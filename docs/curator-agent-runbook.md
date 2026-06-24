# Curator Agent — Build Runbook

How to build the **write-path** half of NewsPulse AI: a Microsoft Copilot Studio agent, published
into Teams, that lets a curator find AI news, select articles, generate summaries, write them to
this repo's `data/articles.json`, and ping the Teams group with a link to the article's page on the
static reader.

> **Why this is a runbook and not code.** The agent lives entirely inside Microsoft Copilot Studio /
> M365 in your tenant — it is configured in Microsoft's low-code tooling, not built from this
> repository. This repo only owns the **read** surface (the static site) and the **data contract**
> (`data/articles.json` + its schema). This document is the buildable specification for the agent
> half, mapped 1:1 to the BRD's functional requirements (FR-A1–A10) and success criteria (SC-1–SC-5).

---

## 1. Architecture recap

```
  Curator (in Teams)
        │
        ▼
  ┌──────────────────────────┐         writes          ┌─────────────────────┐
  │  Copilot Studio agent    │  ───────────────────▶    │  data/articles.json │
  │  (this runbook)          │   (GitHub contents API)  │  (the data contract)│
  │  RSS + Bing · summarise  │                          └──────────┬──────────┘
  └──────────────────────────┘                                     │ reads
        │ pings                                                     ▼
        ▼                                              ┌─────────────────────────┐
  Teams group  ───── link ──────────────────────────▶ │ Static reader (GH Pages) │
                 article.html?id=<id>                  │ index / archive / article│
                                                       └─────────────────────────┘
```

The two surfaces never call each other directly — they are joined **only** by `data/articles.json`.
The agent is the sole writer; the static site is a read-only consumer.

---

## 2. Prerequisites

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | **Microsoft 365 Copilot license** for the curator | Required to build/publish/operate the agent and to get free public-web grounding (BRD §9.1). |
| 2 | **Copilot Studio** access | Where the agent, topics, and agent flow are built. |
| 3 | **Grounding with Bing Search** enabled | Powers latest-news + topic candidates (FR-A2/FR-A3). |
| 4 | **Target Teams group** | Destination for the ping (OD-4). One group for this PoC. |
| 5 | **GitHub write credential** | A fine-grained PAT (or GitHub App) with `contents: write` on `AK-1096/i2e-News`, stored as a Copilot Studio **secret/connection** — never inline. |
| 6 | **Copilot Studio capacity / PAYG** (optional) | Only needed to cover metered actions for unlicensed end users (BRD §10). |

### Configuration values to gather first
- **OD-3 — curated RSS feeds** (see §6 for a starter list).
- **OD-4 — Teams group** id / channel for the ping.
- **OD-5 — store + credential**: repo `AK-1096/i2e-News`, file path `data/articles.json`, branch `main`.
- **Static site base URL**: `https://ak-1096.github.io/i2e-News`.

---

## 3. Build steps (mapped to FRs)

### Step 1 — Create the agent and publish to Teams · **FR-A1**
1. In Copilot Studio, create a new agent (e.g. "NewsPulse Curator").
2. Give it instructions describing its role: surface AI news, let the curator select, summarise on
   publish, write to the contract, ping Teams.
3. **Publish** → add the **Microsoft Teams** channel → install for the curator.
4. ✅ *SC-1 check:* the curator can open the agent inside Teams.

### Step 2 — Latest AI news view · **FR-A2**
1. Add a **knowledge source / connector** for the curated RSS feeds (§6).
2. Add a topic **"Latest news"** that:
   - fetches items from each RSS feed,
   - runs a **Bing** web search for recent AI news,
   - **merges** both sets, **de-duplicates** by URL/title, and **orders by recency**.
3. Return the merged candidates as a selectable list (title, source, date).
4. ✅ *SC-1 check:* opening "Latest" shows recent AI news candidates.

### Step 3 — Topic prompts · **FR-A3**
1. Add a topic **"Find on a subject"** that accepts free-text (e.g. "EU AI regulation").
2. Route the text to **Bing grounding**; return relevance-ranked candidates in the same selectable
   card format as Step 2.
3. ✅ *SC-1 check:* a topic prompt returns ranked candidates.

### Step 4 — Curator selection · **FR-A4**
1. Render candidates as an adaptive card with a **select / publish** action per item (single or
   multi-select).
2. Selection is the **only** gate — nothing is auto-published (BRD §9.2).
3. ✅ *SC-2 check:* the curator can pick which candidate(s) to publish.

### Step 5 — Summary generation at publish · **FR-A5**
1. On selection, call the agent's **built-in generative** capability to produce a 1–2 sentence
   factual summary of the chosen article (no external AI API — **NFR-2**).
2. Show the draft summary to the curator for a final glance before writing.
3. ✅ *SC-2 check:* a short summary is generated for the finalised article.

### Step 6 — Write to `data/articles.json` · **FR-A6** (+ **NFR-3**)
This is the heart of the contract. Use an **agent flow** (Power Automate) calling the **GitHub
REST contents API** with an **idempotent upsert by `id`** — see §4 for the exact mechanism.
- ✅ *SC-3 check:* on publish, the article's metadata appears in `data/articles.json`.

### Step 7 — Ping the Teams group · **FR-A7**
1. After a successful write, post an adaptive card to the **target Teams group** (OD-4) containing
   the title, summary, source, and a button linking to:
   `https://ak-1096.github.io/i2e-News/article.html?id=<id>`
