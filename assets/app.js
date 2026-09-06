// ALerts — shared static-reader logic.
// The static site reads data/articles.json as its only data source (FR-S1);
// no backend, no AI calls run here (NFR-2/NFR-4).

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

// Order a contract array newest-first by `addedDate` — when the curator filed
// the item on ALerts. That date is also the one shown everywhere on the site;
// `publishedDate` (the original source's date) is kept in the data for the
// record and is never displayed, so ordering and dateline agree.
//
// Ties are broken by the item's position in the JSON file rather than left to
// the engine: the publisher appends at the top, so file order is already
// newest-first within a day. Array.prototype.sort is stable in modern engines,
// but decorating with the index makes that a property of this function instead
// of an assumption about the host.
function sortByAddedDate(items) {
  return items
    .map(function (it, i) { return { it: it, i: i }; })
    .sort(function (a, b) {
      var d = Date.parse(b.it.addedDate) - Date.parse(a.it.addedDate);
      if (d) return d;
      return a.i - b.i;
    })
    .map(function (w) { return w.it; });
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
      return sortByAddedDate(articles);
    });
}

// --- i2e AI Guide (data/usecases.json) -----------------------------------------
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
      return sortByAddedDate(usecases);
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

// --- Item tags: freshness + subject -----------------------------------------
// Two independent tags share the chip slot on every surface:
//
//   "Latest"  — a freshness badge, computed here from `addedDate` (when the
//               curator filed the item on the site). Nothing in the data says
//               "Latest", so the badge ages out on its own after RECENT_DAYS.
//   subject   — what the item is about: an article's `topic`, a use-case's
//               `category`. Only some items carry one, so it only sometimes shows.
//
// The curator writes the literal "Latest" into `topic` when an article came off
// the plain feed rather than a topic prompt. That is a placeholder, not a
// subject, and rendering it as one is what used to leave every archived article
// tagged "Latest" years after it was filed.

var RECENT_DAYS = 7;

// True when `addedDate` (YYYY-MM-DD) falls within the last RECENT_DAYS days.
// Both sides are pinned to UTC midnight so the comparison counts whole days and
// doesn't flip depending on the reader's timezone. A date in the future counts
// as recent — it can only be newer than now.
function isRecent(addedDate) {
  var t = Date.parse(addedDate);
  if (isNaN(t)) return false;
  var now = new Date();
  var todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (todayUtc - t) / 86400000 < RECENT_DAYS;
}

// The subject tag's text, or '' when the item has no real subject — blank, or
// the "Latest" placeholder described above.
function subjectLabel(s) {
  var v = (s == null ? '' : String(s)).trim();
  if (!v || v.toLowerCase() === 'latest') return '';
  return v;
}

// The tag row for one item, wrapped in `cls` (each surface has its own spacing
// class). Returns '' when the item has neither tag, so callers drop the line
// entirely rather than printing an empty one.
function renderTags(cls, addedDate, subject) {
  var tags = '';
  if (isRecent(addedDate)) tags += '<span class="chip chip--latest">Latest</span>';
  var subj = subjectLabel(subject);
  if (subj) tags += '<span class="chip">' + escapeHtml(subj) + '</span>';
  if (!tags) return '';
  return '<p class="' + cls + ' tag-row">' + tags + '</p>';
}

// Human-readable label for a sourcePlatform enum value.
function platformLabel(p) {
  var map = { reddit: 'Reddit', hackernews: 'Hacker News', blog: 'Blog', newsletter: 'Newsletter', youtube: 'YouTube', other: 'Other' };
  return map[p] || (p ? String(p) : 'Other');
}

// The empty counter slot every row carries. initRowCounters() fills it in after
// the list has painted; until then (and forever, if the counter service is
// unreachable) it is an empty, aria-hidden span that costs nothing.
//
// It is emitted as the row's *last* child — after the summary — so the cluster
// settles into the row's bottom-right corner on its own line rather than
// crowding the meta dateline. It stays inert: no link, no pointer events, and
// the headline's stretched ::after overlay is a positioned element painted over
// this static one, so the whole row remains one click target.
function rowStatsSlot() {
  return '<span class="row__stats" aria-hidden="true"></span>';
}

// Render one use-case as an editorial list row (reuses the .row component).
// Category leads as the chip; the meta line carries platform, the ALerts
// publish date and tools.
function renderUsecaseItem(u) {
  var href = 'usecase.html?id=' + encodeURIComponent(u.id);
  var tools = Array.isArray(u.tools) ? u.tools.join(' · ') : '';
  var meta = escapeHtml(platformLabel(u.sourcePlatform)) + ' &middot; ' + formatDate(u.addedDate);
  if (tools) meta += ' &middot; ' + escapeHtml(tools);
  var aud = audienceMeta(u.audience);
  if (aud) meta += ' &middot; ' + escapeHtml(aud);
  return '<article class="row" data-kind="usecase" data-id="' + escapeHtml(u.id) + '">' +
    renderTags('row__chip', u.addedDate, u.category) +
    '<h2 class="row__headline"><a href="' + href + '">' + escapeHtml(u.title) + '</a></h2>' +
    '<p class="row__meta caption">' + meta + '</p>' +
    '<p class="row__summary">' + escapeHtml(u.whatItDoes) + '</p>' +
    rowStatsSlot() +
    '</article>';
}

// Render one article as an editorial list row. The headline is the single real
// link (one tab stop per row); a stretched ::after overlay makes the whole row
// a click target. Every injected field is escaped; the id is URL-encoded.
function renderListItem(a) {
  var href = 'article.html?id=' + encodeURIComponent(a.id);
  var meta = escapeHtml(a.source) + ' &middot; ' + formatDate(a.addedDate);
  var aud = audienceMeta(a.audience);
  if (aud) meta += ' &middot; ' + escapeHtml(aud);
  return '<article class="row" data-kind="article" data-id="' + escapeHtml(a.id) + '">' +
    renderTags('row__chip', a.addedDate, a.topic) +
    '<h2 class="row__headline"><a href="' + href + '">' + escapeHtml(a.title) + '</a></h2>' +
    '<p class="row__meta caption">' + meta + '</p>' +
    '<p class="row__summary">' + escapeHtml(a.summary) + '</p>' +
    rowStatsSlot() +
    '</article>';
}

