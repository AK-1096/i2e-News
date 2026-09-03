// Upsert a single record into a data-contract file (data/articles.json or data/usecases.json).
//
// Which contract is written is selected by PUBLISH_TARGET ("article" — default — or "usecase"),
// so the news path (publish-article) and the AI Playbook path (publish-usecase) share one script
// and one idempotent-upsert-by-`id` implementation. Fields are read from prefixed environment
// variables (ART_* / UC_*) populated from a repository_dispatch client_payload by
// .github/workflows/publish.yml. Existing id → replace in place; new id → prepend (newest-first).
// The file is written back pretty-printed (2-space indent + trailing newline) so diffs stay clean.
//
// The result is validated against the matching JSON Schema in the workflow *after* this script
// runs, so a malformed payload fails the build instead of corrupting the live data.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const todayUtc = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// --- Target definitions -----------------------------------------------------
// Each target maps the contract's field order to a builder that reads its value
// from the environment. `required` fields fail the run loudly when empty/missing;
// fields not in `required` are optional and are omitted when empty.

const TARGETS = {
  article: {
    file: join(ROOT, "data", "articles.json"),
    label: "article",
    // Contract field order — matches data/articles.schema.json (additionalProperties: false).
    fields: {
      id: () => process.env.ART_ID,
      title: () => process.env.ART_TITLE,
      url: () => process.env.ART_URL,
      source: () => process.env.ART_SOURCE,
      summary: () => process.env.ART_SUMMARY,
      topic: () => process.env.ART_TOPIC || "Latest",
      publishedDate: () => process.env.ART_PUBLISHED,
      addedDate: () => process.env.ART_ADDED || todayUtc(),
      audience: () => parseList(process.env.ART_AUDIENCE),
      relevance: () => parseObject(process.env.ART_RELEVANCE),
    },
    required: ["id", "title", "url", "source", "summary", "topic", "publishedDate", "addedDate"],
    urlField: "url", // the stable identity key — see the URL-collision guard below
  },
  usecase: {
    file: join(ROOT, "data", "usecases.json"),
    label: "use-case",
    // Contract field order — matches data/usecases.schema.json (additionalProperties: false).
    // Long-form and provenance fields arrive grouped (see ucContent/ucSource above); the flat
    // UC_* variables stay supported so a hand-built dispatch still works.
    fields: {
      id: () => process.env.UC_ID,
      title: () => process.env.UC_TITLE,
      tools: () => parseList(process.env.UC_TOOLS),
      category: () => process.env.UC_CATEGORY,
      whatItDoes: () => ucContent().whatItDoes || process.env.UC_WHAT_IT_DOES,
      whatItImproves: () => ucContent().whatItImproves || process.env.UC_WHAT_IT_IMPROVES,
      howToTry: () => ucContent().howToTry || process.env.UC_HOW_TO_TRY,
      sourceUrl: () => ucOrigin().url || process.env.UC_SOURCE_URL,
      sourcePlatform: () => ucOrigin().platform || process.env.UC_SOURCE_PLATFORM,
      author: () => ucOrigin().author || process.env.UC_AUTHOR,
      difficulty: () => process.env.UC_DIFFICULTY,
      curatorVerified: () => parseBool(process.env.UC_CURATOR_VERIFIED),
      publishedDate: () => ucOrigin().publishedDate || process.env.UC_PUBLISHED,
      addedDate: () => process.env.UC_ADDED || todayUtc(),
      audience: () => parseList(process.env.UC_AUDIENCE),
      relevance: () => parseObject(process.env.UC_RELEVANCE),
    },
    required: [
      "id", "title", "tools", "category", "whatItDoes", "whatItImproves", "howToTry",
      "sourceUrl", "sourcePlatform", "curatorVerified", "publishedDate", "addedDate",
    ],
    urlField: "sourceUrl", // the stable identity key — see the URL-collision guard below
  },
};

