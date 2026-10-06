const byId = (id) => document.getElementById(id);
let tab;
async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response.error) throw new Error(response.error);
  return response.result;
}
async function action(work) {
  byId("error").textContent = "";
  const buttons = [...document.querySelectorAll("button")];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  try {
    await work();
    await refresh();
  } catch (error) {
    byId("error").textContent = error.message;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}
async function refresh() {
  const state = await send({ action: "status" });
  if (state.error) byId("error").textContent = state.error;
  byId("connected").hidden = !state.office;
  byId("pair").hidden = !!state.office;
  if (!state.office) return;
  byId("office-name").textContent = state.office;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  byId("tab-name").textContent = tab?.title ?? "No active tab";
  byId("agents").replaceChildren();
  for (const agent of state.agents) {
    const label = document.createElement("label"),
      checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = agent.id;
    label.append(checkbox, document.createTextNode(` ${agent.name}`));
    byId("agents").append(label);
  }
  if (!state.agents.length) byId("agents").textContent = "Create an agent you manage in the office first.";
  byId("grants").replaceChildren();
  for (const grant of state.grants) {
    const div = document.createElement("div"),
      text = document.createElement("p"),
      button = document.createElement("button");
    div.className = "grant";
    text.textContent = `${grant.title} · ${grant.origin} · ${grant.expiresAt ? new Date(grant.expiresAt).toLocaleTimeString() : "Until revoked"}`;
    button.textContent = "Stop sharing";
    button.onclick = () => void action(() => send({ action: "revoke", id: grant.id }));
    div.append(text, button);
    byId("grants").append(div);
  }
}
byId("pair").onsubmit = (event) => {
  event.preventDefault();
  // Request optional host access during the click gesture, before awaiting.
  let office;
  try {
    office = new URL(byId("office").value).origin;
  } catch {
    byId("error").textContent = "Enter a valid office URL";
    return;
  }
  const permission = chrome.permissions.request({ origins: [`${office}/*`] });
  void action(async () => {
    if (!(await permission)) throw new Error("Office permission was not granted");
    await send({ action: "pair", office, code: byId("code").value.trim() });
    byId("code").value = "";
  });
};
byId("share").onclick = () =>
  void action(() =>
    send({
      action: "share",
      tabId: tab?.id,
      agentIds: [...byId("agents").querySelectorAll("input:checked")].map((input) => input.value),
      minutes: byId("minutes").value ? Number(byId("minutes").value) : null,
    }),
  );
void action(async () => {});
