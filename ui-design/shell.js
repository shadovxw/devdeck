// Shared shell for devdeck design-sample pages: dock, status strip, theme switch, toasts, icons.
// Usage: <body data-page="Storage"> … <script src="shell.js"></script> then page script uses window.DD.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const root = document.documentElement;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICON = {
    good: '<circle cx="5" cy="5" r="4.2" fill="currentColor"/>',
    warning: '<path d="M5 .6 9.6 9H.4z" fill="currentColor"/>',
    serious: '<path d="M5 .3 9.7 5 5 9.7.3 5z" fill="currentColor"/>',
    critical: '<rect x=".8" y=".8" width="8.4" height="8.4" rx="1.2" fill="currentColor"/>',
    neutral: '<circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  };
  const si = (s) => `<svg class="si" viewBox="0 0 10 10" aria-hidden="true">${ICON[s]}</svg>`;
  const pill = (s, label, title) => `<span class="pill" data-s="${s}"${title ? ` title="${esc(title)}"` : ""}>${si(s)}${esc(label)}</span>`;
  const svg = (paths, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const I = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    bucket: '<path d="M4 7h16l-1.6 12.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z"/><ellipse cx="12" cy="7" rx="8" ry="2.5"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l2 2M15 8l2 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
    snapshot: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6l1.5-2h5L16 6"/><circle cx="12" cy="13" r="3.5"/>',
    restore: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>',
  };

  // ---------- dock: one list for every sample page ----------
  const DOCK = [
    ["Home", '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', "index.html"],
    ["Stacks", '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5"/>'],
    ["Logs", '<path d="M4 6h16M4 10h10M4 14h16M4 18h8"/>'],
    ["Resources", '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>'],
    "|",
    ["Repositories", '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 5-12 2-12 7"/>'],
    ["Work items", '<path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11"/>'],
    ["Databases", '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'],
    ["Storage", I.bucket, "storage.html"],
    ["Secrets", I.key, "secrets.html"],
    "|",
    ["Flows", '<rect x="3" y="5" width="7" height="5" rx="1.5"/><rect x="14" y="14" width="7" height="5" rx="1.5"/><path d="M10 7.5h2a2 2 0 0 1 2 2V14"/>'],
    ["Trace", '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h7a3 3 0 0 1 0 6H10a3 3 0 0 0 0 6h7"/>', "flow-trace.html"],
    ["Findings", I.shield],
    ["Images", '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'],
    "|",
    ["Notifications", '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'],
    ["Settings", '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'],
  ];
  const page = document.body.dataset.page;
  const dock = $("#dock");
  if (dock) {
    dock.innerHTML = '<a class="logo" href="index.html" title="devdeck" aria-label="devdeck home"><svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 336 336" aria-hidden="true" focusable="false"><defs><linearGradient id="ddms" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#054d58"/><stop offset=".42" stop-color="#02b3ae"/><stop offset="1" stop-color="#02f1c9"/></linearGradient><linearGradient id="ddmu" x1="12" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#01d4d0"/><stop offset=".45" stop-color="#23ecca"/><stop offset=".8" stop-color="#68fbc9"/><stop offset="1" stop-color="#71fbb6"/></linearGradient><linearGradient id="ddml" x1="12" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00efc7"/><stop offset=".45" stop-color="#01c1ac"/><stop offset=".72" stop-color="#048e8d"/><stop offset=".88" stop-color="#05545d"/><stop offset="1" stop-color="#0a6a70"/></linearGradient><clipPath id="ddmc"><path d="M12 0H195Q215 0 229 15L298 90Q320 115 320 165C320 250 260 320 185 320H12L92 244H185C250 244 280 190 270 173L175 76H92Z"/></clipPath></defs><path d="M0 8L80 84V236L0 312Z" fill="url(#ddms)"/><path d="M12 0H195Q215 0 229 15L298 90Q320 115 320 165C320 250 260 320 185 320H12L92 244H185C250 244 280 190 270 173L175 76H92Z" fill="url(#ddmu)"/><g clip-path="url(#ddmc)"><path d="M0 212L262 168L320 138H340V340H0Z" fill="url(#ddml)"/><path d="M262 168L320 138" stroke="#ffffff" stroke-opacity=".28" stroke-width="2"/></g><path d="M118 128L152 160L118 192" fill="none" style="stroke:var(--mark-prompt,#4ee8b5)" stroke-width="17" stroke-linecap="square"/><rect x="166" y="186" width="54" height="16" rx="2" style="fill:var(--mark-under,#2aeab4)"/></svg></a>' + DOCK.map((d) => d === "|" ? "<hr>" :
      `<button class="dock-btn" type="button" ${d[2] ? `data-href="${d[2]}"` : `data-nav="${d[0]}"`} ${d[0] === page ? 'aria-current="page"' : ""} aria-label="${d[0]}">${svg(d[1], 1.7)}<span class="tip">${d[0]}</span></button>`).join("");
  }
  const strip = $("#strip");
  if (strip) {
    strip.innerHTML = `<button class="chipbtn ws" type="button" title="Workspace">infrabot ${svg('<path d="M6 9l6 6 6-6"/>', 2).replace("<svg", '<svg width="12" height="12"')}</button>
      <a class="chipbtn" href="index.html" title="Stack full · services up">${si("critical").replace('class="si"', 'class="si" style="color:var(--critical)"')}<b class="num">12/14</b></a>
      <span class="spacer"></span>
      <button class="iconbtn" type="button" id="theme-toggle" title="Switch light / dark" aria-label="Switch theme">${svg('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}</button>`;
  }

  // ---------- toasts ----------
  function toast(s, title, action) {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    const el = document.createElement("div"); el.className = "toast"; el.dataset.s = s; el.setAttribute("role", "status");
    el.innerHTML = `${si(s)}<span>${esc(title)}</span>${action ? `<button class="btn sm act" type="button">${esc(action.label)}</button>` : ""}`;
    if (action) el.querySelector(".act").addEventListener("click", () => { action.fn(); el.remove(); });
    box.appendChild(el); while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => el.remove(), action ? 7000 : 4000);
  }

  // ---------- navigation + theme ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-href],[data-nav]");
    if (!t) return;
    if (t.dataset.href) location.href = t.dataset.href;
    else if (t.dataset.nav) toast("neutral", `${t.dataset.nav} isn't in this sample`);
  });
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
  const saved = store.get("dd-theme"); if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#theme-toggle")) return;
    root.dataset.theme = isDark() ? "light" : "dark"; store.set("dd-theme", root.dataset.theme);
  });

  // ---------- in-place confirm for destructive buttons ----------
  // First click arms the button ("Confirm?") for 3 s; second click runs fn.
  function confirmClick(btn, label, fn) {
    if (btn.dataset.armed) { clearTimeout(+btn.dataset.armed); delete btn.dataset.armed; btn.classList.remove("armed"); btn.innerHTML = btn.dataset.orig; fn(); return; }
    btn.dataset.orig = btn.innerHTML; btn.classList.add("armed"); btn.textContent = label;
    btn.dataset.armed = String(setTimeout(() => { delete btn.dataset.armed; btn.classList.remove("armed"); btn.innerHTML = btn.dataset.orig; }, 3000));
  }
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast("good", `${what} copied`); }
    catch (e) { toast("neutral", "Copy isn't allowed here"); }
  }
  const fmtBytes = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : n >= 1e3 ? (n / 1e3).toFixed(1) + " KB" : n + " B";

  window.DD = { $, esc, si, pill, svg, I, toast, confirmClick, copy, fmtBytes, store };
})();
