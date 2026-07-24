# Curator Agent — Build Runbook

How to build the **write-path** half of NewsPulse AI: a Microsoft Copilot Studio agent that lets a
curator find AI news, select articles, generate summaries, publish them to this repo's
`data/articles.json`, and post a link into a Teams channel pointing at the article's page on the
static reader.

> **Why this is a runbook and not code.** The agent lives entirely inside Microsoft Copilot Studio /
> M365 in your tenant — it is configured in Microsoft's low-code tooling, not built from this
> repository. This repo owns the **read** surface (the static site), the **data contract**
> (`data/articles.json` + its schema), **and** the publish glue that turns an agent request into a
> committed, deployed article (`scripts/upsert-article.mjs` + `.github/workflows/publish.yml`).
> This document is the buildable specification for the agent half, mapped to the BRD's functional
> requirements (FR-A1–A10) and success criteria (SC-1–SC-7).

> **Deviations from the BRD, adopted for the PoC** (see §9):
> - **RSS discovery (part of FR-A2) was dropped.** Discovery relies on the agent's built-in **web
>   search** plus a set of **website knowledge sources**. The RSS-fetch flow proved brittle in the
>   low-code UI; the recency/source-control/determinism trade-offs are acceptable for a PoC.
> - **Publishing is done via GitHub `repository_dispatch`, not a GET→upsert→PUT contents-API flow.**
>   The agent fires a single POST; the upsert + schema-validate + commit logic lives in repo code
>   (`publish.yml`) where it can be tested. Deploy is handled by GitHub Pages' branch builder.

---

## 1. Architecture recap

```
  Curator (1:1 with the agent)
        │
        ▼
  ┌──────────────────────────┐   repository_dispatch    ┌──────────────────────────┐
  │  Copilot Studio agent    │  ───────────────────▶    │  publish.yml (Actions)   │
  │  (this runbook)          │   POST publish-article   │  upsert → validate → push│
  │  web search + KB ·       │   (custom connector)     └───────────┬──────────────┘
  │  summarise               │                                      │ writes
  └──────────────────────────┘                                      ▼
        │ posts link                                     ┌─────────────────────┐
        ▼                                                │  data/articles.json │
  Teams channel  ── link ───────────┐                    │  (the data contract)│
   article.html?id=<id>             │                    └──────────┬──────────┘
   (Post to Teams flow)             │                               │ reads (branch builder deploys)
                                    │                               ▼
                                    │                  ┌─────────────────────────┐
                                    └────────────────▶ │ Static reader (GH Pages) │
                                                       │ index / archive / article│
                                                       └─────────────────────────┘
```

The two surfaces never call each other directly — they are joined **only** by `data/articles.json`.
The agent is the sole writer (via `publish.yml`); the static site is a read-only consumer. The
**curator interacts 1:1 with the agent** to publish; the Teams channel is a **one-way post target**
for links — members don't command the agent.

---

## 2. Prerequisites

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | **Microsoft 365 Copilot license** for the curator | Required to build/publish/operate the agent and to get free public-web grounding (BRD §9.1). |
| 2 | **Copilot Studio** access | Where the agent, its **tools** (the publish custom connector + the Teams flow), and instructions are built. |
| 3 | **Web search + website knowledge sources** | Powers discovery (FR-A2/FR-A3). RSS was dropped for the PoC (§9). |
| 4 | **Target Teams team + channel** | Destination for the one-way post (OD-4). Build against a throwaway test channel first, then swap to the real channel. |
| 5 | **GitHub write credential** | A fine-grained **PAT** with `contents: write` on `AK-1096/i2e-News`. Used as the API key in the **"Github Dispatch" custom connector** (Authorization header = `Bearer <PAT>`) — never inline in a flow expression. Rotate if ever exposed. |
| 6 | **Copilot Studio capacity / PAYG** (optional) | Only needed to cover metered actions for unlicensed end users (BRD §10). |

### Configuration values to gather first
- **OD-3 — discovery sources**: the website knowledge sources + web-search scope (see §6).
- **OD-4 — Teams destination**: the **Team** and **Channel** for the Post to Teams flow.
- **OD-5 — store + credential**: repo `AK-1096/i2e-News`, file path `data/articles.json`, branch
  `main`, dispatch event type `publish-article`.
