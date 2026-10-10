const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };
let token = store.get("token");
let sessionId = null, runId = null, path = ".";

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 401) { logout(); throw new Error("token inválido"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r;
}
const status = (m) => ($("status").textContent = m || "");
const add = (text, cls) => { const s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; $("out").appendChild(s); $("out").scrollTop = 1e9; };

function logout() { store.del("token"); token = null; $("app").hidden = true; $("login").hidden = false; $("logout").hidden = true; }
async function enter() {
  try {
    const projects = await (await api("/api/projects")).json();
    $("project").replaceChildren(...projects.map((p) => new Option(p.name, p.name)));
    $("login").hidden = true; $("app").hidden = false; $("logout").hidden = false; status("");
  } catch (e) { status(e.message); }
}
$("loginBtn").onclick = () => { token = $("token").value.trim(); $("token").value = ""; store.set("token", token); enter(); };
$("logout").onclick = logout;
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== b.dataset.tab));
  if (b.dataset.tab === "files") loadFiles("."); if (b.dataset.tab === "sessions") loadSessions();
}));
$("newSession").onclick = () => { sessionId = null; $("out").replaceChildren(); status("nova sessão"); };

async function streamRun(id) {
  const r = await api(`/api/runs/${id}/stream`, { headers: { accept: "text/event-stream" } });
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const e = JSON.parse(line.slice(6));
      if (e.type === "text") add(e.text);
      else if (e.type === "tool") add(`\n⚙ ${e.name} ${e.input}\n`, "tool");
      else if (e.type === "error") add(`\n${e.message}\n`, "err");
      else if (e.type === "end") status(`fim: ${e.status}`);
    }
  }
}
$("send").onclick = async () => {
  const prompt = $("prompt").value.trim(); if (!prompt) return;
  $("prompt").value = ""; add(`\n› ${prompt}\n`, "tool"); $("send").disabled = true; $("cancel").hidden = false; status("executando…");
  try {
    const body = sessionId ? { prompt, sessionId } : { prompt, project: $("project").value, profile: $("profile").value };
    const r = await (await api("/api/runs", { method: "POST", body: JSON.stringify(body) })).json();
    sessionId = r.sessionId; runId = r.runId;
    await streamRun(runId);
  } catch (e) { add(`\n${e.message}\n`, "err"); status(""); }
  $("send").disabled = false; $("cancel").hidden = true; runId = null;
};
$("cancel").onclick = () => runId && api(`/api/runs/${runId}/cancel`, { method: "POST" });

async function loadFiles(p) {
  path = p;
  const q = new URLSearchParams({ project: $("project").value, path: p });
  try {
    const list = await (await api(`/api/files?${q}`)).json();
    $("crumb").textContent = `/${p === "." ? "" : p}`;
    $("fileView").textContent = "";
    const items = list.map((e) => { const li = document.createElement("li"); li.textContent = (e.type === "dir" ? "📁 " : "📄 ") + e.name; li.onclick = () => open(e); return li; });
    if (p !== ".") { const up = document.createElement("li"); up.textContent = "↩ ..";  up.onclick = () => loadFiles(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "."); items.unshift(up); }
    $("fileList").replaceChildren(...items);
  } catch (e) { status(e.message); }
}
async function open(e) {
  const p = path === "." ? e.name : `${path}/${e.name}`;
  if (e.type === "dir") return loadFiles(p);
  try { $("fileView").textContent = (await (await api(`/api/file?${new URLSearchParams({ project: $("project").value, path: p })}`)).json()).content; } catch (err) { status(err.message); }
}
async function loadSessions() {
  const list = await (await api("/api/sessions")).json();
  $("sessionList").replaceChildren(...list.map((s) => { const li = document.createElement("li"); li.textContent = `${s.project} · ${s.title} (${s.profile})`; li.onclick = () => { sessionId = s.id; $("out").replaceChildren(); status("sessão retomada"); document.querySelector('[data-tab=chat]').click(); }; return li; }));
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
if (token) enter();
