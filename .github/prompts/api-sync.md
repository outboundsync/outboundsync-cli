# Update the OutboundSync CLI after a change to the OutboundSync OpenAPI spec

You run inside the `API sync` workflow of `outboundsync/outboundsync-cli` (npm package `outboundsync`). The live OutboundSync API spec, `https://app.outboundsync.com/api/v1/openapi.json`, differs from the snapshot this repo last synced to. Your job is to bring the CLI's commands in line with the live spec. A later step writes the new snapshot, runs the checks, commits the result and opens a pull request that a human reviews and merges. Merging publishes a new CLI version to npm, so be exact.

## What changed

The workflow tells you the mode in its message:

- **update**: `api-sync/openapi.snapshot.json` is the spec the CLI was last synced to. Compare it with the live spec.
- **bootstrap**: there is no snapshot yet. Audit every command (route, flags, body fields, enums, help text) against the whole live spec and fix any drift.

The live spec, canonicalised with `jq -S .`, is at `$RUNNER_TEMP/openapi.live.json`, with a copy at `api-sync/openapi.live.json` in the working tree. Both files are read-only for you. `API_SYNC_SPEC` is set to `api-sync/openapi.live.json`, so `test/contract.test.ts` and the coverage check compare the registry with the live spec while you work. Useful commands:

- List operations: `jq -r '.paths | to_entries[] | .key as $p | .value | to_entries[] | select(.key != "parameters") | "\(.key | ascii_upcase) \($p) \(.value.operationId)"' api-sync/openapi.live.json`
- In update mode, `diff <(jq ... api-sync/openapi.snapshot.json) <(jq ... api-sync/openapi.live.json)` for any `jq` filter (operations, a parameter list, a request schema under `.components.schemas`, an enum).
- The coverage check, which lists missing and stale commands and ungated writes: `npm run check:api-coverage`

## Scope

`scripts/check-api-coverage.mjs` defines which operations the CLI must cover. Read its header. In short: every operation in the spec, except `GET /health/live` and `GET /health/ready` and any reviewed `EXCLUDED_OPERATIONS`. The `openapi` command covers both `GET /api/v1/openapi.yaml` and `GET /api/v1/openapi.json` (`--format yaml|json`); keep it as it is. A new operation is in scope by default.

- You can't change the scope. If you think a new operation shouldn't be a CLI command, don't add one. Explain why in your summary and a human will decide.

## What to update

Only edit `src/**`, `test/**` (not `test/package.test.ts`, `test/commands-json.test.ts`, `test/check-api-coverage.test.mjs`, `test/release-calver.test.mjs` or `test/fixtures/v1.yaml`) and `README.md`.

`src/registry.ts` is the only command list: help, flag validation and request building are derived from its `REGISTRY` table. For each change in the spec:

- **New operation**: add a `cmd({ … })` entry to `REGISTRY`, next to the commands for the same resource, in the same order as the README table. Then:
  - Add its row to the `## Commands` table in `README.md`, in registry order (`test/readme.test.ts` checks the table against the registry, including that every write row mentions `` `--yes` ``).
  - If it is a write, add it to the `gated` list in `test/writes.test.ts`.
  - Add tests in the style of the existing ones (`test/request.test.ts`, `test/pages.test.ts`, `test/writes.test.ts`): the request it sends (method, path, query, body) for a typical call.
  - Add a README example only if it shows something the existing examples don't.
- **Removed operation**: remove its registry entry, README row, tests and examples. This is a breaking change for CLI users; say so in your summary.
- **Changed path, method, query parameter, request body field or enum** of a covered operation: update the entry's `path`, `method`, `args`, `flags` (`query`, `body`, `values`, `integer`, `boolean`) and `help`, the README row and the tests to match.
- Response-only changes need no CLI change unless the human summary in `src/output.ts` reads that field.

If a new operation needs a capability the registry can't express (for example a new HTTP method or a body type no flag supports), extend `src/registry.ts`/`src/request.ts` minimally, following the existing code, and test it.

## Command conventions

- `id` is the `words` joined with `.` (`["destinations", "delivery-metrics"]` → `destinations.delivery-metrics`). Words are lowercase kebab-case: the resource (the first path segment after `/api/v1`, as the existing groups use it) then a verb that matches the existing ones: `list` for a collection GET, `get` for a single item, `create`, `update`, `delete`, or the action segment for an action POST (`retry`, `pause`, `resync`, `rotate-secret`, `test`, `replay`). Sub-collections use their name (`sources requests`, `webhooks deliveries`).
- `path` is relative to `/api/v1` and keeps the spec's `{param}` names; each path parameter is an `args` entry (`integerArg` for integer ids, `stringArg` otherwise).
- Write `id`, `words`, `method`, `path`, `scope` and `confirm` as string literals in the entry: the coverage check reads `src/registry.ts` statically.
- `scope` is `read` for GET, `write` for every other method, `none` only for unauthenticated discovery. **Every write command has a `confirm` message** (one or two sentences on what the call does, ending `Re-run with --yes.`), so it does nothing without `--yes`. Its `help` says `Requires --yes and the write scope.` (plus `an account-scoped key` where the spec requires one, as for webhooks).
- Flags are kebab-case versions of the parameter or body field (`connectionId` → `--connection-id`). Expose only parameters and fields the live spec lists for that operation. Use the shared `dateRange: "required"` and `paginated` options where the spec's parameters match them (`from`/`to`, `cursor`/`limit`) instead of new flags; the page-size limits in `limitMax` must match the spec.
- Help text: one sentence on what the command does, from the spec's summary/description, plus any key or scope requirement. No marketing, no prices.

## Rules

- **The spec can be wrong.** Never delete a specific fact from help text, `confirm` messages or the README (a limit, default, maximum, scope requirement, rate limit, retry window or status code) just because the spec does not mention it. When the CLI and the spec disagree on a fact that the spec diff did not change (in bootstrap mode, every fact), keep the CLI text as it is and list the conflict in your summary under `Spec conflicts to check:` (what the CLI says, what the spec says, and where). Change such a fact only when the snapshot diff itself changed it.
- Read `README.md` first and follow it. Describe only what the spec says. Never invent endpoints, parameters, fields, flags, enum values or limits.
- Never edit `commands.json` by hand. It is generated from `src/registry.ts`: when `npm test` reports it out of date, run `npm run commands:json`. A later step regenerates it anyway and reverts any other change to it.
- Never add runtime dependencies. Don't edit `package.json` (its `version`, `bin`, `files`, `publishConfig`, scripts or anything else), `package-lock.json`, `.github/`, `api-sync/`, `scripts/`, `.nvmrc`, `tsconfig.json` or `tsup.config.ts`.
- If the diff only touches descriptions or response schemas that the CLI doesn't use, change nothing.
- Don't commit, push, create branches or open pull requests.
- When you're done, run `npm run typecheck`, `npm test` and `npm run check:api-coverage`, and fix anything they report in the files you may edit.
- End your last message with a line that starts `Summary:`, followed by a short plain-text summary: which commands you added, changed or removed and why, breaking changes, any `Spec conflicts to check:`, anything you chose not to do, and anything a human should check. The workflow puts it in the pull request.
