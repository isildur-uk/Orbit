/* panelresize.js — drag-to-resize the left intel sidebar.
 *
 * Ported from SOLAR's charting panelresize.js: an 8px grab zone over the divider,
 * live width via a CSS custom property, clamped range, double-click reset, width
 * persisted per browser. Self-contained and additive — remove the <script> and
 * the column is fixed again. Desktop only (the mobile layout stacks).
 *
 * Browser: window.OrbitPanelResize.
 */
(function () {
  "use strict";
  var MIN = 290, MAX = 520, DEFAULT = 360, KEY = "orbit_intel_width_v1";

  function init() {
    var app = document.getElementById("network-app");
    var panel = app && app.querySelector(".intel-panel");
    if (!app || !panel || document.getElementById("intel-resize")) return;

    var saved = 0;
    try { saved = parseInt(localStorage.getItem(KEY) || "0", 10); } catch (e) {}
    if (saved >= MIN && saved <= MAX) app.style.setProperty("--intel-w", saved + "px");

    var handle = document.createElement("div");
    handle.id = "intel-resize";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize the sidebar — drag, or double-click to reset");
    handle.title = "Drag to resize · double-click to reset";
    panel.appendChild(handle);

    var dragging = false, raf = 0, pendingW = 0;
    function apply(w) { w = Math.max(MIN, Math.min(MAX, Math.round(w))); app.style.setProperty("--intel-w", w + "px"); return w; }
    function nudgeGraph() { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }

    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true;
      handle.classList.add("is-dragging");
      document.body.classList.add("is-panel-resizing");
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    handle.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      pendingW = e.clientX - app.getBoundingClientRect().left;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; apply(pendingW); nudgeGraph(); });
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("is-dragging");
      document.body.classList.remove("is-panel-resizing");
      var w = parseInt(getComputedStyle(app).getPropertyValue("--intel-w"), 10) || DEFAULT;
      try { localStorage.setItem(KEY, String(w)); } catch (e) {}
      nudgeGraph();
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", function () { apply(DEFAULT); try { localStorage.setItem(KEY, String(DEFAULT)); } catch (e) {} nudgeGraph(); });
  }

  /* The right-hand contact dossier: same drag-to-resize, but the handle is on the
   * LEFT edge and the width grows as the pointer moves left. */
  var D_MIN = 300, D_MAX = 640, D_DEFAULT = 330, D_KEY = "orbit_dossier_width_v1";
  function initDossier() {
    var dossier = document.getElementById("person-dossier");
    if (!dossier || document.getElementById("dossier-resize")) return;
    var saved = 0;
    try { saved = parseInt(localStorage.getItem(D_KEY) || "0", 10); } catch (e) {}
    if (saved >= D_MIN && saved <= D_MAX) dossier.style.setProperty("--dossier-w", saved + "px");

    var handle = document.createElement("div");
    handle.id = "dossier-resize";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Resize the profile — drag, or double-click to reset");
    handle.title = "Drag to resize · double-click to reset";
    dossier.appendChild(handle);

    var dragging = false, raf = 0, pendingW = 0;
    function apply(w) { w = Math.max(D_MIN, Math.min(D_MAX, Math.round(w))); dossier.style.setProperty("--dossier-w", w + "px"); return w; }
    function nudge() { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }
    handle.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true; handle.classList.add("is-dragging"); document.body.classList.add("is-panel-resizing");
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    handle.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      pendingW = dossier.getBoundingClientRect().right - e.clientX;
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; apply(pendingW); });
    });
    function end() {
      if (!dragging) return;
      dragging = false; handle.classList.remove("is-dragging"); document.body.classList.remove("is-panel-resizing");
      var w = parseInt(getComputedStyle(dossier).getPropertyValue("--dossier-w"), 10) || D_DEFAULT;
      try { localStorage.setItem(D_KEY, String(w)); } catch (e) {}
      nudge();
    }
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", function () { apply(D_DEFAULT); try { localStorage.setItem(D_KEY, String(D_DEFAULT)); } catch (e) {} });
  }

  /* The profile now shares the left column, so only the intel-sidebar resize
   * (init) runs; the old right-dossier resize (initDossier) is retired. */
  function boot() { init(); }
  window.OrbitPanelResize = { init: init, initDossier: initDossier };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
