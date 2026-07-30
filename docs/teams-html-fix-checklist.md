# Teams HTML rendering — repair checklist

> # ✅ COMPLETE — 29 Jul 2026
> Applied and verified from the published Teams agent. The durable findings have been folded into
> `docs/curator-agent-runbook.md` §3 Step 7; **this file can be deleted.** Kept only in case the fix
> needs re-applying before the next session reads the runbook.

**Status (29 Jul 2026): the flow is intact; only the *Post message in a chat or channel* action was
deleted.** The trigger and *Respond to the agent* remain. This re-adds the action in the corrected
shape, which fixes the literal-`<b>` rendering *and* retires the stale "i2e NewsPulse" branding in
one pass — they were always the same edit.

> ✅ **The flow keeps its id, so the agent's tool stays bound to it.** No tool re-add is required,
> which means the two silent-reset traps in Phase 2 do **not** apply unless something forces a
> re-add. This is the cheap path — much better than rebuilding the flow.

**Principle:** the platform HTML-encodes the **AI-filled input** before inserting it into the flow's
Message field. Markup **you** author in that field still renders. So the model sends only plain text,
and the flow owns all markup.

Reference: `docs/curator-agent-runbook.md` §3 Step 7 (spec) and §10 (Instructions text).
Delete this file once applied.

> **Why the action was deleted.** The flow's definition referenced a connection reference
> (`ca_agent.shared_teams.9f90370e…`) destroyed when the org re-added the Microsoft account. Publish
> failed with `0x80095005` on every attempt, and that exact logical name cannot be recreated through
> the UI. A freshly added Teams action writes a clean `connectionReferences` block — that is the exit.

> ⚠️ **The Teams announcement fails until this is done.** Publishing articles still works (separate
> tool). Avoid curator demos in the meantime.

---

## Phase 1 — Repair the flow

- [ ] **1.1** Open the flow in Copilot Studio → **Flows**. The canvas should show the trigger
      (displayed as **manual**) and **Respond to the agent**, with the Teams action missing.
- [ ] **1.2 Rename the flow to `Post to Teams`** if it is still "Untitled" — it sat unnamed for three
      weeks and cost real time to identify. Do this as its own save.
- [ ] **1.3 Fix the trigger inputs.** Open the trigger and **delete the old `MessageText` input**,
      then add three **Text** inputs — exact names, case-sensitive:
      `ArticleTitle` · `ArticleSummary` · `ArticleUrl`
      *(This is the change that moves markup ownership to the flow. Skipping it leaves the model
      supplying HTML and the bug intact.)*

> ⚠️ **Put the name in the input's *name* box, not its *description* box.** They are adjacent and easy
> to confuse: typing "ArticleTitle" into the description leaves the input **titled "Text"** and burns
> the description slot — which is where the *plain text only* guardrail has to live, the most
> load-bearing instruction in this fix. Correct shape in the trigger's Code view:
> `"text": { "title": "ArticleTitle", "description": "The reader-focused headline, plain text only…" }`
>
> **Renaming an input does not change its key** (`text`, `text_1`, `text_2` are stable), so the
> `messageBody` expressions survive a rename. Re-check Code view afterwards to confirm.
- [ ] **1.4** Click the **⊕ between the trigger and *Respond to the agent*** and add
      **Microsoft Teams → Post message in a chat or channel**. Order matters — it must run before the
      response, not after it.
- [ ] **1.5** When prompted for a connection, pick a healthy **Microsoft Teams** connection (one of
      the properly-labelled ones) or create a new one. A fresh action writes a clean
      `connectionReferences` block — this is what ends the `0x80095005` loop.
- [ ] **1.6** Set: **Post as** = Flow bot · **Post in** = Channel · **Team** and **Channel** from the
      **dropdowns** (test channel first; swapping to the real channel later is a one-field change).
      Never let AI fill these — it fails with *"Location invalid"* / *"Message body is missing"*.
- [ ] **1.7** ⚠️ **Switch the Message field to code / HTML view** (the `</>` toggle) **before typing
      anything.** In rich-text mode the editor escapes the tags *you* type — you would recreate the
      identical bug from the maker side and conclude the fix failed. This is the single most likely
      way this goes wrong.
- [ ] **1.8** The field starts as `<p class="editor-paragraph"><br></p>` — the editor's empty
      placeholder, which is why it fails validation with *'Message' is required*. **Keep the
      `<p class="editor-paragraph">` wrapper** (it is the shape Teams already renders — the 28 Jul
      run history confirms it rendered while the injected value did not). Select all, replace with:

