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
function renderRoleFilter(container, onChange, options) {
  options = options || {};
  var variantClass = options.variant ? ' ' + options.variant : '';
  var kicker = options.kicker || 'I am &mdash;';
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
  container.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.role-chip') : null;
    if (!btn) return;
    for (var i = 0; i < buttons.length; i++) {
      var sel = buttons[i] === btn;
      buttons[i].classList.toggle('is-selected', sel);
      buttons[i].setAttribute('aria-pressed', sel ? 'true' : 'false');
    }
    onChange(btn.getAttribute('data-role') || null);
  });
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
