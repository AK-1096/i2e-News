# Curator Agent — Build Runbook

How to build the **write-path** half of **i2e ALerts** (formerly NewsPulse AI): a Microsoft Copilot
Studio agent that lets a
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
- **Static site base URL**: `https://news.i2econsulting.com`.

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
2. Show the draft **summary, title, `audience` list, all three `relevance` strings, and the `id`
   slug** (plus source/url) to the curator in a **confirmation gate** before publishing ("Ask before
   running" = Yes on the publish tool). The curator can correct any of them before the write.
   **The `id` belongs in that list** — it is the one required input the model otherwise has to
   synthesise with no textual anchor, which is what breaks batch approvals (§3 Step 6). It is also
   the permanent article URL, so it is worth a human glance before it is minted.
3. ✅ *SC-2 check:* the summary, title, audience, relevance, and id are generated and shown before write.

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
   - **Confirmation:** "Ask before running" = **Yes** (FR-A4/A5), **and the confirmation message must
     be non-empty** — see *Rebuilding the tool* below. **Credentials:** maker-provided.
   - **Fill mode (all 9):** every field = **Dynamically fill with AI**.
   - ⚠️ **`relevance` must be ONE tool input at `client_payload.relevance` — never three sub-path
     inputs.** ✅ **RESOLVED 28 Jul 2026** — see *Relevance force-prompt: what actually fixed it*
     below and §4 for the connector block.
3. A successful call returns **HTTP 204** and fires the `publish.yml` workflow (§4).
- ✅ *SC-3 check:* on publish, the article's metadata appears in `data/articles.json` and the live
  site (after the branch builder deploys).

> The earlier **agent-flow HTTP action** approach was abandoned — it mis-sent the request body
> (persistent 422). The custom connector is the working publish path.

#### Relevance force-prompt: what actually fixed it · **RESOLVED 28 Jul 2026**

**Symptom (23–28 Jul 2026).** The agent generated all three `relevance` strings, showed them in the
confirmation gate, the curator approved — and then it stopped and asked *"…provide the reason why
this article is relevant…"* instead of publishing.

**Cause.** `client_payload.relevance.whyRelevant` / `.dailyImpact` / `.practicalBenefit` were
registered as **three separate sub-path tool inputs**. The generative orchestrator force-prompts for
any leaf it can't confidently bind at call time, and binding nested leaves out of generated prose is
exactly where that fails.

**The fix — two edits, both required:**
1. **Connector Swagger** — declare `relevance` as `type: object` with **no enumerated `properties`**
   (key shape goes in its `description`; block in §4). Copilot Studio then renders it as a single
   `Any`-typed input and the picker offers no leaves at all.
2. **Tool inputs** — delete the three leaves, add **one** input named `relevance`. Tool inputs never
   re-sync with the Swagger, so edit 1 alone changes nothing on an existing tool.

**Confirmed by data, not by the gate looking right** — first clean publish
`techcrunch-openai-hugging-face-breach-2026-07-27` carries a full `relevance` object with all three
keys in `data/articles.json`.

**Two theories this disproved — do not revive them:**
- ❌ *Rewriting the input description fixes it.* A declarative "generate it yourself, never ask the
  curator" description got the Test pane publishing cleanly on 27 Jul, then **still force-prompted in
  Teams quoting that same new description back**. Keep the description (it helps), but it is not the
  fix.
- ❌ *Batch size is the cause.* Recorded earlier as "2 articles bound fine, 4 did not". A **single**
  article failed identically on 28 Jul. Fan-out was a correlation of the leaf-slot era, nothing more.
  *(Batch size **does** cause a separate force-prompt on `id` — see the next section. Different
  field, different mechanism, and it fails only at N ≥ 2. This `relevance` finding stands.)*

#### Batch force-prompt on `id`: approving two articles at once · **ROOT-CAUSED 29 Jul 2026**

**Symptom.** The curator approves **two** articles in one message ("approve both"). Instead of
publishing, the agent asks *"What is the URL-safe slug ID for the article? Please provide it in
lowercase, hyphenated, ASCII only format without spaces, underscores, or trailing punctuation."* —
and re-asks the identical question after every reply. Nothing publishes; no Teams post.

**It is a slot-fill force-prompt, not a conversational question.** Three tells:
- The wording is a near-verbatim echo of the `id` line in §10 plus its format hints — that is how
  Copilot Studio generates a question from an input description.
- It says *"**the** article"* (singular) after two were approved: the orchestrator planned **one**
  tool call, not two.
- The re-ask is byte-identical. The reply is consumed as a candidate `id`, fails the stated format
  constraint, and the same generated question is re-emitted. **Slot-fill prompts have no cancel
  affordance — you cannot talk your way out of the loop.** Start a fresh conversation.

**Cause — `id` is the only required input with no textual anchor.** The confirmation gate displays
`title`, `summary`, `audience`, all three `relevance` strings, `source` and `url`. Eight of the nine
AI-filled inputs can therefore be bound by lifting a literal string out of the agent's own previous
message. **`id` was deliberately not shown**, so it has to be *synthesised* at call time from source
and date.

- **N = 1** — synthesis is unambiguous: one article in scope, one slug. Binds fine.
- **N = 2** — one slot, two competing candidate articles, no text to anchor the choice. Confidence
  drops below the bind threshold → force-prompt.

**Controlled comparison, four minutes apart, same agent and config:**

| Time (29 Jul) | Articles | Outcome |
|---|---|---|
| 01:25 | 1 | Full chain held — dispatch → upsert → schema → commit `8129c62` |
| 01:29 | 2 | Force-prompt loop on `id`, nothing published |

That rules out fill mode (a mis-set `id` input would prompt at N = 1 too), the connector Swagger, the
flow, and all of the 28–29 Jul Teams work.

**The fix — two lines in §10, no tenant plumbing.** Applied to this doc 29 Jul; paste both together:
1. **Sequence the batch** (*"Handle exactly one article per publish… publish them strictly in
   sequence"*). This is the load-bearing half: one article in flight means the `id` slot never has
   two candidates.
2. **Put the `id` in the confirmation gate.** Gives the slot a textual anchor, so even a mis-planned
   call can bind by quoting the gate — belt and braces, and the curator sees the permanent article
   URL before it is minted.

Part 2 alone is **not** sufficient: a declarative "never ask me" guardrail is a helper, not a fix —
proven on `relevance` above, where a rewritten description got the Test pane publishing cleanly and
Teams still force-prompted quoting that same new description back.

**Rejected — a batch `client_payload` array.** It re-opens the nested-object binding class that caused
the `relevance` regression, and needs connector *and* workflow changes. Wrong trade for a PoC.

> **Sequencing is required by the pipeline anyway**, independent of this bug: the `concurrency` queue
> in `publish.yml` holds one pending run and silently drops articles at N ≥ 3 (§4).

#### Rebuilding the tool from scratch — what deletion silently resets

Deleting and re-adding **Publish article** does **not** restore its previous settings. Two fields
come back wrong and neither is obvious:

| Field | Resets to | Must be |
|---|---|---|
| **Message to display** (under *How do you want to ask the user?* → "Send specific response") | **empty** | non-empty text |
| **Credentials to use** | **End user credentials** | maker-provided, on the existing Github Dispatch connection |

⚠️ **An empty confirmation message hard-fails every call** with `Error code: InvalidContent` — the
tool never fires, no dispatch reaches GitHub, and the Teams error card shows only the opaque code.
"Ask before running = Yes" survives the rebuild; the message it depends on does not. *(28 Jul 2026:
cost four failed publish attempts and three wrong theories — fan-out, stale conversation state, the
`Any`-typed relevance slot — before the real message surfaced.)*

**Left on "End user credentials"**, each Teams user is asked for their own Github Dispatch
connection, which they cannot create — the connector authenticates with a single maker-held PAT.

**Diagnostic that ended it — keep the `On Error` topic.** Teams renders only
`Error code: InvalidContent …`. The **Test pane**, with an `On Error` topic that echoes the
`Error Message` system variable into the chat, printed the actual sentence:

> `This tool requires user confirmation, but no confirmation message has been set.`

That topic is worth more than its footprint. When a publish fails opaquely in Teams, **reproduce it
in the Test pane and read `Error Message` before theorising.**

**Rebuild checklist:** tool named exactly `Publish article` (Instructions reference it by name) ·
4 fixed inputs · 9 AI-filled inputs, one `relevance`, no leaves · Ask before running = Yes ·
**confirmation message filled** · **maker credentials** · Save → **Publish the agent** → test 1
article → verify the record in `data/articles.json` actually contains `relevance`.

### Step 7 — Post the link to Teams · **FR-A7**
Use a small **agent flow** (not the raw Teams connector-action tool, which can't reliably shape the
message body). **The flow owns the markup; the model only supplies plain text** — see the encoding
entry below for why this is not negotiable.

1. Create an agent flow **"Post to Teams"** with **three Text inputs**, all plain text:
   `ArticleTitle`, `ArticleSummary`, `ArticleUrl`. Set its **Details → Description** (Copilot Studio
   may seed the tool's description from it, so write it as guardrail text):
   *"Posts a published ALerts article to the i2e News Test channel in Teams. Call once, only after
   "Publish article" has succeeded — never call it if publishing failed. Supply plain text only: the
   flow adds all formatting and the link markup itself."*
   Leave **Increase flow capacity** disabled; **Plan** is Copilot Studio (runs meter against Copilot
   Studio capacity, no separate Power Automate license).
2. Add the Microsoft Teams action **"Post message in a chat or channel"**: **Post as** = Flow bot,
   **Post in** = Channel, **Team** and **Channel** = pick your target from the **dropdowns** (test
   channel now; swap to the real channel later — that's the only change needed). **Message** = the
   authored HTML below. Completion = **Don't respond (default)**.
3. Wire the flow into the agent as the **"Post to Teams" tool**; set all three inputs to
   **Dynamically fill with AI**, each with the input description given below.
4. In Instructions: call **Post to Teams** once, **only after "Publish article" succeeds**.
5. ✅ *SC-4 / SC-5 check:* the post appears in the channel **with rendered bold and a clickable
   link**, and that link opens the per-article view, which links out to the original source.
   Verify from the **published Teams agent**, never from the Test pane (see below).

> 📋 **Re-applying this?** This section is the reference for *what* the flow must look like and
> *why*; the tool-add reset traps are in §3 Step 6 (*Rebuilding the tool*). The ordered execution
> checklist used for the 29 Jul repair was retired once the fix was verified — recover it with
> `git show 0e1eb45:docs/teams-html-fix-checklist.md` if the flow ever has to be rebuilt.
>
> **On 29 Jul 2026 the Teams action was deleted and re-added** — not the whole flow — after its
> connection reference proved unrecoverable (see the blocker entry below). The flow keeps its id, so
> the agent's tool stays bound and no tool re-add is needed. The trigger still has to be migrated from
> `MessageText` to the three inputs. **Name the flow `Post to Teams`** if it is still *"Untitled"*: it
> sat unnamed for three weeks and cost real time to identify.

**Message field — exact content.** Author this in the flow's **Message** field, inserting the three
inputs as dynamic-content tokens where marked. Everything else is static, maker-authored markup:

```html
📰 <b>New article on i2e ALerts</b><br><br>
<b>{ArticleTitle}</b><br><br>
{ArticleSummary}<br><br>
<a href="{ArticleUrl}">Read here</a>
```

`{…}` = the dynamic-content token for that input, not literal braces. The token for `ArticleUrl`
goes **inside the `href` attribute**; the anchor text stays the static words *Read here*. Our article
URLs carry no `&`, so attribute-level encoding of the injected value is a no-op.

**Verified trigger keys** (29 Jul, `manual` trigger, `kind: Skills`): `text` = ArticleTitle,
`text_1` = ArticleSummary, `text_2` = ArticleUrl, all three `required`. Keys follow creation order,
survive renames, and must be re-confirmed after any trigger edit.

**Verified action definition** (29 Jul, from the action's Code view — the shape to restore to after
any future rebuild):

```json
"parameters": {
  "poster": "Flow bot",
  "location": "Channel",
  "body/recipient/groupId": "<AI Accelerators team>",
  "body/recipient/channelId": "<i2e News Test channel>",
  "body/messageBody": "<p class=\"editor-paragraph\">📰 <b>New article on i2e ALerts</b><br><br><b>@{triggerBody()['text']}</b><br><br>@{triggerBody()['text_1']}<br><br>🔗 <a href=\"@{triggerBody()['text_2']}\">Read here</a></p>"
}
```

Read that `messageBody` carefully when checking a rebuild: the backslashes are **JSON string
escaping for the quote characters**, not HTML encoding. Literal `<b>` and `<a href=` stored raw is
correct. If you ever see `&lt;b&gt;` *in the definition itself*, the Message field was authored in
rich-text mode instead of code view. The action carries no Content-Type parameter — the connector
sends this as HTML.

**Input descriptions** (the tool's *Customize* pane — these are what stop the model re-introducing
markup):

| Input | Description to set |
|---|---|
| `ArticleTitle` | The reader-focused headline, **plain text only**. No HTML, no Markdown, no asterisks, no quotes around it. |
| `ArticleSummary` | The 1-2 sentence summary, **plain text only**. No HTML, no Markdown, no link. |
| `ArticleUrl` | The article URL and nothing else: `https://news.i2econsulting.com/article.html?id=` followed by the exact id used when publishing. **No anchor tag, no surrounding text, no trailing punctuation.** |

The `id` is **not returned by "Publish article"** — that POST returns **204 No Content**. The agent
must **reuse the exact same `id` slug it sent in the publish `client_payload`** (§5), never mint a
new one.

> Pin Team/Channel via the flow's **dropdowns** — don't let the AI fill the Teams body. AI-filling
> the raw connector body fails (400 "Location invalid" for a URL in `Post in`; 400 "Message body is
> missing" when it shapes the JSON wrong).

> 📌 **Branding lives in the flow, not in the model.** The post says **"i2e ALerts"** — the product
> was renamed from *NewsPulse AI* (Jul 2026). Because the name now sits in the static Message field,
> renaming again is a one-line flow edit, not a prompt change, and the model cannot drift back to a
> stale name on an individual post.
>
> *Evidence this is the right place for it:* in the 28 Jul channel posts the stale heading appears
> **inside the escaped region** — i.e. the model is authoring the brand line itself — and its wording
> drifts between runs (`New Article on i2e NewsPulse!` at 23:36/23:39 vs `New article published on
> i2e…` at 22:39). Prompt-level branding is re-decided on every single post; a static Message field
> is decided once. If the name changes, update the Message field, `README.md`, the
> reader pages, and §10's Instructions text together.

> 🕘 **Superseded (kept for context) — the "emit an anchor tag" instruction fix.** Until 28 Jul 2026
> the agent was told to emit `<a href="…">Read here</a>` itself, because Teams' HTML body does not
> reliably auto-link a bare URL (a *Read more: https://…* post rendered as dead text, Jul 2026). That
> rule is now **obsolete and must be removed** from the tool Description / input Customize: with the
> flow authoring the anchor, an agent-emitted tag would arrive HTML-encoded and show as visible
> markup — the exact bug below. **Keep** the other guardrails in that Description (*call once, only
> after "Publish article" succeeds; never post on failure*).

> ⚠️ **The AI-filled input is HTML-encoded before it reaches the Teams body.** Root-caused 28 Jul
> 2026; **amended later the same day — the encoding now happens in the Test pane too.**
> ## ✅ RESOLVED AND VERIFIED 29 Jul 2026
> Applied in full — three plain-text inputs, flow-authored Message, tool Description stripped of the
> obsolete anchor rule, Instructions updated. **Verified from the published Teams agent** (the
> environment that was actually broken, not the Test pane): bold heading, bold title, plain summary,
> clickable *Read here*, branding reading *i2e ALerts*. The article committed to `main` as `8129c62`,
> so the whole chain — dispatch → upsert → schema validation → commit — held.
>
> **Symptom.** The post shows `<b>`, `<br>` and the `<a href>` anchor as visible text. Originally
> observed only from the **published Teams agent**, with the **Test pane** rendering correctly.
>
> **Root cause — Copilot Studio HTML-encodes the AI-filled string input before inserting it into the
> flow's Message field.** Proven from the flow's run-history raw inputs. Same wrapper, same block
> order, same anchor; the only difference is encoding:
>
> | Run | `body/messageBody` |
> |---|---|
> | Test pane, 22:13 | `<p class="editor-paragraph">📰 <b>New Article on i2e…` |
> | Teams, 22:39 | `<p class="editor-paragraph">📰 &lt;b&gt;New article published on i2e…` |
>
> The agent emitted correct HTML and obeyed the anchor rule **in both runs** — it is not an
> instruction problem, a model non-determinism problem, or a flow-definition problem.
>
> **Confirmed 29 Jul from the flow's Overview: `Modified Jul 6, 2026`.** The flow definition had not
> been touched for three weeks while its rendered output changed on 28 Jul. Nothing on our side of
> the flow moved — the change is platform-side. Flow drift is ruled out by date, not by argument.
>
> ### Amendment — the Test-pane exemption is gone (28 Jul 2026, later)
>
> The Test pane now produces literal markup as well, so **"published Teams ≠ Test pane" is no longer
> the mechanism** — it was a transient environment difference, not the cause. Two consequences, both
> in our favour:
>
> - **The root cause narrows and hardens.** It was never *"Teams encodes"*; it is *"the AI-filled
>   input is encoded"*. That behaviour is now uniform across both entry points, which is what a
>   platform-side rollout looks like, not a configuration drift on our side.
> - **The Test pane is a faithful reproduction environment again.** It reproduces the bug, so it can
>   also demonstrate the fix — no publish cycle needed between attempts.
>
> **The fix is unchanged, and the evidence for it got stronger.** In the broken posts the
> `<p class="editor-paragraph">` wrapper is **not** visible on screen, while the model's `<b>` is.
> Both sit in the same `messageBody`. That asymmetry is the whole proof:
>
> - the body is still being interpreted as **HTML** (a plain-text body would show the wrapper too), and
> - **maker-authored markup in the Message field still renders**; only the *injected value* is escaped.
>
> So moving the markup into the Message field puts it on the side of that line which still renders.
> **The restructure is also its own test:** the first post after it either shows bold text and a live
> link, or it doesn't — no separate probe is needed.
>
> ⚠️ **Check what you are looking at in the Test pane.** The agent's *conversational reply* in the test
> chat is plain text and will always show tags literally — that is normal and proves nothing. Only the
> **Teams post the flow actually sends**, or the flow's **run-history `body/messageBody`**, is evidence.
>
> **Do not "fix" this at the agent.** Instructing it to emit plain text reverts the Jul 2026 dead-link
> fix above; instructing it to emit **Markdown** does not work either — the body is HTML mode
> (`<p class="editor-paragraph">` wrapper, confirmed above), so `**bold**` renders as literal
> asterisks. Both were considered and rejected on evidence.
>
> **The fix — move markup ownership from the model to the flow.** Specified in full above: three
> plain-text inputs, HTML authored in the flow's Message field. Maker-authored markup in that field is
> not what gets sanitised; only injected values are, and encoding plain prose is harmless (`&amp;` in
> a title renders as `&`). It puts the markup on the side of the escaping boundary that still renders,
> instead of fighting the boundary, and it makes the anchor rule non-load-bearing. *(The audience line
> considered in the first draft was dropped — three inputs, not four.)*
>
> *Alternative, not recommended:* decode in the Message field with
> `replace(replace(replace(replace(triggerBody()['text'],'&lt;','<'),'&gt;','>'),'&quot;','"'),'&amp;','&')`
> — note `&quot;` is required or the `href="…"` stays broken. This deliberately re-opens the markup
> injection the platform is closing, on strings generated from third-party web pages. Prefer the
> restructure.

> ✅ **Resolved 29 Jul 2026 — and the blocker was narrower than it looked.** `Save draft` fails on the
> stale connection reference while **`Publish` succeeds on the identical definition**. Both surface
> the same *"Failed to publish workflow"* text, which hid which button was actually failing and made
> a working flow look unpublishable. **If Save draft errors with `0x80095005`, press Publish anyway.**
>
> The reference itself could not be repaired: publishing
> returned `0x80095005` naming `ca_agent.shared_teams.9f90370e…` as missing, and that exact logical
> name cannot be recreated through the UI (Dataverse auto-generates the GUID suffix), so the error's
> *"create connection references with those names"* branch was a dead end. The picker listed a row
> whose Details showed that very name — an **orphaned stub**, recognisable by its missing display
> name. A freshly added Teams action binds a clean reference while preserving the flow id — preferred
> over rebuilding the flow, which would force a tool re-add and its two silent resets. The procedure
> below is kept for the next occurrence.
>
> 🚧 **Blocker — the flow will not save.** Unrelated to the formatting, but on its critical path:
> `Failed to find connection references with logical name(s) 'ca_agent.shared_teams.<guid>'`, which
> appeared after the org re-added the Microsoft account. The `ca_agent` publisher prefix is the
> agent's own solution — the reference only resolves inside that solution's context. Work through
> these in order and stop at the first that saves:
>
> 1. **Edit from the right place.** Copilot Studio → the **i2e news admin** agent → **Flows** → open
>    **Post to Teams** → Edit. Opening the same flow from Power Automate's **My flows** list loads it
>    outside the solution, where `ca_agent.*` cannot resolve — that alone reproduces the error.
> 2. **Repoint the connection reference.** make.powerapps.com → correct environment → **Solutions** →
>    the agent's solution (publisher prefix `ca_agent`) → **Connection references** → the Microsoft
>    Teams one → set **Connection** to a live Teams connection owned by the re-added account
>    (**+ New connection** first if the list is empty) → Save. Then reopen the flow and save it.
> 3. **Mint a fresh reference.** If the old reference was destroyed when the account was removed,
>    open the flow *in the solution*, on the Teams action choose **Change connection → Add new
>    connection**, sign in, then Save — Power Automate creates a new reference bound to the solution.
>
> ✅ **Confirm before moving on:** the flow's **Details** page shows the Teams connection as connected
> under the re-added account, with no "Fix connection" prompt. Then **re-publish the agent** — a saved
> flow does not reach the Teams channel until the agent is published.
>
> **Then verify.** Post one article and read the flow's run history `body/messageBody`: it should
> contain literal `<b>` and `<a href=` (maker markup, unencoded) with the title, summary and URL as
> plain text inside them. Since the amendment above, the Test pane reproduces the encoding, so it is
> a valid first check — but still confirm once from the **published Teams agent** before calling it
> done, because the two environments have diverged before (§3 Step 6, force-prompt).
>
> **Pattern worth naming: the Test pane and the published Teams channel are not equivalent
> environments.** The force-prompt entry in §3 Step 6 remains a confirmed instance — the Test pane
> published cleanly and Teams did not on identical config. **Never accept a green Test pane run as
> proof that Teams works.**
>
> This encoding bug *looked* like a second instance for several hours and is no longer counted as one:
> the Test pane later started reproducing it. **A cross-environment difference can be a rollout in
> progress rather than a property of the environments** — before building a theory on "it works over
> here", check whether "over here" still works today.

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

> ⚠️ **Never expand `client_payload` values into a `run:` block with `${{ }}`.** *(Fixed 28 Jul 2026,
> PR #11.)* The commit step interpolated the title directly:
> `git commit -m "Publish: ${{ github.event.client_payload.title }}"`. A title containing double
> quotes — `Don't share sensitive work via Claude links — "anyone with a link" chats were publicly
> indexed on Google` — closed the `-m` argument early; the remainder became stray pathspecs and the
> step exited 1.
>
> **The failure mode is the dangerous part: the upsert and schema validation had already passed.** The
> article was accepted, then silently dropped at commit — and the agent had long since received its
> **204**, so the curator was told it published. **A 204 is proof the dispatch was accepted, never
> proof the article landed.** Verify in `data/articles.json`, not in the agent's reply.
>
> It is also an injection path: `title` is model-generated from third-party web pages, and this job
> holds `contents: write`. Pass untrusted context values through `env:` so the shell only ever sees
> `"$VAR"` — never through `${{ }}` inside `run:`.
5. The workflow **serialises** on a `concurrency` group (`group: publish`, `cancel-in-progress: false`)
   so two dispatches close together don't run in parallel. ⚠️ This queue holds **one** pending run —
   see the concurrency warning below before publishing three or more articles in quick succession.

> ✅ **Stale-base race — FIXED (commit `ae54a3b`).** `actions/checkout@v4` checks out `GITHUB_SHA`,
> which for a `repository_dispatch` is the default-branch tip **at dispatch-creation time**. When the
> curator approved multiple articles, the tool fired several dispatches off the *same* base; even
> though `concurrency` queued them, each queued run still checked out that **stale base**, committed
> on it, and its `git push` was rejected **non-fast-forward** — silently dropping the later article
> (the agent already had its HTTP 204). Seen 27 Jul: two dispatches off `148baa4` — first (`fd27dfb`)
> pushed, second (`80beaeb`, valid + schema-passed) failed to push and never landed.
>
> `publish.yml` now checks out the **live branch tip**, so a serialised run sees the prior run's
> commit and its push fast-forwards cleanly:
> ```yaml
> - uses: actions/checkout@v4
>   with:
>     ref: main          # track the branch tip, not the stale dispatch SHA
>     fetch-depth: 0
> ```
>
> ⚠️ **Still open — `concurrency` drops articles at N ≥ 3 (found 29 Jul 2026).** GitHub holds only
> **one** pending run per concurrency group and **cancels the previously pending run** when a newer
> one arrives. `cancel-in-progress: false` protects the *in-progress* job only — it does not protect
> the queue. So with `group: publish`: N = 2 is safe (one running, one pending), but at **N ≥ 3 the
> middle article(s) are cancelled before they ever execute**, and the agent already has its 204.
>
> **204 is proof the dispatch was accepted, never proof the article landed.** Verify in
> `data/articles.json`.
>
> **Until fixed, publish articles one at a time** — which the agent Instructions now enforce (§10,
> *"Handle exactly one article per publish"*), so this is belt-and-braces rather than curator
> discipline. **Fix if batching is ever wanted:** make runs safe to execute concurrently instead of
> serialising them — a per-run unique `concurrency` group (nothing is ever cancelled) plus a
> fetch → `reset --hard origin/main` → re-run the upsert → commit → push retry loop. Re-running the
> upsert rather than rebasing avoids a textual conflict when two runs both prepend to the array; the
> upsert is idempotent by `id`, so a retry is always safe.

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

> **`relevance` input shape (Publish article tool) — one object input, not three leaves.** Expose
> `client_payload.relevance` as a **single** AI-filled object input; the model emits the whole
> `{whyRelevant, dailyImpact, practicalBenefit}` JSON in one slot. Do **not** decompose it into three
> separate required inputs — that triggers the force-prompt regression (§3 Step 6). The repo glue
> already ingests the whole object: `publish.yml` sends `ART_RELEVANCE = toJSON(client_payload.relevance)`
> and `upsert-article.mjs` `parseObject` JSON-parses it — so no repo change is needed regardless of
> how the connector is shaped.
>
> **What actually decomposes it — settled 27 Jul 2026: the three leaf inputs live on the TOOL, not
> the connector.** `client_payload.relevance.whyRelevant` / `.dailyImpact` / `.practicalBenefit` were
> added as three separate **tool inputs** back in B2. Tool inputs are **independent of the connector
> Swagger and never re-sync with it**, so every Swagger edit (enumerated `properties` → property-less
> object → `type: string`) was **inert** — the three leaves survived untouched and kept driving the
> force-prompt. That is why the symptom persisted in Teams through every schema change, and why only
> the leaves' *descriptions* ever altered the prompt wording.
>
> **Proof:** adding a single `client_payload.relevance` input while the leaves were still present
> raised `There is an error: 'OverlappingTaskDialogInputPropertyPath'` — Copilot Studio objecting that
> a parent path and its children were both registered as inputs.
>
> **Fix (tool level, not Swagger):** delete the three leaf inputs, keep **one** input at
> `client_payload.relevance` set to *Dynamically fill with AI*. *(There is no `required` array in this
> connector — required-ness was never involved.)*
>
> **Fix — ✅ applied and confirmed working 28 Jul 2026 — collapse to one object input by
> removing the enumerated `properties`.** In the
> `PublishArticle` body, the `relevance` block becomes `type: object` + `description` only (no nested
> `properties`); put the shape in the description so the AI knows the keys:
> ```yaml
> relevance:
>   type: object
>   description: >-
>     JSON object with exactly these keys: whyRelevant, dailyImpact, practicalBenefit. Each value is
>     one concrete second-person sentence for an i2e Consulting employee, anchored in a real i2e task
>     (validation-document review, client status update, or GxP-aware data step). Fill all three; omit
>     the whole object only if you cannot. No generic filler.
> ```
> Steps: make.powerautomate.com → **Custom connectors** → **Github Dispatch** → **Edit** → **Swagger
> editor** → replace the `relevance` block as above → **Update connector** → Copilot Studio → **Publish
> article** tool → **Add input** (see below) → set it **Dynamically fill with AI** → **Publish** the
> agent → retest (approve → HTTP 204, no per-field questions).
>
> ⚠️ **The tool's input list does NOT auto-sync with the connector.** Editing the connector Swagger
> never makes a new field appear on the tool by itself — you must **Add input** and name the payload
> path explicitly. Hit twice now: first in B2 (adding the three `relevance` leaves, 23 Jul) and again
> on 27 Jul, where an absent `relevance` row was mis-read as "the designer dropped the object" when in
> fact it had simply never been added. **An input missing from the list means "not added yet", not
> "rejected by the schema" — add it before concluding anything about the Swagger.**
>
> Add **one** input at path `client_payload.relevance` — **not** three sub-path inputs
> (`client_payload.relevance.whyRelevant`, …), which is what causes the force-prompt regression above.
>
> **Shipped shape (28 Jul 2026):** property-less `type: object` in the Swagger → Copilot Studio's
> input picker lists `relevance` once as `Any; <description>`, with no `whyRelevant` / `dailyImpact` /
> `practicalBenefit` entries to add by mistake. Verify that by eye when rebuilding: **if the picker
> offers the leaves, the Swagger edit did not land.**
>
> **Either payload shape now works.** `parseObject` accepts a real object *and* a double-encoded JSON
> string (the shape Copilot Studio sends when the field is typed `string`) — see
> [`scripts/upsert-article.mjs`](../scripts/upsert-article.mjs). So `relevance` may be declared
> `type: object` or `type: string` in the connector; pick whichever the designer renders as a single
> AI-fillable input. *(Superseded: an earlier note here insisted on `object` because a stringified
> value was rejected — that repo-side limitation was fixed in PR #10.)*
> `audience` is a flat array (fills fine, not prompting) — leave it as one input.

---

## 5. Stable id convention

Use a deterministic, URL-safe slug so the same article never publishes twice and the article-page
URL is stable: `<source>-<short-title-or-publishedDate>`, lowercased, hyphenated — e.g.
`openai-gpt-4o-2024-05-13`. The upsert in §4 keys on this `id` (replace-in-place, not duplicate).

**The agent generates it and shows it at the confirmation gate** (§3 Step 5) — the curator never types
one. It is the only publish input with no other textual anchor in the conversation, which is why
leaving it off the gate broke batch approvals (§3 Step 6). The same slug is reused verbatim for the
article link and the Teams post; never mint a second one.

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

> ✅ **Teams paragraph: applied and verified 29 Jul 2026.** The **Post to Teams** paragraph and the
> ALerts rename in the opening line are live in the tenant and confirmed working from the published
> Teams agent (§3 Step 7).
>
> ⏳ **Ahead of the tenant (29 Jul 2026) — the two batch-publish lines.** The *"Handle exactly one
> article per publish"* rule and the *"the exact id slug you will publish under"* clause in the
> confirmation-gate line are the fix for the batch force-prompt (§3 Step 6). Paste **both together**:
> the sequencing rule is the load-bearing half, and the id-in-the-gate clause is what gives the slot
> a textual anchor. Neither is live until this block is pasted into the agent and the agent is
> **published**.

```text
You are the i2e News AI curator agent for i2e Consulting. You help a curator find AI news, select what to publish, generate a short factual summary, publish it to the i2e ALerts reader, and post the link to the team.

Role and behavior:
- When asked for the latest AI news, use your web search and knowledge sources to find recent AI news. Prefer items from the last 7-14 days, remove duplicates, and order by most recent first. Present them as a numbered, selectable list showing title, source, and date. Do not publish anything yet.
- When given a topic or subject (e.g. "EU AI regulation"), search the web for that subject and return relevance-ranked candidates in the same numbered format.
- Never publish automatically. The curator must explicitly choose an article before anything is published - their selection is the only publish gate.
- Handle exactly one article per publish. If the curator selects or approves several articles in one message, publish them strictly in sequence: publish the first, post it to Teams, confirm it to the curator, then start the next. Never combine two articles into a single "Publish article" call, and never ask the curator to supply an id, title, url or any other field - you generate every field yourself and show them at the confirmation gate.
- When the curator selects an article, generate all of the following using only your own reasoning - do not call any external AI or summarization service:
  - A factual 1-2 sentence summary of the article.
  - A reader-focused title (see the title guidance below).
  - An audience list and a relevance object (see the content guidance below).
- Show the curator the generated title, summary, audience list, and all three relevance strings - together with the source, the url, and the exact id slug you will publish under - and get their approval before publishing. This confirmation gate is mandatory: never publish before showing these.

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

- After publishing, confirm to the curator and share the article link: https://news.i2econsulting.com/article.html?id= followed by the exact same id you used when publishing. Do not mint a new id for the link or the Teams post.
- If a news source is temporarily unavailable, skip it and continue with whatever sources you could reach - never fail the whole request because one source failed.

To announce a published article, call the "Post to Teams" tool once, only after "Publish article" has succeeded. Never post if publishing failed. Fill its three inputs with plain text only - the flow adds all formatting and the link markup itself:
- ArticleTitle: the reader-focused headline, plain text. No HTML tags, no Markdown, no asterisks, no surrounding quotes.
- ArticleSummary: the same 1-2 sentence summary you published, plain text. No HTML tags, no Markdown, no link.
- ArticleUrl: only the URL - https://news.i2econsulting.com/article.html?id= followed by the exact same id you used when publishing. No anchor tag, no label text, no trailing punctuation.
Do not write any HTML or Markdown into these inputs. Markup you add is displayed to readers as visible characters instead of being rendered.

Tone: concise, factual, neutral. You are a curation tool, not a commentator - do not editorialize or add opinion to summaries.
```