```html
<p class="editor-paragraph">📰 <b>New article on i2e ALerts</b><br><br><b>@{triggerBody()['text']}</b><br><br>@{triggerBody()['text_1']}<br><br>🔗 <a href="@{triggerBody()['text_2']}">Read here</a></p>
```

- [ ] **1.9 Verify the three parameter names before trusting the line above.** The `manual` trigger
      names text inputs `text`, `text_1`, `text_2` **in creation order, not by display name**. Check
      via **⋯ on the trigger → Peek code**: each property has a key and a `title` — map title →
      key → chip. Swapping `text_1`/`text_2` puts the summary in the `href` and the URL in the body —
      a confusing failure.

> 🔴 **Deleting `MessageText` first makes this likely, not theoretical.** That input was probably
> keyed `text`. The designer may continue numbering rather than reuse the freed key, so the three new
> inputs can come out as **`text_1`, `text_2`, `text_3`**. Then `triggerBody()['text']` resolves to
> nothing and every post ships with an **empty bold title**, with the other two values shifted one
> slot. Hovering a chip shows only what you typed, so it cannot distinguish the two cases — Peek code
> is the only check that can.
      Confirm the URL expression sits **inside the `href="…"` attribute**, with the anchor text left
      as the literal words *Read here*.

> ⚠️ **After any toggle to rich-text view, re-check Code view.** Round-tripping *could* normalise or
> re-escape the tags — the exact failure this fix exists to prevent. In practice one round-trip on
> 29 Jul preserved `messageBody` byte-for-byte, so this is a verify-after rule, not a prohibition.
> Two signatures to look for: `&lt;b&gt;` anywhere, or an `href` that lost its expression.
>
> If `@{…}` ends up rendering literally at runtime instead of resolving, place the three tokens with
> the dynamic-content picker in normal view at those positions, leaving the static markup untouched.
- [ ] **1.10** Leave **Respond to the agent** as it is.
- [ ] **1.11 Publish the flow — do not rely on Save draft.**

> 🔄 **Counterintuitive, confirmed 29 Jul: `Save draft` fails where `Publish` succeeds.** Save draft
> returned `0x80095005` on the stale connection reference repeatedly, while **Publish went through
> cleanly** on the same definition. The error text says *"Failed to publish workflow"* in both cases,
> which disguises which button actually failed.
>
> **Rule: if Save draft errors on a connection reference, press Publish anyway before concluding the
> flow is broken.** Hours were lost treating a draft-save failure as a hard blocker.

> 🔴 **Confirmed 29 Jul: re-adding the action does NOT clear it.** Publish still returned
> `0x80095005` naming `ca_agent.shared_teams.9f90370e…` even though the new action's Code view showed
> a clean `"connection": "shared_teams-1"`. The dead reference lives in the flow's **workflow-level
> `connectionReferences` block**, above the actions — action-level edits cannot reach it.
>
> **Rule out the browser draft cache first** (one pass, ~5 min): **Save draft** → reopen the flow in a
> **private/incognito window** (a fresh profile cannot hold a stored copy — more reliable than
> dismissing the *"your browser has stored a copy"* banner) → verify the inputs and markup are there →
> **Publish**.
>
> **If the same GUID comes back, stop repairing and build a new flow.** Everything needed is recorded
> in runbook §3 Step 7: the three input names and descriptions, the resulting keys
> (`text`/`text_1`/`text_2` in creation order), and the verified `messageBody` string. Budget ~10 min.
> The one real cost is re-pointing the agent's tool, which forces the tool re-add and its two silent
> resets in Phase 2 — do not skip those.

---

## Phase 2 — Re-sync the tool

The tool is still bound to this flow (same id), so **it does not need re-adding** — but it still
carries the old single-input mapping.

- [ ] **2.1** Agent → **Tools** → **Post to Teams**. Confirm it now lists `ArticleTitle`,
      `ArticleSummary`, `ArticleUrl` and no longer `MessageText`. Refresh the tool if there is an
      option to.
- [ ] **2.2** **Only if the inputs refuse to re-sync**, remove and re-add the tool — tool inputs are
      known not to follow a changed definition (same lesson as the connector Swagger, §3 Step 6).

> 🚨 **The two settings that silently reset on a tool add** — relevant only if 2.2 was needed
> (this cost hours on 28 Jul):
> - **Message to display** — the confirmation text — comes back **empty**. If *Ask before running* is
>   **Yes** and this is blank, **every call hard-fails** with `Error code: InvalidContent`, and Teams
>   shows nothing useful. Either set a confirmation message, or set *Ask before running* = **No**
>   (recommended here — the curator already approved at the publish gate; a second prompt adds
>   nothing).
> - **Credentials to use** reverts to **End user credentials**. Set it back to **maker-provided**.
>
> Check both explicitly. Neither announces itself.

