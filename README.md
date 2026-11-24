# outboundsync

Command-line interface for the [OutboundSync](https://outboundsync.com) API v1. It covers the same surface as the OutboundSync MCP server: account, sources, syncs, destinations, block lists, platform webhooks, events, and contact outreach. It also covers workspace members, invitations, and allowed email domains.

The binary is `outboundsync`. It has no runtime dependencies. API reference: [outboundsync.com/docs/api/v1](https://outboundsync.com/docs/api/v1). Live contract: `outboundsync openapi`.

## Install

```bash
npm i -g outboundsync
outboundsync --help
```

Or run it without installing:

```bash
npx outboundsync --help
```

Requires Node.js 20 or newer.

## Authentication

1. In the OutboundSync dashboard, open **Platform access → API keys** and create a key. It starts with `osapi_`.
2. Export it:

```bash
export OUTBOUNDSYNC_API_KEY=osapi_your_key_here
outboundsync me
```

`--token <key>` overrides the environment variable for one command, but a flag value is visible in shell history and the process list, so prefer the variable. The CLI never stores the key, never prints it, and redacts it from anything the API echoes back. There is no login command.

What a key can do:

- **Scope.** Keys created in the dashboard are read-only. Write commands need a key with the `write` scope; ask OutboundSync support for one.
- **Account vs connection.** A key is either account-wide ("All connections") or scoped to one CRM connection. A connection-scoped key reads and writes that connection's data. `webhooks …` commands need an account-scoped key. `workspace …` commands other than `workspace get` need an account-scoped key. `events …` work with either; a connection-scoped key sees its connection's events plus account-level events.
- **Plan features.** `webhooks …` and `events …` need platform webhooks on the plan. `blocklists resync` needs block lists on the plan.
- **Workspace.** A legacy key is rejected. `workspace get` works for a connection-scoped key. Listing invitations needs `members.invite`; other workspace reads need `workspace.read`. Writes need the `write` scope plus `workspace.update`, `domains.manage`, `members.invite`, `members.update_role`, or `members.remove`, depending on the command.

`outboundsync me` shows the key's scopes and connection scope. The JSON also includes `workspace` (`id`, `name`, `role`) for a workspace key, or null for a legacy key.

The API base defaults to `https://app.outboundsync.com/api/v1`. Override it with `OUTBOUNDSYNC_API_BASE_URL` or `--base-url`; the value includes `/api/v1`. It must be `https` (plain `http` is accepted only for `localhost`, `127.0.0.1` or `[::1]`). The CLI does not follow redirects, so the key is only ever sent to that base URL.

## Commands

`outboundsync` with no arguments prints every command. `outboundsync <group>` lists a group, and `outboundsync <command> --help` shows that command's flags.

| Command | API route | Scope | Notes |
| --- | --- | --- | --- |
| `openapi` | `GET /openapi.yaml`, `/openapi.json` | none | No key needed. `--format yaml\|json` |
| `me` | `GET /me` | read | |
| `account status` | `GET /account/status` | read | |
| `account metrics` | `GET /account/metrics` | read | date range |
| `setup` | `GET /setup` | read | |
| `connections list` | `GET /connections` | read | |
| `sources list` | `GET /sources` | read | |
| `sources requests <sourceId>` | `GET /sources/{sourceId}/requests` | read | date range, pages |
| `sources syncs <sourceId>` | `GET /sources/{sourceId}/syncs` | read | date range, pages |
| `sources retry-syncs <sourceId>` | `POST /sources/{sourceId}/syncs/retry` | write | `--yes` |
| `contacts outreach` | `GET /contacts/outreach` | read | `--email`, `--profile-url`, or `--file` |
| `requests list` | `GET /requests` | read | date range, pages |
| `requests metrics` | `GET /requests/metrics` | read | date range |
| `syncs list` | `GET /syncs` | read | date range, pages |
| `syncs get <id>` | `GET /syncs/{id}` | read | |
| `syncs metrics` | `GET /syncs/metrics` | read | date range |
| `syncs retry <id>` | `POST /syncs/{id}/retry` | write | `--yes` |
| `destinations list` | `GET /destinations` | read | |
| `destinations get <id>` | `GET /destinations/{id}` | read | |
| `destinations reply-relays` | `GET /destinations/reply-relays` | read | |
| `destinations deliveries <id>` | `GET /destinations/{id}/deliveries` | read | date range, pages |
| `destinations delivery-metrics <id>` | `GET /destinations/{id}/deliveries/metrics` | read | date range |
| `destinations replay <id> <deliveryId>` | `POST /destinations/{id}/deliveries/{deliveryId}/replay` | write | `--yes` |
| `deliveries list` | `GET /deliveries` | read | date range, pages |
| `blocklists list` | `GET /blocklists` | read | |
| `blocklists pause <id>` | `POST /blocklists/{id}/pause` | write | `--yes` |
| `blocklists resync <id>` | `POST /blocklists/{id}/resync` | write | `--yes` |
| `webhooks list` | `GET /webhooks` | read | account key |
| `webhooks get <id>` | `GET /webhooks/{id}` | read | account key |
| `webhooks create` | `POST /webhooks` | write | account key, `--yes` |
| `webhooks update <id>` | `PATCH /webhooks/{id}` | write | account key, `--yes` |
| `webhooks delete <id>` | `DELETE /webhooks/{id}` | write | account key, `--yes` |
| `webhooks rotate-secret <id>` | `POST /webhooks/{id}/rotate-secret` | write | account key, `--yes` |
| `webhooks test <id>` | `POST /webhooks/{id}/test` | write | account key, `--yes` |
| `webhooks deliveries <id>` | `GET /webhooks/{id}/deliveries` | read | account key, pages |
| `webhooks replay <id> <deliveryId>` | `POST /webhooks/{id}/deliveries/{deliveryId}/replay` | write | account key, `--yes` |
| `events list` | `GET /events` | read | pages |
| `events get <id>` | `GET /events/{id}` | read | |
| `workspace get` | `GET /workspace` | read | |
| `workspace update` | `PATCH /workspace` | write | account key, `--yes` |
| `workspace domains` | `GET /workspace/domains` | read | account key |
| `workspace domains create` | `POST /workspace/domains` | write | account key, `--yes` |
| `workspace domains update <domain>` | `PATCH /workspace/domains/{domain}` | write | account key, `--yes` |
| `workspace domains delete <domain>` | `DELETE /workspace/domains/{domain}` | write | account key, `--yes` |
| `workspace invitations` | `GET /workspace/invitations` | read | account key |
| `workspace invitations create` | `POST /workspace/invitations` | write | account key, `--yes` |
| `workspace invitations delete <invitationId>` | `DELETE /workspace/invitations/{invitationId}` | write | account key, `--yes` |
| `workspace members` | `GET /workspace/members` | read | account key |
| `workspace members update <email>` | `PATCH /workspace/members/{email}` | write | account key, `--yes` |
| `workspace members delete <email>` | `DELETE /workspace/members/{email}` | write | account key, `--yes` |

Routes are relative to the base URL. Global flags: `--token`, `--base-url`, `--json`, `-h` / `--help`, `-V` / `--version`.

Examples:

```bash
outboundsync account status
outboundsync account metrics --since 24h
outboundsync syncs list --since 24h --status error --connection-id 7
outboundsync syncs retry 1001 --yes
outboundsync sources syncs 42 --from 2026-08-01T00:00:00Z --to 2026-08-08T00:00:00Z --status error
outboundsync contacts outreach --email ada@example.com
outboundsync contacts outreach --profile-url linkedin.com/in/ada-lovelace
outboundsync contacts outreach --file contacts.csv --json > outreach.jsonl
outboundsync destinations deliveries 3 --since 7d --status error --all --json
outboundsync webhooks create --url https://example.com/hooks/outboundsync --event sync.failed --yes
outboundsync events list --type sync.failed --delivered false
```

### Write commands need `--yes`

Every command that needs the `write` scope exits 1 without calling the API unless you pass `--yes`, and says what it would do:

- `syncs retry` re-queues one failed HubSpot or Salesforce sync.
- `sources retry-syncs` re-queues every recorded error from the last 30 days for that source. The API allows one bulk retry per source per 24 hours; retry one sync with `syncs retry` first to check the fix.
- `destinations replay` and `webhooks replay` send a delivery to its URL again.
- `blocklists pause` stops fetching and pushing a list (it does not clear the list in the sequencer). `blocklists resync` enables it and queues a full reload from the CRM.
- `webhooks create`, `update`, `delete`, `rotate-secret`, and `test` manage platform webhook endpoints. `delete` is a soft delete that the API cannot undo. `rotate-secret` stops the old secret verifying at once.
- `workspace update` renames the workspace (at most 80 characters; `Create new workspace` is reserved). `workspace domains create`, `update`, and `delete` manage allowed email domains. `workspace invitations create` and `delete` invite someone or cancel an invitation. `workspace members update` and `delete` change a role or remove a member.

`webhooks create` and `webhooks rotate-secret` print the `oswhsec_…` signing secret on stdout once, with a stderr reminder to store it. A later GET does not return it. `oswhsec_…` values are redacted from error output.

`webhooks update` needs at least one of `--url`, `--description`, `--event`, or `--active true|false`. Repeat `--event` to replace the list. On create, omitting `--event` enables every event type. `workspace domains update` needs at least one of `--discoverable` or `--auto-join-enabled`. On `workspace invitations create`, omitting `--role` grants MEMBER.

### Dates

Range commands need both `--from` and `--to`, or `--since 24h|7d|30d`. Timestamps are full ISO-8601 with a timezone offset (`2026-08-01T00:00:00Z`). `--since` ends at now and cannot be combined with `--from`/`--to`. The span can be at most 31 days, matching the API.

### Pages

Commands marked "pages" accept `--cursor`, `--limit`, and `--all`. Activity lists (requests, syncs, destination deliveries) default to 100 per page, max 500. Webhook deliveries and events default to 25, max 100. The CLI sends `limit` only when you pass `--limit`.

`--all` follows `nextCursor` until the API reports no more pages, up to 200 pages (`--max-pages` raises the cap). Hitting the cap prints what was fetched, writes a stderr line, and exits 1. An HTTP error stops the walk with that error's exit code.

### Contact file

`contacts outreach --file <path>` reads JSONL or CSV; `--file -` reads stdin. Each row is one API call. JSONL rows use `email` and/or `profileUrl` (`profile_url` also works). CSV needs a header with `email` and/or `profile_url`. At most 5 profile URLs per row. The file must be a regular file of at most 5 MiB and 10,000 rows. A malformed file exits 1 before any request.

Output is one JSON line per row: `{ "input": {…}, …response }`, or `{ "input": {…}, "error": { "status", "message" } }`. The run continues past a failed row and exits with the highest exit code it saw.

## Output

Success prints pretty JSON on stdout, followed by a one-line summary for some commands. `--json` prints compact JSON with no summary; with `--all` or `--file` it prints JSONL. Errors go to stderr.

Text from the API is printed with terminal control characters (ANSI escapes, C1 controls, bidi overrides) replaced by visible `\uXXXX` escapes, so a response cannot drive your terminal. In JSON output those escapes decode to the same value.

`account status` exits 0 even when `ready` is false; the summary says `ready: yes` or `ready: no`.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Usage or local validation error, including a missing `--yes` |
| 2 | Unauthorized (HTTP 401) |
| 3 | Forbidden (HTTP 403): missing `write` scope, connection-scoped key on a webhook command or a workspace command other than `workspace get`, or a plan feature not enabled |
| 4 | Rate limited (HTTP 429) |
| 5 | Server error (5xx), query timeout (504), request timeout, network error, or a 2xx that was not JSON |
| 6 | Any other HTTP status, including 400, 404, 409, and a redirect |

Codes match the KingMinos CLI (`kingminos`) except 3: there it means out of credits (HTTP 402), because KingMinos bills credits per call. OutboundSync has no credits error, so 3 is a 403.

A 429 is retried once if `Retry-After` fits in a 30-second budget. A GET that returns 5xx (other than 504) is retried once after 1 second. Writes are never retried on 5xx.

## Rate limits

General API calls share 120 requests per 60 seconds per account. `contacts outreach` has its own 600 requests per 60 seconds. `--all` and `--file` pause before the next call only when `X-RateLimit-Remaining` is 0 or 1, for the `X-RateLimit-Reset` seconds (at most 60).

## API sync

The commands follow the live OutboundSync contract, [`openapi.json`](https://app.outboundsync.com/api/v1/openapi.json). Every 6 hours the [API sync](.github/workflows/api-sync.yml) workflow compares it with `api-sync/openapi.snapshot.json`. When it changed, a Cursor CLI agent ([prompt](.github/prompts/api-sync.md)) updates the registry, tests and command table, the workflow writes the new snapshot and regenerates `commands.json`, and it opens or updates a PR on `chore/api-sync`. A human reviews and merges every sync PR; merging publishes a new npm version. See [`api-sync/README.md`](api-sync/README.md).

`npm run check:api-coverage` (in CI) fails when an operation in the snapshot has no command in `src/registry.ts`, a command's route isn't in the snapshot, or a write command has no `confirm` (`--yes`). Only `GET /health/live` and `GET /health/ready` are left out, and `openapi` covers both spec documents. Until the first sync PR adds the snapshot, the check skips.

## Releases

Every merge to `main` that passes CI publishes a new version to npm automatically, with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) and provenance. There is no npm token in the repository.

Versions are CalVer in npm-safe semver form, `YYYY.M.DDNN`: UTC date, month without a leading zero, and the day times 100 plus a counter. `2026.11.1700` is the first release on 2026-11-17 and `2026.11.1701` the second. Git tags are `v` plus the version.

`package.json` on `main` stays at `0.0.0-dev`. After [CI](.github/workflows/ci.yml) passes on a push to `main`, [publish.yml](.github/workflows/publish.yml) plans the next version, skips if there are no new commits since the last tag, builds and tests, runs `npm publish --provenance`, then pushes the tag and creates the GitHub release. It never runs for pull requests or forks. Preview the next version locally:

```bash
npm run release:preview
```

## Development

```bash
npm ci
npm run build
node dist/outboundsync.js --help
npm run ci
```

`src/registry.ts` is the only command list; help, flag validation, and requests are derived from it. `test/contract.test.ts` fails if the registry and the OpenAPI snapshot in `api-sync/openapi.snapshot.json` disagree on routes, and `test/readme.test.ts` fails if the command table above drifts from the registry.

`commands.json` is the command reference as data, for the website's CLI docs: every command's id, usage, summary, method, OpenAPI path, flags (name, help, whether it is required, allowed values), whether it writes and whether it needs a key, sorted by id (schema `cli.commands.v1`, shared with the [KingMinos CLI](https://github.com/outboundsync/kingminos-cli)). It has no version or date, so it changes only when a command does. Read it from GitHub (`https://raw.githubusercontent.com/outboundsync/outboundsync-cli/main/commands.json`) or the npm package (`outboundsync/commands.json`). After changing `src/registry.ts`, run `npm run commands:json`; `test/commands-json.test.ts` fails when the committed file is out of date.

## License

MIT. See [LICENSE](LICENSE).
