import { join } from "node:path";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { agents, rooms } from "../agents/state.ts";
import { enqueueMessage } from "../agents/conversation/message-queue.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { canSeeRoom, getUserById, getUserByName } from "../users.ts";
import type { MemberQuestion } from "../../shared/questions/types.ts";
import { createQuestionStore, questionFile } from "./store.ts";
import { QuestionError, questionContent } from "./validation.ts";

export const questions = createQuestionStore(questionFile(join(BUREAU_DIR, "questions.json")));
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function visible(question: MemberQuestion, userId: string): boolean {
  const user = getUserById(userId),
    agent = agents.get(question.agentId);
  const room = agent && rooms[agent.info.room];
  return !!user && question.memberUserId === userId && !!room && canSeeRoom(user, room.id);
}
function agentIdentity(req: Request, id: string) {
  const identity = resolveAgentToken(readBearerToken(req)),
    agent = agents.get(id);
  if (!identity || identity.agentId !== id || !agent || (agent.info.userId ?? null) !== identity.userId || (identity.userId && !getUserById(identity.userId)))
    throw new QuestionError("A current bearer for this agent is required", 403);
  return agent;
}
async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 32 * 1024) throw new QuestionError("Question request is too large", 413);
  try {
    body = JSON.parse(raw);
  } catch {
    throw new QuestionError("Invalid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new QuestionError("Body must be an object");
  return body as Record<string, unknown>;
}
function knownKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((key) => !keys.includes(key))) throw new QuestionError("Unknown question field");
}
function revision(body: Record<string, unknown>): number {
  if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new QuestionError("The current revision is required");
  return body.revision as number;
}
function deliver(question: MemberQuestion) {
  const answer = question.answer!,
    agent = agents.get(question.agentId);
  if (!visible(question, answer.userId) || !agent) return { ok: false as const, error: "The agent or room is no longer accessible" };
  if (agent.sessionId !== question.sessionId) return { ok: false as const, error: "The agent started a different conversation. Open its chat before sending this answer manually." };
  if (agent.info.pendingPrompt) return { ok: false as const, error: "Finish the agent's pending permission or selection first" };
  const text = `Question: ${question.prompt}\n\n${answer.dismissed ? "Dismissed by the addressed member" : "Answer"}${answer.text ? `: ${answer.text}` : "."}`;
  const result = enqueueMessage(question.agentId, { sender: { kind: "user", username: answer.username }, text, clientMessageId: `question-${answer.attemptId}` });
  return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
}

export async function handleQuestionsRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  const agentRoute = /^\/api\/agents\/([^/]+)\/questions(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
  const memberRoute = /^\/api\/questions(?:\/([a-f0-9-]{36})(?:\/(answer|dismiss|retry))?)?$/.exec(url.pathname);
  if (!agentRoute && !memberRoute) return null;
  try {
    if (agentRoute) {
      const [, agentId, id] = agentRoute;
      let agent = agentIdentity(req, agentId);
      const own = () => {
        const question = questions.get(id);
        if (question.agentId !== agentId) throw new QuestionError("Question not found", 404);
        return question;
      };
      if (req.method === "GET") return json(id ? own() : { questions: questions.list().filter((row) => row.agentId === agentId) });
      if (!(id ? ["PATCH", "DELETE"] : ["POST"]).includes(req.method)) return json({ error: "Method not allowed" }, 405);
      const body = await bodyOf(req);
      agent = agentIdentity(req, agentId);
      if (req.method === "POST" && !id) {
        knownKeys(body, ["prompt", "member", "options", "recommended", "link"]);
        if (body.member !== undefined && typeof body.member !== "string") throw new QuestionError("member must be a username");
        const member = typeof body.member === "string" ? getUserByName(body.member) : agent.info.userId ? getUserById(agent.info.userId) : null;
        const room = rooms[agent.info.room];
        if (!member || !room || !canSeeRoom(member, room.id)) throw new QuestionError("Choose a member who can access this agent's room", 422);
        return json(questions.create({ agentId, memberUserId: member.id, sessionId: agent.sessionId }, questionContent(body)), 201);
      }
      if (!id) return json({ error: "Method not allowed" }, 405);
      const current = own();
      if (req.method === "PATCH") {
        knownKeys(body, ["revision", "prompt", "options", "recommended", "link"]);
        return json(questions.edit(id, revision(body), body));
      }
      if (req.method === "DELETE") {
        knownKeys(body, ["revision"]);
        if (current.status !== "open") throw new QuestionError("Only the member can remove an answered question", 409);
        questions.remove(id, revision(body));
        return new Response(null, { status: 204 });
      }
    } else if (memberRoute) {
      if (auth?.kind !== "ok" || !getUserById(auth.session.userId)) throw new QuestionError("A browser session is required", 401);
      const userId = auth.session.userId;
      const [, id, action] = memberRoute;
      const addressed = () => {
        const row = questions.get(id);
        if (!visible(row, userId)) throw new QuestionError("Question not found", 404);
        return row;
      };
      if (req.method === "GET" && !action)
        return json(id ? addressed() : { questions: questions.list().filter((row) => visible(row, userId) && (!url.searchParams.get("agentId") || row.agentId === url.searchParams.get("agentId"))) });
      if (!id || !(action ? req.method === "POST" : req.method === "DELETE")) return json({ error: "Method not allowed" }, 405);
      const body = await bodyOf(req);
      const row = addressed(),
        user = getUserById(userId)!;
      if (req.method === "DELETE" && !action) {
        knownKeys(body, ["revision"]);
        if (row.status === "open") throw new QuestionError("Dismiss an open question instead", 409);
        questions.remove(id, revision(body));
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST" && (action === "answer" || action === "dismiss")) {
        knownKeys(body, ["revision", "text"]);
        if (body.text !== undefined && typeof body.text !== "string") throw new QuestionError("text must be a string");
        return json(questions.answer(id, revision(body), { text: (body.text as string | undefined) ?? "", dismissed: action === "dismiss", userId, username: user.name }, deliver));
      }
      if (req.method === "POST" && action === "retry") {
        knownKeys(body, ["revision", "confirmedUncertain"]);
        return json(questions.retry(id, revision(body), body.confirmedUncertain === true, deliver));
      }
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof QuestionError) return json({ error: error.message }, error.status);
    console.error("[questions] request failed:", error);
    return json({ error: "Question storage is unavailable. The existing data was kept; check the server log." }, 500);
  }
}