// Tools / audience arrive as a JSON array string (["a","b"]) or a comma-separated list. Both
// normalise to a trimmed, non-empty string[]. A missing repository_dispatch field is rendered by
// `toJSON(...)` as the literal string "null" (or "undefined") — treat those as empty, not a value.
function parseList(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (s === "" || s === "null" || s === "undefined") return [];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* fall through to comma-split */
    }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

// relevance arrives as a JSON object string ({"whyRelevant":"…",…}). Returns the parsed object,
// or null when absent/blank/malformed (an optional field — validation of its shape happens in the
// schema step after this script, so a bad object fails the run loudly there rather than silently).
function parseObject(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "" || s === "null" || s === "undefined") return null;
  try {
    let obj = JSON.parse(s);
    // Double-encoded case: the Copilot Studio connector can only expose `relevance` as a *string*
    // input (a `type: object` with no enumerated properties is dropped from the tool inputs
    // entirely), so the agent sends the object as JSON text. toJSON() then wraps that text again and
    // one JSON.parse yields a string rather than the object — unwrap exactly one extra level.
    if (typeof obj === "string") {
      const inner = obj.trim();
      if (inner === "" || inner === "null" || inner === "undefined") return null;
      obj = JSON.parse(inner);
    }
    if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
  } catch {
    /* fall through — treated as absent, caught by the schema gate if it was meant to be present */
  }
  return null;
}

// curatorVerified is always present (default false). Only the exact string "true" is true.
function parseBool(raw) {
  return String(raw).trim().toLowerCase() === "true";
}

// GitHub caps a repository_dispatch `client_payload` at TEN top-level properties — an 11th fails the
// whole dispatch with 422 "Invalid request." before any workflow run starts. The use-case contract
// has 14 fields, so the agent groups its long-form and provenance fields into two nested objects:
//   content = { whatItDoes, whatItImproves, howToTry }
//   origin  = { url, platform, author, publishedDate }
// which keeps the payload at 9 top-level keys. parseObject already tolerates both a real object and
// the double-encoded JSON string Copilot Studio sends, so both wire shapes land here identically.
// Missing group → {} so each field falls back to its flat UC_* variable.
//
// The second group is `origin`, not `source`: the news path already uses a top-level `source` STRING,
// and the workflow evaluates every step's `env:` block regardless of its `if:` condition, so reusing
// that key fails the whole run at template evaluation ("A mapping was not expected").
const ucContent = () => parseObject(process.env.UC_CONTENT) || {};
const ucOrigin = () => parseObject(process.env.UC_ORIGIN) || {};

// Query keys that identify a *referral*, not a document — two links differing only by these point at
// the same article. Anchored so `ref_src` matches but a meaningful `reference` param does not.
const TRACKING_PARAM = /^(utm_[a-z_]*|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src|si)$/i;

