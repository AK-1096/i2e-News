# BRD Addendum — "AI Playbook" Section (DRAFT v0.2, pending PO approval)

> **v0.2 (14 Jul 2026):** PO revisions — YouTube sources swapped to AI Engineer + Matt Pocock;
> sanctioned-tools list finalised by PO (OD-U4 resolved).

> **Status: DRAFT — not approved, no build actions taken.**
> Extends the frozen BRD v2.0 (22 Jun 2026) for the ALerts PoC. Where this addendum is silent,
> the BRD and the curator-agent runbook (`docs/curator-agent-runbook.md`) apply unchanged.

---

## 1. Purpose

Stakeholder feedback (14 Jul 2026): add a **separate section on the reader** for
*"new and unique ways people on the internet are using AI and its accompanying tools"* —
community-sourced methodologies, prompting techniques, hacks, and workflows that i2e employees
can apply to the tools they use. The existing section answers *"what happened in AI"*; this
section answers *"what can I do with AI"*.

**Working name: "AI Playbook"** (alternatives: "Field Notes", "Hacks & How-Tos" — PO to confirm, §10).

## 2. Decisions already taken (PO, 14 Jul 2026)

| # | Decision |
|---|----------|
| D1 | **Recurring discovery, human-gated publishing.** The agent gathers candidates on a schedule; the curator remains the only publish gate. The PoC fence's "no automated publishing" rule stands — only *discovery* is scheduled. |
| D2 | Success = section fed mostly by **Reddit + Hacker News + blogs/newsletters** (+ YouTube). Direct X/Twitter and LinkedIn ingestion is **out of scope** (Phase-2 / paid-API item). Admin can redefine the source list (§6). |
| D3 | **Richer sibling data contract** (`data/usecases.json`), not a flag on `articles.json`. Core fields: applicable tool(s), category, what it does, what it improves on (§5). |
| D4 | The **existing Copilot Studio curator agent grows a second mode** — no new agent. |
| D5 | Reader shows a **standing disclaimer**, an **"org-sanctioned tools" filter**, and a **curator-verified tag** (§7). |
| D6 | Cadence: **weekly digest of 5–10 candidate items** delivered to the curator. |

## 3. Architecture (unchanged pattern, new lane)

Same split-surface model joined only by a data contract:

```
 Weekly trigger ─▶ Curator agent (mode 2:      digest    Curator (selects, 1:1)
                   "discover AI use-cases") ──────────▶      │ confirm gate
                                                             ▼
                                            repository_dispatch: publish-usecase
                                                             ▼
                                            publish.yml → upsert → validate → commit
                                                             ▼
                                                   data/usecases.json
                                                             ▼
                                            Static reader: Playbook section (new pages)
```

- **Write path:** second mode on the existing agent + a second dispatch event type
  (`publish-usecase`) through the **same** `publish.yml` workflow (new upsert target + schema gate).
- **Read path:** new list page `playbook.html` and detail page `usecase.html?id=<id>`, reading
  `data/usecases.json` only. No backend, no AI calls on the reader (NFR-2/NFR-4 unchanged).

## 4. Functional requirements (FR-U series)

### Agent (write path)
- **FR-U1 — Second mode.** On request ("find AI use-cases / hacks") or on the weekly trigger, the
  existing agent discovers candidate use-cases from the configured Playbook sources (§6) via web
  search + website knowledge sources. News mode (FR-A1–A10) is unaffected.
- **FR-U2 — Weekly digest.** A **scheduled trigger (weekly)** runs discovery and delivers a digest
  of **5–10 candidates** to the curator (title, source, platform, one-line gist). The trigger may
  **never** call the publish tool — discovery only. *(This is an approved amendment to the PoC
  fence, which otherwise banned triggers.)*
- **FR-U3 — Selection & enrichment.** The curator picks candidates from the digest (or from an
  ad-hoc query). For each selected item the agent drafts the structured fields of §5 (tools,
  category, what-it-does, what-it-improves, how-to-try) and shows them at a **confirmation gate**
  ("Ask before running" = Yes), where the curator can correct them and set `curatorVerified`.
- **FR-U4 — Publish.** On confirmation, the agent fires **one POST** —
  `repository_dispatch`, `event_type: publish-usecase` — via the existing "Github Dispatch" custom
  connector (same PAT, same host). Success = HTTP 204.