- [ ] **2.3** Set all three inputs to **Dynamically fill with AI**, with these descriptions:

| Input | Description |
|---|---|
| `ArticleTitle` | The reader-focused headline, **plain text only**. No HTML, no Markdown, no asterisks, no surrounding quotes. |
| `ArticleSummary` | The 1-2 sentence summary, **plain text only**. No HTML, no Markdown, no link. |
| `ArticleUrl` | The article URL and nothing else: `https://ak-1096.github.io/i2e-News/article.html?id=` followed by the exact id used when publishing. **No anchor tag, no label text, no trailing punctuation.** |

- [ ] **2.4** Replace the tool **Description**. The pre-existing text still carries the obsolete
      anchor rule (*"the live link MUST be an HTML anchor"*) — confirmed still present 29 Jul. Leaving
      it re-creates the bug: an agent-emitted `<a href>` arrives encoded and shows as visible markup,
      while the flow is already doing the anchoring. Replace the whole field with:

```text
Posts a published ALerts article to the i2e News Test channel in Teams. Call this once, and only after the "Publish article" tool has succeeded. Never call it if publishing failed. Supply plain text only for all three inputs — the flow adds all formatting and the link markup itself. Do not put any HTML or Markdown in the inputs.
```

- [ ] **2.5** **Customize** on each input — confirm the plain-text guardrail descriptions carried
      over from the flow trigger; paste them in if blank.
> ℹ️ **No credentials setting on this tool, and that is correct.** The *Credentials to use* trap
> belongs to **Publish article**, a *custom connector* tool. **Post to Teams is a flow-based tool** —
> it runs under the connection bound inside the flow (`shared_teams-1`), maker-owned by construction,
> so there is nothing to re-set. Do not go hunting for it in an input's **Customize → Advanced**
> panel; that section is entity-extraction config and is largely inert when inputs are set to
> *Dynamically fill with AI*. Leave its defaults (incl. *Action if no entity found: Escalate*).

---

## Phase 3 — Instructions

- [ ] **3.1** Paste the Instructions text from runbook **§10** into the agent. It rebrands the opening
      line to *i2e ALerts* and adds the three-input **Post to Teams** paragraph.
      **Same sitting as Phase 1** — pasting it earlier points the model at inputs that do not exist.
- [ ] **3.2** Confirm the tool's actual name matches what the Instructions call it (*"Post to Teams"*).

---

## Phase 4 — Publish and verify

- [ ] **4.1** Save the agent → **Publish**. A published flow does not reach the channel until the
      *agent* is published too.
- [ ] **4.2** Publish one test article end to end. The post must show **bold text and a clickable
      link**.
- [ ] **4.3** Open the flow's **run history** → `body/messageBody`. Correct output contains literal
      `<b>` and `<a href=` (unencoded — your markup) with title, summary and URL as **plain text**
      inside them.
- [ ] **4.4** Repeat once from the **published Teams agent**, not only the Test pane. The two have
      diverged before (runbook §3 Step 6, force-prompt).
- [ ] **4.5** Click **Read here** — it must open the per-article page for that exact id.
- [ ] **4.6** Confirm the post reads **"New article on i2e ALerts"**.
- [ ] **4.7** Confirm `data/articles.json` actually gained the article. A 204 proves the dispatch was
      accepted, not that the article landed (PR #11).

---

## Phase 5 — If tags are still literal

Read `body/messageBody` first; the answer is always there.

| What you see | Meaning | Action |
|---|---|---|
| `&lt;b&gt;` where **your** static markup should be | Step 1.7 was missed — the rich-text editor escaped your own tags | Redo 1.7/1.8 in **code view** |
| `<p class="editor-paragraph">` **visible in the rendered post** | The whole body is going out as plain text — diagnosis changes | Stop; re-diagnose before editing further |
| Encoding only inside the injected title/summary | **Expected and harmless** — plain prose | None |
| Link renders as dead text | The URL token is outside the `href` attribute | Redo 1.8/1.9 |
| `Error code: InvalidContent` | Blank confirmation message with *Ask before running* = Yes | Phase 2.2 |

**Do not** respond by re-adding the anchor instruction to the agent, or by asking it for Markdown.
Both were tested and rejected on evidence (runbook §3 Step 7).
