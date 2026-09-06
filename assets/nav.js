// Direction-aware page slides for the two "All" pages.
//
// styles.css runs the cross-document view transition one way: the arriving page
// enters from the right. That is correct for News -> i2e AI Guide (the guide
// lives to the right), but backwards for i2e AI Guide -> News, which should
// come back in from the left. Which way a link points is only knowable from
// script, so the intent is handed to the arriving document through
// sessionStorage and read back in `pagereveal` — the last moment a class can
// still change how the transition paints. This mirrors the `vt-back` handler in
// app.js exactly; only the trigger differs.
//
// Loaded as a classic sync script in <head> so the listener is registered
// before the first rendering opportunity of the arriving document.
(function () {
  var KEY = 'alerts:slide';

  function readFlag() {
    try { return sessionStorage.getItem(KEY); } catch (err) { return null; }
  }

  function clearFlag() {
    try { sessionStorage.removeItem(KEY); } catch (err) {}
  }

  // Any link marked data-slide="left" declares "the page I lead to sits to the
  // left of this one". Modified clicks (new tab/window, download) never
  // navigate this document, so they must not leave a flag behind.
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = e.target && e.target.closest ? e.target.closest('a[data-slide="left"]') : null;
    if (!link || link.target === '_blank') return;
    try { sessionStorage.setItem(KEY, 'left'); } catch (err) {}
  });

  // No cross-document view transitions here: navigate as before, and make sure
  // a flag written by a previous page can never outlive its navigation.
  if (!('onpagereveal' in window)) {
    clearFlag();
    return;
  }

  window.addEventListener('pagereveal', function (e) {
    // Read once and clear immediately, whatever happens next — a flag that
    // survives this navigation would misdirect the following one.
    var flag = readFlag();
    clearFlag();
    if (flag !== 'left') return;
    if (!e.viewTransition) return;             // reduced motion, or transition skipped

    // A Back already has a direction of its own (app.js owns `vt-back`); this
    // flag only ever describes a forward click.
    var act = window.navigation && navigation.activation;
    if (act && act.navigationType === 'traverse') return;

    var root = document.documentElement;
    var clear = function () { root.classList.remove('vt-left'); };
    root.classList.add('vt-left');
    e.viewTransition.finished.then(clear, clear);
  });

  // Safety net: if `pagereveal` never fired for this document, the flag is
  // stale by the time the page has loaded and must not colour a later click.
  window.addEventListener('load', clearFlag);
})();
