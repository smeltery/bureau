importScripts("actions.js");
let connection;
const grants = new Map();
const expiryTimers = new Map();
let polling = false;
let lastError = null;
const ready = (async () => {
  connection = (await chrome.storage.local.get("connection")).connection;
  // A worker restart never silently restores control of a tab.
  const previous = (await chrome.storage.session.get("grants")).grants ?? [];
  for (const grant of previous) {
    await chrome.debugger.detach({ tabId: grant.tabId }).catch(() => {});
    await api(`grants/${grant.id}`, "DELETE").catch(() => {});
  }
  await persist();
  await chrome.alarms.create("sharing", { periodInMinutes: 0.5 });
})();
async function api(path, method = "GET", body) {
  if (!connection) throw new Error("Pair this browser first");
  const response = await fetch(`${connection.office}/browser-sharing/extension/${path}`, {
    method,
    credentials: "omit",
    headers: { "X-Bureau-Extension": chrome.runtime.id, Authorization: `Bearer ${connection.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}
async function persist() {
  await chrome.storage.session.set({ grants: [...grants.values()] });
  await chrome.action.setBadgeText({ text: grants.size ? String(grants.size) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#b45309" });
}
async function revoke(grant) {
  grants.delete(grant.id);
  clearTimeout(expiryTimers.get(grant.id));
  expiryTimers.delete(grant.id);
  await chrome.debugger.detach({ tabId: grant.tabId }).catch(() => {});
  // Local detachment is authoritative even when persistence or the office fails.
  try {
    await persist();
  } finally {
    await api(`grants/${grant.id}`, "DELETE").catch(() => {});
  }
}
async function poll() {
  await ready;
  if (polling || !connection || !grants.size) return;
  polling = true;
  try {
    for (const grant of [...grants.values()]) if (grant.expiresAt !== null && grant.expiresAt <= Date.now()) await revoke(grant);
    const state = await api("poll");
    for (const grant of [...grants.values()]) if (!state.grants.some((row) => row.id === grant.id)) await revoke(grant);
    for (const command of state.commands) {
      const grant = grants.get(command.grantId);
      if (!grant || grant.tabId !== command.tabId || grant.origin !== command.origin) continue;
      let result, error;
      try {
        let timer;
        try {
          result = await Promise.race([
            execute(command),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error("Browser action timed out")), 14000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      } catch (caught) {
        error = caught.message;
        lastError = error;
        await revoke(grant);
      }
      if (grants.has(grant.id)) await api(`results/${command.id}`, "POST", { result, error });
    }
  } catch (error) {
    lastError = error.message;
    // Lose connectivity => lose control. The user can explicitly share again.
    for (const grant of [...grants.values()]) await revoke(grant);
  } finally {
    polling = false;
  }
}
setInterval(() => void poll(), 1000);
chrome.alarms.onAlarm.addListener(() => void poll());
chrome.debugger.onDetach.addListener(({ tabId }) => {
  for (const grant of grants.values()) if (grant.tabId === tabId) void revoke(grant);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const grant of grants.values()) if (grant.tabId === tabId) void revoke(grant);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  for (const grant of grants.values()) if (grant.tabId === tabId && new URL(change.url).origin !== grant.origin) void revoke(grant);
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return false;
  void handle(message).then(
    (result) => respond({ result }),
    (error) => respond({ error: error.message }),
  );
  return true;
});
async function handle(message) {
  await ready;
  if (message.action === "pair") {
    const office = new URL(message.office);
    if (office.username || office.password || (office.protocol !== "https:" && !(office.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(office.hostname))))
      throw new Error("Use HTTPS, or HTTP on localhost");
    if (grants.size) throw new Error("Stop sharing all tabs before pairing another office");
    const response = await fetch(`${office.origin}/browser-sharing/extension/pair`, {
      method: "POST",
      credentials: "omit",
      headers: { "X-Bureau-Extension": chrome.runtime.id, "Content-Type": "application/json" },
      body: JSON.stringify({ code: message.code, name: "Chrome browser" }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    connection = { office: office.origin, token: data.token };
    await chrome.storage.local.set({ connection });
    return { office: connection.office };
  }
  if (message.action === "status") return { error: lastError, office: connection?.office, grants: [...grants.values()], agents: connection ? await api("agents") : [] };
  if (message.action === "revoke") {
    const grant = grants.get(message.id);
    if (grant) await revoke(grant);
    return {};
  }
  if (message.action === "share") {
    lastError = null;
    const tab = await chrome.tabs.get(message.tabId);
    if (!["http:", "https:"].includes(new URL(tab.url).protocol)) throw new Error("Only HTTP and HTTPS tabs can be shared");
    for (const grant of grants.values()) if (grant.tabId === tab.id) await revoke(grant);
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    try {
      const grant = await api("grants", "POST", { tabId: tab.id, title: tab.title, url: tab.url, agentIds: message.agentIds, minutes: message.minutes });
      grants.set(grant.id, grant);
      if (grant.expiresAt !== null)
        expiryTimers.set(
          grant.id,
          setTimeout(() => void revoke(grant), Math.max(0, grant.expiresAt - Date.now())),
        );
      await persist();
      return grant;
    } catch (error) {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
      throw error;
    }
  }
  throw new Error("Unknown action");
}
