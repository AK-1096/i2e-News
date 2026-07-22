// ALerts — shared static-reader logic.
// The static site reads data/articles.json as its only data source (FR-S1);
// no backend, no AI calls run here (NFR-2/NFR-4).

// FR-S7: the front page shows a sensible number of recent items; the rest live
// in the archive. Config-driven so the cap is tunable without touching markup.
var RECENT_LIMIT = 10;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function formatDate(d) {
  var t = Date.parse(d);
  if (isNaN(t)) return escapeHtml(d);
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Fetch articles.json and return the list ordered newest-first by addedDate
// (when the curator published it). Rejects on HTTP/parse failure.
function loadArticles() {
  return fetch('data/articles.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (articles) {
      if (!Array.isArray(articles)) return [];
      return articles.slice().sort(function (a, b) {
        return Date.parse(b.addedDate) - Date.parse(a.addedDate);
      });
    });
}

// --- AI Guide (data/usecases.json) -----------------------------------------
// Sibling data contract; same no-backend read model as the news path.

// Fetch usecases.json and return the list ordered newest-first by addedDate.
// Rejects on HTTP/parse failure.
function loadUsecases() {
  return fetch('data/usecases.json')
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (usecases) {
      if (!Array.isArray(usecases)) return [];
      return usecases.slice().sort(function (a, b) {
        return Date.parse(b.addedDate) - Date.parse(a.addedDate);
      });
    });
}

// --- Role filter (shared by archive.html, playbook.html, future landing) ----
// Items carry an `audience` array of role slugs. The filter is single-select
// and per-visit (no storage, no URL state) — it resets on reload.

// Display labels for the role slugs, and the canonical chip order.
var ROLE_LABELS = {
  developers: 'Developers',
  qa: 'QA',
  'ba-pc': 'BA & Project Coordination',
  pm: 'Project Managers',
  'non-technical': 'Non-technical'
};
var ROLE_ORDER = ['developers', 'qa', 'ba-pc', 'pm', 'non-technical'];

// Short forms for the per-row audience meta tag.
var ROLE_SHORT = {
  developers: 'Dev',
  qa: 'QA',
  'ba-pc': 'BA/PC',
  pm: 'PM',
  'non-technical': 'General'
};

// Render the role-filter bar into `container`. Calls onChange(role) where role
// is a slug, or null for "Everyone". Chips are real buttons (keyboard + focus).
// `options` (optional) tunes presentation without changing behavior:
//   options.variant — extra modifier class on .role-filter (e.g. the front-page
//                     inverted strip); options.kicker — HTML for the kicker label
//                     (trusted caller string, defaults to "I am —").
// Returns a setSelected(role) function that moves the selection without firing
// onChange — the front page runs one strip per section front and uses this to
// keep the two in step. Callers that don't need it can ignore the return value.
function renderRoleFilter(container, onChange, options) {
  options = options || {};
  var variantClass = options.variant ? ' ' + options.variant : '';
  var kicker = options.kicker || 'Show me content for &mdash;';
  var chips = [{ slug: null, label: 'Everyone' }].concat(
    ROLE_ORDER.map(function (slug) { return { slug: slug, label: ROLE_LABELS[slug] }; })
  );
  var html =
    '<div class="role-filter' + variantClass + '">' +
      '<span class="role-filter__kicker caption">' + kicker + '</span>' +
      '<div class="role-filter__chips" role="group" aria-label="Filter by role">';
  chips.forEach(function (c, i) {
    var selected = i === 0;
    html +=
      '<button type="button" class="role-chip' + (selected ? ' is-selected' : '') + '"' +
        ' data-role="' + escapeHtml(c.slug || '') + '"' +
        ' aria-pressed="' + (selected ? 'true' : 'false') + '">' +
        escapeHtml(c.label) +
      '</button>';
  });
  html += '</div></div>';
  container.innerHTML = html;

  var buttons = container.querySelectorAll('.role-chip');

  function mark(btn) {
    for (var i = 0; i < buttons.length; i++) {
      var sel = buttons[i] === btn;
      buttons[i].classList.toggle('is-selected', sel);
      buttons[i].setAttribute('aria-pressed', sel ? 'true' : 'false');
    }
  }

  container.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.role-chip') : null;
    if (!btn) return;
    mark(btn);
    onChange(btn.getAttribute('data-role') || null);
  });

  return function setSelected(role) {
    for (var i = 0; i < buttons.length; i++) {
      if ((buttons[i].getAttribute('data-role') || null) === (role || null)) {
        mark(buttons[i]);
        return;
      }
    }
  };
}

// Filter items to those relevant to `role`. Null (Everyone) shows all; items
// without an audience array always show.
function filterByRole(items, role) {
  if (!role) return items;
  return items.filter(function (it) {
    return !Array.isArray(it.audience) || it.audience.length === 0 ||
      it.audience.indexOf(role) !== -1;
  });
}

