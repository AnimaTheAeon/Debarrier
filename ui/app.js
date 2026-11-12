"use strict";
/* DeBarrier for DSM — window UI. Talks to the service through api.cgi using
   the DSM session (cookie + SynoToken). Polls only while visible. */

const PAGES = [["status", "Status"], ["activity", "Activity"], ["config", "Settings"]];
/* Pages reachable without a menu entry (the log opens from Settings). */
const HIDDEN_PAGES = { log: "config" };
const ENGINE_NAMES = { flaresolverr: "FlareSolverr", byparr: "Byparr" };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let token = "";
let status = null;
let config = null;
let page = "status";
let pollTimer = null;

// ---------- API ----------

async function getToken() {
  try {
    const r = await fetch("/webman/login.cgi", { credentials: "same-origin" });
    const j = await r.json();
    token = j.SynoToken || "";
  } catch (e) { token = ""; }
}

async function api(route, body) {
  const opts = {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "X-SYNO-TOKEN": token },
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch("api.cgi?r=" + encodeURIComponent(route), opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (res.status === 401) {
    showOverlay("Sign in needed", esc(data.error || "Your DSM session has expired. Sign in to DSM again."));
    throw new Error("auth");
  }
  if (res.status === 503) {
    showOverlay("DeBarrier isn't running", esc(data.error || "Start DeBarrier in Package Center."));
    throw new Error("down");
  }
  hideOverlay();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showOverlay(title, html) {
  $("#overlay-title").textContent = title;
  $("#overlay-text").innerHTML = html;
  $("#overlay").classList.add("open");
}
function hideOverlay() { $("#overlay").classList.remove("open"); }

// ---------- menu ----------

function buildMenu() {
  const nav = $("#menu");
  nav.innerHTML = PAGES.map(([id, label]) =>
    `<button class="menu-item" data-go="${id}"><svg class="hand"><use href="#hand"/></svg>${label}</button>`).join("");
  nav.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) {
      nav.classList.add("menu-used");
      go(b.dataset.go);
    }
  });
  go(location.hash.slice(1) || "status");
}

// ---------- Box of X look ----------

let greenHome = true;
let greenCursor = 0;
const isGreen = () => document.body.classList.contains("green");

function applyTheme(theme) {
  const green = theme === "green";
  $$("#theme-pick [data-theme]").forEach((b) => b.classList.toggle("picked", b.dataset.theme === (green ? "green" : "ff")));
  if (green === isGreen() && document.body.dataset.themed) return;
  document.body.dataset.themed = "1";
  document.body.classList.toggle("green", green);
  if (green) greenShowHome(false);
  else document.body.classList.remove("g-at-home");
}

function buildGreenMenu() {
  $("#g-menu").innerHTML = PAGES.map(([id, label], i) =>
    `<button class="g-tab" data-g="${i}"><span class="g-node"></span><span class="g-plate">${esc(label.toUpperCase())}</span></button>`).join("");
  $("#g-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (b) greenOpen(Number(b.dataset.g));
  });
  $("#g-menu").addEventListener("mouseover", (e) => {
    const b = e.target.closest("[data-g]");
    if (b) { greenCursor = Number(b.dataset.g); greenMarkCursor(); }
  });
  $("#g-select").onclick = () => greenOpen(greenCursor);
  $("#g-back").onclick = greenBack;
  document.addEventListener("keydown", (e) => {
    if (!isGreen()) return;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "");
    if (greenHome) {
      if (e.key === "ArrowDown") { greenCursor = (greenCursor + 1) % PAGES.length; greenMarkCursor(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { greenCursor = (greenCursor + PAGES.length - 1) % PAGES.length; greenMarkCursor(); e.preventDefault(); }
      else if (e.key === "Enter") { greenOpen(greenCursor); e.preventDefault(); }
    } else if (e.key === "Escape" && !typing) {
      greenBack();
    } else if (e.key === "Escape" && typing) {
      document.activeElement.blur();
    }
  });
  document.addEventListener("mouseup", (e) => { if (e.button === 3 && isGreen() && !greenHome) greenBack(); });
  greenMarkCursor();
}