// --- Upvotes (detail pages only) --------------------------------------------
// The one place the reader writes anything. A static site has nowhere to keep
// shared state, so the totals live in a free hosted counter service (Abacus):
//   GET /hit/<ns>/<key> → increments, returns {"value": n}
//   GET /get/<ns>/<key> → reads it, 404 when nobody has voted yet
// No account, no key, no backend — and correspondingly no guarantees. The
// namespace below is public (it ships in this file), the service is unofficial
// and free, and anyone who works out the URL can inflate a count. This is
// PoC-grade social proof, not an audited number. See the README.
//
// What "anonymous" does and doesn't mean here. The request body carries the
// item's key and nothing else: no name, no account, no reader id, and this site
// never learns or stores who voted. But the browser calls Abacus directly, so
// Abacus receives the reader's IP address and user agent the way any web server
// would. So: anonymous with respect to i2e and to other readers, not with
// respect to the counter service. The reader-facing note and the README both say
// only what that supports. Whether *this browser* has voted is kept in
// localStorage and never leaves the device.
//
// The whole feature degrades to nothing. The count is read before the control is
// built, so if the service is unreachable, blocked, or returns junk, the page
// renders exactly as it did before — a dead dependency costs one failed fetch.

var UPVOTE_API = 'https://abacus.jasoncameron.dev';
var UPVOTE_NS = 'alerts-i2e-7f3a9c2e';
var UPVOTE_NOTE = 'Upvote if you found it useful!';
var UPVOTE_RETRY = 'That didn’t go through. Try again.';
var UPVOTE_UNSURE = 'We couldn’t confirm your upvote. Reload to see the current total.';

// Counter keys are scoped by collection. Articles and use-cases are separate
// contracts with separately-assigned ids, and nothing in either schema stops the
// two from colliding; an unscoped key would merge a colliding pair's totals and
// voted state into one counter.
var UPVOTE_KINDS = { article: 'a', usecase: 'g' };

// The counter key for one item: an optional metric prefix, then a collection
// prefix, then its id. Returns null for an unknown collection, which leaves the
// control unrendered rather than guessing a prefix and silently sharing someone
// else's counter.
//
//   counterKey('',   'article', id) → 'a-<id>'    upvotes
//   counterKey('v-', 'article', id) → 'v-a-<id>'  views
//   counterKey('s-', 'usecase', id) → 's-g-<id>'  shares
//
// The three metrics are separate counters on the same namespace; the metric
// prefix is what keeps them apart. Upvotes pass '' so their keys stay exactly
// what they were before views and shares existed — an existing total must not
// be orphaned by a key change.
//
// Keys are capped at 64 characters and limited to a URL-safe alphabet. Every id
// in the contract fits today (the longest is 59, plus the 2-character prefix),
// but ids are written by the curator, so a long one folds down to a truncated
// slug plus a hash of the whole key rather than 400-ing and losing the control.
// The fold runs on the whole key, metric prefix included, so the three metrics
// stay distinct even for a folded id.
function counterKey(prefix, kind, id) {
  // Own-property check, not a plain lookup: `toString` and `constructor` resolve
  // through the prototype chain and would otherwise pass for real collections.
  if (!Object.prototype.hasOwnProperty.call(UPVOTE_KINDS, kind)) return null;
  var k = (prefix || '') + UPVOTE_KINDS[kind] + '-' + id;
  if (k.length <= 64 && /^[A-Za-z0-9_-]+$/.test(k)) return k;
  var h = 5381;
  for (var i = 0; i < k.length; i++) h = ((h * 33) ^ k.charCodeAt(i)) >>> 0;
  return k.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50) + '-' + h.toString(36);
}

// The upvote counter key — the original, unprefixed form.
function upvoteKey(kind, id) {
  return counterKey('', kind, id);
}

// Read a total out of a counter response. A 200 carrying a payload we can't read
// is a broken dependency, not a zero — mounting "0" would invent a number the
// service never reported — so an unreadable body throws and the control hides.
// A numeric string is accepted so a benign change in how the service formats its
// JSON doesn't blank the control, but null, undefined and anything unparseable
// are rejected outright — Number(null) is 0, and reporting that as a total is
// exactly the invented number this guard exists to prevent.
//
// A total is a count of votes, so only a safe non-negative integer will do.
// Rounding 1.9 down to 1, or accepting a value past Number.MAX_SAFE_INTEGER
// where arithmetic silently stops being exact, would each display a number the
// service did not report — the same defect in a quieter form.
function upvoteCount(d) {
  var v = d && d.value;
  var usable = typeof v === 'number' ||
    (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)));
  var n = usable ? Number(v) : NaN;
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('unreadable counter payload');
  return n;
}

// localStorage is unavailable in some privacy modes; a reader there simply gets
// an un-guarded button rather than a broken page.
function upvoteRead(k) {
  try { return localStorage.getItem(k) === '1'; } catch (e) { return false; }
}
function upvoteWrite(k) {
  try { localStorage.setItem(k, '1'); } catch (e) { /* nothing to do */ }
}