// Short audience tag for a list row (e.g. "DEV · QA"). Returns '' when there is
// no audience, or when the item targets all five roles (i.e. "everyone").
function audienceMeta(audience) {
  if (!Array.isArray(audience) || audience.length === 0) return '';
  var coversAll = ROLE_ORDER.every(function (r) { return audience.indexOf(r) !== -1; });
  if (coversAll) return '';
  return audience.map(function (r) { return ROLE_SHORT[r] || r; }).join(' · ');
}

// Render the "Why this matters to you" block from an item's `relevance` object.
// Returns '' when relevance is absent (no empty shell). One small lime marker
// beside the kicker is the only accent — the body stays inked.
function renderRelevance(rel) {
  if (!rel || typeof rel !== 'object') return '';
  var rows = [
    ['Why is this relevant to me?', rel.whyRelevant],
    ['How will this help in my daily job?', rel.dailyImpact],
    ['What practical benefit does it provide?', rel.practicalBenefit]
  ];
  var body = '';
  rows.forEach(function (r) {
    if (!r[1]) return;
    body +=
      '<div class="relevance__entry">' +
        '<p class="relevance__label caption">' + escapeHtml(r[0]) + '</p>' +
        '<p class="relevance__body">' + escapeHtml(r[1]) + '</p>' +
      '</div>';
  });
  if (!body) return '';
  return '<section class="relevance" aria-label="Why this matters to you">' +
    '<p class="relevance__kicker caption">' +
      '<span class="relevance__marker" aria-hidden="true"></span>Why this matters to you' +
    '</p>' + body +
    '</section>';
}

// Human-readable label for a sourcePlatform enum value.
function platformLabel(p) {
  var map = { reddit: 'Reddit', hackernews: 'Hacker News', blog: 'Blog', newsletter: 'Newsletter', youtube: 'YouTube', other: 'Other' };
  return map[p] || (p ? String(p) : 'Other');
}

// Render one use-case as an editorial list row (reuses the .row component).
// Category leads as the chip; the meta line carries platform + tools.
function renderUsecaseItem(u) {
  var href = 'usecase.html?id=' + encodeURIComponent(u.id);
  var tools = Array.isArray(u.tools) ? u.tools.join(' · ') : '';
  var meta = escapeHtml(platformLabel(u.sourcePlatform));
  if (tools) meta += ' &middot; ' + escapeHtml(tools);
  var aud = audienceMeta(u.audience);
  if (aud) meta += ' &middot; ' + escapeHtml(aud);
  return '<article class="row">' +
    '<p class="row__chip"><span class="chip">' + escapeHtml(u.category) + '</span></p>' +
    '<h2 class="row__headline"><a href="' + href + '">' + escapeHtml(u.title) + '</a></h2>' +
    '<p class="row__meta caption">' + meta + '</p>' +
    '<p class="row__summary">' + escapeHtml(u.whatItDoes) + '</p>' +
    '</article>';
}

// Render one article as an editorial list row. The headline is the single real
// link (one tab stop per row); a stretched ::after overlay makes the whole row
// a click target. Every injected field is escaped; the id is URL-encoded.
function renderListItem(a) {
  var href = 'article.html?id=' + encodeURIComponent(a.id);
  var meta = escapeHtml(a.source) + ' &middot; ' + formatDate(a.publishedDate);
  var aud = audienceMeta(a.audience);
  if (aud) meta += ' &middot; ' + escapeHtml(aud);
  return '<article class="row">' +
    '<p class="row__chip"><span class="chip">' + escapeHtml(a.topic) + '</span></p>' +
    '<h2 class="row__headline"><a href="' + href + '">' + escapeHtml(a.title) + '</a></h2>' +
    '<p class="row__meta caption">' + meta + '</p>' +
    '<p class="row__summary">' + escapeHtml(a.summary) + '</p>' +
    '</article>';
}