function greenMarkCursor() {
  $$("#g-menu .g-tab").forEach((b, i) => b.classList.toggle("lit", i === greenCursor));
}

function greenOpen(i) {
  greenCursor = i;
  greenMarkCursor();
  document.body.classList.add("g-zoom");
  setTimeout(() => {
    greenHome = false;
    document.body.classList.remove("g-at-home", "g-zoom");
    go(PAGES[i][0]);
    document.body.classList.add("g-reveal");
    setTimeout(() => document.body.classList.remove("g-reveal"), 320);
  }, 280);
}

function greenBack() {
  if (page === "log") { go("config"); return; }
  greenShowHome(true);
}

function greenShowHome(animate) {
  greenHome = true;
  greenCursor = Math.max(0, PAGES.findIndex(([p]) => p === (HIDDEN_PAGES[page] || page)));
  greenMarkCursor();
  document.body.classList.add("g-at-home");
  if (animate) {
    document.body.classList.add("g-unzoom");
    setTimeout(() => document.body.classList.remove("g-unzoom"), 320);
  }
}

function renderGreenStatus(busy) {
  if (!status) return;
  const top = `${Number(status.solved).toLocaleString()} SOLVED · ${Number(status.failed).toLocaleString()} FAILED TODAY`;
  const bottom = $("#statusbar").textContent;
  $$(".g-status .g-top").forEach((el) => { el.textContent = top; });
  $$(".g-status .g-bottom").forEach((el) => { el.textContent = bottom; });
  $$(".g-status").forEach((el) => el.classList.toggle("busy", busy));
}

function go(id) {
  if (!PAGES.some(([p]) => p === id) && !HIDDEN_PAGES[id]) id = "status";
  page = id;
  const menuId = HIDDEN_PAGES[id] || id;
  $$(".menu-item").forEach((b) => b.classList.toggle("selected", b.dataset.go === menuId));
  $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === id));
  history.replaceState(null, "", "#" + id);
  const title = $("#g-title");
  if (title) title.textContent = (PAGES.find(([p]) => p === id) || [id, id === "log" ? "Log" : id])[1].toUpperCase();
  refresh();
}

// ---------- rendering ----------

function ago(secs) {
  if (secs < 90) return "just now";
  if (secs < 5400) return Math.round(secs / 60) + " min ago";
  if (secs < 129600) return Math.round(secs / 3600) + " h ago";
  return Math.round(secs / 86400) + " days ago";
}