// Mount the upvote control for `id` into `host`. Renders nothing at all unless
// the current total comes back, so the control never appears in a state where
// pressing it would fail.
function initUpvotes(host, kind, id) {
  if (!host || !id) return;
  var key = upvoteKey(kind, id);
  if (!key) return;
  var seen = 'alerts:upvoted:' + key;

  // Priority: the control can't be built until this lands, and a reader waiting
  // on it must not queue behind a list page's speculative row reads.
  counterFetch(UPVOTE_API + '/get/' + UPVOTE_NS + '/' + encodeURIComponent(key), true)
    .then(function (r) {
      if (r.status === 404) return { value: 0 };   // created on first upvote
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var n = upvoteCount(d);
      // Same memo the list rows read from, so a Back out of this page shows the
      // total we already paid for rather than spending another request.
      counterCacheWrite(key, n);
      mount(n);
    })
    .catch(function () { /* counter unavailable — leave the page as it was */ });

  function mount(count) {
    var voted = upvoteRead(seen);
    host.innerHTML =
      '<button type="button" class="upvote" aria-pressed="' + (voted ? 'true' : 'false') + '">' +
        '<span class="upvote__mark" aria-hidden="true">&#9650;</span>' +
        '<span class="upvote__label">' + (voted ? 'Upvoted' : 'Upvote') + '</span>' +
        '<span class="upvote__count">' + count + '</span>' +
      '</button>' +
      // The note doubles as the control's status line: it starts as the standing
      // privacy line and is overwritten when a vote fails or can't be confirmed.
      // role=status makes those swaps reach assistive tech, which would otherwise
      // get the sighted reader's explanation and nothing else. It is in the DOM
      // before any mutation, which is what makes the announcement reliable.
      '<p class="upvote__note caption" role="status" aria-live="polite">' +
        escapeHtml(UPVOTE_NOTE) +
      '</p>';

    var btn = host.querySelector('.upvote');
    var label = host.querySelector('.upvote__label');
    var num = host.querySelector('.upvote__count');
    var note = host.querySelector('.upvote__note');
    if (voted) btn.disabled = true;
    setLabel(count, voted);

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      // Optimistic: the reader sees their vote land immediately, and the
      // authoritative total from the response replaces it a moment later.
      var previous = count;
      btn.disabled = true;
      paint(previous + 1, true);
      note.textContent = UPVOTE_NOTE;

      counterFetch(UPVOTE_API + '/hit/' + UPVOTE_NS + '/' + encodeURIComponent(key), true)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          count = upvoteCount(d);
          // Fold the new total into the session memo so the list this reader
          // goes back to shows their own vote instead of the pre-vote number.
          counterCacheWrite(key, count);
          // Only now is the vote real. Recording it any earlier would lock the
          // reader out of retrying a vote that never actually landed: the next
          // load would read back the unchanged total and still disable the
          // button as "Upvoted".
          upvoteWrite(seen);
          paint(count, true);
        })
        .catch(function () { reconcile(previous); });
    });

    // A failed /hit does not mean nothing happened. The increment may well have
    // landed and only the response been lost, and the service offers no
    // idempotency key to settle it — so simply rolling back and inviting a retry
    // would count a single intended vote twice.
    //
    // Re-read the total instead and let the number decide. This narrows the
    // window rather than closing it: a different reader voting during the
    // reconcile is indistinguishable from our own, and that ambiguity is
    // deliberately resolved towards under-counting. Losing one upvote off a soft
    // popularity signal is the cheaper error than inflating it.
    function reconcile(previous) {
      counterFetch(UPVOTE_API + '/get/' + UPVOTE_NS + '/' + encodeURIComponent(key), true)
        .then(function (r) {
          if (r.status === 404) return { value: 0 };
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (d) {
          var now = upvoteCount(d);
          if (now > previous) {
            // Something landed. Treat it as this reader's vote and stop here —
            // the button stays spent, so no retry can double it.
            count = now;
            counterCacheWrite(key, count);
            upvoteWrite(seen);
            paint(count, true);
          } else {
            // The total never moved: the vote genuinely didn't reach the
            // service. Restore the control and say so, rather than letting an
            // unexplained number slide back down.
            count = previous;
            paint(count, false);
            btn.disabled = false;
            note.textContent = UPVOTE_RETRY;
          }
        })
        .catch(function () {
          // Both calls failed, so which happened is unknowable from here. Show
          // the last total we trust and leave the button spent — offering a
          // blind retry is how the double-count gets in. Nothing is persisted,
          // so a reload re-reads the real total and hands the reader a working
          // button again.
          count = previous;
          paint(count, false);
          note.textContent = UPVOTE_UNSURE;
        });
    }

    function paint(n, isVoted) {
      num.textContent = n;
      label.textContent = isVoted ? 'Upvoted' : 'Upvote';
      btn.setAttribute('aria-pressed', isVoted ? 'true' : 'false');
      setLabel(n, isVoted);
    }

    // The visible text is three separate spans, so give assistive tech one
    // sentence that says what the control does and what the number means.
    function setLabel(n, isVoted) {
      btn.setAttribute('aria-label',
        (isVoted ? 'Upvoted. ' : 'Upvote this. ') +
        n + (n === 1 ? ' upvote' : ' upvotes') + ' so far.');
    }
  }
}

// --- Toast ------------------------------------------------------------------
// One transient status line for the whole page, bottom-centre. A single element
// is created on first use and reused on every later message, so repeated clicks
// stack nothing up. role=status + aria-live=polite means the message is spoken
// as well as seen; the fade is CSS and is dropped under reduced motion.

var TOAST_MS = 2500;

