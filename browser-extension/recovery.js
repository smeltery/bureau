const recoveringGrants = new Map();

function recoverGrant(grant) {
  grant.recoveryAttempted = true;
  grant.recoveryGeneration = (grant.recoveryGeneration ?? 0) + 1;
  let active = true;
  let timer;
  const owned = () => {
    if (!active || grants.get(grant.id) !== grant || (grant.expiresAt !== null && grant.expiresAt <= Date.now())) throw new Error("Tab sharing ended during recovery");
  };
  const work = (async () => {
    let attached = false;
    try {
      const tab = await chrome.tabs.get(grant.tabId);
      owned();
      if (new URL(tab.url).origin !== grant.origin) throw new Error("Tab left its shared origin");
      const targets = await chrome.debugger.getTargets();
      owned();
      if (!targets.some((target) => target.tabId === grant.tabId && target.type === "page" && target.id === grant.targetId)) throw new Error("Shared page target changed");
      await chrome.debugger.attach({ tabId: grant.tabId }, "1.3");
      attached = true;
      owned();
      const { targetInfo } = await chrome.debugger.sendCommand({ tabId: grant.tabId }, "Target.getTargetInfo");
      owned();
      if (targetInfo.targetId !== grant.targetId) throw new Error("Shared page target changed");
      const { frameTree } = await chrome.debugger.sendCommand({ tabId: grant.tabId }, "Page.getFrameTree");
      owned();
      if (new URL(frameTree.frame.url).origin !== grant.origin) throw new Error("Tab left its shared origin");
      await chrome.debugger.sendCommand({ tabId: grant.tabId }, "Page.enable");
      owned();
    } catch (error) {
      if (attached) await chrome.debugger.detach({ tabId: grant.tabId }).catch(() => {});
      throw error;
    }
  })();
  const completion = Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Browser recovery timed out")), 3000);
    }),
  ])
    .catch(async (error) => {
      lastError = error.message;
      await revoke(grant);
    })
    .finally(() => {
      active = false;
      clearTimeout(timer);
      recoveringGrants.delete(grant.id);
    });
  recoveringGrants.set(grant.id, completion);
  return completion;
}
