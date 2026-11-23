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
- **Trigger:** carried over from the source workflow (CLAUDE.md **Traps**); user correction #85 (on "ship it", Claude pushed a merge of `main` and ran `gh pr ready` a second later; the `ready_for_review` run (full) was queued first and cancelled by the `synchronize` run, which still read the PR as a draft and ran only smoke; Claude reported the surviving run as the full tier)
- **Symptom:** `gate` went red with no failing test; or a green `gate` on a ready PR came from the smoke tier.
- **Root cause:** the `e2e` job hit `timeout-minutes`, or a newer event cancelled the run (`cancel-in-progress`), including a push and `gh pr ready` sent back to back.
- **Rule:** before blaming the PR, check whether the job was cancelled or timed out. Raising the timeout or sharding is its own `chore` PR; a superseded run is rerun with `gh run rerun`. Never push and `gh pr ready` together: wait for the push's run to start, or mark ready first and push after. Before calling a run full-tier or merging, read the job name on the head (`e2e (full)`, both `sweeps` and `webkit` ran), not the run order.
- **Check:** the job log ends in a test failure, not "The job running on runner … has exceeded the maximum execution time" or "cancelled"; the merge's `gate` comes from a run whose `e2e` job is named `e2e (full)`.
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

### L-023 — WebKit on the CI runner needs a container to itself
- **Date:** 2026-11-14
- **Trigger:** red CI job, #75: three WebKit @smoke tests (nav, RSVP ticket, wedding tabs) timed out in `e2e (full)`, all passing on the Mac's WebKit
- **Symptom:** WebKit tests hang in Playwright's actionability wait ("visible, enabled and stable", "scrolling into view") or on `press`, then hit the 30 s test timeout; no page error in the trace.
- **Root cause:** WebKit on the Linux runner renders in software. Sharing the four-vCPU e2e container with two Chromium workers starved it of frames (the trace's screencast had 4–15 s gaps between paints), and actionability checks wait on frames.
- **Rule:** run WebKit in its own CI job at one worker (`webkit` in `ci.yml`), never alongside the Chromium projects' workers. Before blaming the site or the test for a WebKit-only CI timeout, read the trace's screencast gaps and the click's "attempting" to "done" times. Even alone, WebKit there is slow (nav toggle clicks took 6-10 s), so a test with a fixed short poll for a transition gets a narrow, commented `webkit` skip that names the reason, never a longer poll for every project.
- **Check:** `ci.yml`'s e2e job passes `--project=chromium --project=mobile`, and the `webkit` job runs `--project=webkit` with no `--workers` (`scripts/ci/ci-triggers.test.mjs` asserts both).
- **Guard:** none
- **Paths:** `.github/workflows/**`, `playwright.config.ts`, `tests/**`

### L-026 — Reduced motion shortens transitions; it does not remove them
- **Date:** 2026-11-16
- **Trigger:** flaky test: #80 (`gallery.spec.ts` reduced-motion check expected `getAnimations().length` 0 and read 1 or 42 depending on timing)
- **Symptom:** a reduced-motion spec that asserts "no animations" passes on one run and fails on the next.
- **Root cause:** the site-wide rule in `src/styles/base.css` sets `transition-duration: 0.01ms !important` on every element, and the default `transition-property` is `all`, so any inherited change (a parent hiding with `visibility`) starts a 0.01 ms `CSSTransition` on each child. Whether the spec sees them depends on whether they have finished.
- **Rule:** under reduced motion, assert that nothing perceptible animates: filter `getAnimations()` to effects whose computed `duration + delay` exceeds 1 ms and expect that list empty. Never assert a raw count of 0.
- **Check:** the reduced-motion spec filters by computed timing and passes `--repeat-each 20 --workers 8`.
- **Guard:** none
- **Paths:** `tests/**`

### L-027 — A named reference means its engine, not a look-alike
- **Date:** 2026-11-16
- **Trigger:** #80 Local review fix round: the gallery shipped to preview as a flat orthographic "stamps on a desk" canvas; the user had picked the Lunardi infinite canvas (as on chandebootcamp.com/gallery) and asked for its 3D fly-through and its popup.
- **Symptom:** the build matched the Paper stills but not the reference's motion and feel, and needed a rewrite of the canvas and the lightbox after review.
- **Root cause:** a visual fix round optimised for the Paper screenshot (no overlap, fixed tiers) and replaced the reference's mechanism (perspective chunks, depth fade, fly-through, FLIP popup) without asking.
- **Rule:** when the user picks a reference implementation, the criteria name its mechanism and its tuning values (read from its source), and Paper governs only the chrome and the look of the parts. A fix round that would change the mechanism to match a still is a question for the user, not a fix.
- **Check:** the criteria file lists the reference's source and values; the review pack says which reference behaviours were kept and which were left out.
- **Guard:** none
- **Paths:** `src/scripts/**`, `src/components/sections/**`

### L-028 — Measure WebGL and blur smoothness on the real GPU
- **Date:** 2026-11-16
- **Trigger:** #80: the gallery popup measured p95 100–133 ms per frame in headless Chromium with SwiftShader, and 16.7 ms on the same build with `--use-angle=metal`.
- **Symptom:** software-GL frame timings blame the code for compositor costs (a `backdrop-filter` over a full-screen WebGL canvas) that a GPU handles at 60 fps.
- **Root cause:** SwiftShader renders and composites on the CPU, so blur and large layers cost many times more than on any guest's device.
- **Rule:** smoothness numbers for the review pack come from Playwright's Chromium launched with `--use-angle=metal --ignore-gpu-blocklist --enable-gpu` on the Mac (confirm the WebGL renderer string says Metal). SwiftShader is fine for correctness checks, never for frame-time claims. Do not take screenshots inside a measured window.
- **Check:** the `Local:` line's frame times name the renderer.
- **Guard:** none
- **Paths:** `tests/**`, `src/scripts/gallery/**`

### L-029 — The shared fade-in hides a section's controls until it is reached
- **Date:** 2026-11-16
- **Trigger:** #80 Local review fix round (teaser reveal): putting `data-fade-in` on the gallery copy made "Step inside" `visibility: hidden` until the section scrolled into view, and three existing specs that clicked it straight after `goto` timed out. #89 CHANGES_REQUIRED: the reveal was added to seven sections but only the specs that failed once got the wait; faq, wedding, rsvp and rsvp-paths still focused or measured fading elements, and an attire drag failed 5 of 20 under load.
- **Symptom:** a spec that clicks or focuses an element inside a fade-in section fails with a timeout or an unexpected re-scroll, though the element exists.
- **Root cause:** `src/scripts/fade-in.ts` sets `autoAlpha: 0` (visibility hidden) on every `[data-fade-in-item]` until its ScrollTrigger fires, and the fade's 24px rise moves the element after Playwright scrolls to it.
- **Rule:** when a section gains `data-fade-in`, its specs reach the section first and wait for the item's opacity to reach 1 before clicking, focusing or sampling positions, using `reveal()` from `tests/helpers/reveal.ts`. Grep every spec that touches any newly faded element, not only the ones that fail once, and read positions relative to the fade item rather than the viewport. Keyboard users reach it the same way, so this is the intended behaviour, not something to work around in the component.
- **Check:** each spec for a section that gains `data-fade-in` calls `reveal()` before its first interaction or measurement, and the changed specs pass `--repeat-each 20 --workers 4`.
- **Guard:** none
- **Paths:** `tests/**`, `src/scripts/fade-in.ts`

### L-032 — Every new validation rule gets a test that fails without it
- **Date:** 2026-11-17
- **Trigger:** PR #82, CHANGES_REQUIRED
- **Symptom:** a new server rule (reject a slipper size on a seat that is not attending) and the inline error's clear-on-change had no assertion; deleting either left the suite green. A `toHaveRole("alert")` check passed whether the error was visible or not.
- **Root cause:** the brief listed the tests by area ("validation accept/reject") rather than one assertion per acceptance criterion, so tests covered the happy and obvious-reject paths only.
- **Rule:** a brief that adds a validation branch or an error state names one assertion per branch: each reject rule, the accept case, the decline path, and for an inline error both its visibility after the failed submit and its clearing after the fix. Assert visibility with `toBeVisible`/`toBeHidden`, never with a role or attribute alone.
- **Check:** for each new `return false` (or thrown error) in the diff, a test exists that fails when that line is removed.
- **Guard:** none
- **Paths:** `src/lib/**`, `src/actions/**`, `tests/**`, `.agents/skills/codex-handoff/**`

### L-035 — Measure layout shift in the element's own frame, not the viewport
- **Date:** 2026-11-18
- **Trigger:** #84 flaky test (`rsvp.spec.ts` "keeps RSVP field layout stable when focused" failed 1 of 3 on `origin/main`'s source too)
- **Symptom:** the next block's `getBoundingClientRect().top` moved 56px between blur and focus while the input itself kept its size, so the test failed with nothing wrong in the field.
- **Root cause:** the assertion reads viewport coordinates, so any scroll on focus or a late layout shift above the RSVP (lazy images, fonts) moves `top` without the field changing.
- **Rule:** a "layout stays stable" assertion compares positions relative to a stable ancestor (the next block's top minus the form's top), or pins the scroll position first, never raw viewport `top` across an action that can scroll.
- **Check:** the spec subtracts an ancestor's rect or asserts `scrollY` unchanged, and passes `--repeat-each 20 --workers 8`.
- **Guard:** none
- **Paths:** `tests/**`

### L-061 — Sound starts on the guest's chosen action, not on the first gesture
- **Date:** 2026-11-23
- **Trigger:** #108 Local-review round; escape: runtime #92
- **Symptom:** the background song started while the guest was still searching for their name in the preloader, before they pressed "Open my letter" or "Just browsing".
- **Root cause:** `Preloader.astro` dispatched `ew:music-start` on the lookup submit to borrow its user gesture for autoplay, and no spec asserted the audio stayed paused through the lookup.
- **Rule:** start audio only from the control whose meaning is "enter the site" ("Open my letter", "Just browsing"). Any earlier gesture (typing, a lookup, a suggestion reply) leaves it silent, and each start point gets a spec that also asserts the steps before it stay silent.
- **Check:** `tests/music.spec.ts` "waits for a found guest to open the letter before starting" passes and fails when an `ew:music-start` dispatch is added before the lookup.
- **Guard:** none
- **Paths:** `src/components/global/Preloader.astro`, `src/components/global/BackgroundMusic.astro`, `tests/music.spec.ts`

## Content and layout

### L-031 — More items in a row means smaller photos; show the size before building
- **Date:** 2026-11-17
- **Trigger:** #83 Local review fix round (the 7-across clotheslines shrank each polaroid photo from 248 to 148px wide at 1440; the user found the looks too small and picked a two-line layout)
- **Symptom:** a grid that grows from 4 to 7 items per row was built to fit the row, and every photo became about 60% of its old width.
- **Root cause:** the redesign fitted the new count into the same width and nobody stated the photo size trade-off before the build.
- **Rule:** when a row's item count grows, state the rendered photo size before and after at 1440 and 390 in the design proposal, and offer a layout that keeps the size (more rows, a slider) alongside the one that fits the row.
- **Check:** the proposal or PR body lists the photo width before and after at 1440 and 390.
- **Guard:** taste — the user judges whether the size is enough; no test can measure it
- **Paths:** `src/components/sections/**`

### L-033 — Facts in a Paper artboard are not confirmed copy
- **Date:** 2026-11-17
- **Trigger:** PR #82, Local-review rounds 1 and 2 (the user had the copy changed twice: the time, then the slippers' purpose)
- **Symptom:** the after-party header shipped to the preview as "For the after party · 10 PM". The time came from a Paper drawing, and the user had only said "~10 PM, I think".
- **Root cause:** the criteria copied every string from the artboard, so a value drawn as a placeholder became site copy without a check against `src/content` or the user.
- **Rule:** when criteria take copy from Paper, any time, date, place, price or name in it, and what an item is for (the slippers are the couple's gift to every guest, not an after-party item), must already be on the site or confirmed by the user; otherwise leave it out and ask in the approval message.
- **Check:** each fact in new copy in the diff is found in `src/content/**` or in the user's words in the thread.
- **Guard:** none
- **Paths:** `src/components/**`, `src/content/**`, `.agents/skills/astro-component/**`

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
- **Trigger:** carried over from adc-website (its L-017): layouts that held at the artboard widths broke between them (576–744, 850–1023, 1024–1400), where the user drags the window; escape: runtime #77 (the preloader envelope's stamps, postmark and button covered its name field at 481–720, under a viewport breakpoint from #66; the round-1 overlap sweep checked props against the envelope but skipped the envelope's own parts); #80 Local review fix round (the gallery popup's stamp was top-anchored and its controls pinned to the bottom, so a gap opened on any window not 900px tall; #85 CHANGES_REQUIRED (the notebook postmark got a fixed height for row maths, so `img { max-width: 100% }` capped its width under 395px and `object-fit: cover` cropped it; the sweep measured only text baselines and overlaps)); repeat, #96 CHANGES_REQUIRED (the admin overflow sweep listed 1023/1024/1279/1280 but not the stylesheet's real 84rem = 1344px table/card switch, and its comment said 80rem)
- **Symptom:** a layout checked at 390 and 1440 overlaps or wraps badly in between.
- **Root cause:** QA measured only Paper's artboard widths; the user reviews by resizing through every width. An overlap sweep that only compares decorations against content misses parts of one component colliding with each other.
- **Rule:** after a layout change, sweep 320–1920 for overlaps, a shared content edge and wrapping, including odd widths (632, 968, 1032, 1150) and just past each breakpoint (481, 488) as well as 390, 768, 1023, 1024 and 1440. The overlap check compares every pair of text, form and absolutely positioned parts inside each touched component, not only decorations against content. When a change fixes an image's width or height, the sweep also checks its rendered aspect ratio at the narrowest widths (320, 375): a global `max-width: 100%` caps one axis and `object-fit: cover` crops it silently. A component with absolutely positioned internals picks its layout by its own width (a container query), not the viewport's. Paper is the design intent, not a pixel spec: write criteria around structure and the sweep, not small offsets. A full-screen overlay or dialog is also swept by viewport height (578, 667, 720, 844, 900, 1080) at a desktop and a phone width; stack its parts as one centred column rather than anchoring some to the top and others to the bottom. Take the breakpoint widths from the stylesheet the diff adds (each `min-width`/`max-width` in px and one px below), never from a comment or the usual list.
- **Check:** the `@sweep` specs of the touched sections ran (`select-specs`, or the full tier), and the review pack lists the widths checked. For the preloader, `tests/preloader.spec.ts` "keeps the envelope parts from overlapping at every width" pins the in-component pairs. For overlays, the review pack lists the heights checked and the gaps between the stacked parts.
- **Guard:** none
- **Paths:** `src/components/**`, `src/styles/**`, `src/layouts/**`

### L-025 — A shared script must handle the "off" state its first caller never hit
- **Date:** 2026-11-16
- **Trigger:** #79 CHANGES_REQUIRED (the GSAP slider moved from Explore into `src/scripts/gsap-slider.ts` for the Attire looks rows); #80 CHANGES_REQUIRED (the gallery canvas kept a page-wide `keydown` listener that swallowed arrow keys and Cmd/Ctrl+A/S/D after the overlay closed, resized itself to 1×1 on a `resize` while hidden, and kept a drag alive across close); #80 round 2 CHANGES_REQUIRED (the fix skipped keys on any focused `BUTTON`/`A`, so canvas panning died once focus sat on the close button)
- **Symptom:** on desktop, where the Attire slider is off, every polaroid was `aria-hidden` and untabbable, and a phone swiped to look 3 then rotated past 48rem kept the desktop row shifted by the old inline transform.
- **Root cause:** the script set the carousel ARIA and the track transform before checking whether the slider was enabled, and returned early without cleanup. Explore's slider is always on, so that path never ran until a second caller used it.
- **Rule:** when a script becomes shared, read it for every state the new caller can put it in (off at a breakpoint, a resize between states, fewer items than fit) and make each state set up, and undo, its own attributes, transforms and listeners. The same holds for anything that can be closed or hidden (an overlay, a modal, a paused canvas): bind `window`/`document` listeners on open and remove them on close, reset in-flight gesture state on close, never measure a hidden element, and re-measure on open. Key handlers ignore events with a modifier key and skip only text entry (`input`, `textarea`, `select`, contenteditable), never buttons or links, which is where focus sits in a dialog.
- **Check:** the new caller's spec covers the inactive state (no item `aria-hidden`, no leftover transform) and a resize from active to inactive; an overlay's spec closes it, then shows a page key (ArrowDown) is not default-prevented and a resize while closed leaves the reopened canvas the stage's size.
- **Guard:** none
- **Paths:** `src/scripts/**`

### L-034 — Sweep a form's edit and error states, not only its resting state
- **Date:** 2026-11-17
- **Trigger:** escape: runtime #60 (found on #82's preview)
- **Symptom:** the step 2 rename editor's "Done" button had no padding: its label sat flush against the left edge of a fixed 4rem column.
- **Root cause:** the button had no font, padding or centring of its own, and the #60 checks measured the checklist at rest, never with a row in edit mode.
- **Rule:** when a component has modes (edit, error, open, busy), the width sweep and the Paper comparison cover each mode, and every button sets its own font, padding and alignment rather than relying on browser defaults.
- **Check:** the review pack lists the modes measured; a spec measures the label inset of any button whose column is sized by the layout (`tests/rsvp-paths.spec.ts` "renames a member via Edit").
- **Guard:** none
- **Paths:** `src/components/**`, `tests/**`

### L-036 — Run copy-editing on new copy before the review pack
- **Date:** 2026-11-18
- **Trigger:** #84 Local-review round (the user asked to fix the copy with `copy-editing` after the pack went out)
- **Symptom:** a content PR filled in facts but left em dashes in the sections it touched and long two-clause sentences in the new copy, so the user had to ask for a copy pass.
- **Root cause:** the facts were checked against the source, but the voice rules in `.agents/product-marketing.md` (no em dashes in sections that are touched, short sentences, "we" to "you") weren't run before the review pack.
- **Rule:** any PR that adds or changes guest-facing copy runs the `copy-editing` AI-tell and voice checks on that copy, and clears the em dashes in every section it touches, before the first review pack.
- **Check:** `grep -rn "—" src/components src/content` shows no hits in the touched sections, apart from code comments and the hidden With Love attribution marks.
- **Guard:** none
- **Paths:** `src/components/**`, `src/content/**`

### L-037 — Every round runs select-specs, including subagent rounds
- **Date:** 2026-11-18
- **Trigger:** #84 red CI (`smoke.spec` "marks section headings for the shared fade-in" counted 2 items in `.playlist_header` after a `layout-implementer` round moved the intro into the postcard)
- **Symptom:** a Local-review round ran only the spec its implementer touched (`playlist.spec`), pushed, and `e2e (full)` and `webkit` went red on a site-wide spec that counts the header's fade-in items.
- **Root cause:** the round's specs were picked by hand from the implementer's report instead of from `select-specs.mjs`, which lists `smoke.spec` for any section change.
- **Rule:** before every push, including after a `layout-implementer` or Codex round, run `select-specs.mjs` on the round's paths and run the specs it returns, not only the ones the implementer names.
- **Check:** the round's entry in `task.md` and the PR's `Local:` line name the `select-specs` output for that round.
- **Guard:** none
- **Paths:** `tests/**`, `src/components/**`

### L-038 — An async form state must survive the guest typing
- **Date:** 2026-11-19
- **Trigger:** #86 CHANGES_REQUIRED (the envelope and RSVP "Did you mean" state: a stale suggestion stayed on screen after typing, a late lookup response overwrote a newer name, a failed "Yes" kept resending the old suggestion, and an ignored stale response left the envelope's submit disabled)
- **Symptom:** a form that adds a state between submit and result (suggest, confirm, pending) shows or submits a value the guest has already replaced.
- **Root cause:** each branch set its own part of the state (text, label, flag, `disabled`), and the input listener, the failure paths and the early return each reset only some of them.
- **Rule:** keep one reset function per state and call it from the input listener, every failure branch and every early return; compare the submitted value with the current input before applying an async response; re-enable the submit control in `finally`, not per branch.
- **Check:** a spec types after the new state appears and asserts the visible text, the button's accessible name and the hidden alert all reset; the submit button's `disabled = false` lives in `finally`.
- **Guard:** none
- **Paths:** `src/components/global/Preloader.astro`, `src/components/sections/Rsvp.astro`

### L-039 — A rename sweeps every surface and asks about every public string
- **Date:** 2026-11-20
- **Trigger:** #88 Local-review round (the user asked to also change the `#EuniceAndWarren` hashtag and the README and voice doc, which the first round left as open questions)
- **Symptom:** a site-wide rename shipped its first review pack with the old name still in the footer hashtag, `README.md` and `.agents/product-marketing.md`, so the user needed a second round.
- **Root cause:** the inventory only covered `src/` and `tests/`, and the plan defaulted a public, brand-like string (the hashtag) to "unchanged" instead of asking about it with the other open questions.
- **Rule:** inventory a rename across the whole repo (`src/`, `tests/`, `public/`, `README.md`, `.agents/`), and put every public string that carries the name (hashtags, handles, file names guests see) in the approval question, not in a default.
- **Check:** `grep -rnIE "<old name>" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git` is empty, apart from listed exceptions, before the first pack.
- **Guard:** none
- **Paths:** `src/components/**`, `src/consts.ts`, `README.md`, `.agents/product-marketing.md`

### L-041 — An image swap re-checks every pointer at it
- **Date:** 2026-11-20
- **Trigger:** #90 Local-review round (the user found the mobile "that's us!" arrow pointing down at the date line, away from the hero photos it labels, after the hero postcards were swapped to the couple's own photos)
- **Symptom:** the round 2 review pack showed the 390 hero with the note below the photos and its arrow aimed at the text underneath.
- **Root cause:** the swap was treated as image-only, and the 390 screenshot was checked for the photo crops, not for the annotation that refers to them. The mobile note had sat below the photos with a down-pointing arrow since the hero layout shipped.
- **Rule:** when hero or section photos change, check every annotation that points at them (notes, arrows, stickers, captions) at 320, 390 and 767 as well as 1440, and say in the pack what each one points to.
- **Check:** the review pack names each pointing element and its target at every width it lists.
- **Guard:** none
- **Paths:** `src/components/sections/Hero.astro`

### L-042 — Geometry tolerances leave room for the runner's fonts
- **Date:** 2026-11-20
- **Trigger:** #90 red `e2e (full)` (the hero note-arrow spec allowed 2px between the arrow and the text's line box; it passed on the Mac and failed on the Linux runner by 0.012px at 320, 390 and 767)
- **Symptom:** a new layout spec passed locally and in the draft's `@smoke` tier, then failed in the full tier on "ship it", which cost another CI run before the merge.
- **Root cause:** the tolerance was set at the measured local gap. Text line boxes, especially Delicious Handrawn's, differ by a few px between macOS and the Linux runner.
- **Rule:** a geometry assertion that involves a text box gets a tolerance well inside the regression it guards (the old bug is tens of px off, so allow ~6px), never the local measurement plus a hair. Record the old-CSS value next to the tolerance so the margin is visible.
- **Check:** the spec's comment or the PR body states the tolerance and the old-CSS failure value; the old value exceeds the tolerance by at least 5×.
- **Guard:** none
- **Paths:** `tests/**`

### L-043 — A fixed overlay must never return under a pressed pointer
- **Date:** 2026-11-20
- **Trigger:** PR #92, red CI (`webkit` and `e2e (full)`: RSVP specs that pass on main)
- **Symptom:** after `fill()` then a click on Find my invite or Send RSVP, the next step never appeared; Playwright reported a timeout, not "intercepts pointer events".
- **Root cause:** the docked music tag hid while a field had focus. Pressing a button blurs the field on mousedown, the tag came back at once under the pointer, and the release (and click) went to the tag instead of the button. Playwright checks the hit target only on the first event of a click, so it stayed silent.
- **Rule:** a fixed or sticky element that hides for a reason (focus, a form or CTA in its zone) sets `pointer-events: none` the moment it hides and shows again only once no pointer is down. Any fixed element in a corner also hides while a form or CTA occupies its band, at every width.
- **Check:** a spec scrolls the control to the fixed element's corner (`scrollIntoView({block: "end"})`), fills a field, presses and holds the control, asserts `document.elementFromPoint` at its centre is the control, releases, and expects the next state (`tests/music.spec.ts`).
- **Guard:** none
- **Paths:** `src/components/global/**`, `src/scripts/**`, `tests/**`

### L-044 — A real feature retires its placeholder
- **Date:** 2026-11-21
- **Trigger:** PR #92, Local-review round (the user asked to remove the nav "NOW PLAYING · Dancing Queen" pill); PR #92 red CI (`sweeps`: removing the pill shrank the desktop nav 85→69px and moved the page)
- **Symptom:** the site played the real background song while a static nav pill and the menu panel named a different, made-up song.
- **Root cause:** an earlier design shipped a decorative stand-in for the feature, and the criteria for the real feature never searched for it.
- **Rule:** when criteria add a real feature (music, a gallery, a countdown), grep `src/` for decorative stand-ins of the same feature (static copy, `aria-hidden` mock controls) and list each in the approval message with a recommendation to remove or wire it. When you remove one, measure its container's size at the breakpoints before and after; if the stand-in was what set it, hold that size so nothing else moves.
- **Check:** the approval message for a new feature names any existing stand-in, or says none was found; a removal's PR shows the container's height unchanged at 390, 991, 992 and 1440.
- **Guard:** none
- **Paths:** `src/components/**`, `src/consts.ts`

### L-051 — A divided list drops the divider under its last visible row
- **Date:** 2026-11-21
- **Trigger:** PR #98, Local-review rounds 1 and 2 (the user saw a rule under the last RSVP card, above the card's bottom edge; then asked for the same on every screen, since the Guest list and Song cards had it too)
- **Symptom:** every RSVP row drew `border-bottom`, so the last card ended with a hairline floating just above the white card's rounded bottom.
- **Root cause:** the brief copied the Paper table's per-row border and nobody checked the list's end, at 390 or with search hiding rows.
- **Rule:** a list that separates rows with borders removes the one under its last visible row (`:not([hidden]):not(:has(~ tr:not([hidden])))`, or the gap/`+` sibling pattern), and the screenshot review looks at the end of every list, not only the top. A fix to one list card applies to every list card on the same surface (the dashboard's RSVPs, Guest list and Songs share the pattern); open lists on the page ground keep their closing rule as Paper draws it.
- **Check:** a spec reads the last visible row's `border-bottom-width` at rest and after a search hides rows (`tests/admin-rsvps.spec.ts` "drops the divider under the last visible row", `tests/admin.spec.ts` "admin list cards").
- **Guard:** none
- **Paths:** `src/styles/admin.css`, `src/pages/admin/**`, `src/components/**`

## Data and backend

### L-045 — External data the user owns is read-only
- **Date:** 2026-11-21
- **Trigger:** D1 PR (branch `t3/d1-database`), the user's correction: the design said the Google Sheet and its service-account secret would be "removed", and the user said never to delete anything on the Sheet
- **Symptom:** the criteria planned to retire the guest Sheet and its credentials as part of a code migration.
- **Root cause:** "replace the Sheet" was read as "delete the Sheet"; a code migration was allowed to reach into a store the hosts own and use.
- **Rule:** a migration removes or parks code paths only. Spreadsheets, documents, KV namespaces, databases and secrets that the user or hosts own are read-only unless the user names the exact deletion. Removing a code path that writes to them is itself the user's call (remove, export-only or dormant), asked in the approval message.
- **Check:** the PR's criteria and diff contain no delete, clear or overwrite of an external store or secret; any parked code is listed in `docs/prelaunch.md`.
- **Guard:** none
- **Paths:** `src/lib/**`, `src/actions/**`, `scripts/**`, `wrangler.jsonc`

### L-046 — Trace each field to the screens that render it before naming it guest-facing or host-only
- **Date:** 2026-11-21
- **Trigger:** D1 PR (branch `t3/d1-database`), the user's correction: the design said guests never see the household name, but the RSVP stub and the preloader welcome render it
- **Symptom:** the schema dropped the guest-facing household name and would have shown nothing, or the couple's internal label ("Toledo_Sabang"), on the invitation stub.
- **Root cause:** the decision was made from the data model and a relayed summary, not from the components that render the field.
- **Rule:** before a schema or criteria call a field guest-facing or host-only, grep `src/components` and `src/lib` for every place it is read and list them with file:line in the proposal. A host-only field gets a test that it never appears in action responses or rendered pages.
- **Check:** the proposal lists each render site of a renamed or split field; `tests/d1-unit.test.ts` and the RSVP/preloader specs assert the label never reaches guest output.
- **Guard:** none
- **Paths:** `src/lib/**`, `src/actions/**`, `src/components/sections/Rsvp.astro`, `src/components/global/Preloader.astro`

### L-047 — A store rewrite keeps every branch of the old restore logic
- **Date:** 2026-11-21
- **Trigger:** PR #95, CHANGES_REQUIRED (a guest who declined came back with no seat ticked)
- **Symptom:** the D1 store restored each seat's stored `attending`, so after a decline every seat came back unticked; the Sheets parser had ticked the members in that case.
- **Root cause:** the rewrite ported the data shape and the main path but not a small conditional (`previous.attending ? seat.attending : index < members.length`) in the old parser, and the criteria said "behaves as before" without listing that branch.
- **Rule:** before replacing a store or parser, list every branch of the old read and restore logic (decline, plus-one, renamed seat, missing row) in the brief, and require one test per branch against the new store.
- **Check:** the brief for a store rewrite names the old file and its branches; each has a test in the new store's unit file (`tests/d1-unit.test.ts` "resets member ticks after a decline").
- **Guard:** none
- **Paths:** `src/lib/**`, `src/components/sections/Rsvp.astro`

### L-050 — State a script keeps in the URL must reach every link and the focus trap
- **Date:** 2026-11-21
- **Trigger:** PR #98, CHANGES_REQUIRED (typed search lost on a filter or row click; Tab escaped the open drawer); PR #100, CHANGES_REQUIRED (Guest list: edit Cancel and hidden form `q` dropped the state, a page-wide `a[href^=…]` rewrite leaked `q` into the nav and stopped matching once it wrote absolute hrefs)
- **Symptom:** the RSVPs page filtered rows in place and `replaceState`d `q`, but every pill, row and close link still carried the server's `q`, so a click dropped the search and `pushState` overwrote it; the drawer focused a `tabindex="-1"` heading the trap's list skipped, so Tab left the dialog.
- **Root cause:** progressive enhancement updated the address bar but not the server-built hrefs that also encode the state, and the focus trap only wrapped at its first and last element, assuming focus starts inside that list.
- **Rule:** when a client script changes URL state, rebuild it into every link that carries it (or build the href at click time), and skip modified clicks (cmd, ctrl, shift, middle). That includes every Cancel, every redirect after a POST, and the hidden fields of open forms. Scope the rewrite to the page's own container, never the layout nav, and write hrefs back in the same (relative) form the selector matches. A focus trap handles focus on any element inside the dialog, including the programmatic focus target, and its spec presses Tab and Shift+Tab from the opened state.
- **Check:** the spec types a query, clicks a filter and a row, and expects `q` in the URL and the input; the drawer spec tabs forward and back from the opened state and expects focus inside the dialog.
- **Guard:** none
- **Paths:** `src/pages/admin/**`, `src/scripts/**`

### L-052 — A form with several submit buttons makes Save the default
- **Date:** 2026-11-22
- **Trigger:** PR #99 CHANGES_REQUIRED; PR #101 CHANGES_REQUIRED (the Enter-saves specs were deleted when the form moved into a drawer)
- **Symptom:** in the Guest list editor, pressing Enter in the household name field fired the seat stepper's "−" (or "+ Add member") instead of Save, silently dropping an empty seat; the specs only clicked Save, so nobody pressed Enter.
- **Root cause:** implicit submission uses the first submit button in tree order, and the stepper buttons came before Save.
- **Rule:** any form with more than one submit button puts its primary action first in tree order (a visually hidden, `tabindex="-1"`, `aria-hidden` copy of Save is fine) so Enter always does what Save does. Secondary submits (stepper, add row) carry their own `name`/`value`.
- **Check:** the form's spec presses Enter in a text field and expects the save, with every other field (seat count) unchanged (`tests/admin-guests.spec.ts`).
- **Guard:** none
- **Paths:** `src/components/admin/**`, `src/pages/admin/**`, `src/components/sections/Rsvp.astro`

### L-053 — A rewritten form keeps its old assertions and proves every round trip
- **Date:** 2026-11-22
- **Trigger:** PR #101 CHANGES_REQUIRED
- **Symptom:** the Guest list editor moved from inline rows into a drawer. The rewrite deleted the Enter-saves, Cancel-keeps-query, stale-refusal and stepper specs without replacing them. It also shipped no-JS paths that never reached a save: "Add anyway" was forgotten on the round trip; the invitation name flipped to "edited"; an archived seat was dropped by "−"; "Remove open seat" skipped the save and counted the seat twice. A named plus-one also showed as an open seat. The JS and no-JS halves drifted, and only the JS half had specs.
- **Root cause:** the brief listed the new flows. It never required each deleted assertion to come back, so draft state carried across a POST (confirmations, an "edited" flag, removed or archived seats) had no test on the no-JS path.
- **Rule:** before a form rewrite, list the old spec's assertions in the brief and keep or replace every one. Any draft state that must survive a round trip goes into a hidden field the server re-emits, and each secondary submit (add, confirm, remove, stepper, toggle) gets one no-JS spec that ends in a real save and checks the stored result. The JS path and the no-JS path share the same helpers and the same counts.
- **Check:** `git diff origin/main -- tests/` shows no deleted `test(` or `expect(` without a replacement named in the PR body, and `tests/admin-guests.spec.ts` has a `javaScriptEnabled: false` spec per secondary submit that ends in a save.
- **Guard:** none
- **Paths:** `src/components/admin/**`, `src/pages/admin/**`, `tests/admin-*.spec.ts`

### L-054 — A generated value the host sees names its source in the criteria
- **Date:** 2026-11-22
- **Trigger:** PR #101 Local-review round (the user asked for the host ID to come from the invitation name)
- **Symptom:** the add drawer generated the host ID from the guests' surnames ("ruiz-ilagan"), a source Claude picked when writing the criteria. On the preview, the user asked for it to follow the household's invitation name, which cost a fix round after PASS.
- **Root cause:** the criteria stated how the ID was built but did not put the choice of source to the user. The design (Paper) showed an ID that happened to fit either source.
- **Rule:** when criteria auto-generate something the host reads or keeps (an ID, a default name, a slug), the approval message names its source and an example, and offers the obvious alternative. Generated values follow what the host already sees on the form (here, the invitation name) unless the user says otherwise.
- **Check:** the posted criteria for a generated field show "from <source>: <example>"; `tests/admin-unit.test.ts` pins `generateHostId` on invitation names.
- **Guard:** none
- **Paths:** `src/lib/admin/**`, `src/components/admin/**`, `src/pages/admin/**`

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
- **Trigger:** carried over from adc-website (its L-037: `select-specs.mjs` printed `none` for a page no spec mapped); on this branch, Codex's first `select-specs` narrowed the shared `fade-in.ts` to one spec; repeat, #75: a new spec's `SPEC_SOURCES` entry copied its sibling's sources and missed `RsvpTicketPrinter.astro`, whose modal it asserts; repeat, #89 CHANGES_REQUIRED: the new preloader spec asserts the hero's entrance but its entry listed only preloader sources
- **Symptom:** a changed file went untested locally while the selector looked green.
- **Root cause:** each fail-closed rule covered the inputs it named, and the leftover case (an unmapped file, an import form the parser skips) fell to the narrow default.
- **Rule:** in any script that narrows what runs (spec selection, CI routing, `already-tested`), make the default for an unmapped or unparsed input the widest option, and add a test for the leftover case.
- **Check:** for each lookup in the diff, "what does a key with no entry return?" is answered by the broad path, and a test pins it. A new `SPEC_SOURCES` entry lists every component whose markup the spec asserts, not only its sibling spec's sources.
- **Guard:** none
- **Paths:** `scripts/ci/**`

### L-024 — A compact layout scales to the space it gets
- **Date:** 2026-11-15
- **Trigger:** #77 Local-review round 2 (the user's correction: the preloader's compact envelope stayed at the 350px phone width on 481–748px windows and looked small); #80 round 6 CHANGES_REQUIRED (polaroid photo window used `top: 6%`, which resolves against the polaroid's height, so the top border differed from the 6%-of-width sides); escape: runtime #90 (the hero's compact photo pair and note kept fixed `left` rems tuned to 390, so at 600px they sat left of the centred title)
- **Symptom:** a layout that switches to its compact form by container width keeps phone-sized parts on tablet and narrow-desktop widths, leaving the component small with empty space around it.
- **Root cause:** the compact rules were the old phone rules moved under a wider container query, with fixed widths and px sizes tuned to 350px.
- **Rule:** when a compact layout serves more than phone widths, size it to its container (`min(100%, <cap>)`) and scale its internals with container units, clamped so the phone values hold at the phone width. Re-check prop and decoration gates, since the component grows taller. A border or inset that must scale with the element's width uses percentage `margin`/`padding` (both resolve against width) or container units, never a percentage `top`/`bottom`. Parts placed with a fixed `left` that should line up with centred content get a centring offset (`max(0px, 50% - <half the group's width>)`) so they track the centre across the band.
- **Check:** the review pack measures the component at the narrowest and widest widths of its compact band, and the overlap sweep covers that band. `tests/hero.spec.ts` "centres the compact photo pair over the title" pins the hero case.
- **Guard:** taste — the user's call on how large the compact envelope reads; no test measures "too small"
- **Paths:** `src/components/**`

### L-049 — A transient status resets its own timer
- **Date:** 2026-11-21
- **Trigger:** #97 CHANGES_REQUIRED (the "Copy list for the DJ" status: a second click within 2 s let the first click's timer clear the new "Copied" message early; Codex and the spec only tested one click)
- **Symptom:** a status, toast or "Copied" message that should stay for N seconds vanishes early when the action repeats.
- **Root cause:** each trigger scheduled its own `setTimeout` to clear the status, and no trigger cancelled the previous one.
- **Rule:** a client script that shows a status for a fixed time keeps one timer id, clears it before setting a new message (success or failure), and only then schedules the clear. The brief for any such script names the repeated-trigger case.
- **Check:** the spec triggers the action twice inside the window and asserts the status is still visible just after the first timer would have fired, then cleared by the second (`tests/admin.spec.ts` DJ copy).
- **Guard:** none
- **Paths:** `src/pages/**`, `src/components/**`, `src/scripts/**`

### L-055 — Focus-trap specs wait for the opened drawer
- **Date:** 2026-11-22
- **Trigger:** #102, flaky test
- **Symptom:** the focus-trap spec pressed Tab before the asynchronously swapped drawer had focused its heading, so the first assertion sometimes observed focus outside the dialog.
- **Root cause:** the test began keyboard navigation immediately after the click instead of synchronizing on the drawer's opened and focused state.
- **Rule:** wait for the drawer to be visible and its programmatic heading focus to be established before the first Tab or Shift+Tab assertion.
- **Check:** the spec awaits drawer visibility and heading focus before tabbing in both directions.
- **Guard:** none
- **Paths:** `tests/admin-rsvps.spec.ts`

### L-056 — A refused form re-emits the token it was posted with
- **Date:** 2026-11-22
- **Trigger:** #102, CHANGES_REQUIRED
- **Symptom:** after a stale refusal, the re-rendered RSVP edit form carried the household's new `updated_at`, so pressing Save a second time passed the stale check and wrote the host's old draft over the newer reply.
- **Root cause:** the page reloaded the record on the POST and rendered the hidden token from that fresh read instead of from the posted form.
- **Rule:** any form that re-renders after a refusal (stale or validation) keeps the posted concurrency token in its draft and emits that, never a value read during the POST. Only an explicit Reload (a GET) may pick up the new token.
- **Check:** the stale spec saves twice after the refusal and both are refused (`tests/admin-rsvps.spec.ts` "refuses a stale host edit and keeps the draft").
- **Guard:** none
- **Paths:** `src/pages/admin/**`

### L-057 — Dashboard edit forms protect the host's typing
- **Date:** 2026-11-22
- **Trigger:** #102, Local review fix round; #103, CHANGES_REQUIRED (Guest list drawer: an untouched edit form for a household sharing a name started dirty because the starts-dirty check read the duplicate warning after the script's own `sync()` had shown it; a `discardConfirmed` flag set before an in-page drawer swap survived it, so stepper/switch changes on the new drawer got no reload warning); #103, red e2e (full) on mobile (the spec clicked the scrim at (4,4); the phone sheet covered that point, so the click retried until the test timed out)
- **Symptom:** the RSVP edit drawer let Esc, ×, the scrim or a nav link throw away a half-typed edit without a word, a second click on Save could post twice, and seat state ("not coming", size select) only caught up after a save. The user asked for the dashboard to be "as UX friendly as possible".
- **Root cause:** the criteria covered the data rules and the happy path, not how a non-technical host can lose work or get unclear feedback.
- **Rule:** every dashboard edit form (a) asks "Discard your changes…?" before any JS exit while it differs from how it loaded, and warns on reload/tab close (`beforeunload`); (b) shows a busy "Saving…" state and blocks a second submit; (c) reflects each control's consequence live. Write these into the criteria of any new edit form. Test a transient submit state by preventing the submit at the form in the spec, not by holding the navigation request with `page.route`. Decide whether a form starts dirty from the server-rendered markup, read before any client script rewrites it. Reset any "discard already confirmed" flag whenever a new form is swapped in, because controls that are not text fields (stepper, switch, chip ×) fire no `input` event to clear it. Specs click a drawer scrim (and anything under it) from script, `locator.evaluate((el) => el.click())`: on the phone layout the sheet covers it, so a pointer click lands on the panel.
- **Check:** `tests/admin-rsvps.spec.ts` "guards dirty edit exits and allows a clean Escape", "shows Saving while a dirty reply is submitting without a guard", "updates the seat state and size control live"; `tests/admin-guests.spec.ts` "a clean edit of a household sharing a name closes without asking", "guards Archive household and warns on reload after a drawer swap".
- **Guard:** none
- **Paths:** `src/pages/admin/**`

### L-059 — Wait for traffic the spec controls
- **Date:** 2026-11-22
- **Trigger:** #102, flaky test; #104
- **Symptom:** the gallery concurrency spec timed out waiting for 500 ms of global network quiet while unrelated lazy images, fonts, intent prefetch and a canvas module import kept the page busy.
- **Root cause:** `networkidle` synchronized the test with every request on the page instead of only the gallery image requests relevant to the assertion.
- **Rule:** never wait on `networkidle` in a spec; wait for the requests the spec routes or for a DOM state it owns.
- **Check:** `grep -rn networkidle tests` finds nothing.
- **Guard:** none
- **Paths:** `tests/**`

### L-060 — Read a closing element's style in the same turn that closes it
- **Date:** 2026-11-23
- **Trigger:** #106, flaky test
- **Symptom:** `tests/preloader.spec.ts` "reduced motion does not animate the envelope transform" failed under `--repeat-each 20 --workers 8` with `element(s) not found`: Escape removed the overlay (160 ms under reduced motion) before `toHaveCSS` polled.
- **Root cause:** the spec pressed a key that starts a timed removal, then asserted on the element with a polling matcher, racing the removal timer.
- **Rule:** to assert the style of an element that a close or dismiss removes on a timer, wait for the component to be ready, then dispatch the trigger and read `getComputedStyle` in one synchronous `page.evaluate`.
- **Check:** the spec passes `--repeat-each 20 --workers 8` and fails when the CSS rule it guards is removed.
- **Guard:** none
- **Paths:** `tests/**`
