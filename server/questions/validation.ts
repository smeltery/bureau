import type { QuestionContent } from "../../shared/questions/types.ts";

export class QuestionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function questionContent(input: Record<string, unknown>, previous?: QuestionContent): QuestionContent {
  const prompt = input.prompt === undefined ? previous?.prompt : input.prompt;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 4000) throw new QuestionError("prompt must contain 1–4000 characters");
  const raw = input.options === undefined ? previous?.options : input.options;
  let options: string[] | undefined;
  if (raw !== undefined) {
    if (!Array.isArray(raw) || (raw.length !== 0 && (raw.length < 2 || raw.length > 4)) || raw.some((value) => typeof value !== "string" || !value.trim() || value.length > 80))
      throw new QuestionError("options must contain 2–4 nonempty labels of at most 80 characters, or an empty list");
    options = raw.length ? raw.map((value) => value.trim()) : undefined;
    if (options && new Set(options).size !== options.length) throw new QuestionError("options must be distinct");
  }
  const recommended = input.recommended === null ? undefined : input.recommended === undefined ? (input.options === undefined ? previous?.recommended : undefined) : input.recommended;
  if (recommended !== undefined && (typeof recommended !== "string" || !options?.includes(recommended))) throw new QuestionError("recommended must match an option");
  const link = input.link === null ? undefined : input.link === undefined ? previous?.link : input.link;
  if (link !== undefined && (typeof link !== "string" || !/^\/(?:tasks|apps|schedules|settings|inbox|pager)(?:\?[a-zA-Z0-9_%=&.-]*)?$/.test(link)))
    throw new QuestionError("link must be an office Tasks, Apps, Schedules, Settings or Inbox page");
  return { prompt: prompt.trim(), ...(options ? { options } : {}), ...(recommended ? { recommended: recommended as string } : {}), ...(link ? { link: link as string } : {}) };
}
