const send = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
async function assertOrigin(tabId, origin) {
  const { frameTree } = await send(tabId, "Page.getFrameTree");
  if (new URL(frameTree.frame.url).origin !== origin) throw new Error("Tab left its shared origin");
}
async function evaluate(tabId, origin, expression) {
  const result = await send(tabId, "Runtime.evaluate", {
    expression: `(() => { if (location.origin !== ${JSON.stringify(origin)}) throw new Error("Tab left its shared origin"); return (${expression}); })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error("Page action failed; check the selector");
  return result.result.value;
}
async function execute(command) {
  const { tabId, origin, input } = command;
  await assertOrigin(tabId, origin);
  let result;
  if (input.action === "read") {
    result = await evaluate(
      tabId,
      origin,
      `({title: document.title, url: location.href, text: document.body.innerText.slice(0, 32000), elements: Array.from(document.querySelectorAll('a,button,input,textarea,select')).slice(0,200).map(e => ({tag:e.tagName, text:(e.innerText || e.getAttribute('aria-label') || '').slice(0,150), selector:e.id ? '#'+CSS.escape(e.id) : null, type:e.type}))})`,
    );
  } else if (input.action === "screenshot") {
    result = await send(tabId, "Page.captureScreenshot", { format: "jpeg", quality: 60 });
    if (result.data.length > 1_900_000) throw new Error("Screenshot exceeds the transfer limit");
    result = { mimeType: "image/jpeg", base64: result.data };
  } else if (input.action === "upload") {
    if (!input.file || typeof input.file.base64 !== "string" || input.file.base64.length > 1_398_104) throw new Error("Upload exceeds the transfer limit");
    result = await evaluate(
      tabId,
      origin,
      `(() => { const e=document.querySelector(${JSON.stringify(input.selector)}); if(!(e instanceof HTMLInputElement) || e.type!=='file' || e.disabled) throw new Error('File input unavailable'); const f=${JSON.stringify(input.file)}; const bytes=Uint8Array.from(atob(f.base64), c=>c.charCodeAt(0)); if(bytes.length>1048576) throw new Error('Upload exceeds the transfer limit'); const file=new File([bytes], f.name, {type:f.mimeType}); const transfer=new DataTransfer(); transfer.items.add(file); e.files=transfer.files; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return {name:file.name,mimeType:file.type,size:file.size}; })()`,
    );
  } else if (input.action === "navigate") {
    if (new URL(input.url).origin !== origin) throw new Error("Navigation must stay on the shared origin");
    result = await send(tabId, "Page.navigate", { url: input.url });
    if (result.errorText) throw new Error(result.errorText);
  } else if (input.action === "click" || input.action === "type") {
    const selector = JSON.stringify(input.selector);
    await evaluate(
      tabId,
      origin,
      `(() => { const e=document.querySelector(${selector}); if(!e || e.type==='file') throw new Error('Element unavailable'); e.${input.action === "click" ? "click" : "focus"}(); return true; })()`,
    );
    if (input.action === "type") {
      await assertOrigin(tabId, origin);
      await send(tabId, "Input.insertText", { text: input.text });
    }
    result = { ok: true };
  } else throw new Error("Unsupported action");
  await assertOrigin(tabId, origin);
  return result;
}