// Reduce a URL to a comparison key for the collision guard below. Scheme and fragment are dropped
// (http/https serve the same article; `#section` is a position within one page, not another page),
// `www.` and a trailing slash are stripped, tracking params are removed, and the survivors are
// sorted so param order cannot disguise a duplicate. Host and path are lowercased: article URLs are
// effectively case-insensitive in practice, and a missed duplicate is silent while a false match is
// loud and overridable. An unparseable value is compared verbatim rather than guessed at.
function normalizeUrl(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  let u;
  try {
    u = new URL(s);
  } catch {
    return s.toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAM.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${host}${path}${query}`;
}

// Titles are model-generated prose, so compare them on words alone — punctuation, casing and
// spacing vary between two generations of the same headline without changing what it says.
function normalizeTitle(raw) {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "boolean") return false; // false is a valid value, not "missing"
  if (typeof v === "object") return Object.keys(v).length === 0;
  return String(v).trim() === "";
}

function buildRecord(target) {
  const raw = {};
  for (const [key, read] of Object.entries(target.fields)) raw[key] = read();

  const missing = target.required.filter((k) => isEmpty(raw[k]));
  if (missing.length > 0) {
    console.error(`upsert-${target.label}: missing required field(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  // Normalise into contract order; trim strings, keep arrays/booleans; drop empty optionals.
  const ordered = {};
  for (const key of Object.keys(target.fields)) {
    const v = raw[key];
    if (isEmpty(v) && !target.required.includes(key)) continue; // omit empty optional
    if (Array.isArray(v)) ordered[key] = v;
    else if (typeof v === "boolean") ordered[key] = v;
    else if (v && typeof v === "object") ordered[key] = v; // nested object (relevance) — keep as-is
    else ordered[key] = String(v).trim();
  }
  return ordered;
}

async function main() {
  const targetName = process.env.PUBLISH_TARGET || "article";
  const target = TARGETS[targetName];
  if (!target) {
    console.error(`upsert: unknown PUBLISH_TARGET "${targetName}" (expected article | usecase)`);
    process.exit(1);
  }

  const record = buildRecord(target);

  let records;
  try {
    records = JSON.parse(await readFile(target.file, "utf8"));
  } catch (err) {
    console.error(`upsert-${target.label}: could not read/parse ${target.file}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(records)) {
    console.error(`upsert-${target.label}: ${target.file} is not a JSON array`);
    process.exit(1);
  }

  // --- Duplicate guard --------------------------------------------------------
  // Why this exists: the `id` slug is model-minted from source + short title + publishedDate, and the
  // agent invents a day when a source carries only a month (runbook §11.7). So the SAME item
  // rediscovered on a later run can mint a DIFFERENT id, which the upsert-by-id below would accept as
  // a brand-new record — a duplicate on the reader and, once publishing is automated, a duplicate
  // @everyone Teams ping. Comparing ids alone cannot catch that.
  //
  // ⚠️ But a shared URL is NOT by itself a duplicate, and must never hard-fail. One source page
  // legitimately yields several distinct entries — runbook §11.6 records exactly this ("one source
  // can yield several entries"), and both contracts already contain such groups: a roundup post and
  // a TechCrunch *category* page each back two separate articles, and one dev.to listicle backs two
  // separate techniques. Failing on URL would break roundup mining and would also block the
  // idempotent republish of every record already sitting in one of those groups (SC-U7).
  //
  // So the signal is split by how unambiguous it is:
  //   same URL + same title, different id  -> a true duplicate. Fail before anything is written.
  //   same URL, different title            -> the legitimate roundup pattern. Warn only.
  // The warning lands in the workflow log, which publish.yml treats as the record of what the model
  // actually sent, so an accidental duplicate stays visible after the fact.
  const incomingUrl = normalizeUrl(record[target.urlField]);
  if (incomingUrl !== "") {
    const sharesUrl = records.filter(
      (r) => r && r.id !== record.id && normalizeUrl(r[target.urlField]) === incomingUrl,
    );
    const twin = sharesUrl.find((r) => normalizeTitle(r.title) === normalizeTitle(record.title));
    if (twin) {
      console.error(
        `upsert-${target.label}: duplicate — ${record[target.urlField]} is already published as ` +
        `"${twin.id}" under the same title, but this payload carries id "${record.id}".`,
      );
      console.error(
        `upsert-${target.label}: refusing to write it. Republish under id "${twin.id}" to update ` +
        `the existing record.`,
      );
      process.exit(1);
    }
    if (sharesUrl.length > 0) {
      console.warn(
        `upsert-${target.label}: note — ${sharesUrl.length} existing record(s) share this URL ` +
        `(${sharesUrl.map((r) => `"${r.id}"`).join(", ")}). Titles differ, so this is treated as a ` +
        `distinct item from the same source. Verify that is intended.`,
      );
    }
  }

  const existingIndex = records.findIndex((r) => r && r.id === record.id);
  if (existingIndex >= 0) {
    records[existingIndex] = record; // replace in place — idempotent
    console.log(`upsert-${target.label}: replaced existing "${record.id}"`);
  } else {
    records.unshift(record); // prepend — newest first
    console.log(`upsert-${target.label}: added new "${record.id}"`);
  }

  await writeFile(target.file, JSON.stringify(records, null, 2) + "\n", "utf8");
}

main();
