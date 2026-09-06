// Direction-aware page slides for the two "All" pages.
//
// styles.css runs the cross-document view transition one way: the arriving page
// enters from the right. That is correct for News -> i2e AI Guide (the guide
// lives to the right), but backwards for i2e AI Guide -> News, which should
// come back in from the left.
//
// The direction is derived on the arriving document alone, from the Navigation
// API: `navigation.activation.from.url` is the page just left and
// `navigation.activation.entry.url` is this one. Nothing is written by the
// departing page and nothing is stored between navigations, so the decision is
// identical on the first crossing and every one after it.
//
// Traverses are not ours: app.js owns `vt-back` and already reverses a Back,
// so this handler bails on `traverse` and only ever colours a push/replace.
//
// Loaded as a classic sync script in <head> so the listener is registered
// before the first rendering opportunity of the arriving document.
(function () {
  // Last path segment, lowercased; a bare directory URL is the gate page.
  function pageOf(u) {
    try {
      var path = new URL(u, location.href).pathname;
      return path.slice(path.lastIndexOf('/') + 1).toLowerCase() || 'index.html';
    } catch (err) {
      return null;
    }
  }

  // Pure: which way the arriving page should slide in, given where we came
  // from and where we landed. 'left' reverses the forward slide; null leaves
  // the default. The gate (index.html) sits above both All pages, so arriving
  // from it never reverses.
  function slideDirection(fromUrl, toUrl) {
    if (!fromUrl || !toUrl) return null;
    var from = pageOf(fromUrl);
    var to = pageOf(toUrl);
    if (!from || !to) return null;
    if (from === 'playbook.html' && to === 'events.html') return 'left';
    return null;
  }

  // Reachable for unit tests; the page itself never reads it.
  window.__slideDirection = slideDirection;

  if (!('onpagereveal' in window)) return;   // no cross-document transitions here

  window.addEventListener('pagereveal', function (e) {
    if (!e.viewTransition) return;           // reduced motion, or transition skipped

    var act = window.navigation && navigation.activation;
    if (!act || act.navigationType === 'traverse') return;   // app.js owns Back
    if (!act.from || !act.entry) return;

    if (slideDirection(act.from.url, act.entry.url) !== 'left') return;

    var root = document.documentElement;
    var clear = function () { root.classList.remove('vt-left'); };
    root.classList.add('vt-left');
    e.viewTransition.finished.then(clear, clear);
  });
})();
