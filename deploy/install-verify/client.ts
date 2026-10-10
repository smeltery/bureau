import assert from "node:assert/strict";

export async function eventually<T>(probe: () => T | Promise<T>, label: string, timeout = 45000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
export async function waitForHttp(base: string, path = "/"): Promise<void> {
  await eventually(async () => {
    try {
      return (await fetch(base + path, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      return false;
    }
  }, `HTTP ${path}`);
}
export async function claim(base: string, origin: string, setupKey?: string): Promise<string> {
  await waitForHttp(base);
  const post = (fields: Record<string, string>, requestOrigin = origin) =>
    fetch(base + (setupKey ? "/setup" : "/auth/claim"), {
      method: "POST",
      redirect: "manual",
      headers: { origin: requestOrigin, host: new URL(origin).host },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(10000),
    });
  if (setupKey) assert.equal((await post({ key: "incorrect", name: "Install Owner" })).status, 403);
  assert.equal((await post({ key: setupKey ?? "", name: "Install Owner" }, "https://foreign.invalid")).status, 403);
  const response = await post({ key: setupKey ?? "", name: "Install Owner" });
  assert.equal(response.status, setupKey ? 200 : 302, await response.clone().text());
  const cookieHeader = response.headers.get("set-cookie");
  assert.ok(cookieHeader?.includes("HttpOnly"));
  if (setupKey) assert.ok(cookieHeader.includes("Secure"));
  const replay = await post({ key: setupKey ?? "", name: "Second Owner" });
  assert.ok([400, 409].includes(replay.status), `Repeated claim: ${replay.status}`);
  await waitForHttp(base, "/readyz");
  return cookieHeader.split(";")[0];
}
export async function exerciseOffice(base: string, origin: string, cookie: string, cwd: string): Promise<void> {
  const messages: any[] = [];
  let failure: Error | null = null;
  const socket = new WebSocket(base.replace(/^http/, "ws") + "/ws", { headers: { origin, host: new URL(origin).host, cookie } });
  socket.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));
  socket.addEventListener("error", () => {
    failure = new Error("Office WebSocket failed");
  });
  const wait = (predicate: (message: any) => boolean, label: string) =>
    eventually(() => {
      if (failure) throw failure;
      return messages.find(predicate);
    }, label);
  const send = (value: unknown) => socket.send(JSON.stringify(value));
  try {
    const state = await wait((message) => message.type === "full_state", "initial office state");
    assert.ok(state.rooms.length);
    const identity = await wait((message) => message.type === "session_context", "owner identity");
    assert.equal(identity.context.role, "owner");
    for (const [offset, provider] of ["claude", "codex"].entries()) {
      const name = `Install ${provider}`;
      send({ type: "spawn", name, cwd, roomId: state.rooms[0].id, desk: 4 + offset, agentType: provider, permissionMode: provider === "codex" ? "on-request" : "default" });
      const added = await wait((message) => message.type === "agent_added" && message.agent.name === name, `${provider} agent creation`);
      const agentId = added.agent.id;
      if (offset === 0) {
        send({ type: "terminal_open", agentId });
        await wait((message) => message.type === "terminal_output" && message.agentId === agentId, "first terminal output");
        // The expected output is absent from echoed input; only execution can pass.
        send({ type: "terminal_input", agentId, data: "printf '\\102\\125\\122\\105\\101\\125\\137\\120\\124\\131\\137\\117\\113\\n'\r" });
        await eventually(
          () =>
            messages
              .filter((message) => message.type === "terminal_output" && message.agentId === agentId)
              .map((message) => message.data)
              .join("")
              .includes("BUREAU_PTY_OK"),
          "PTY command execution",
        );
        send({ type: "terminal_close", agentId });
      }
      send({ type: "send_message", agentId, text: "Fresh-install signed-out check. Do not run tools.", username: "Install Owner" });
      await wait((message) => message.type === "log_entry" && message.entry.agentId === agentId && message.entry.metadata?.providerLogin === provider, `${provider} sign-in guidance`);
      send({ type: "kill", agentId });
    }
    assert.equal((await fetch(base + "/readyz")).status, 200);
  } catch (error) {
    console.error("Install check events:", JSON.stringify(messages.filter((message) => message.type === "log_entry" || message.type === "terminal_exit").slice(-30)));
    throw error;
  } finally {
    socket.close();
  }
  console.log("PASS: owner identity, Claude/Codex creation, first PTY, signed-out guidance, readiness");
}