- **Static site base URL**: `https://ak-1096.github.io/i2e-News`.

---

## 3. Build steps (mapped to FRs)

### Step 1 — Create the agent · **FR-A1**
1. In Copilot Studio, create a new agent (e.g. "i2e news admin").
2. Give it **Instructions** describing its role: surface AI news via web search, let the curator
   select, then at publish time generate (no external AI) a factual summary, a **reader-benefit
   title**, and the `audience` + `relevance` fields (§4) — show all of them at the confirmation gate,
   call the publish tool, then post the link to Teams. *(The deployed Instructions text is kept
   verbatim in §10.)*
3. Turn **off** document/image capabilities and Work IQ, and add **no triggers / connected agents**
   (keeps the PoC fence: no automated publishing).
4. ✅ *SC-1 check:* the curator can open and converse with the agent (Test pane / assigned channel).

> **Instructions gotcha:** the Instructions validator rejects raw `<>` placeholders — write id/URL
> placeholders in plain English, not angle-bracket tokens.

### Step 2 — Latest AI news discovery · **FR-A2**
1. Add the agent's **website Knowledge sources** (§6) and enable its **built-in web search**.
2. In Instructions, direct the agent to surface **recent** AI-news candidates on request (e.g. "show
   me the latest AI news"), drawing on web search + the knowledge sources.
3. Have it return candidates as a readable list (title, source, approximate date) for selection.
4. ✅ *SC-1 check:* asking for the latest news returns recent AI-news candidates.

> RSS is intentionally not used (§9). Recency precision is best-effort via web search rather than a
> deterministic feed pull — acceptable for the PoC.

### Step 3 — Topic prompts · **FR-A3**
1. Let the curator ask about a subject in free text (e.g. "EU AI regulation").
2. The agent routes the query through **web search / knowledge sources** and returns relevance-ranked
   candidates in the same list format as Step 2.
3. ✅ *SC-1 check:* a topic prompt returns ranked candidates.

### Step 4 — Curator selection · **FR-A4**
1. The curator picks one (or more) candidates to publish from the returned list.
2. Selection is the **only** gate — nothing is auto-published (BRD §9.2).
3. ✅ *SC-2 check:* the curator can pick which candidate(s) to publish.

### Step 5 — Content generation at publish · **FR-A5**
1. On selection, use the agent's **built-in generative** capability to produce — **no external AI
   API** (**NFR-2**) — a 1–2 sentence **factual** summary, a **reader-benefit title**, and the
   `audience` + `relevance` fields, all per the content-generation guidance in §4.
2. Show the draft **summary, title, `audience` list, and all three `relevance` strings** (plus
   source/url) to the curator in a **confirmation gate** before publishing ("Ask before running" =
   Yes on the publish tool). The curator can correct any of them before the write.
3. ✅ *SC-2 check:* the summary, title, audience, and relevance are generated and shown before write.

### Step 6 — Publish to `data/articles.json` · **FR-A6** (+ **NFR-3**)
Publishing is a **single POST** from the agent; the heavy lifting is repo-side (§4).
1. Build a **Power Platform custom connector** ("Github Dispatch"): host `api.github.com`, **API-key**
   auth (Authorization header value = `Bearer <PAT>`), one **`PublishArticle`** POST action to
   `/repos/AK-1096/i2e-News/dispatches`.
2. Wire it into the agent as the **"Publish article" tool**:
   - **Fixed inputs:** `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
     `Content-Type: application/json`, and `event_type: publish-article`.
   - **AI-filled `client_payload` fields (9):** `id, title, url, source, summary, topic,
     publishedDate, audience, relevance` — add format hints on `id` (slug, §5) and `publishedDate`
     (`YYYY-MM-DD`). `audience` is a **JSON array** of role slugs and `relevance` is a **JSON
     object** of three strings; both are generated per the content-generation guidance below
     (*Content generation guidance — titles, `audience` & `relevance`*), and both are optional
     repo-side (omit → the record simply carries no role targeting / relevance block, and the reader
     treats it as "for everyone"). `addedDate` is defaulted repo-side, so the agent need not send it.
   - **Confirmation:** "Ask before running" = **Yes** (FR-A4/A5). **Credentials:** maker-provided.
3. A successful call returns **HTTP 204** and fires the `publish.yml` workflow (§4).
- ✅ *SC-3 check:* on publish, the article's metadata appears in `data/articles.json` and the live
  site (after the branch builder deploys).

> The earlier **agent-flow HTTP action** approach was abandoned — it mis-sent the request body
> (persistent 422). The custom connector is the working publish path.

### Step 7 — Post the link to Teams · **FR-A7**
Use a small **agent flow** (not the raw Teams connector-action tool, which can't reliably shape the
message body):
1. Create an agent flow **"Post to Teams"** with a single **Text** input `MessageText`.
2. Add the Microsoft Teams action **"Post message in a chat or channel"**: **Post as** = Flow bot,
   **Post in** = Channel, **Team** and **Channel** = pick your target from the **dropdowns** (test
   channel now; swap to the real channel later — that's the only change needed). **Message** =
   `MessageText`. Completion = **Don't respond (default)**.
3. Wire the flow into the agent as the **"Post to Teams" tool**; set `MessageText` = **Dynamically
   fill with AI** = article **title + one-line summary + live link**:
   `https://ak-1096.github.io/i2e-News/article.html?id=<id>`
4. In Instructions: call **Post to Teams** once, **only after "Publish article" succeeds**.
5. ✅ *SC-4 / SC-5 check:* the post appears in the channel and its link opens the per-article view,
   which links out to the original source.

> Pin Team/Channel via the flow's **dropdowns** — don't let the AI fill the Teams body. AI-filling
> the raw connector body fails (400 "Location invalid" for a URL in `Post in`; 400 "Message body is
> missing" when it shapes the JSON wrong).

> ⚠️ **The Teams body is HTML — the link must be an anchor tag, not a bare URL.** The flow's
> **"Post message in a chat or channel"** action sends `Body/messageBody` as HTML (it wraps the AI
> `Text` input in `<p class="editor-paragraph">…</p>`). In HTML mode Teams does **not** reliably
> auto-link a raw URL, so a message like `Read more: https://…` renders as dead, unclickable text.
> Instruct the agent to emit the live link as an explicit anchor:
> `<a href="https://ak-1096.github.io/i2e-News/article.html?id=<id>">Read here</a>`. This is an
> **instruction fix on the "Post to Teams" tool** (the `Text` input description / Customize) — no flow
> edit is needed, and the action has no separate Content-Type toggle to change.
>
> **Append this rule — do not overwrite the Description.** The tool Description already holds the
> guardrails (*call once, only after "Publish article" succeeds; never post on failure*). Add the
> anchor rule to the **end** of that text (or, more targeted, put it in the `Text` input's
> **Customize**), so those guardrails are preserved. The character in `id=<id>` is a **placeholder** —
> the agent substitutes the real slug, it is never hardcoded.
>
> The `<id>` is **not returned by "Publish article"** — that POST returns **204 No Content**. The agent
> must **reuse the exact same `id` slug it sent in the publish `client_payload`** (§5), never mint a
> new one. *(Regression seen Jul 2026: an AI-filled bare URL posted as plain text; fixed by mandating
> the anchor tag.)*

### Step 8 — Configurability · **FR-A8 / FR-A9**
- Keep the **discovery sources** (knowledge sources) and the **Teams Team/Channel** editable in the
  agent/flow config, not hardcoded in logic, so they can be changed without a rebuild (**NFR-8**).

### Step 9 — Graceful degradation · **FR-A10**
- Discovery is best-effort: if a knowledge source or web-search result set is unavailable, the agent
  still returns what it could find rather than failing the whole request.

---

## 4. The publish mechanism (FR-A6 / NFR-3 / OD-5)

Publishing is split: the **agent** sends an event; **repo code** performs the idempotent upsert,
schema-validates, commits, and lets GitHub Pages deploy. This keeps expression-heavy logic out of the
low-code tooling and under test.

**Field contract** (validated against [`data/articles.schema.json`](../data/articles.schema.json)):
`id, title, url, source, summary, topic, publishedDate, addedDate` — all required; dates are
`YYYY-MM-DD`; `url` starts with `http(s)://`. Plus two **optional** reader-facing fields carried
through the same dispatch: `audience` (array of role slugs) and `relevance` (object of three
strings) — see the content-generation guidance below. Notes:
- `id` — a stable slug, e.g. `<source-slug>-<publishedDate>` (used in the article URL, §5).
- `topic` — the topic prompt text, or defaults to `"Latest"` if omitted.
- `publishedDate` — the article's original date; `addedDate` — defaults to today (publish date) if
  the payload omits it.
- `audience` / `relevance` — optional; when present they must validate (`audience` slugs from the
  fixed set below; `relevance` carries all three strings). When absent they are simply omitted from
  the record. The dispatch → env-var → upsert glue for both fields lives in
  [`publish.yml`](../.github/workflows/publish.yml) (`ART_AUDIENCE` / `ART_RELEVANCE`, passed via
  `toJSON`) and [`scripts/upsert-article.mjs`](../scripts/upsert-article.mjs).

**1 — Agent → GitHub (`repository_dispatch`).** The "Publish article" tool (§3 Step 6) POSTs to
`/repos/AK-1096/i2e-News/dispatches` with `event_type: publish-article` and the 7 AI-filled fields in
`client_payload`. Success = **HTTP 204**.

**2 — Repo-side upsert + validate + commit** ([`.github/workflows/publish.yml`](../.github/workflows/publish.yml)),
on `repository_dispatch: [publish-article]`:
1. Checkout + Node 20.
2. Run [`scripts/upsert-article.mjs`](../scripts/upsert-article.mjs): reads the payload from `ART_*`
   env vars and does an **idempotent upsert by `id`** — replace-in-place if the id exists, else
   **prepend** (newest-first) — writing back pretty-printed. Missing required fields → exit 1.
3. **Validate** `data/articles.json` against the schema with `ajv` — **before commit**, so a bad
   write **fails the run** instead of corrupting the archive (**NFR-3**).
4. **Commit + push** to `main` (skipped if the upsert was a no-op / idempotent republish).
5. The workflow **serialises** on a `concurrency` group so two dispatches close together don't
   collide on `git push`.

**3 — Deploy.** The push to `main` triggers GitHub Pages' built-in **"Deploy from a branch"** builder,
which deploys the updated site. This is the **single deploy path** — `publish.yml` and `pages.yml`
intentionally do **not** run `deploy-pages` (that raced with the branch builder and caused
"Deployment failed, try again later"; see the git history / PR that split them out). `pages.yml` is
now a **validation-only** CI check on human pushes.

> Keep the PAT in the **custom connector's API-key auth**, not embedded in any flow expression.

### Content generation guidance — titles, `audience` & `relevance` (extends FR-A5)

This governs **what the agent writes** at the confirmation gate (§3 Step 5) for **every article**
**and** every **AI Guide** entry (`playbook.html` / `data/usecases.json`). It sits alongside the
factual-summary rule (FR-A5 / NFR-2) — the same "generate, then show before write" gate applies.

**Title guidance.** Write the `title` for the **reader's benefit and day-to-day applicability**, not
as a restatement of the technical concept. Lead with what an i2e employee can *do* with it; keep it
factual (no hype), but framed around the payoff rather than the mechanism.

> **Before → after.**
> `Anthropic ships prompt caching API` → `Cut your AI tool costs: reuse prompts instead of resending them`
>
> Both are truthful; the second tells the reader why it matters to their day.

**New required content fields.** The agent must now generate these for **every article and every AI
Guide entry**, and show them in the same confirmation gate before publishing:

- **`audience`** — an array of **one or more** role slugs, drawn from **exactly** this set (use the
  slug on the left; the label on the right is for the reader-facing UI):

  | slug | role |
  |------|------|
  | `developers` | Developers / Coders |
  | `qa` | QA |
  | `ba-pc` | BAs & Project Coordinators |
  | `pm` | Project Managers |
  | `non-technical` | Non-technical users |

  Pick the roles who **genuinely** benefit — use multiple when warranted, but do not list a role that
  gains nothing concrete just to widen reach.

- **`relevance`** — an object of **three short, second-person** strings, each answering one question
  concretely (no generic filler), written for **i2e Consulting employees** — an IT-services
  consultancy serving **pharma / life-science** clients:
  - `whyRelevant` — *"Why is this relevant to me?"*
  - `dailyImpact` — *"How will this help in my daily job?"*
  - `practicalBenefit` — *"What practical benefit does it provide?"*

> ⚠️ **Concrete, not generic.** "It boosts productivity" fails the bar. Anchor each string in a real
> i2e task — e.g. a validation-document review, a client status update, a GxP-aware data-handling
> step — so the reader recognises their own work.

> The confirmation gate (§3 Step 5, "Ask before running" = **Yes**) must show the curator the
> drafted `title`, `audience`, and all three `relevance` strings **before** the publish POST fires.
> The data contract / schema that carries these fields lives under `data/` and is versioned there —
> keep the field names above verbatim (`audience`, `relevance.whyRelevant`, `relevance.dailyImpact`,
> `relevance.practicalBenefit`) so the payload validates.

---

## 5. Stable id convention

Use a deterministic, URL-safe slug so the same article never publishes twice and the article-page
URL is stable: `<source>-<short-title-or-publishedDate>`, lowercased, hyphenated — e.g.
`openai-gpt-4o-2024-05-13`. The upsert in §4 keys on this `id` (replace-in-place, not duplicate).

---

## 6. Discovery sources (OD-3)

Discovery uses the agent's **built-in web search** plus a set of **website knowledge sources** (the
PoC agent uses ~10, including vendor blogs). Treat the list as configurable (**FR-A8**); the
graceful-degradation rule (§3 Step 9 / FR-A10) covers any source that's momentarily unavailable.

A starting set of public, non-paywalled AI publications + vendor newsrooms (BRD **NFR-5**) to add as
website knowledge sources / web-search targets:

| Publication / newsroom | Site |
|------------------------|------|
| Google — The Keyword (AI) | `https://blog.google/technology/ai/` |
| Hugging Face — Blog | `https://huggingface.co/blog` |
| TechCrunch — AI | `https://techcrunch.com/category/artificial-intelligence/` |
| The Verge — AI | `https://www.theverge.com/ai-artificial-intelligence` |
| VentureBeat — AI | `https://venturebeat.com/category/ai/` |
| MIT Technology Review | `https://www.technologyreview.com/` |
| MarkTechPost | `https://www.marktechpost.com/` |
| Anthropic — News | `https://www.anthropic.com/news` |
| OpenAI — News | `https://openai.com/news/` |
| Google DeepMind — Blog | `https://deepmind.google/discover/blog/` |
| Meta AI — Blog | `https://ai.meta.com/blog/` |

---

## 7. Acceptance / demo script

Run this end-to-end to validate the build against the BRD success criteria:

1. Open the agent → ask for "Latest" candidates → run one topic prompt. **(SC-1: FR-A1–A3)**
2. Select one article → confirm a short factual summary is generated and shown. **(SC-2: FR-A4–A5)**
3. Confirm on the gate → **Publish article** returns success → the new object lands in
   `data/articles.json` (and `publish.yml` passes the schema gate before commit). **(SC-3: FR-A6, NFR-3)**
4. Confirm the **Teams channel** receives the post with the article link. **(SC-4: FR-A7)**
5. Click the link → the per-article page opens on the static site and links out to the source.
   **(SC-5: FR-S3, FR-S5)** — *if the page shows no content, the article likely committed but the
   Pages deploy is still catching up; hard-refresh, or re-run the deploy.*
6. Confirm the article now shows on the static **list** and, over time, in the **archive**.
   **(SC-6: FR-S2, FR-S4 — already live on the reader)**
7. Confirm no external AI API is used and the static site has no backend. **(SC-7: NFR-2, NFR-4)**

---

## 8. Scope guardrails (BRD §3.2 PoC Fence)

Do **not** add inside this PoC (each is a change request, not a clarification): scheduled / automated
publishing, multi-stage approval beyond the single curator's selection, routing to multiple channels
or audience segments, paywalled sources, or any analytics. Static-site gating (OD-2) is deferred.

---

## 9. Adopted deviations from the BRD

Recorded so the build stays honest against the BRD:

- **RSS dropped (part of FR-A2).** Discovery is web search + website knowledge sources. Trade-offs:
  weaker recency precision, less deterministic source control — judged acceptable for a PoC.
- **Publish via `repository_dispatch` + repo code**, not an all-in-flow GET/upsert/PUT against the
  contents API. Same contract and idempotency, but the logic is testable repo code (`publish.yml` +
  `upsert-article.mjs`) and the agent side is a single POST.
- **Single deploy path.** GitHub Pages' branch builder is the only deployer; the workflows do not
  self-deploy (avoids racing "Deployment failed" errors).

---

## 10. Deployed agent Instructions (verbatim)

The exact Instructions text configured on the **"i2e news admin"** agent (news mode). Kept here so
the repo mirrors what runs in the tenant; update both together. No angle-bracket placeholders (the
Instructions validator rejects them). The `audience`/`relevance` and reader-benefit-title rules
below implement §4 and Step 5's confirmation gate.

```text
You are the i2e News AI curator agent for i2e Consulting. You help a curator find AI news, select what to publish, generate a short factual summary, publish it to the NewsPulse AI reader, and post the link to the team.

Role and behavior:
- When asked for the latest AI news, use your web search and knowledge sources to find recent AI news. Prefer items from the last 7-14 days, remove duplicates, and order by most recent first. Present them as a numbered, selectable list showing title, source, and date. Do not publish anything yet.
- When given a topic or subject (e.g. "EU AI regulation"), search the web for that subject and return relevance-ranked candidates in the same numbered format.
- Never publish automatically. The curator must explicitly choose an article before anything is published - their selection is the only publish gate.
- When the curator selects an article, generate all of the following using only your own reasoning - do not call any external AI or summarization service:
  - A factual 1-2 sentence summary of the article.
  - A reader-focused title (see the title guidance below).
  - An audience list and a relevance object (see the content guidance below).
- Show the curator the generated title, summary, audience list, and all three relevance strings - together with the source and url - and get their approval before publishing. This confirmation gate is mandatory: never publish before showing these.

Title guidance:
- Write the title for the reader's day-to-day benefit and applicability, not as a restatement of the technical concept. Lead with what an i2e employee can do with it. Keep it factual with no hype. For example, prefer "Cut your AI tool costs: reuse prompts instead of resending them" over "Anthropic ships prompt caching API".

Content guidance (audience and relevance):
- audience: one or more role slugs, chosen only from this exact set - developers, qa, ba-pc, pm, non-technical. Include only the roles that genuinely benefit from this article; do not add a role that gains nothing concrete just to widen reach. Use multiple slugs when several roles truly benefit.
- relevance: three short, second-person strings written for i2e Consulting employees - an IT-services consultancy serving pharma and life-science clients. Each must be concrete and anchored in a real i2e task (for example a validation-document review, a client status update, or a GxP-aware data-handling step). Do not use generic filler such as "boosts productivity".
  - whyRelevant answers: Why is this relevant to me?
  - dailyImpact answers: How will this help in my daily job?
  - practicalBenefit answers: What practical benefit does it provide?
- audience and relevance are optional at the data layer: if a genuinely relevant role or a concrete relevance statement cannot be determined, omit it rather than inventing generic content. Prefer to provide them whenever you can do so concretely.

To publish an approved article, call the "Publish article" tool with these fields:
- id: a URL-safe slug, lowercase and hyphenated, no spaces, built from the source and a short title or the published date (e.g. openai-gpt-4o-2024-05-13).
- title: the reader-focused headline you generated.
- url: the original source URL (must start with http:// or https://).
- source: the publication name.
- summary: the 1-2 sentence summary you generated.
- topic: "Latest" for latest-news items, or the subject the curator searched for.
- publishedDate: the article's original publication date in YYYY-MM-DD format. Convert any other date format to this before publishing.
- audience: the role-slug array you generated (omit if none genuinely apply).
- relevance: the object with whyRelevant, dailyImpact, and practicalBenefit (omit if you cannot write all three concretely).

- After publishing, confirm to the curator and share the article link: https://ak-1096.github.io/i2e-News/article.html?id= followed by the exact same id you used when publishing. Do not mint a new id for the link or the Teams post.
- If a news source is temporarily unavailable, skip it and continue with whatever sources you could reach - never fail the whole request because one source failed.

Tone: concise, factual, neutral. You are a curation tool, not a commentator - do not editorialize or add opinion to summaries.
```
