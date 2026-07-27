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
  },
  usecase: {
    file: join(ROOT, "data", "usecases.json"),
    label: "use-case",
    // Contract field order — matches data/usecases.schema.json (additionalProperties: false).
    fields: {
      id: () => process.env.UC_ID,
      title: () => process.env.UC_TITLE,
      tools: () => parseList(process.env.UC_TOOLS),
      category: () => process.env.UC_CATEGORY,
      whatItDoes: () => process.env.UC_WHAT_IT_DOES,
      whatItImproves: () => process.env.UC_WHAT_IT_IMPROVES,
      howToTry: () => process.env.UC_HOW_TO_TRY,
      sourceUrl: () => process.env.UC_SOURCE_URL,
      sourcePlatform: () => process.env.UC_SOURCE_PLATFORM,
      author: () => process.env.UC_AUTHOR,
      difficulty: () => process.env.UC_DIFFICULTY,
      curatorVerified: () => parseBool(process.env.UC_CURATOR_VERIFIED),
      publishedDate: () => process.env.UC_PUBLISHED,
      addedDate: () => process.env.UC_ADDED || todayUtc(),
      audience: () => parseList(process.env.UC_AUDIENCE),
      relevance: () => parseObject(process.env.UC_RELEVANCE),
    },
    required: [
      "id", "title", "tools", "category", "whatItDoes", "whatItImproves", "howToTry",
      "sourceUrl", "sourcePlatform", "curatorVerified", "publishedDate", "addedDate",
    ],
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
    const obj = JSON.parse(s);
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
