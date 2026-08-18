// Drive the running DevHelper WebView2 over CDP: navigate to Star Map, collect
// console errors from the page and its iframe, and report what loaded.
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];

const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, res);
    ws.send(JSON.stringify(msg));
  });

await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    logs.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    logs.push(`[exception] ${d.text} ${d.exception?.description ?? ""} @ ${d.url ?? ""}:${d.lineNumber}`);
  }
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    logs.push(`[log] ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
  }
};

// Auto-attach to iframes so their exceptions arrive too.
await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await send("Runtime.enable");
await send("Log.enable");

await send("Runtime.evaluate", { expression: `window.location.hash = "#/tools/star-map"; true` });
await new Promise((r) => setTimeout(r, 9000));

const frames = await send("Page.getFrameTree").catch(() => null);
const r = await send("Runtime.evaluate", {
  expression: `(() => {
    const f = document.querySelector("iframe");
    if (!f) return "NO IFRAME";
    const d = f.contentDocument;
    if (!d) return "iframe present, no contentDocument (cross-origin?)";
    const scripts = [...d.querySelectorAll("script[src]")].map(s => s.getAttribute("src"));
    const w = f.contentWindow;
    return JSON.stringify({
      src: f.getAttribute("src"),
      readyState: d.readyState,
      title: d.title,
      bodyChildren: d.body ? d.body.children.length : -1,
      scripts,
      hasMap: typeof w.map,
      hasSMX: typeof w.SMX,
      hasS: typeof w.S,
      smxKeys: w.SMX ? Object.keys(w.SMX).slice(0, 20) : null,
      labButton: !!d.querySelector('[data-smx], .smx, #smx-lab, [id*=lab]'),
      topBar: !!d.querySelector('header, .topbar, #topbar, .toolbar'),
    }, null, 1);
  })()`,
  returnByValue: true,
});
console.log("=== iframe state ===");
console.log(r?.result?.value ?? JSON.stringify(r));
console.log("=== console errors ===");
console.log(logs.length ? logs.join("\n") : "(none captured)");
ws.close();
