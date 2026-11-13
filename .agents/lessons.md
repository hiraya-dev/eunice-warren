# Lessons

Mistakes this repo has already paid for, written down so no agent repeats them.
Claude, Codex and the `pr-reviewer` subagent all read this file. Each entry states what went wrong, the rule that
prevents it, and how to check for it.

- **Codex**: before you implement, read the entries whose **Paths** match the files
  you will touch. A handoff quotes the matching ones, but the ledger is the source.
- **`pr-reviewer`**: the entries matching the diff are saved to
  `.context/review-<pr>/lessons.md`. Treat each as a checklist item, and cite its ID
  in a finding (`path:line — breaks L-009: … — fix`).
- **Claude**: pick entries with `scripts/lessons/select.mjs` (below) for every brief
  and review, and capture new ones as `CLAUDE.md` **Lessons** says.

Guarded lessons, the ones a hook, lint or test now enforces, live in
`lessons-archive.md`. `CLAUDE.md` **Traps** names the guards.

## Using the ledger

```bash
git diff --name-only origin/main...HEAD | node scripts/lessons/select.mjs           # full entries
printf '%s\n' src/components/Button.astro | node scripts/lessons/select.mjs --brief  # one line each
node scripts/lessons/select.mjs --check   # validate both files (prepush and CI run this)
```

## Entry format