function showToast(msg) {
  var el = document.getElementById('alerts-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'alerts-toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  if (el.dismissTimer) clearTimeout(el.dismissTimer);
  // Drop and re-add so a second click restarts the fade rather than riding out
  // the first one's remaining time. Reading offsetWidth forces the reflow that
  // makes the removal a real style change.
  el.classList.remove('is-visible');
  void el.offsetWidth;
  el.classList.add('is-visible');
  el.dismissTimer = setTimeout(function () {
    el.dismissTimer = null;
    el.classList.remove('is-visible');
  }, TOAST_MS);
}

// --- Counter request budget --------------------------------------------------
// Abacus rate-limits at 30 requests per 10 seconds per IP, and it enforces that
// across the whole service — not per counter and not per tab. A 53-row archive
// asking for two totals a row is 106 requests, so the naive version tripped 429
// inside the first second: most rows stayed blank *and* the reader's next click
// (a view hit, an upvote) landed in the penalty box behind them.
//
// So every Abacus call in this file goes through counterFetch(), which meters
// the whole page against one budget:
//
//   * a rolling-window allowance of COUNTER_BUDGET requests per
//     COUNTER_WINDOW_MS — deliberately under the service's 30, leaving headroom
//     for the same reader's other tabs, which share the IP and the limit;
//   * at most COUNTER_MAX_INFLIGHT sockets open at once;
//   * two FIFO queues. Interactive calls (a view hit, a share hit, anything the
//     upvote control does) jump ahead of speculative row reads, because those
//     are the reader's own actions and there is a person waiting on them;
//   * a back-off: a 429 or a network failure on a row read pauses the *row*
//     drain (interactive calls still go), honouring Retry-After when the service
//     sends one.
//
// Nothing here retries on the caller's behalf and nothing here throws into the
// page: a starved request simply waits, and a failed one resolves the way a
// failed fetch already did.

var COUNTER_BUDGET = 20;            // requests allowed per rolling window
var COUNTER_WINDOW_MS = 10000;      // the window Abacus measures (30/10s there)
var COUNTER_MAX_INFLIGHT = 4;       // sockets open at once
var COUNTER_BACKOFF_MS = 10000;     // default pause after a 429
var COUNTER_BACKOFF_MAX_MS = 30000; // cap on a service-supplied Retry-After

var counterStamps = [];             // issue times inside the current window
var counterQueues = [[], []];       // [0] interactive, [1] background row reads
var counterInflight = 0;
var counterBackoffUntil = 0;        // background drain paused until this ms
var counterTimer = null;

// Drop the issue stamps that have aged out of the rolling window.
function counterPrune(now) {
  while (counterStamps.length && now - counterStamps[0] >= COUNTER_WINDOW_MS) {
    counterStamps.shift();
  }
}

// The next job to send, or null when everything runnable is blocked. Interactive
// work is never held by the back-off — the pause exists to stop row reads from
// re-tripping the limit, not to punish the reader.
function counterTake(now) {
  if (counterQueues[0].length) return counterQueues[0].shift();
  if (counterQueues[1].length && now >= counterBackoffUntil) return counterQueues[1].shift();
  return null;
}

// Wake counterPump() at the earliest moment the queue can move again. In-flight
// completions re-pump on their own, so only the window and the back-off need a
// timer; one is enough, and it is never stacked.
function counterSchedule() {
  if (counterTimer) return;
  if (!counterQueues[0].length && !counterQueues[1].length) return;
  var now = Date.now();
  var delay = -1;
  if (counterStamps.length >= COUNTER_BUDGET && counterStamps.length) {
    delay = Math.max(delay, counterStamps[0] + COUNTER_WINDOW_MS - now);
  }
  if (!counterQueues[0].length && counterQueues[1].length && counterBackoffUntil > now) {
    delay = Math.max(delay, counterBackoffUntil - now);
  }
  if (delay < 0) return;            // only in-flight capacity is missing
  counterTimer = setTimeout(function () {
    counterTimer = null;
    counterPump();
  }, delay + 1);
}

function counterSend(job) {
  var settled = false;
  function done() {
    if (settled) return;
    settled = true;
    counterInflight--;
    counterPump();
  }
  var p;
  try { p = fetch(job.url); } catch (e) { p = Promise.reject(e); }
  Promise.resolve(p).then(
    function (r) { done(); job.resolve(r); },
    function (e) { done(); job.reject(counterNetworkError(e)); }
  );
}

// A rejected fetch and a 429 are the same thing to the row drain: "back off and
// try this one again later". Tagging the error is what lets the read layer tell
// those apart from a junk payload, which retrying would not fix.
function counterNetworkError(e) {
  var err = new Error('counter request failed: ' + ((e && e.message) || 'network'));
  err.counterRetry = true;
  return err;
}

function counterPump() {
  var now = Date.now();
  counterPrune(now);
  while (counterInflight < COUNTER_MAX_INFLIGHT && counterStamps.length < COUNTER_BUDGET) {
    var job = counterTake(now);
    if (!job) break;
    counterStamps.push(now);
    counterInflight++;
    counterSend(job);
  }
  counterSchedule();
}

// The one door to Abacus. `priority` true = the reader is waiting (hits, upvote
// reads); false = a speculative row read. Resolves with the Response, rejects
// only when the request never completed.
function counterFetch(url, priority) {
  return new Promise(function (resolve, reject) {
    counterQueues[priority ? 0 : 1].push({ url: url, resolve: resolve, reject: reject });
    counterPump();
  });
}

// How long to wait after a throttle. `res` is the 429 response when there was
// one, so a service-supplied Retry-After (seconds) wins over the default —
// capped, because an absurd value would otherwise strand the counters for the
// whole visit. Shared by the row-read back-off and by the /hit retry, so both
// obey the same instruction from the service.
function counterRetryAfterMs(res) {
  var ms = COUNTER_BACKOFF_MS;
  if (res && res.headers && res.headers.get) {
    var ra = parseFloat(res.headers.get('Retry-After'));
    if (isFinite(ra) && ra > 0) ms = ra * 1000;
  }
  if (ms > COUNTER_BACKOFF_MAX_MS) ms = COUNTER_BACKOFF_MAX_MS;
  return ms;
}

// Pause the row-read drain. `res` is the 429 response when there was one, so a
// service-supplied Retry-After (seconds) wins over the default — capped, because
// an absurd value would otherwise strand the counters for the whole visit.
function counterBackoff(res) {
  var until = Date.now() + counterRetryAfterMs(res);
  if (until > counterBackoffUntil) counterBackoffUntil = until;
}

// --- Counter cache -----------------------------------------------------------
// Totals are soft signals that move slowly, so a short memo in sessionStorage
// buys back most of the budget: the role filter re-rendering the list, and a
// Back out of an article, both repaint from the cache without spending a single
// request. sessionStorage (not localStorage) keeps the memo to this tab and this
// visit, which is about as long as a number this stale should be trusted.

var COUNTER_CACHE_PREFIX = 'alerts:ctr:';
var COUNTER_CACHE_TTL_MS = 300000;   // 5 minutes

function counterCacheRead(key) {
  if (!key) return null;
  try {
    var raw = sessionStorage.getItem(COUNTER_CACHE_PREFIX + key);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (!o || typeof o.v !== 'number' || typeof o.t !== 'number') return null;
    if (!Number.isSafeInteger(o.v) || o.v < 0) return null;
    if (Date.now() - o.t > COUNTER_CACHE_TTL_MS) return null;
    return o.v;
  } catch (e) {
    return null;
  }
}

function counterCacheWrite(key, v) {
  if (!key) return;
  try {
    sessionStorage.setItem(COUNTER_CACHE_PREFIX + key, JSON.stringify({ v: v, t: Date.now() }));
  } catch (e) { /* private mode, or the quota — the memo is optional */ }
}

// Used when this browser lands a /hit whose body we couldn't read: the total we
// have is now one behind, and showing the reader's own action is worth more than
// waiting out the TTL. Absent from the cache means nothing to correct.
function counterCacheBump(key) {
  var v = counterCacheRead(key);
  if (v !== null) counterCacheWrite(key, v + 1);
}

// --- Counter reads/writes (shared by upvotes, views and shares) --------------

// GET /hit — increment, resolving true only when the service confirmed it.
// Never rejects: every caller here is fire-and-forget and must not turn a dead
// counter service into an unhandled rejection in the console.
//
// Interactive by definition — a hit is always something the reader just did — so
// every attempt takes the priority queue, and each retry is metered by the same
// global budget as the first try.
//
// Abacus' 30-per-10s limit is shared across every tab and everyone behind the
// same IP, so a reader's view or share hit can be throttled through no fault of
// this page. Resolving false once and stopping there silently lost the action
// until the reader happened to reopen the page or copy the link again, so a hit
// now retries:
//
//   * HTTP 429 — the increment did *not* happen, so retrying cannot double
//     count. Wait Retry-After (default 10s, capped at 30s) and try again, up to
//     HIT_MAX_ATTEMPTS attempts in total. The row-read drain is paused too: this
//     browser is demonstrably over the limit, and speculative reads should stand
//     aside for the reader's own action.
//   * a rejected fetch — ambiguous: the request may well have landed and only
//     the response been lost, and Abacus offers no idempotency key to settle it.
//     Retried exactly ONCE after HIT_NET_RETRY_MS, which accepts a small risk of
//     counting one view or share twice in exchange for not dropping it. That
//     trade is deliberate and specific to views and shares — soft signals where
//     a rare +1 costs less than a systematically lost count. Upvotes do not use
//     this path; initUpvotes() reconciles by re-reading the total instead.
//   * any other non-ok status (other 4xx/5xx) — give up and resolve false. A
//     dead or misconfigured service fails the same way on the next attempt.
//
// Resolves true only after a confirmed ok response, which is what keeps
// initViewCount()/initShare() from writing their localStorage flag for a hit
// that never landed. Retries are plain setTimeout work: if the reader closes the
// page first they simply die with it, the flag stays unset, and the next open or
// copy counts the action.
var HIT_MAX_ATTEMPTS = 4;        // total /hit attempts across 429s
var HIT_NET_RETRY_MS = 5000;     // the single retry after a request never completed

function hitCounter(key) {
  if (!key) return Promise.resolve(false);
  var url = UPVOTE_API + '/hit/' + UPVOTE_NS + '/' + encodeURIComponent(key);

  return new Promise(function (resolve) {
    var attempts = 0;            // attempts issued, including the first
    var netRetried = false;      // the one network-failure retry is spent

    function attempt() {
      attempts++;
      counterFetch(url, true).then(
        function (r) {
          if (r.status === 429) {
            counterBackoff(r);                     // hold the row reads back too
            if (attempts >= HIT_MAX_ATTEMPTS) { resolve(false); return; }
            setTimeout(attempt, counterRetryAfterMs(r));
            return;
          }
          if (!r.ok) { resolve(false); return; }
          // The increment has landed; only the body is still in question, so
          // from here every path resolves true.
          var body;
          try { body = r.json(); } catch (e) { body = Promise.reject(e); }
          Promise.resolve(body).then(
            function (d) {
              // The response carries the new total; fold it into the memo so the
              // list the reader goes back to shows their own view or share.
              try { counterCacheWrite(key, upvoteCount(d)); } catch (e) { counterCacheBump(key); }
              resolve(true);
            },
            function () { counterCacheBump(key); resolve(true); }
          );
        },
        function () {
          if (netRetried) { resolve(false); return; }
          netRetried = true;
          setTimeout(attempt, HIT_NET_RETRY_MS);
        }
      );
    }

    attempt();
  });
}

// One metered, memoised counter read. Resolves { v, retry }:
//   v     — the total, or null when it couldn't be read (callers render nothing
//           rather than an invented "0"). 404 is "nobody has hit this yet" and
//           is a real zero.
//   retry — the read failed in a way worth one more attempt later (a 429, or the
//           request never completed). A junk payload is not: retrying it would
//           fail the same way.
function counterReadDetailed(key, priority) {
  if (!key) return Promise.resolve({ v: null, retry: false });
  var cached = counterCacheRead(key);
  if (cached !== null) return Promise.resolve({ v: cached, retry: false });
  return counterFetch(UPVOTE_API + '/get/' + UPVOTE_NS + '/' + encodeURIComponent(key), priority)
    .then(function (r) {
      if (r.status === 404) return { value: 0 };
      if (r.status === 429) {
        counterBackoff(r);                 // Retry-After, if the service sent one
        var e429 = counterNetworkError(new Error('HTTP 429'));
        e429.counterBackedOff = true;      // don't let the catch overwrite it
        throw e429;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (d) {
      var n = upvoteCount(d);
      counterCacheWrite(key, n);
      return { v: n, retry: false };
    })
    .catch(function (e) {
      var again = !!(e && e.counterRetry);
      // A request that never completed is indistinguishable from a throttle at
      // this layer, and the cure is the same, so pause the row drain for both.
      if (again && !e.counterBackedOff) counterBackoff(null);
      return { v: null, retry: again };
    });
}

// GET /get — the current total, or null when it can't be read.
function readCounter(key) {
  return counterReadDetailed(key, false).then(function (o) { return o.v; });
}

// --- Share (detail pages only) ----------------------------------------------
// Copies the item's canonical ALerts URL and counts the copy. Unlike upvotes
// this control is built unconditionally: copying to the clipboard is a local
// operation that works whether or not the counter service is reachable, so a
// dead Abacus costs the tally, not the feature.

var SHARE_COPIED = 'Link copied to the clipboard';
var SHARE_FAILED = 'Couldn’t copy the link';

var SHARE_ICON =
  '<svg class="share__icon" viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' +
    '<circle cx="18" cy="5" r="3"></circle>' +
    '<circle cx="6" cy="12" r="3"></circle>' +
    '<circle cx="18" cy="19" r="3"></circle>' +
    '<line x1="8.6" y1="10.6" x2="15.4" y2="6.4"></line>' +
    '<line x1="8.6" y1="13.4" x2="15.4" y2="17.6"></line>' +
  '</svg>';

// The page's own address, stripped of any hash or stray query parameters, so a
// reader who arrived through a tracking link still shares the clean canonical
// one.
function canonicalItemUrl(id) {
  return location.origin + location.pathname + '?id=' + encodeURIComponent(id);
}

// navigator.clipboard is unavailable on insecure origins and in older browsers,
// and can reject even where it exists (permission, no user gesture). The
// textarea + execCommand path is the fallback for both cases.
function legacyCopy(text) {
  return new Promise(function (resolve, reject) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    var ok = false;
    try {
      ta.select();
      if (ta.setSelectionRange) ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (ok) resolve(); else reject(new Error('copy failed'));
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
  }
  return legacyCopy(text);
}

// Mount the share control for `id` into `host`. `url` overrides the canonical
// address if a caller ever needs to (nothing does today).
//
// Every click copies the link and confirms with a toast; the *counter* is
// counted once per browser per item, the same shape as the view guard. The
// localStorage flag `alerts:shared:<key>` is written only after the increment
// is confirmed. hitCounter() now retries a throttled hit in place (and a
// network failure once), so only a hit that fails every attempt leaves the flag
// unwritten — and that one is retried on the next copy. A reader in a privacy
// mode where
// localStorage throws is counted on each copy rather than not at all.
function initShare(host, kind, id, url) {
  if (!host || !id) return;
  var link = url || canonicalItemUrl(id);
  var shareKey = counterKey('s-', kind, id);
  var shared = shareKey ? 'alerts:shared:' + shareKey : null;

  host.innerHTML =
    '<button type="button" class="share" aria-label="Copy a link to this page">' +
      SHARE_ICON +
      '<span class="share__label">Share</span>' +
    '</button>';

  host.querySelector('.share').addEventListener('click', function () {
    copyText(link).then(
      function () {
        showToast(SHARE_COPIED);
        // Fire-and-forget: the reader has the link either way, so a failed
        // count must not walk back a toast that told the truth.
        if (shared && upvoteRead(shared)) return;   // already counted on this browser
        hitCounter(shareKey).then(function (ok) {
          if (ok && shared) upvoteWrite(shared);
        });
      },
      function () {
        showToast(SHARE_FAILED);
      }
    );
  });
}

// --- View counter (detail pages only) ---------------------------------------
// Counted once per browser per item, the same shape as the upvote guard: the
// localStorage flag is written only after the increment is confirmed, so a hit
// that never landed is retried on the next visit instead of being lost. A
// reader in a privacy mode where localStorage throws is counted each visit
// rather than not at all. A 429 is retried in place by hitCounter() while the
// page is open; only a hit that fails every attempt leaves the flag unwritten,
// and the next open counts the view.
//
// Call it after the item has rendered. It touches no DOM and never rejects, so
// it cannot affect the page.
function initViewCount(kind, id) {
  if (!id) return;
  var key = counterKey('v-', kind, id);
  if (!key) return;
  var seen = 'alerts:viewed:' + key;
  if (upvoteRead(seen)) return;          // already counted on this browser
  hitCounter(key).then(function (ok) {
    if (ok) upvoteWrite(seen);
  });
}

// --- List-row counters ------------------------------------------------------
// initRowCounters(container)
//
//   Contract. Call it after rendering a list of rows into `container` — e.g.
//   `initRowCounters(document.getElementById('list'))`. It finds every
//   `.row[data-kind][data-id]` beneath the container (renderListItem() and
//   renderUsecaseItem() emit those attributes and an empty
//   `<span class="row__stats">` slot as the row's last child), reads that
//   item's upvote, view and share totals from the counter service, and fills
//   the slot in — ▲ n · 👁 n · share n, icons only, bottom-right of the row.
//   The upvote total is read through the *unprefixed* key initUpvotes() writes,
//   so the list and the detail page always agree; lists never write it.
//
//   Safe to call again after any re-render — a role filter rebuilding the list
//   is the usual case. Each call takes a new generation number; results from a
//   superseded call are dropped instead of painted onto rows that no longer
//   exist, and the superseded call's observer is disconnected. Nothing here can
//   fail the page: a row whose reads fail keeps its empty slot, and the list is
//   already interactive before the first response.
//
//   Cheap by construction, because the budget is small (see counterFetch) and a
//   full archive is 53 rows × 3 counters:
//
//     * Nothing is read for a row the reader hasn't reached. An
//       IntersectionObserver with a 200px margin enqueues each row the first
//       time it comes near the viewport and then stops watching it, so an
//       opening screen costs a handful of requests instead of 159. Without
//       IntersectionObserver (old browsers) the first ROW_COUNTER_FALLBACK_ROWS
//       rows are read and the rest simply stay blank — the same
//       degrade-to-nothing the whole feature already has.
//     * Anything still fresh in the session memo paints straight away, before
//       any observing starts and without a request. That is what makes a
//       role-filter re-render and a Back out of an article free. A Back that
//       comes out of the back-forward cache restores the old DOM instead of
//       re-running any of this, so a `pageshow` listener repaints the rows
//       from the memo there too — cache only, no requests, observer untouched.
//     * A throttled or failed read is re-queued exactly once. counterBackoff()
//       has already paused the row drain by then, so the retry naturally lands
//       after the pause rather than immediately re-tripping the limit.

var ROW_COUNTER_GEN = 0;
var ROW_COUNTER_ROOT_MARGIN = '200px 0px';   // start reading just before arrival
var ROW_COUNTER_FALLBACK_ROWS = 6;           // no IntersectionObserver

var STAT_ICONS = {
  // A bare up-chevron, not the filled ▲ of the detail-page control: the row
  // cluster is a read-out, and a solid mark would read as a button to press.
  upvotes:
    '<svg class="row__stat-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      '<path d="M5 15.5 12 8.5l7 7"></path>' +
    '</svg>',
  views:
    '<svg class="row__stat-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      '<path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z"></path>' +
      '<circle cx="12" cy="12" r="3"></circle>' +
    '</svg>',
  shares:
    '<svg class="row__stat-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      '<circle cx="18" cy="5" r="2.6"></circle>' +
      '<circle cx="6" cy="12" r="2.6"></circle>' +
      '<circle cx="18" cy="19" r="2.6"></circle>' +
      '<line x1="8.4" y1="10.7" x2="15.6" y2="6.3"></line>' +
      '<line x1="8.4" y1="13.3" x2="15.6" y2="17.7"></line>' +
    '</svg>'
};

function rowStatUnit(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function initRowCounters(container) {
  if (!container) return;
  var gen = ++ROW_COUNTER_GEN;
  container.setAttribute('data-counters-gen', String(gen));

  var found = container.querySelectorAll('.row[data-kind][data-id]');
  var rows = [];
  for (var i = 0; i < found.length; i++) rows.push(found[i]);

  var observer = null;

  // A later render bumps the container's generation; anything still in flight
  // from this one then paints nothing, and this call's observer lets go of the
  // rows it was watching rather than outliving the list it belongs to.
  function stale() {
    if (container.getAttribute('data-counters-gen') === String(gen)) return false;
    if (observer) { observer.disconnect(); observer = null; }
    return true;
  }

  // The cluster, in reading order: upvotes, views, shares. Each entry is the
  // metric prefix its counter key carries — '' is the upvote key, which
  // predates the other two and is read here exactly as initUpvotes() writes it.
  var ROW_STATS = [
    { prefix: '', icon: 'upvotes', one: 'upvote', many: 'upvotes' },
    { prefix: 'v-', icon: 'views', one: 'view', many: 'views' },
    { prefix: 's-', icon: 'shares', one: 'share', many: 'shares' }
  ];

  // The three keys for one row, in cluster order.
  function keysFor(row) {
    var kind = row.getAttribute('data-kind');
    var id = row.getAttribute('data-id');
    return ROW_STATS.map(function (m) { return counterKey(m.prefix, kind, id); });
  }

  // The number currently painted for one metric, or null when that metric is
  // not in the cluster. Lets a partial repaint keep the sides it knows nothing
  // about instead of dropping them.
  function paintedStat(slot, name) {
    var el = slot.querySelector('.row__stat[data-stat="' + name + '"] .row__stat-n');
    if (!el) return null;
    var n = parseInt(el.textContent, 10);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }

  // `values` is one entry per ROW_STATS metric: a number, or null when that
  // read failed or wasn't attempted. Each metric is then resolved
  // independently — memo, then the value handed in, then whatever is already
  // painted — so the cluster always shows the freshest number this page knows
  // per metric, and a partial repaint never erases the others. Only a row with
  // nothing known at all says nothing.
  function paint(row, values) {
    var slot = row.querySelector('.row__stats');
    if (!slot) return;
    var any = false;
    var keys = keysFor(row);
    var resolved = [];
    for (var i = 0; i < ROW_STATS.length; i++) {
      // Cache-first, per metric. The memo is written by every confirmed read
      // *and* by the reader's own hit on the detail page, so it is never staler
      // than the value handed in here — and a metric this call knows nothing
      // about (null) keeps whatever is already on the row rather than
      // disappearing from the cluster.
      var n = counterCacheRead(keys[i]);
      if (n === null && values && values[i] !== undefined) n = values[i];
      if (n === null) n = paintedStat(slot, ROW_STATS[i].icon);
      if (n !== null) any = true;
      resolved.push(n);
    }
    if (!any) return;                       // nothing known at all — say nothing

    var html = '';
    var label = [];
    ROW_STATS.forEach(function (m, i) {
      var n = resolved[i];
      if (n === null) return;
      html += '<span class="row__stat' + (n > 0 ? ' is-on' : '') + '" data-stat="' + m.icon + '">' +
        STAT_ICONS[m.icon] + '<span class="row__stat-n">' + n + '</span></span>';
      label.push(rowStatUnit(n, m.one, m.many));
    });
    slot.innerHTML = html;
    slot.setAttribute('aria-label', label.join(', '));
    slot.setAttribute('aria-hidden', 'false');
  }

  // Paint whatever the session memo already holds for this row, and report
  // whether that covered all three metrics. One memoised metric is worth
  // painting on its own — that is what makes the reader's own upvote show up on
  // the list — but a partly-cached row still goes through the read path, where
  // the cached sides resolve without a request anyway.
  function paintFromCache(row) {
    var keys = keysFor(row);
    var values = [];
    var have = 0;
    for (var i = 0; i < keys.length; i++) {
      var v = counterCacheRead(keys[i]);
      if (v !== null) have++;
      values.push(v);
    }
    if (!have) return false;
    paint(row, values);
    return have === keys.length;
  }

  // Read one row's three counters. A cached side resolves without a request, so
  // a partly-cached row costs only what it is missing.
  function one(row, retried) {
    var keys = keysFor(row);
    return Promise.all(keys.map(function (k) { return counterReadDetailed(k, false); }))
      .then(function (reads) {
        if (stale()) return;
        var again = reads.some(function (r) { return r.retry; });
        if (!retried && again) return one(row, true);
        paint(row, reads.map(function (r) { return r.v; }));
      });
  }

  function enqueue(row) {
    if (row.getAttribute('data-counters-read') === '1') return;
    row.setAttribute('data-counters-read', '1');
    one(row);
  }

  // Pressing Back out of a detail page usually restores this document from the
  // browser's back-forward cache: the old DOM comes back untouched, so the row
  // the reader just opened still shows its pre-visit numbers even though the
  // view, share or upvote they landed has already been folded into the memo.
  // `pageshow` with persisted=true is the only signal that happened (no load,
  // no DOMContentLoaded), so repaint from the memo there. Cache only — no
  // requests are issued on a restore, and the observer set up by whichever
  // render is current is left exactly as it is. A row whose memo has since
  // expired keeps the numbers it is showing. Registered once per container;
  // persisted=false is an ordinary load, which paints itself.
  if (container.getAttribute('data-counters-pageshow') !== '1') {
    container.setAttribute('data-counters-pageshow', '1');
    window.addEventListener('pageshow', function (e) {
      if (!e || !e.persisted) return;
      var live = container.querySelectorAll('.row[data-kind][data-id]');
      for (var r = 0; r < live.length; r++) paintFromCache(live[r]);
    });
  }

  // Free rows first, so a re-render repaints everything it can before deciding
  // what still has to be fetched.
  var pending = [];
  for (var c = 0; c < rows.length; c++) {
    if (paintFromCache(rows[c])) rows[c].setAttribute('data-counters-read', '1');
    else pending.push(rows[c]);
  }
  if (!pending.length) return;

  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(function (entries) {
      if (stale()) return;
      for (var e = 0; e < entries.length; e++) {
        if (!entries[e].isIntersecting) continue;
        // One read per row for the life of this render: stop watching before
        // enqueuing, so a row scrolled past and back doesn't queue twice.
        observer.unobserve(entries[e].target);
        enqueue(entries[e].target);
      }
    }, { rootMargin: ROW_COUNTER_ROOT_MARGIN });
    for (var o = 0; o < pending.length; o++) observer.observe(pending[o]);
  } else {
    for (var f = 0; f < pending.length && f < ROW_COUNTER_FALLBACK_ROWS; f++) enqueue(pending[f]);
  }
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

  // How far this region can actually be scrolled.
  function maxScrollOf() {
    return isWindow
      ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      : Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  // A page whose header is tall relative to its body can run out of scroll
  // before the threshold is ever reached — a news article on a tall window is
  // the usual case. The masthead would still retract on the first scroll down
  // and nothing would replace it, leaving the reader with no header at all. So
  // the retract is only allowed when the compact bar can actually take over.
  var threshold, canCollapse;
  function measure() {
    threshold = resolveThreshold();
    canCollapse = maxScrollOf() >= threshold;
  }
  measure();

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
    if (!canCollapse) {
      // Several pages call this before their list has been fetched, so the
      // region was genuinely short when first measured and has grown since.
      // Re-measure while that verdict stands — it costs a layout read only on
      // pages still judged too short, and stops once one is tall enough.
      measure();
    }
    if (!canCollapse) {
      // Too short for the hand-off: keep the masthead rather than stranding the
      // reader with no header at all.
      navHidden = false;
      collapsed = false;
      lastY = y;
      apply();
      return;
    }
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
  window.addEventListener('resize', function () { measure(); onScroll(); });

  // The first measurement is taken before the web fonts settle, and the display
  // face changes both where the dateline sits and how tall the page is — the
  // two numbers canCollapse is decided from. Re-measure once they land.
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () { measure(); onScroll(); });
  }

  apply();

  return {
    refresh: function () { measure(); onScroll(); }
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

// --- Back-aware page transitions --------------------------------------------
// The page slide in styles.css runs one way: the arriving page enters from the
// right. That reads wrong on a Back, where the reader expects to retreat the
// way they came. Which way a navigation went is only knowable from script, so
// this is the one part of the transition that cannot be pure CSS.
//
// `pagereveal` fires on the *arriving* document before its first frame — the
// last moment a class can still change how the transition paints. The class
// keys the reversed keyframes, and is dropped once the transition settles so
// nothing lingers into the next navigation.
(function () {
  if (!('onpagereveal' in window)) return;   // no cross-document transitions here

  window.addEventListener('pagereveal', function (e) {
    if (!e.viewTransition) return;           // reduced motion, or transition skipped

    var act = window.navigation && navigation.activation;
    if (!act || act.navigationType !== 'traverse') return;   // push/replace = forward

    // A traverse runs either way, so compare positions in the history list:
    // arriving at a lower index than we left means the reader went back.
    var from = act.from, to = act.entry;
    if (!from || !to || from.index <= to.index) return;

    var root = document.documentElement;
    var clear = function () { root.classList.remove('vt-back'); };
    root.classList.add('vt-back');
    e.viewTransition.finished.then(clear, clear);
  });
})();
