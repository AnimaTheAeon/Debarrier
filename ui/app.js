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

/** Dark Glass: move the menu's selection pill under the open page. The
 * pill is the menu's ::before, so it glides there with a CSS transition. */
function glassPill() {
  const nav = $("#menu");
  if (!nav) return;
  const cur = nav.querySelector(".menu-item.selected");
  nav.classList.toggle("has-sel", !!cur);
  if (!cur) return;
  nav.style.setProperty("--sel-top", cur.offsetTop + "px");
  nav.style.setProperty("--sel-left", cur.offsetLeft + "px");
  nav.style.setProperty("--sel-w", cur.offsetWidth + "px");
  nav.style.setProperty("--sel-h", cur.offsetHeight + "px");
}
addEventListener("resize", glassPill);


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

// ---------- Blades look ----------
// Glossy silver blades; the open one wears its page's color. The page itself
// (#main) moves into the open blade, so every page works as before.
// Same look as Turks and Lifestream's NAS pages.

const isBlades = () => document.body.classList.contains("blades");
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let bstage = null, bcur = 0, bdrag = null, bcontour = null;
const BARROW = (d) => `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function bladesBuild() {
  if (bstage) return;
  bstage = document.createElement("div");
  bstage.id = "bstage";
  bstage.setAttribute("aria-label", "Blades");
  document.body.insertBefore(bstage, $(".layout"));
  const make = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const nav = (dir, label, d) => { const b = make("button", "bnav", BARROW(d)); b.dataset.dir = dir; b.setAttribute("aria-label", label); b.onclick = () => bladesStep(dir); return b; };
  PAGES.forEach(([key, label]) => {
    const sec = make("section", "bsec k-" + key);
    sec.setAttribute("aria-label", label);
    const tab = make("button", "btab");
    tab.setAttribute("aria-label", label);
    tab.onclick = () => { if ((HIDDEN_PAGES[page] || page) !== key) go(key); };
    tab.append(make("span", "blabel", esc(label.toLowerCase())));
    const band = make("div", "bband", `<h1>${esc(label)}</h1><span class="bchip" title="Open ${esc(PAGES[0][1])}"><span class="bdot"></span><span class="btxt"></span></span><span class="bspeed"></span>`);
    $(".bchip", band).onclick = () => { if ((HIDDEN_PAGES[page] || page) !== PAGES[0][0]) go(PAGES[0][0]); };
    const foot = make("div", "bfoot", '<span class="bkey bhint">← →</span><span class="bhint">Blades</span><span class="bkey bhint">ENTER</span><span class="bhint">Select</span><span class="bkey bhint">ESC</span><span class="bhint">Back</span>');
    const navs = make("span", "bnavs");
    navs.append(nav(-1, "Previous blade", "M10 3 L5 8 L10 13"), nav(1, "Next blade", "M6 3 L11 8 L6 13"));
    foot.append(navs);
    const panel = make("div", "bpanel");
    panel.append(band, make("div", "bbody"), foot);
    const wrap = make("div", "bwrap");
    wrap.append(panel);
    sec.append(tab, wrap);
    bstage.append(sec);
  });
  const edge = make("div", "bedge");
  edge.setAttribute("aria-hidden", "true");
  bstage.append(edge);
  bcontour = bladesContour(bstage, ".bsec.open .bbody", ".bpanel");
  // Swipe sideways: anywhere with a finger, or from a tab or the top band with the mouse.
  bstage.addEventListener("pointerdown", (e) => { bdrag = { x: e.clientX, y: e.clientY, ok: e.pointerType === "touch" || !!e.target.closest(".btab, .bband") }; });
  bstage.addEventListener("pointerup", (e) => {
    if (!bdrag || !bdrag.ok) { bdrag = null; return; }
    const dx = e.clientX - bdrag.x, dy = e.clientY - bdrag.y; bdrag = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 60) bladesStep(dx < 0 ? 1 : -1);
  });
}

// Blades: rows follow the open blade"s curved left edge. Each row shifts
// right by how far the curve comes in at its height (the most it comes in
// over the row"s span), so nothing runs into the curve near the top and
// bottom. Re-run on scroll, resize and page changes.
function bladesContour(stage, bodySel, panelSel) {
  let queued = false, shifted = new Set();
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // Children, looking through display: contents wrappers (they have no box).
  const kidsOf = (el) => [...el.children].flatMap((c) => (getComputedStyle(c).display === 'contents' ? kidsOf(c) : visible(c) ? [c] : []));
  const pick = (el, out) => {
    if (!visible(el)) return;
    const h = el.getBoundingClientRect().height;
    const kids = kidsOf(el);
    const t0 = kids.length ? kids[0].getBoundingClientRect().top : 0;
    const stacked = kids.length > 1 && kids.some((k) => Math.abs(k.getBoundingClientRect().top - t0) > 4);
    if (h > 90 && (stacked || kids.length === 1)) kids.forEach((k) => pick(k, out));
    else if (h > 90 && kids.length > 1) {
      // Side-by-side columns: only the leftmost one meets the curve.
      const left = kids.reduce((a, b) => (b.getBoundingClientRect().left < a.getBoundingClientRect().left ? b : a));
      pick(left, out);
    } else out.push(el);
  };
  const run = () => {
    queued = false;
    const open = stage.querySelector(bodySel);
    const panel = open && open.closest(panelSel);
    const next = new Set();
    if (open && panel) {
      const pr = panel.getBoundingClientRect(), br = open.getBoundingClientRect();
      const r = parseFloat(getComputedStyle(stage).getPropertyValue("--r")) || 44;
      const mid = pr.top + pr.height / 2, half = pr.height / 2;
      const arc = (y) => { const d = Math.max(-1, Math.min(1, (y - mid) / half)); return r * (1 - Math.sqrt(1 - d * d)); };
      const rows = [];
      [...open.children].forEach((c) => pick(c, rows));
      for (const el of rows) {
        shiftRow(el, 0);
        const er = el.getBoundingClientRect();
        const top = Math.max(er.top, br.top), bot = Math.min(er.bottom, br.bottom);
        if (bot <= top) continue;
        const dx = Math.round(Math.max(arc(top), arc(bot)));
        if (dx > 0) { shiftRow(el, dx); next.add(el); }
      }
    }
    shifted.forEach((el) => { if (!next.has(el)) shiftRow(el, 0); });
    shifted = next;
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  stage.addEventListener("scroll", queue, true);
  addEventListener("resize", queue);
  stage.addEventListener("transitionend", queue);
  const mo = new MutationObserver(queue);
  mo.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "open"] });
  queue();
  return {
    refresh: queue,
    stop: () => {
      mo.disconnect();
      stage.removeEventListener("scroll", queue, true);
      removeEventListener("resize", queue);
      stage.removeEventListener("transitionend", queue);
      shifted.forEach((el) => { shiftRow(el, 0); });
      shifted.clear();
    },
  };
}

// Moves a row right by dx and narrows it by the same amount, so its right
// end stays where it was instead of running past the blade's edge.
function shiftRow(el, dx) {
  el.style.translate = dx ? `${dx}px 0` : "";
  el.style.maxWidth = dx ? `calc(100% - ${dx}px)` : "";
}

function bladesPlace(instant) {
  if (!bstage) return;
  const W = innerWidth, narrow = W < 700, p = narrow ? 30 : 52, r = narrow ? 20 : 44, edge = narrow ? 14 : 30, n = PAGES.length;
  const ms = instant || calm() ? 0 : 700;
  bstage.style.cssText = `--p:${p}px;--r:${r}px;--edge:${edge}px;--bw:${W - edge - (n - 1) * p + r}px;--ms:${ms}ms`;
  $$(".bsec", bstage).forEach((s, i) => {
    s.style.transform = `translateX(${i <= bcur ? i * p : W - edge - (n - i) * p}px)`;
    s.style.zIndex = 10 + i;
    s.classList.toggle("open", i === bcur);
    $(".btab", s).tabIndex = i === bcur ? -1 : 0;
    $(".bwrap", s).inert = i !== bcur;
  });
  $$(".bnav", bstage).forEach((b) => { b.disabled = (+b.dataset.dir < 0 && bcur === 0) || (+b.dataset.dir > 0 && bcur === n - 1); });
}

/** Open the blade for `id`: #main moves into it and the blades slide. */
function bladesShow(id, instant) {
  bladesBuild();
  const i = Math.max(0, PAGES.findIndex(([p]) => p === (HIDDEN_PAGES[id] || id)));
  const slot = $$(".bbody", bstage)[i], main = $("#main");
  if (main.parentNode !== slot) slot.append(main);
  bcur = i;
  const title = (PAGES.find(([p]) => p === id) || [id, "Log"])[1];
  $(".bband h1", $$(".bsec", bstage)[i]).textContent = title;
  bladesPlace(instant);
  if (bcontour) bcontour.refresh();
}

function bladesOff() {
  if (bcontour) bcontour.stop();
  bcontour = null;
  const main = $("#main"), layout = $(".layout");
  if (main && layout && main.parentNode !== layout) layout.insertBefore(main, $(".side"));
  if (bstage) { bstage.remove(); bstage = null; }
}

function bladesStep(d) {
  const j = Math.max(0, Math.min(PAGES.length - 1, bcur + d));
  if (j !== bcur) go(PAGES[j][0]);
}

/** Chip and status line on every blade's top band. */
function drawBladesStatus(text, level) {
  if (!isBlades() || !bstage) return;
  const chip = level === "good" ? "All good" : level === "bad" ? "Problem" : "Needs a look";
  $$(".bband", bstage).forEach((b) => {
    $(".btxt", b).textContent = chip;
    $(".bdot", b).className = "bdot " + (level === "good" ? "" : level);
    $(".bspeed", b).textContent = text;
    $(".bspeed", b).title = text;
  });
}

/** Keys in Blades: arrows switch, Esc closes a dialog, then the log, then goes to the first blade. */
function bladesKey(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const tag = (document.activeElement || {}).tagName || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
  if (e.key === "ArrowRight") { e.preventDefault(); bladesStep(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); bladesStep(-1); }
  else if (e.key === "Escape") {
    if (page === "log") { e.preventDefault(); go("config"); }
    else if (bcur > 0) { e.preventDefault(); go(PAGES[0][0]); }
  } else if (e.key === "Enter" && (!tag || tag === "BODY")) {
    const first = $(".bsec.open .bbody button, .bsec.open .bbody input, .bsec.open .bbody select", bstage);
    if (first) { e.preventDefault(); first.focus(); }
  }
}
document.addEventListener("keydown", (e) => { if (isBlades()) bladesKey(e); });
for (const type of ["mousedown", "mouseup"]) {
  window.addEventListener(type, (e) => {
    if (e.button !== 3 || !isBlades()) return;
    e.preventDefault();
    if (type !== "mouseup") return;
      if (page === "log") return go("config");
    bladesStep(-1);
  });
}
addEventListener("resize", () => { if (isBlades()) bladesPlace(true); });

// ---------- MC360 look ----------
// The MC360 dashboard skin's blades, one per page, each with a menu of what
// that page holds. Picking an entry opens the page on the blade (the same
// page as in every other look) and jumps to that part of it. The drawing,
// sounds and keys come from the shared engine in mc360/.

let mc = null;          // the running engine, while the look is MC360
let mcLoading = null;
const isMc360 = () => !!mc;
const MC_LOOKS = [["ff", "FFVII Menu"], ["green", "Xbox"], ["blades", "Blades"], ["glass", "Dark Glass"], ["mc360", "MC360"]];
const MC_BLADES = [
  { key: "status", color: "blue", items: [
    { id: "status", label: "Engines", icon: "bolt", hint: "Both engines and their state.", page: "status" },
    { id: "try", label: "Try a site…", icon: "search", hint: "Check a Cloudflare site.", page: "status", section: "TRY A SITE", focus: "#test-url" },
    { id: "hookup", label: "Hook up Materia", icon: "plug", hint: "The address to paste into Materia.", page: "status", section: "HOOK UP MATERIA" },
  ] },
  { key: "activity", color: "green", items: [
    { id: "activity", label: "Requests", icon: "list", hint: "Every request Materia sent.", page: "activity" },
    { id: "clear", label: "Clear", icon: "trash", hint: "Empty the list.", page: "activity", click: "#clear-activity" },
  ] },
  { key: "settings", color: "purple", items: [
    { id: "engine", label: "Engine", icon: "gear", hint: "Which engine answers.", page: "config", section: "ENGINE" },
    { id: "port", label: "Port", icon: "net", hint: "Where Materia reaches DeBarrier.", page: "config", section: "PORT" },
    { id: "updates", label: "Updates", icon: "refresh", hint: "Check now and Update now.", page: "config", section: "UPDATES" },
    { id: "look", label: "Look and sound", icon: "palette", hint: "Five looks; MC360's skin and sounds are in the guide (G).", page: "config", section: "LOOK" },
  ] },
  { key: "log", color: "grey", items: [
    { id: "log", label: "Log", icon: "doc", hint: "Today's log.", page: "log" },
  ] },
];
const mcBladeOf = (id) => Math.max(0, MC_BLADES.findIndex((b) => b.items.some((it) => it.page === id)));
let mcItem = null;      // the entry being opened from the menu

function mcSection(label) {
  return $$(".page.active .section > .label").find((l) => l.textContent.trim() === label);
}

function mcLoad() {
  if (window.MC360) return Promise.resolve();
  if (mcLoading) return mcLoading;
  const css = document.createElement("link");
  css.rel = "stylesheet"; css.href = "mc360/mc360.css?v=" + mcVersion();
  document.head.append(css);
  mcLoading = new Promise((resolve, reject) => {
    const js = document.createElement("script");
    js.src = "mc360/mc360.js?v=" + mcVersion();
    js.onload = resolve; js.onerror = reject;
    document.head.append(js);
  });
  return mcLoading;
}
function mcVersion() {
  const tag = $('script[src^="app.js"]');
  return tag ? new URL(tag.src, location.href).searchParams.get("v") || "" : "";
}

async function mcOn() {
  if (mc) return;
  try { await mcLoad(); } catch (e) { $("#statusbar").textContent = "The MC360 look couldn't load its files."; return; }
  if (mc || !config || config.theme !== "mc360") return;
  mc = MC360.mount({
    base: "mc360/",
    app: { name: "DeBarrier", plat: "NAS", ver: mcVersion(), icon: "shield" },
    blades: MC_BLADES,
    card: () => [
      $("#statusbar").textContent,
      `${$("#info-solved").textContent} solved · ${$("#info-failed").textContent} failed`,
    ],
    host: () => $("#main"),
    onOpen: (b, item) => { mcItem = item; go(item.page); },
    beforeBack: () => { if (page === "log") { go("config"); return true; } return false; },
    popupOpen: () => !!$(".modal.open, .overlay-msg.open, #overlay.open"),
    looks: MC_LOOKS.map(([, l]) => l),
    setLook: (label) => {
      const key = (MC_LOOKS.find(([, l]) => l === label) || ["ff"])[0];
      if (key === config.theme) return;
      config.theme = key;
      applyTheme(key);
      queueSave({ theme: key });
    },
    checkUpdates: async () => {
      await api("update/check", {});
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        await refreshStatus();
        if (!$("#update-check").disabled) break;
      }
      return $("#update-state").textContent || "Checked for updates";
    },
  });
  mc.host.classList.add("bbody");
  const blade = mcBladeOf(HIDDEN_PAGES[page] || page);
  if (page === "status") mc.home(blade); else mc.showPage(blade, (MC_BLADES[blade].items.find((it) => it.page === page) || {}).id);
}

function mcOff() {
  if (!mc) return;
  mc.destroy();
  mc = null;
}

/** After go(): show the page on its blade, and jump to the picked part of it. */
function mcShow(id) {
  if (!mc) return;
  const it = mcItem && mcItem.page === id ? mcItem : null;
  mcItem = null;
  const blade = mcBladeOf(HIDDEN_PAGES[id] || id);
  const first = MC_BLADES[blade].items.find((x) => x.page === id) || MC_BLADES[blade].items[0];
  mc.showPage(blade, (it || first).id);
  if (!it) { mc.host.scrollTop = 0; return; }
  requestAnimationFrame(() => {
    if (it.open) { const d = $(it.open); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } }
    else if (it.section) { const l = mcSection(it.section); if (l) l.parentElement.scrollIntoView({ block: "start" }); }
    else mc.host.scrollTop = 0;
    if (it.click) { const b = $(it.click); if (b && !b.disabled) b.click(); }
    if (it.focus) { const f = $(it.focus); if (f) f.focus(); }
  });
}

// ---------- Xbox look ----------

let greenHome = true;
let greenCursor = 0;
const isGreen = () => document.body.classList.contains("green");

function applyTheme(theme) {
  const green = theme === "green", blades = theme === "blades", glass = theme === "glass", mc360 = theme === "mc360";
  const key = mc360 ? "mc360" : glass ? "glass" : blades ? "blades" : green ? "green" : "ff";
  $$("#theme-pick [data-theme]").forEach((b) => b.classList.toggle("picked", b.dataset.theme === key));
  if (document.body.dataset.themed === key) return;
  document.body.dataset.themed = key;
  document.body.classList.toggle("green", green);
  document.body.classList.toggle("blades", blades);
  document.body.classList.toggle("glass", glass);
  requestAnimationFrame(glassPill);
  if (mc360) {
    greenHome = false;
    document.body.classList.remove("g-at-home");
    bladesOff();
    mcOn();
    return;
  }
  mcOff();
  if (blades) {
    greenHome = false;
    document.body.classList.remove("g-at-home");
    bladesShow(page, true);
    return;
  }
  bladesOff();
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
  if (calm()) {
    greenHome = false;
    document.body.classList.remove("g-at-home");
    go(PAGES[i][0]);
    return;
  }
  document.body.classList.add("g-zoom");
  setTimeout(() => {
    greenHome = false;
    document.body.classList.remove("g-at-home", "g-zoom");
    go(PAGES[i][0]);
    document.body.classList.add("g-reveal");
    setTimeout(() => document.body.classList.remove("g-reveal"), 500);
  }, 600);
}

/** Xbox page bar: a tab per page along the bottom, to switch pages without the home screen. */
function renderPageBar() {
  const cur = HIDDEN_PAGES[page] || page;
  $("#g-tabs").replaceChildren(...PAGES.map(([id, label], i) => {
    const b = document.createElement("button");
    b.className = "g-nav";
    b.textContent = label;
    b.setAttribute("aria-current", id === cur ? "page" : "false");
    b.onclick = () => {
      if (id === page) return;
      greenCursor = i;
      go(id);
      if (!calm()) {
        document.body.classList.remove("g-switch");
        void document.body.offsetWidth;
        document.body.classList.add("g-switch");
        setTimeout(() => document.body.classList.remove("g-switch"), 300);
      }
    };
    return b;
  }));
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
  if (animate && !calm()) {
    document.body.classList.add("g-unzoom");
    setTimeout(() => document.body.classList.remove("g-unzoom"), 600);
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
  if (isBlades()) bladesShow(id);
  const menuId = HIDDEN_PAGES[id] || id;
  $$(".menu-item").forEach((b) => b.classList.toggle("selected", b.dataset.go === menuId));
  glassPill();
  $$(".page").forEach((p) => p.classList.toggle("active", p.dataset.page === id));
  mcShow(id);
  history.replaceState(null, "", "#" + id);
  const title = $("#g-title");
  if (title) title.textContent = (PAGES.find(([p]) => p === id) || [id, id === "log" ? "Log" : id])[1].toUpperCase();
  if ($("#g-tabs")) renderPageBar();
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

let seenVersion = "";
function renderUpdate(u) {
  // The service came back on a new version after Update now: reload the page.
  if (seenVersion && u.current && u.current !== seenVersion) { location.reload(); return; }
  if (u.current) seenVersion = u.current;
  const st = $("#update-state");
  const checked = u.checked_at ? ` <span class="dim small">· checked ${ago(u.now - u.checked_at)}</span>` : "";
  const cur = `Installed ${esc(u.current)}`;
  const waited = u.requested_at ? u.now - u.requested_at : 0;
  if (u.requested && !u.task_ok) st.innerHTML = `${cur} · <span class="bad">${esc(u.requested)} is waiting for the update task</span> <span class="dim small">It hasn't run yet. Set it up below, or install the new DeBarrier package in Package Center yourself.</span>`;
  else if (u.requested && waited > 15 * 60) st.innerHTML = `${cur} · <span class="bad">Installing ${esc(u.requested)} is taking too long</span> <span class="dim small">Check the task's result in Task Scheduler, or View Log</span>`;
  else if (u.requested) st.innerHTML = `${cur} · <span class="warn">Installing ${esc(u.requested)}…</span> <span class="dim small">within 5 minutes; DeBarrier restarts by itself</span>`;
  else if (u.checking) st.innerHTML = `${cur} · <span class="warn">Checking for updates…</span>`;
  else if (u.available) st.innerHTML = `${cur} · <span class="warn">Version ${esc(u.latest)} is out</span>${checked}`;
  else if (u.error) st.innerHTML = `${cur} · <span class="bad">Couldn't check for updates</span> <span class="dim small">${esc(u.error)}</span>${checked}`;
  else if (u.latest) st.innerHTML = `${cur} · <span class="good">Up to date</span>${checked}`;
  else st.innerHTML = cur + checked;
  const notes = $("#update-notes");
  const text = u.available && u.notes ? u.notes.trim() : "";
  notes.style.display = text ? "" : "none";
  if (notes.dataset.text !== text) { notes.dataset.text = text; $("#update-notes-text").textContent = text; }
  $("#update-check").disabled = !!u.checking;
  const now = $("#update-now");
  now.style.display = u.available ? "" : "none";
  const pr = u.progress;
  const busy = !!(pr && pr.phase !== "failed");
  if (busy) now.style.display = "none";
  now.disabled = !!u.requested;
  const prow = $("#update-progress");
  prow.style.display = pr ? "" : "none";
  if (pr) {
    const mb = (n) => (n / 1048576).toFixed(1);
    let frac = 0, text = "";
    if (pr.phase === "download") { frac = pr.total ? 0.02 + 0.8 * Math.min(1, pr.done / pr.total) : 0.1; text = `Downloading ${esc(pr.to)}: ${mb(pr.done)}${pr.total ? " of " + mb(pr.total) : ""} MB`; }
    else if (pr.phase === "verify") { frac = 0.88; text = "Checking the download…"; }
    else if (pr.phase === "restart") { frac = 0.96; text = `Restarting on ${esc(pr.to)}. This page reloads by itself.`; }
    else { text = `<span class="bad">Update failed: ${esc(pr.message)}</span>`; }
    $("#update-bar").style.width = (frac * 100).toFixed(1) + "%";
    $("#update-step").innerHTML = text;
  }

  const last = u.last_install;
  const lastEl = $("#update-last");
  if (last && last.time && (u.now - last.time) < 14 * 86400) {
    const when = ago(u.now - last.time);
    lastEl.innerHTML = last.ok
      ? `<span class="label">LAST UPDATE</span>&nbsp; ${when}: ${esc(last.message)}`
      : `<span class="label">LAST UPDATE</span>&nbsp; <span class="bad">${when}, to ${esc(last.to)}: ${esc(last.message)}</span>`;
  } else lastEl.innerHTML = "";
  // Show the setup steps while the task isn't running and something needs it.
  const needTask = (u.auto || (!u.can_install_now && (u.requested || updateClicked))) && !u.task_ok;
  $("#update-setup").style.display = needTask ? "" : "none";
  $("#update-window").style.display = u.can_install_now && !u.window_updates ? "" : "none";
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
  else if (s.update && s.update.requested && !s.update.task_ok) text = `DeBarrier ${s.update.requested} is waiting for the update task, which hasn't run yet (see Settings → Updates).`;
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
  const level = s.port_error || s.engines.every((e) => e.state === "offline") ? "bad"
    : active.state !== "ready" || s.engines.some((e) => e.state === "checking") || (s.update && s.update.requested) ? "warn" : "good";
  drawBladesStatus(text, level);
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
// Every change is numbered, so a save's reply never undoes a newer change
// (picking a second theme while the first is still saving).
let changeNo = 0;
const newest = {};
function queueSave(changes) {
  changeNo++;
  for (const k of Object.keys(changes)) newest[k] = [changeNo, changes[k]];
  Object.assign(pending, changes);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}
function withNewer(reply, upTo) {
  for (const [k, [no, v]] of Object.entries(newest)) {
    if (no > upTo) reply[k] = v; else delete newest[k];
  }
  return reply;
}
async function flushSave() {
  const changes = pending; pending = {};
  if (!Object.keys(changes).length) return;
  const upTo = changeNo;
  try {
    config = withNewer(await api("config", changes), upTo);
    applyConfigToForm();
    $$(".page.active .saved").forEach((s) => { s.classList.add("show"); setTimeout(() => s.classList.remove("show"), 1200); });
    refreshStatus();
  } catch (e) {
    if (e.message !== "auth" && e.message !== "down") {
      alert(e.message);
      try { config = withNewer(await api("config"), upTo); applyConfigToForm(); } catch (e2) { /* ignore */ }
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
    else if (isBlades()) go("config");
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
