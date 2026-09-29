# WordGlance

## Working on this repo

`npm test` runs the suite. It uses the Node platform test runner and has no
dependencies. Tests drive the background script's real message contract through
an injected network, so a test never calls a function the background defines
internally — see `tests/harness.js`.

The bundled dictionary under `data/` is generated, not edited. See
`docs/dictionary-refresh.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `ShrekBytes/wordglance-extension`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
