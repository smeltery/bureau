import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { MemberQuestion, QuestionContent } from "../../shared/questions/types.ts";
import { atomicWriteFileSync } from "../persistence/paths.ts";
import { QuestionError, questionContent } from "./validation.ts";

export interface QuestionPersistence {
  read(): unknown;
  write(rows: MemberQuestion[]): void;
}
export function questionFile(path: string): QuestionPersistence {
  return {
    read() {
      try {
        return JSON.parse(readFileSync(path, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
    write(rows) {
      mkdirSync(dirname(path), { recursive: true });
      atomicWriteFileSync(path, JSON.stringify(rows, null, 2));
    },
  };
}

type Delivery = (question: MemberQuestion) => { ok: true } | { ok: false; error: string };
export function createQuestionStore(persistence: QuestionPersistence) {
  let rows: MemberQuestion[] | null = null;
  function load(): MemberQuestion[] {
    if (rows) return rows;
    const input = persistence.read();
    if (!Array.isArray(input)) throw new Error("Invalid question storage; the original file was kept");
    const ids = new Set<string>();
    for (const row of input) {
      if (
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        ids.has(row.id) ||
        typeof row.agentId !== "string" ||
        typeof row.memberUserId !== "string" ||
        (row.sessionId !== null && typeof row.sessionId !== "string") ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 1 ||
        !Number.isFinite(row.createdAt) ||
        !Number.isFinite(row.updatedAt) ||
        !["open", "delivering", "delivered", "failed", "uncertain"].includes(row.status)
      )
        throw new Error("Invalid question storage; the original file was kept");
      questionContent(row);
      if (row.status === "open" && row.answer !== undefined) throw new Error("Invalid open question storage; the original file was kept");
      if (
        row.status !== "open" &&
        (!row.answer ||
          typeof row.answer.text !== "string" ||
          typeof row.answer.dismissed !== "boolean" ||
          typeof row.answer.username !== "string" ||
          row.answer.userId !== row.memberUserId ||
          typeof row.answer.attemptId !== "string")
      )
        throw new Error("Invalid question answer storage; the original file was kept");
      ids.add(row.id);
    }
    // Delivery may have reached the queue before a process stopped. Never
    // retry that ambiguous operation automatically after restart.
    rows = input.map((row) => ({ ...row, status: row.status === "delivering" ? "uncertain" : row.status }));
    return rows!;
  }
  function put(row: MemberQuestion): MemberQuestion {
    const next = [...load().filter((item) => item.id !== row.id), row];
    persistence.write(next);
    rows = next;
    return structuredClone(row);
  }
  function get(id: string): MemberQuestion {
    const row = load().find((item) => item.id === id);
    if (!row) throw new QuestionError("Question not found", 404);
    return structuredClone(row);
  }
  function version(row: MemberQuestion, revision: number) {
    if (row.revision !== revision) throw new QuestionError("This question changed. Refresh before answering or editing.", 409);
  }
  function deliver(row: MemberQuestion, send: Delivery): MemberQuestion {
    const started = put({ ...row, status: "delivering", updatedAt: Date.now() });
    let status: MemberQuestion["status"] = "uncertain",
      error: string | undefined;
    try {
      const result = send(started);
      status = result.ok ? "delivered" : "failed";
      if (!result.ok) error = result.error;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Delivery could not be confirmed";
    }
    const settled: MemberQuestion = { ...started, status, answer: { ...started.answer!, error }, updatedAt: Date.now() };
    try {
      return put(settled);
    } catch (caught) {
      // Preserve the known outcome for same-process retries even when the
      // receipt write fails. The durable "delivering" row becomes uncertain
      // on restart; it still contains the member's complete answer.
      rows = load().map((item) => (item.id === row.id ? settled : item));
      console.error("[questions] could not persist delivery receipt:", caught);
      return structuredClone(settled);
    }
  }
  return {
    list: () => structuredClone(load()),
    get,
    create(identity: Pick<MemberQuestion, "agentId" | "memberUserId" | "sessionId">, content: QuestionContent) {
      if (load().filter((row) => row.agentId === identity.agentId && row.status === "open").length >= 50) throw new QuestionError("At most 50 open questions per agent", 429);
      const now = Date.now();
      return put({ ...identity, ...questionContent(content as unknown as Record<string, unknown>), id: crypto.randomUUID(), revision: 1, status: "open", createdAt: now, updatedAt: now });
    },
    edit(id: string, revision: number, input: Record<string, unknown>) {
      const row = get(id);
      version(row, revision);
      if (row.status !== "open") throw new QuestionError("An answered question cannot be edited", 409);
      const { options: _options, recommended: _recommended, link: _link, ...base } = row;
      return put({ ...base, ...questionContent(input, row), revision: row.revision + 1, updatedAt: Date.now() });
    },
    remove(id: string, revision: number) {
      const row = get(id);
      version(row, revision);
      if (row.status === "delivering") throw new QuestionError("An answer is being delivered", 409);
      const next = load().filter((item) => item.id !== id);
      persistence.write(next);
      rows = next;
    },
    answer(id: string, revision: number, answer: { text: string; dismissed: boolean; username: string; userId: string }, send: Delivery) {
      const row = get(id);
      version(row, revision);
      if (row.memberUserId !== answer.userId) throw new QuestionError("Only the addressed member may answer", 403);
      if (row.answer) {
        if (row.answer.text === answer.text && row.answer.dismissed === answer.dismissed) return row;
        throw new QuestionError("This question already has an answer", 409);
      }
      if (typeof answer.text !== "string" || answer.text.length > 8000 || (!answer.dismissed && !answer.text.trim())) throw new QuestionError("Answer must contain 1–8000 characters");
      return deliver({ ...row, answer: { ...answer, attemptId: crypto.randomUUID() } }, send);
    },
    retry(id: string, revision: number, confirmedUncertain: boolean, send: Delivery) {
      const row = get(id);
      version(row, revision);
      if (row.status !== "failed" && row.status !== "uncertain") throw new QuestionError("This answer does not need retrying", 409);
      if (row.status === "uncertain" && !confirmedUncertain) throw new QuestionError("Check the conversation before confirming a retry; the answer may already have arrived", 409);
      return deliver({ ...row, answer: { ...row.answer!, attemptId: crypto.randomUUID() } }, send);
    },
  };
}