```markdown
### L-NNN — Short title
- **Date:** YYYY-MM-DD the lesson was first learned
- **Trigger:** PR #, and CHANGES_REQUIRED, red CI, revert, flaky test, Local-review round or the user's correction; add `escape: <route> #PR` when the user found what the gates missed
- **Symptom:** what went wrong, as seen
- **Root cause:** why it happened
- **Rule:** what to do, stated positively
- **Check:** how to verify the rule holds
- **Guard:** none; hook / test / lint plus where it lives; or `taste — <reason>` (the user's OK, no test can measure it)
- **Paths:** `glob`, `glob` (repo-relative; `**` for every change)
```

Maintenance rules (`--check` enforces the mechanical ones):

- IDs are never reused. Take the next number after the highest one in both files,
  after merging `origin/main`; `--check` fails on a duplicate.
- This file holds the live entries, all with `Guard: none` or `Guard: taste`.
- Once a lesson is guarded, move its entry to `lessons-archive.md` with the guard
  named, and shrink any prose rule elsewhere to one line naming the guard.
- When a lesson happens again, add the PR to **Trigger** and sharpen the rule. An
  entry with no finding in its last 20+ merged PRs, that no guard, spec or script
  cites, may move to the archive once the user approves.
- `--check --base origin/main` (`npm run check:lessons`, in `prepush` and CI) fails
  when this branch and `origin/main` both added the same ID; it names the next free
  ID.

## Git and checkouts

### L-007 — The checkout can move under you
- **Date:** 2026-10-11
- **Trigger:** carried over from the source workflow (CLAUDE.md **Traps**)
- **Symptom:** another session switched branches or edited files in the same worktree mid-task, and a commit picked up hunks that were not the task's.
- **Root cause:** several sessions can share one checkout, and nothing locks it.
- **Rule:** run `git status -sb` and confirm the branch right before every handoff, commit and push. A hunk that is not yours is never "stray": leave it out of the commit and leave it in the tree.
- **Check:** the PR diff holds only the task's files.
- **Guard:** none
- **Paths:** `**`

### L-008 — One port per checkout, and keep CLAUDECODE unset for astro preview
- **Date:** 2026-10-11
- **Trigger:** carried over from the source workflow: a hardcoded Playwright port with `reuseExistingServer` tested another checkout's code and reported green; Astro 7 backgrounds `astro preview` when `CLAUDECODE` is set
- **Symptom:** a suite passed against another worktree's server; or the Playwright `webServer` exited at once and every test failed to connect.
- **Root cause:** a port is machine-wide while worktrees run side by side; and `astro preview` detaches itself when it sees `CLAUDECODE`.
- **Rule:** keep `playwright.config.ts` deriving its port from the checkout path with `reuseExistingServer: false`, and run `astro preview` through `env -u CLAUDECODE` in every config and script. When a suite acts as if a change is missing, `lsof -nP -iTCP:<port> -sTCP:LISTEN` first.
- **Check:** `playwright.config.ts` has `derivePort(process.cwd())`, `reuseExistingServer: false` and `env -u CLAUDECODE`; so does every `preview` script in `t3.json`.
- **Guard:** none
- **Paths:** `playwright.config.ts`, `t3.json`, `package.json`

### L-012 — Your test traffic is the user's IP
- **Date:** 2026-10-11
- **Trigger:** carried over from the source workflow: about 20 headless loads in 20 minutes tripped the host's DDoS mitigation
- **Symptom:** Cloudflare blocked the user's own browser after a scripted run against a hosted deploy.
- **Root cause:** automated load from one IP looks like an attack.
- **Rule:** test against the local build. Check a hosted deploy or preview a few times by hand, never in a loop.
- **Check:** no spec or script navigates to or fetches `*.workers.dev` (canonical URLs in assertions are fine).
- **Guard:** none
- **Paths:** `tests/**`, `scripts/**`

### L-013 — A red e2e may be a cancel
- **Date:** 2026-10-11
- **Trigger:** carried over from the source workflow (CLAUDE.md **Traps**)
- **Symptom:** `gate` went red with no failing test.
- **Root cause:** the `e2e` job hit `timeout-minutes`, or a newer push cancelled the run.
- **Rule:** before blaming the PR, check whether the job was cancelled or timed out. Raising the timeout or sharding is its own `chore` PR; a superseded run is rerun with `gh run rerun`.
- **Check:** the job log ends in a test failure, not "The job running on runner … has exceeded the maximum execution time" or "cancelled".
- **Guard:** none
- **Paths:** `.github/workflows/**`, `tests/**`

### L-015 — Confirm a PR watch; never report one from memory
- **Date:** 2026-11-13
- **Trigger:** PR #72, the user's correction ("why are you not watching the pr?")
- **Symptom:** Claude told the user three times it was "watching" PR #72, but `list_thread_pull_requests` showed `watching: false`; `gate` went green at 09:39 and the PR sat unmerged until the user asked.
- **Root cause:** Claude reported the watch from what it had said earlier, not from T3's state, so a watch that never registered went unnoticed.
- **Rule:** right after `watch_pull_request`, and whenever the user asks for status, confirm `watching: true` with `list_thread_pull_requests`; if it is false, watch again before ending the turn. Answer status questions from `gh pr checks` and `gh run view`, not from the last thing said.
- **Check:** each "watching" claim in the thread follows a `list_thread_pull_requests` result showing `watching: true` for that PR.
- **Guard:** none
- **Paths:** `**`

## Motion and tests

### L-009 — Time motion assertions by the clock, never by frames
- **Date:** 2026-10-17
- **Trigger:** flaky tests: #56 (ribbon seams), #62 (ticket stepped feed: `plateaus` 2, expected ≥ 3 on CI), #65 (turntable angle: one 66.7 ms CI frame is 0.2327 rad, over a 0.2 rad limit); PR #74, CHANGES_REQUIRED: the spin test switched to the unwrapped `rotate(deg)` value but kept its 0.2 radian thresholds, so it passed on 0.2°
- **Symptom:** motion specs passed locally and failed on CI or under load, with numbers that were off by about one frame.
- **Root cause:** the assertions counted `requestAnimationFrame` samples or compared two reads a fixed number of frames apart. Headless Chrome on a loaded runner delivers frames 40–67 ms apart, and a backgrounded tab freezes rAF entirely. #65 also read the angle through `atan2`, which wraps at ±180°.
- **Rule:** check an animation's shape by pausing it with the Web Animations API and seeking `currentTime` (on a hidden clone if the live element runs timers). For live playback, sample over wall-clock time with `performance.now()`, bound the change by elapsed time plus one capped frame, and assert the peak or spread, never one reading or a frame count. Read the unwrapped value the component writes, not a derived angle. When you change which value a spec reads, convert every threshold to the new value's unit and restate it from the component's rate. Measure in Playwright's own browser, never a backgrounded DevTools tab.
- **Check:** the spec passes `--repeat-each 20 --workers 8` locally, or under CPU throttling, and on `flake-check.yml` (20 repeats, 4 workers, no retries).
- **Guard:** none
- **Paths:** `tests/**`

### L-010 — Release a snap or inertia drag at rest
- **Date:** 2026-10-19
- **Trigger:** flaky test #64: the Explore drag spec failed about 1 in 10 runs at 390px
- **Symptom:** a drag that should land on the next slide sometimes snapped back to the first.
- **Root cause:** GSAP Draggable with `inertia: true` snaps to the point nearest the projected throw end, so the outcome depended on the release velocity Playwright happened to produce. The 150px drag was under half the 314px slide.
- **Rule:** drag past the snap midpoint and hold the pointer still (about 200 ms) before `mouse.up()`, so the release velocity is near zero and the snap target is deterministic.
- **Check:** the drag spec passes `--repeat-each 20 --workers 8`.
- **Guard:** none
- **Paths:** `tests/**`

### L-011 — Keep per-frame work inside the frame budget
- **Date:** 2026-10-17
- **Trigger:** #56: an animation-performance audit of the ticket tilt, the playlist progress bar and the ribbon marquee
- **Symptom:** per-frame main-thread work: each `pointermove` restyled a 56-element subtree, a progress fill animated `width`, and a marquee tween ran every frame while off screen.
- **Root cause:** unregistered custom properties inherit, so each write restyles every descendant; `width` triggers layout; a `repeat: -1` tween that is never paused runs forever.
- **Rule:** register per-frame custom properties with `@property` and `inherits: false`; batch pointer handlers into one `requestAnimationFrame` that reads, then writes; animate `transform` and `opacity`, not layout properties; pause looping tweens while off screen; write text only when it changes.
- **Check:** the section's spec asserts the property is local (a descendant keeps its initial value), the transform-based fill, and an unchanged transform while off screen.
- **Guard:** none
- **Paths:** `src/components/**`, `src/scripts/**`

### L-016 — Specs written blind fail the first run
- **Date:** 2026-11-13
- **Trigger:** carried over from adc-website (its L-039): a spec Codex rewrote without running it failed three selectors in the first real run and cost two full CI runs
- **Symptom:** a spec that `npm run check` accepts fails on its first Playwright run.
- **Root cause:** Codex's sandbox cannot bind a port or build the site, so it writes specs from the source alone and guesses the rendered DOM.
- **Rule:** whoever writes a browser spec runs it before handing it back (`local-checks` **A new or changed spec runs once**). When Codex returns a new or changed spec, Claude or `layout-implementer` runs that spec file alone before the push.
- **Check:** every new or changed `tests/*.spec.ts` in the diff appears in the `Local:` line as run.
- **Guard:** none
- **Paths:** `tests/**`, `.agents/skills/codex-handoff/**`

### L-017 — Specs assert structure, not the couple's copy
- **Date:** 2026-11-13
- **Trigger:** carried over from adc-website (its L-031: a content publish turned a footer spec red with no code change); this repo's audit found specs pinning FAQ and Explore counts, entourage group slugs, attire swatch names, the footer sign-off and button labels
- **Symptom:** a content or copy edit (`src/content/**`, a section's text) turns a spec red with no code change.
- **Root cause:** the spec asserted the current copy or item count instead of the structure the code guarantees.
- **Rule:** specs that render content assert structure (the element exists, has a label or href, sits in the right group, one item per content file read with `node:fs`), not the current copy. Facts the site states as facts (the date, the RSVP deadline, the couple's names) may stay. When a PR changes copy, grep `tests/` for the old values first.
- **Check:** `grep -rn` in `tests/` for strings from `src/content/**` or section copy the diff adds finds no exact-copy assertion.
- **Guard:** none
- **Paths:** `tests/**`, `src/content/**`

### L-021 — A de-pinned count comes from the source, never an async label
- **Date:** 2026-11-13
- **Trigger:** flaky test, #73: "renders one checklist row per seat" read its expected seat total from the "N of M seats" label, failed locally at 4 workers, fixed in PR A; repeat, #75: `tests/rsvp-paths.spec.ts` (written by Codex) read its starting count from the label again, caught in review
- **Symptom:** a spec reads 0 for a count and fails at `toBeGreaterThan(0)` on some runs only.
- **Root cause:** the label reads "0 of 0 seats" until the invite loads; `toHaveText(/\d+ of \d+ seats/)` matches the placeholder, so the spec read the total before the data arrived.
- **Rule:** when a spec stops pinning a count (L-017), take the expected value from the source file or fixture (`node:fs`, or an import such as `fakeFixtures`), never from text the page renders asynchronously. Then wait for the page to show that value.
- **Check:** no spec parses an expected count out of `textContent()` of an element that a client script fills, even when an earlier wait (row count) makes it pass today. Put this rule in every Codex brief for a spec that reads a count.
- **Guard:** none
- **Paths:** `tests/**`

### L-022 — Shared fake-store state needs a spec that is idempotent and serialised
- **Date:** 2026-11-13
- **Trigger:** flaky test, #73 audit: "restores a dedicated returning guest" passed once per server run and failed every `--repeat-each` repeat and every CI retry; PR A's first fix still failed 2 in 20 at 2 workers
- **Symptom:** a spec that submits to the fake store passes on its first run and fails on a repeat or retry, or when another worker submits the same invite between its submit and its read-back.
- **Root cause:** the fake store keeps submissions for the whole server run, shared by every worker and both projects; the spec assumed a fresh store, and its read-back assumed no concurrent writer.
- **Rule:** a spec that writes to the fake store must pass on a store that already holds its own earlier write (branch on the current state, write a value unique to the run) and must hold a cross-process lock around write and read-back when other workers or projects can write the same record. Give each such spec its own fixture record.
- **Check:** the spec passes `--repeat-each 20 --workers 8` locally and on `flake-check.yml`.
- **Guard:** none
- **Paths:** `tests/rsvp*.spec.ts`, `tests/with-love*.spec.ts`, `src/lib/rsvp/**`

## Content and layout

### L-014 — Check list layouts with the real names, not the placeholders
- **Date:** 2026-11-13
- **Trigger:** PR #72, Local-review round (the user asked for one column for secondary sponsors, then for the groomsmen and bridesmaids on mobile, then for every entourage group on mobile)
- **Symptom:** after the real entourage names replaced the short placeholders, the multi-column name lists wrapped names onto two or three lines (a veil sponsor at 1440, most groomsmen and bridesmaids at 390), and paired names no longer lined up.
- **Root cause:** the grids were sized for placeholder names; real names are longer, and nobody re-checked the layout when the content changed.
- **Rule:** when names or copy in a multi-column list change, screenshot the list at 390 and 1440 before the PR and propose a layout fix (a single column) for any name that wraps, instead of waiting for the user to spot it.
- **Check:** at 390 and 1440, every name in `.entourage_role li` fits on one line.
- **Guard:** none
- **Paths:** `src/content/entourage/**`, `src/components/sections/Entourage.astro`

### L-018 — Sweep widths, not just the artboard widths
- **Date:** 2026-11-13
- **Trigger:** carried over from adc-website (its L-017): layouts that held at the artboard widths broke between them (576–744, 850–1023, 1024–1400), where the user drags the window
- **Symptom:** a layout checked at 390 and 1440 overlaps or wraps badly in between.
- **Root cause:** QA measured only Paper's artboard widths; the user reviews by resizing through every width.
- **Rule:** after a layout change, sweep 320–1920 for overlaps, a shared content edge and wrapping, including odd widths (632, 968, 1032, 1150) as well as 390, 768, 1023, 1024 and 1440. Paper is the design intent, not a pixel spec: write criteria around structure and the sweep, not small offsets.
- **Check:** the `@sweep` specs of the touched sections ran (`select-specs`, or the full tier), and the review pack lists the widths checked.
- **Guard:** none
- **Paths:** `src/components/**`, `src/styles/**`, `src/layouts/**`

## CI scripts

### L-019 — Build a parser's test fixtures from the real output
- **Date:** 2026-11-13
- **Trigger:** carried over from adc-website (its L-034: a hand-written Playwright JSON fixture hid a bug with nested `describe` titles); on this branch, Codex's first `check-sweep-tags` fixtures were flat and hand-written
- **Symptom:** a script's unit tests pass on a fixture shaped from memory, and the script fails on the tool's real output.
- **Root cause:** the fixture left out fields or nesting the real output carries at every level.
- **Rule:** shape fixtures for code that reads a tool's output (Playwright JSON, the GitHub API, Workers Builds) from a real sample of that output, trimmed; key on structure the format documents, not on a field's absence.
- **Check:** each fixture in a `scripts/**/*.test.mjs` that models tool output names where its shape came from and keeps the real nesting.
- **Guard:** none
- **Paths:** `scripts/**`

### L-020 — A selector's "no match" means run more, not nothing
- **Date:** 2026-11-13
- **Trigger:** carried over from adc-website (its L-037: `select-specs.mjs` printed `none` for a page no spec mapped); on this branch, Codex's first `select-specs` narrowed the shared `fade-in.ts` to one spec; repeat, #75: a new spec's `SPEC_SOURCES` entry copied its sibling's sources and missed `RsvpTicketPrinter.astro`, whose modal it asserts
- **Symptom:** a changed file went untested locally while the selector looked green.
- **Root cause:** each fail-closed rule covered the inputs it named, and the leftover case (an unmapped file, an import form the parser skips) fell to the narrow default.
- **Rule:** in any script that narrows what runs (spec selection, CI routing, `already-tested`), make the default for an unmapped or unparsed input the widest option, and add a test for the leftover case.
- **Check:** for each lookup in the diff, "what does a key with no entry return?" is answered by the broad path, and a test pins it. A new `SPEC_SOURCES` entry lists every component whose markup the spec asserts, not only its sibling spec's sources.
- **Guard:** none
- **Paths:** `scripts/ci/**`