- **FR-U5 — Teams ping.** After a successful publish, post title + one-line gist + anchor link to
  `usecase.html?id=<id>` to the Teams channel via the existing "Post to Teams" flow (same HTML-anchor
  rule as the news path). *(Default assumption — PO to confirm, §10.)*
- **FR-U6 — Graceful degradation.** If a source is unreachable, the digest ships with what was found.

### Publish glue (repo)
- **FR-U7 — Upsert.** `publish.yml` handles `publish-usecase`: idempotent upsert by `id` into
  `data/usecases.json` (replace-in-place or prepend newest-first), pretty-printed.
- **FR-U8 — Schema gate.** Validate against `data/usecases.schema.json` with ajv **before commit**;
  a bad payload fails the run and never corrupts the file.
- **FR-U9 — Single deploy path.** Push to `main` → GitHub Pages branch builder, as today.

### Reader (read path)
- **FR-U10 — Playbook list.** `playbook.html`: newest-first cards showing title, category badge,
  tool chips, what-it-does, platform, verified tag. Header nav on all pages gains a Playbook link.
- **FR-U11 — Detail view.** `usecase.html?id=<id>` (the Teams ping target): all §5 fields, link out
  to the original source, standing disclaimer visible.
- **FR-U12 — Filters.** Client-side filter by **category**, by **tool**, and a **"sanctioned tools
  only"** toggle (an entry qualifies when at least one of its `tools` appears in
  `data/sanctioned-tools.json`).
- **FR-U13 — Verified tag.** Entries with `curatorVerified: true` show a "Curator verified" badge;
  unverified entries render normally without it.
- **FR-U14 — Standing disclaimer.** Fixed banner on Playbook list + detail pages (copy in §8).
- **FR-U15 — Design.** Everything follows the Switch-Lit system (`docs/DESIGN.md`).

## 5. Data contract — `data/usecases.json`

Array of objects, newest-first. Schema enforced by `data/usecases.schema.json`.

| Field | Type | Req | Notes |
|---|---|---|---|
| `id` | string | ✔ | Stable slug, e.g. `reddit-recursive-prompt-2026-07-12` (same convention as news, keys the upsert + URL). |
| `title` | string | ✔ | Short, imperative where possible ("Turn meeting notes into action items with…"). |
| `tools` | string[] | ✔ | Tool names it applies to, e.g. `["M365 Copilot", "ChatGPT"]`. Drives the tool filter + sanctioned toggle. |
| `category` | enum | ✔ | `prompting-technique` \| `workflow` \| `automation` \| `integration`. |
| `whatItDoes` | string | ✔ | 1–3 sentences: the technique itself. |
| `whatItImproves` | string | ✔ | 1–2 sentences: the before/after — time saved, quality gained, step removed. |
| `howToTry` | string | ✔ | 2–5 short steps to reproduce it. **(suggested addition)** |
| `sourceUrl` | string | ✔ | Original post/video/article, `http(s)://`. |
| `sourcePlatform` | enum | ✔ | `reddit` \| `hackernews` \| `blog` \| `newsletter` \| `youtube` \| `other`. **(suggested addition)** |
| `author` | string | – | Handle/name credit for the original poster. **(suggested addition)** |
| `difficulty` | enum | – | `beginner` \| `intermediate` \| `advanced`. **(suggested addition)** |
| `curatorVerified` | boolean | ✔ | Set at the confirmation gate; default `false`. |
| `publishedDate` | string | ✔ | `YYYY-MM-DD` — date of the original post. |
| `addedDate` | string | ✔ | `YYYY-MM-DD` — defaults repo-side to publish day. |

Suggested-addition rationale: `howToTry` is what makes an entry *actionable* rather than trivia;
`sourcePlatform` powers a per-platform view and keeps D2 measurable; `author` is fair credit;
`difficulty` helps a mixed-skill audience self-select. All four are cheap to fill at the gate.

## 6. Discovery sources — admin-definable, pre-populated

Two artifacts, mirroring how news discovery is configured today (FR-A8):

1. **Agent-side:** the sources are added as **website knowledge sources** on the agent, editable in
   Copilot Studio without a rebuild.
2. **Repo-side registry:** `data/playbook-sources.json` — the same list as reviewable config, so the
   source-of-truth roster is versioned and the reader/docs can display it. Admin edits either; the
   runbook makes keeping them in sync a checklist step.

Pre-populated starting set (one per platform, all publicly accessible without login):