const secs = (ms) => (ms < 1000 ? "under 1s" : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s");

function engineTag(e) {
  if (e.state === "ready") return e.busy ? ["WORKING", "warn"] : ["READY", "good"];
  if (e.state === "checking") return ["CHECKING", "warn"];
  return ["NOT RUNNING", "bad"];
}

function renderEngines() {
  const box = $("#engines");
  box.innerHTML = status.engines.map((e) => {
    const [tag, cls] = engineTag(e);
    const ver = e.version ? `v${esc(e.version)}` : "";
    const counts = e.solved_today || e.failed_today
      ? `${Number(e.solved_today).toLocaleString()} solved · ${Number(e.failed_today).toLocaleString()} failed today`
      : "Nothing yet today";
    let help = "";
    if (e.state === "offline") {
      help = e.ever_up
        ? `<div class="notice">${esc(e.name)} stopped answering. Open <b>Container Manager</b> &rarr; <b>Project</b> &rarr; <b>debarrier</b> and start it, or stop and start DeBarrier in Package Center.</div>`
        : `<div class="notice">Not running yet. On a new install, Container Manager downloads ${esc(e.name)} first, which can take several minutes. If it doesn't start, open <b>Container Manager</b> &rarr; <b>Project</b> &rarr; <b>debarrier</b>.</div>`;
    }
    const use = e.active
      ? `<span class="tag active-tag">IN USE</span>`
      : `<button class="small" data-use="${esc(e.id)}">Use this one</button>`;
    return `<div class="party">
      <div class="orb ${esc(e.id)}"></div>
      <div class="body">
        <div class="title"><span class="name">${esc(e.name)}</span><span class="tag ${cls}">${tag}</span>
          <span class="actions">${use}</span></div>
        <div class="stats"><span class="dim">${[ver, counts].filter(Boolean).join(" · ")}</span></div>
        ${help}
      </div></div>`;
  }).join("");
}

function renderTest() {
  const t = status.test || { state: "idle" };
  const el = $("#test-result");
  $("#test-go").disabled = t.state === "running";
  if (t.state === "running") {
    el.innerHTML = `<span class="warn">Trying ${esc(t.url)}…</span> <span class="dim">This can take up to a minute.</span>`;
  } else if (t.state === "done") {
    const via = ENGINE_NAMES[t.engine] || t.engine;
    const second = t.tried && t.tried.length > 1 ? ` (after ${esc(ENGINE_NAMES[t.tried[0]])} couldn't)` : "";
    el.innerHTML = t.ok
      ? `<span class="good">Got through</span> with ${esc(via)}${second} in ${secs(t.ms)}${t.title ? ` · page title: <b>${esc(t.title)}</b>` : ""} · ${t.cookies} cookie${t.cookies === 1 ? "" : "s"}${t.status && t.status !== 200 ? ` · the site answered ${t.status}` : ""}`
      : `<span class="bad">Couldn't get through.</span> ${esc(t.message)}`;
  } else {
    el.innerHTML = `<span class="dim">Checks that DeBarrier can open a site, the same way Materia's searches will.</span>`;
  }
}

function renderStatus() {
  if (!status) return;
  $("#info-solved").textContent = Number(status.solved).toLocaleString();
  $("#info-failed").textContent = Number(status.failed).toLocaleString();
  renderEngines();
  renderTest();

  const host = location.hostname || "your-nas";
  const addr = `http://${host}:${status.port}`;
  const a = $("#addr");
  if (a.value !== addr) a.value = addr;
  $("#addr-local").textContent = `http://localhost:${status.port}`;

  const pe = $("#port-error");
  pe.style.display = status.port_error ? "" : "none";
  if (status.port_error) {
    pe.innerHTML = `<b>Materia can't reach DeBarrier yet.</b> ${esc(status.port_error)} If you used FlareSolverr before, stop its old container in Container Manager (DeBarrier replaces it). DeBarrier keeps trying every 30 seconds. Or pick another port in Settings.`;
  }

  $("#remembered").textContent = status.remembered
    ? `Remembering which engine works for ${status.remembered} site${status.remembered === 1 ? "" : "s"}, so those go to the right one first.`
    : "When the other engine gets through a site, DeBarrier remembers and goes there first next time.";
  $("#forget-sites").style.display = status.remembered ? "" : "none";
  renderUpdate(status.update || {});
  $("#about").textContent = `DeBarrier for DSM v${status.version} · FlareSolverr and Byparr run in Container Manager as the "debarrier" project`;
  renderStatusBar();
}

function renderUpdate(u) {
  const st = $("#update-state");
  const checked = u.checked_at ? ` <span class="dim small">· checked ${ago(u.now - u.checked_at)}</span>` : "";
  const cur = `Installed ${esc(u.current)}`;
  if (u.requested) st.innerHTML = `${cur} · <span class="warn">Installing ${esc(u.requested)}…</span> <span class="dim small">within 5 minutes; DeBarrier restarts by itself</span>`;
  else if (u.checking) st.innerHTML = `${cur} · <span class="warn">Checking GitHub…</span>`;
  else if (u.available) st.innerHTML = `${cur} · <span class="warn">Version ${esc(u.latest)} is out</span> <a href="${esc(u.page)}" target="_blank" rel="noopener">what's new</a>${checked}`;
  else if (u.error) st.innerHTML = `${cur} · <span class="bad">Couldn't check GitHub</span> <span class="dim small">${esc(u.error)}</span>${checked}`;
  else if (u.latest) st.innerHTML = `${cur} · <span class="good">Up to date</span>${checked}`;
  else st.innerHTML = cur + checked;
  $("#update-check").disabled = !!u.checking;
  const now = $("#update-now");
  now.style.display = u.available ? "" : "none";
  now.disabled = !!u.requested;

  const last = u.last_install;
  const lastEl = $("#update-last");
  if (last && last.time && (u.now - last.time) < 14 * 86400) {
    const when = ago(u.now - last.time);
    lastEl.innerHTML = last.ok
      ? `<span class="label">LAST UPDATE</span>&nbsp; ${when}: ${esc(last.message)}`
      : `<span class="label">LAST UPDATE</span>&nbsp; <span class="bad">${when}, to ${esc(last.to)}: ${esc(last.message)}</span>`;
  } else lastEl.innerHTML = "";
  // Show the setup steps while the task isn't running and something needs it.
  const needTask = (u.auto || u.requested || updateClicked) && !u.task_ok;
  $("#update-setup").style.display = needTask ? "" : "none";
  const cmd = $("#update-command");
  if (cmd.value !== u.command) cmd.value = u.command || "";
}
let updateClicked = false;

function renderStatusBar() {
  const s = status;
  const byId = Object.fromEntries(s.engines.map((e) => [e.id, e]));
  const active = byId[s.engine];
  const other = s.engines.find((e) => e.id !== s.engine);
  const busy = s.engines.reduce((n, e) => n + (e.busy || 0), 0);
  let text;
  if (s.port_error) text = s.port_error + " Materia can't reach DeBarrier yet.";
  else if (s.update && s.update.requested) text = `Installing DeBarrier ${s.update.requested} within 5 minutes. It restarts by itself.`;
  else if (busy) text = `Getting through ${busy} site${busy === 1 ? "" : "s"}…`;
  else if (s.engines.every((e) => e.state === "offline")) text = "Neither engine is running yet. Container Manager may still be downloading them.";
  else if (active.state === "ready") {
    text = `${active.name} is ready on port ${s.port}.`;
    if (s.fallback) text += other.state === "ready" ? ` ${other.name} is standing by.` : ` ${other.name} isn't running.`;
  } else if (s.fallback && other.state === "ready") text = `${active.name} isn't running, so ${other.name} is taking its place.`;
  else text = `${active.name} isn't running.`;
  if (s.update && s.update.available && !s.update.requested && !s.port_error && !busy) text += ` DeBarrier ${s.update.latest} is out (Settings).`;
  $("#statusbar").textContent = text;
  renderGreenStatus(busy > 0);
}

function renderActivity(data) {
  const list = data.entries;
  $("#entries-empty").style.display = list.length ? "none" : "";
  $("#entries").innerHTML = list.map((en) => {
    const res = en.ok ? `<span class="good">Solved</span>` : `<span class="bad">Failed</span>`;
    const tried = en.tried || [];
    let eng = esc(ENGINE_NAMES[en.engine] || en.engine || "");
    if (en.ok && tried.length > 1) eng += ` <span class="dim small">after ${esc(ENGINE_NAMES[tried[0]])}</span>`;
    if (!en.ok && tried.length > 1) eng = tried.map((t) => esc(ENGINE_NAMES[t])).join(" + ");
    const msg = !en.ok && en.message ? `<div class="dim small">${esc(en.message)}</div>` : "";
    const test = en.test ? ` <span class="dim small">(test)</span>` : "";
    const cmd = en.cmd && en.cmd !== "request.get" ? ` <span class="dim small">${esc(en.cmd)}</span>` : "";
    return `<tr><td>${res}</td><td class="file">${esc(en.site)}${test}${cmd}${msg}</td><td>${eng}</td><td class="when">${secs(en.ms)}</td><td class="when">${ago(data.now - en.time)}</td></tr>`;
  }).join("");
}

function renderLog(lines) {
  const box = $("#log");
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.innerHTML = lines.map((l) => {
    const t = l.slice(11, 19), rest = l.slice(20);
    return `<div class="log-line"><span class="t">${esc(t)}</span><span>${esc(rest)}</span></div>`;
  }).join("") || `<div class="empty">No activity yet.</div>`;
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// ---------- settings ----------

function applyConfigToForm() {
  $$("[data-key]").forEach((el) => {
    if (el === document.activeElement) return;
    const v = config[el.dataset.key];
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
  });
  $$("#engine-pick [data-engine]").forEach((b) => b.classList.toggle("picked", b.dataset.engine === config.engine));
  applyTheme(config.theme);
}

let saveTimer = null;
let pending = {};
function queueSave(changes) {
  Object.assign(pending, changes);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}
async function flushSave() {
  const changes = pending; pending = {};
  if (!Object.keys(changes).length) return;
  try {
    config = await api("config", changes);
    applyConfigToForm();
    $$(".page.active .saved").forEach((s) => { s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1200); });
    refreshStatus();
  } catch (e) {
    if (e.message !== "auth" && e.message !== "down") {
      alert(e.message);
      try { config = await api("config"); applyConfigToForm(); } catch (e2) { /* ignore */ }
    }
  }
}

function useEngine(id) {
  config.engine = id;
  applyConfigToForm();
  queueSave({ engine: id });
}

// ---------- actions ----------

function wire() {
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (!el.dataset.key) return;
    const v = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    queueSave({ [el.dataset.key]: v });
  });
  $("#engine-pick").onclick = (e) => {
    const b = e.target.closest("[data-engine]");
    if (b && b.dataset.engine !== config.engine) useEngine(b.dataset.engine);
  };
  $("#engines").onclick = (e) => {
    const b = e.target.closest("[data-use]");
    if (b) useEngine(b.dataset.use);
  };
  $("#theme-pick").onclick = (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b || b.dataset.theme === config.theme) return;
    config.theme = b.dataset.theme;
    applyTheme(config.theme);
    if (isGreen()) { greenHome = false; document.body.classList.remove("g-at-home"); go("config"); }
    queueSave({ theme: config.theme });
  };
  const runTest = async () => {
    const url = $("#test-url").value.trim();
    if (!url) { $("#test-url").focus(); return; }
    try {
      await api("test", { url });
      refreshStatus();
    } catch (e) {
      if (e.message !== "auth" && e.message !== "down") $("#test-result").innerHTML = `<span class="bad">${esc(e.message)}</span>`;
    }
  };
  $("#test-go").onclick = runTest;
  $("#test-url").onkeydown = (e) => { if (e.key === "Enter") runTest(); };
  $("#addr").onclick = (e) => e.target.select();
  $("#addr-copy").onclick = async () => {
    const a = $("#addr");
    a.select();
    try { await navigator.clipboard.writeText(a.value); } catch (e) { try { document.execCommand("copy"); } catch (e2) { /* ignore */ } }
    $("#addr-copy").textContent = "Copied";
    setTimeout(() => { $("#addr-copy").textContent = "Copy"; }, 1200);
  };
  $("#forget-sites").onclick = async () => { await api("sites/forget", {}); refreshStatus(); };
  $("#update-check").onclick = async () => { await api("update/check", {}); refreshStatus(); setTimeout(refreshStatus, 4000); };
  $("#update-now").onclick = async () => {
    updateClicked = true;
    try { await api("update/install", {}); } catch (e) { if (e.message !== "auth" && e.message !== "down") alert(e.message); }
    refreshStatus();
  };
  $("#update-command").onclick = (e) => e.target.select();
  $("#view-log").onclick = () => go("log");
  $("#log-back").onclick = () => go("config");
  $("#clear-activity").onclick = async () => { await api("activity/clear", {}); refresh(); };
}

// ---------- polling ----------

async function refreshStatus() {
  try { status = await api("status"); } catch (e) { return; }
  try { renderStatus(); } catch (e) {
    $("#statusbar").textContent = "Display error: " + e.message + " — press Ctrl+F5 to reload DeBarrier.";
  }
}

async function refresh() {
  await refreshStatus();
  try {
    if (page === "activity") renderActivity(await api("activity"));
    if (page === "log") renderLog((await api("log")).lines);
  } catch (e) { /* ignore */ }
}

function schedule() {
  clearTimeout(pollTimer);
  if (document.visibilityState !== "visible") return;
  const fast = status && (status.test?.state === "running" || status.engines.some((e) => e.busy));
  pollTimer = setTimeout(async () => { await refresh(); schedule(); }, fast ? 1500 : 3000);
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); schedule(); });

(async function init() {
  await getToken();
  buildMenu();
  buildGreenMenu();
  wire();
  try {
    config = await api("config");
    applyConfigToForm();
  } catch (e) {
    if (e.message !== "auth" && e.message !== "down") $("#statusbar").textContent = "Couldn't load settings: " + e.message;
  }
  await refresh();
  schedule();
})();