2. ✅ *SC-4 / SC-5 check:* the ping appears and its link opens the per-article view, which links out
   to the original source.

### Step 8 — Configurability · **FR-A8 / FR-A9**
- Store the **RSS feed list** and the **target Teams group** as agent **variables / environment
  settings**, not hardcoded, so they can be changed without rebuilding (**NFR-8**).

### Step 9 — Graceful degradation · **FR-A10**
- Wrap each RSS/Bing fetch so that if a source is unavailable, the flow **logs and skips** it and
  still returns the candidates it could retrieve — never fail the whole "Latest" view on one dead
  feed.

---

## 4. The `data/articles.json` write mechanism (FR-A6 / NFR-3 / OD-5)

The agent flow must perform a **read-modify-write upsert** so repeated publishes are idempotent and
the archive always matches what was posted (NFR-3).

**Field contract** (validated in CI against [`data/articles.schema.json`](../data/articles.schema.json)):
`id, title, url, source, summary, topic, publishedDate, addedDate` — all required; dates are
`YYYY-MM-DD`; `url` starts with `http(s)://`. The new record uses:
- `id` — a stable slug, e.g. `<source-slug>-<publishedDate>` (used in the article URL).
- `topic` — `"Latest"` for RSS/latest items, or the topic prompt text for on-demand finds.
- `publishedDate` — the article's original date; `addedDate` — today (publish date).

**Flow (GitHub contents API, branch `main`):**
1. **GET** `/repos/AK-1096/i2e-News/contents/data/articles.json`
   → returns base64 `content` + the file `sha`.
2. **Decode** base64 → parse JSON array.
3. **Upsert by `id`:** if an object with the same `id` exists, **replace** it; otherwise **prepend**
   the new object. (Replace-not-duplicate = idempotent.)
4. **Re-serialise** the array (pretty-printed) → base64.
5. **PUT** `/repos/AK-1096/i2e-News/contents/data/articles.json` with:
   - `message`: e.g. `"Publish: <title>"`,
   - `content`: the new base64,
   - `sha`: the sha from step 1 (required to update an existing file),
   - `branch`: `main`.
6. The push to `main` triggers the Pages workflow, which **validates against the schema** and then
   deploys — so a malformed write **fails the build** instead of corrupting the live archive.

> Keep the credential in a Copilot Studio **secret/connection reference**; do not embed the token in
> the flow.

---

## 5. Stable id convention

Use a deterministic, URL-safe slug so the same article never publishes twice and the article-page
URL is stable: `<source>-<short-title-or-publishedDate>`, lowercased, hyphenated — e.g.
`openai-gpt-4o-2024-05-13`. The upsert in §4 keys on this `id`.

---

## 6. Starter curated RSS list (OD-3)

A starting set of public, non-paywalled AI publications (BRD **NFR-5**). **Validate each feed URL is
live before wiring**, and treat the list as configurable (**FR-A8**). The graceful-degradation rule
(§3 Step 9 / FR-A10) covers any feed that later goes dead.

| Publication | Suggested feed URL |
|-------------|--------------------|
| Google — The Keyword (AI) | `https://blog.google/technology/ai/rss/` |
| Hugging Face — Blog | `https://huggingface.co/blog/feed.xml` |
| TechCrunch — AI | `https://techcrunch.com/category/artificial-intelligence/feed/` |
| The Verge — AI | `https://www.theverge.com/rss/ai-artificial-intelligence/index.xml` |
| VentureBeat — AI | `https://venturebeat.com/category/ai/feed/` |
| Ars Technica | `https://feeds.arstechnica.com/arstechnica/index` |
| MIT Technology Review | `https://www.technologyreview.com/feed/` |
| MarkTechPost | `https://www.marktechpost.com/feed/` |

Vendor newsrooms (Anthropic, OpenAI, Meta AI, DeepMind) are valuable too; where they don't expose a
stable RSS feed, cover them via the Bing grounding leg of FR-A2 instead.

---

## 7. Acceptance / demo script

Run this end-to-end to validate the build against the BRD success criteria:

1. Open the agent in Teams → review "Latest" candidates → run one topic prompt. **(SC-1: FR-A1–A3)**
2. Select one article → confirm a short summary is generated. **(SC-2: FR-A4–A5)**
3. Publish → confirm the new object lands in `data/articles.json` (and the Pages build passes the
   schema gate). **(SC-3: FR-A6, NFR-3)**
4. Confirm the Teams group receives the ping with the article link. **(SC-4: FR-A7)**
5. Click the ping → the per-article page opens on the static site and links out to the source.
   **(SC-5: FR-S3, FR-S5)**
6. Confirm the article now shows on the static **list** and, over time, in the **archive**.
   **(SC-6: FR-S2, FR-S4 — already live on the reader)**
7. Confirm no external AI API is used and the static site has no backend. **(SC-7: NFR-2, NFR-4)**

---

## 8. Scope guardrails (BRD §3.2 PoC Fence)

Do **not** add inside this PoC (each is a change request, not a clarification): scheduled / automated
publishing, multi-stage approval beyond the single curator's selection, routing to multiple channels
or audience segments, paywalled sources, or any analytics. Static-site gating (OD-2) is deferred.
