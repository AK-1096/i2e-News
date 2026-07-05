// Upsert a single article into data/articles.json (the data contract).
//
// Reads the 8 contract fields from ART_* environment variables (populated from a
// repository_dispatch client_payload by .github/workflows/publish.yml) and performs an
// idempotent upsert by `id`: if an article with the same id already exists it is replaced
// in place; otherwise the new article is prepended (newest-first). The file is written back
// pretty-printed (2-space indent + trailing newline) so diffs stay clean.
//
// The result is validated against data/articles.schema.json in the workflow *after* this
// script runs, so a malformed payload fails the build instead of corrupting the live archive.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = join(ROOT, "data", "articles.json");

// Contract field order — matches data/articles.schema.json (additionalProperties: false).
const FIELD_ORDER = ["id", "title", "url", "source", "summary", "topic", "publishedDate", "addedDate"];

const todayUtc = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function readEnv() {
  const article = {
    id: process.env.ART_ID,
    title: process.env.ART_TITLE,
    url: process.env.ART_URL,
    source: process.env.ART_SOURCE,
    summary: process.env.ART_SUMMARY,
    topic: process.env.ART_TOPIC || "Latest",
    publishedDate: process.env.ART_PUBLISHED,
    addedDate: process.env.ART_ADDED || todayUtc(),
  };

  // Fail loudly on missing required fields so the workflow surfaces a clear error.
  const missing = FIELD_ORDER.filter((k) => !article[k] || String(article[k]).trim() === "");
  if (missing.length > 0) {
    console.error(`upsert-article: missing required field(s): ${missing.join(", ")}`);
    process.exit(1);
  }

  // Normalise into contract order and trim stray whitespace.
  const ordered = {};
  for (const k of FIELD_ORDER) ordered[k] = String(article[k]).trim();
  return ordered;
}

async function main() {
  const article = readEnv();

  let articles;
  try {
    articles = JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch (err) {
    console.error(`upsert-article: could not read/parse ${DATA_FILE}: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(articles)) {
    console.error("upsert-article: articles.json is not a JSON array");
    process.exit(1);
  }

  const existingIndex = articles.findIndex((a) => a && a.id === article.id);
  if (existingIndex >= 0) {
    articles[existingIndex] = article; // replace in place — idempotent
    console.log(`upsert-article: replaced existing article "${article.id}"`);
  } else {
    articles.unshift(article); // prepend — newest first
    console.log(`upsert-article: added new article "${article.id}"`);
  }

  await writeFile(DATA_FILE, JSON.stringify(articles, null, 2) + "\n", "utf8");
}

main();
