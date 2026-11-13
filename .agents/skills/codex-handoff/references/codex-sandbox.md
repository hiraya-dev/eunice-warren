# Codex sandbox probe results

Reference for `codex-handoff` **What Codex cannot do here**. Measured with the probe in
`SETUP.md` through `delegate_task` on `gpt-5.6-luna` (`workspace-write`, codex-cli
0.164.0) on 2026-10-26, in adc-website on this machine, which uses the same T3
setup. Re-run it here on a new machine or after a Codex upgrade and update this
table.

| Operation | Result |
| --- | --- |
| Write a workspace file | exit 0 |
| `git status` | exit 0 |
| `npm run check` | exit 0 |
| `git config --local` | exit 255, `could not lock config file .git/config: Operation not permitted` |
| Bind `127.0.0.1:4199` | exit 1, `EPERM` |
| Network (`npm view astro version`) | exit 1, `ENOTFOUND` |
| `npm run build` | exit 1. Astro's fonts API needs Google Fonts (`Could not fetch from https://fonts.google.com/metadata/fonts`) and the build binds a local server |
