import { readAgentLogs } from "./log-reader.ts";

interface ChildRequest {
  agentId: string;
  query: string;
}

try {
  const raw = await new Response(Bun.stdin.stream()).text();
  const request = JSON.parse(raw) as ChildRequest;
  const result = readAgentLogs(request.agentId, new URLSearchParams(request.query));
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}