| Platform | Source | URL |
|---|---|---|
| Reddit | r/ChatGPT (largest hack-sharing sub; top-weekly view) | `https://www.reddit.com/r/ChatGPT/top/?t=week` |
| Hacker News | Front page + Algolia search ("AI workflow", "prompt") | `https://news.ycombinator.com` / `https://hn.algolia.com` |
| Blog | Simon Willison's Weblog (gold standard for practical AI usage) | `https://simonwillison.net` |
| Newsletter | Ben's Bites (public web archive) | `https://www.bensbites.com` |
| YouTube | AI Engineer (conference talks: practical LLM/agent engineering) | `https://www.youtube.com/@aiDotEngineer` |
| YouTube | Matt Pocock (AI-assisted dev workflows & tooling) | `https://www.youtube.com/@mattpocockuk` |

Reserve bench (documented, not enabled by default): r/ClaudeAI, r/LocalLLaMA, the Anthropic
Cookbook (`https://github.com/anthropics/anthropic-cookbook`), OpenAI Cookbook
(`https://cookbook.openai.com`), Product Hunt AI (`https://www.producthunt.com/topics/artificial-intelligence`).

## 7. Org-sanctioned tools list

`data/sanctioned-tools.json` — a flat, admin-editable array of tool names used by the FR-U12
toggle (case-insensitive match against `tools`). **Initial contents (PO-provided, 14 Jul 2026):**

```json
["M365 Copilot", "GitHub Copilot", "ChatGPT", "Claude", "Claude Code",
 "Claude Cowork", "Codex", "Copilot Cowork"]
```

Note: `"Claude"` denotes the claude.ai chat interface. Agent instructions must normalise tool
names in `tools` to these canonical labels so the sanctioned-only toggle matches reliably.

## 8. Standing disclaimer (draft copy)

> **Community-sourced techniques.** Playbook entries are gathered from public internet sources and
> are not official i2e guidance. Verify results before relying on them, follow i2e's data-handling
> policies, and never enter confidential, client, or personal data into tools not approved by IT.

## 9. Success criteria

| # | Criterion |
|---|---|
| SC-U1 | The weekly trigger delivers a digest of 5–10 candidates to the curator without manual prompting. |
| SC-U2 | The curator can select a candidate, review/correct the structured fields, and confirm — nothing publishes without this gate. |
| SC-U3 | A confirmed publish lands a schema-valid entry in `data/usecases.json` and on the live Playbook pages. |
| SC-U4 | The Teams post's link opens the use-case detail page, which links to the original source. |
| SC-U5 | Category/tool filters and the sanctioned-only toggle work; verified entries show the badge. |
| SC-U6 | ≥80% of published entries over the first month originate from the D2 platforms (Reddit/HN/blogs/newsletters/YouTube). |
| SC-U7 | News path (FR-A1–A10) is regression-free: an end-to-end news publish still passes the runbook §7 script. |

## 10. Open decisions for the PO

| # | Question | Default if unanswered |
|---|---|---|
| OD-U1 | Section name: **AI Playbook** / Field Notes / Hacks & How-Tos / other? | AI Playbook |
| OD-U2 | Confirm FR-U5: does a published use-case ping the Teams channel like news does? | Yes, same channel |
| OD-U3 | Where does the weekly digest land — the curator's **1:1 chat** with the agent, or the channel? | 1:1 with curator (channel stays publish-announcements-only) |
| OD-U4 | ~~Actual org-sanctioned tools list for §7.~~ **Resolved 14 Jul 2026** — list in §7. | — |
| OD-U5 | Approve the four suggested schema additions (`howToTry`, `sourcePlatform`, `author`, `difficulty`)? | All four included |

## 11. Out of scope (unchanged or new fence)

Auto-publishing (trigger may only discover); direct X/Twitter or LinkedIn ingestion; paywalled
sources; multi-channel routing; analytics; user submissions from the reader ("submit a hack" —
noted as a natural Phase-2 candidate); RSS-based deterministic feed pulls.

## 12. Build sequence (post-approval)

1. **Contract first:** `usecases.schema.json`, seeded `usecases.json`, `playbook-sources.json`,
   `sanctioned-tools.json`; extend `upsert-article.mjs`/`publish.yml` for `publish-usecase`.
2. **Reader:** `playbook.html` + `usecase.html`, nav, filters, disclaimer, badges (Switch-Lit).
3. **Agent:** second mode + weekly trigger + publish tool wiring in Copilot Studio, documented as
   a new runbook section (low-code, built in the tenant like the news mode).
4. **Acceptance:** run SC-U1→U7 end-to-end.
