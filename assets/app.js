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

// --- AI Playbook (data/usecases.json) --------------------------------------
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
  return '<article class="row">' +
    '<p class="row__chip"><span class="chip">' + escapeHtml(a.topic) + '</span></p>' +
    '<h2 class="row__headline"><a href="' + href + '">' + escapeHtml(a.title) + '</a></h2>' +
    '<p class="row__meta caption">' + escapeHtml(a.source) + ' &middot; ' + formatDate(a.publishedDate) + '</p>' +
    '<p class="row__summary">' + escapeHtml(a.summary) + '</p>' +
    '</article>';
}