// --- Dynamic header (shared by every page) ----------------------------------
// One scroll behaviour across the whole product. Scrolling down retracts the
// black masthead and pins a compact page-title bar (.pagehead) to the top-left;
// scrolling up brings the masthead back. The compact bar is built here from the
// page's own title + subtitle, so no page has to duplicate its header in markup.
//
//   opts.scroller      — scroll source (default window). Index section fronts
//                        pass their own overflow container.
//   opts.root          — element that carries the .nav-hidden / .head-collapsed
//                        state classes and hosts .pagehead (default document.body).
//   opts.masthead      — the black ribbon to retract (default first .masthead
//                        found under root).
//   opts.title         — compact-bar title text.
//   opts.sub           — compact-bar subtitle text (optional).
//   opts.collapseAfter — element or px offset: the compact bar only appears once
//                        the reader has scrolled past this point, so it never
//                        doubles the full-size header (default 140px).
// Returns { refresh } to recompute the threshold (e.g. after a resize).
function initDynamicHeader(opts) {
  opts = opts || {};
  var scroller = opts.scroller || window;
  var isWindow = scroller === window;
  var root = opts.root || document.body;
  var masthead = opts.masthead || root.querySelector('.masthead');
  if (masthead) masthead.classList.add('masthead--dynamic');

  // Build the compact page-title bar once.
  var head = document.createElement('div');
  head.className = 'pagehead';
  head.setAttribute('aria-hidden', 'true');
  var inner = document.createElement('div');
  inner.className = 'pagehead__inner';
  var tEl = document.createElement('span');
  tEl.className = 'pagehead__title';
  tEl.textContent = opts.title || '';
  inner.appendChild(tEl);
  if (opts.sub) {
    var sEl = document.createElement('span');
    sEl.className = 'pagehead__sub';
    sEl.textContent = opts.sub;
    inner.appendChild(sEl);
  }
  head.appendChild(inner);
  (opts.headHost || (isWindow ? document.body : root)).appendChild(head);

  function topOf() {
    return isWindow
      ? (window.pageYOffset || document.documentElement.scrollTop || 0)
      : scroller.scrollTop;
  }

  // Resolve the collapse threshold to a fixed px offset (computed while the
  // region is at rest, so the element's measured position is trustworthy).
  function resolveThreshold() {
    var ca = opts.collapseAfter;
    if (typeof ca === 'number') return ca;
    if (ca && ca.getBoundingClientRect) {
      var scrTop = isWindow ? 0 : scroller.getBoundingClientRect().top;
      return Math.max(60, ca.getBoundingClientRect().bottom - scrTop + topOf() - 12);
    }
    return 140;
  }

  var threshold = resolveThreshold();
  var lastY = topOf();
  var navHidden = false;
  var collapsed = false;

  function apply() {
    root.classList.toggle('nav-hidden', navHidden);
    root.classList.toggle('head-collapsed', collapsed);
    head.setAttribute('aria-hidden', collapsed ? 'false' : 'true');
  }

  function onScroll() {
    var y = topOf();
    if (y <= 4) {
      // Back at the top: full masthead, no compact bar.
      navHidden = false;
      collapsed = false;
    } else {
      if (y > lastY + 2) navHidden = true;        // scrolling down → retract nav
      else if (y < lastY - 2) navHidden = false;  // scrolling up  → showcase nav
      if (y > threshold) collapsed = true;         // past the header → pin the bar
    }
    lastY = y;
    apply();
  }

  (isWindow ? window : scroller).addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { threshold = resolveThreshold(); });
  apply();

  return {
    refresh: function () { threshold = resolveThreshold(); }
  };
}

// --- Collapsible "Read this first" disclaimer -------------------------------
// Turns a standing .disclaimer notice into a collapsible card: it opens on load,
// auto-collapses after `autoMs` (default 10s) down to just its lime "Read this
// first" header, and the reader can click (or key) that header to expand it
// again. The collapsed/expanded choice then persists — it is never reset on
// scroll, so it rides along with the page as the reader moves down.
//
// The collapsible body is wrapped here from whatever follows the kicker, so both
// the static playbook markup and the script-built usecase markup work unchanged.
function initDisclaimer(disc, autoMs) {
  if (!disc || disc.getAttribute('data-collapsible') === 'on') return;
  var kicker = disc.querySelector('.disclaimer__kicker');
  if (!kicker) return;
  disc.setAttribute('data-collapsible', 'on');
  if (autoMs == null) autoMs = 10000;

  // Everything after the lime kicker becomes the collapsible body.
  var body = document.createElement('div');
  body.className = 'disclaimer__body';
  var node = kicker.nextSibling;
  while (node) {
    var next = node.nextSibling;
    body.appendChild(node);
    node = next;
  }
  disc.appendChild(body);

  // The kicker becomes the toggle control.
  var region = 'disclaimer-body-' + Math.random().toString(36).slice(2, 8);
  body.id = region;
  kicker.setAttribute('role', 'button');
  kicker.setAttribute('tabindex', '0');
  kicker.setAttribute('aria-controls', region);
  kicker.setAttribute('aria-expanded', 'true');

  var timer = null;
  function stopTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }
  function setCollapsed(collapsed) {
    disc.classList.toggle('is-collapsed', collapsed);
    kicker.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  function toggle() {
    stopTimer(); // a manual choice cancels the pending auto-collapse
    setCollapsed(!disc.classList.contains('is-collapsed'));
  }

  kicker.addEventListener('click', toggle);
  kicker.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      toggle();
    }
  });

  if (autoMs > 0) {
    timer = setTimeout(function () { timer = null; setCollapsed(true); }, autoMs);
  }
}

// Wire every standing disclaimer on the page (idempotent — safe to call again
// after async content renders one in).
function initDisclaimers(autoMs) {
  var list = document.querySelectorAll('.disclaimer');
  for (var i = 0; i < list.length; i++) initDisclaimer(list[i], autoMs);
}
