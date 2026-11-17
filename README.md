# outboundsync

Command line for the [OutboundSync API](https://app.outboundsync.com/api/v1). It covers the same v1 surface as the product MCP: account, sources, syncs, destinations, block lists, platform webhooks, and contact outreach.

The binary is `outboundsync`. It has no runtime dependencies.

## Install

```bash
npm install -g outboundsync
```

Node 20 or newer. From a checkout:

```bash
npm ci
npm run build
node dist/outboundsync.js --help
```

## Authentication

There is no login command and the key is not written to disk.

1. In the dashboard, open Platform access → API keys and create a key. It looks like `osapi_…`.
2. Pass it with `--token`, or set `OUTBOUNDSYNC_API_KEY`.

`--token` wins over the environment variable. A connection-scoped key can read and write data for one CRM connection. Webhook commands need an account-scoped key. Write commands need a key with the write scope; keys from that screen are read-only until support issues a write-scoped key.

The default base URL is `https://app.outboundsync.com/api/v1`. Override it with `--base-url` or `OUTBOUNDSYNC_API_BASE_URL`. The value includes `/api/v1`. The CLI does not append that prefix.

```bash
export OUTBOUNDSYNC_API_KEY=osapi_…
outboundsync me
```

## Output

Success prints pretty JSON to stdout. `--json` prints one compact JSON value and skips the human summary. Errors go to stderr.

`--all` and `contacts outreach --file` print JSONL when `--json` is set: one record per line, not the page wrapper. Without `--json`, `--all` prints each page and then a one-line count.

`account status` exits 0 even when `ready` is false. The summary line says `ready: yes` or `ready: no`.

## Commands

Global flags: `--token`, `--base-url`, `--json`, `-h` / `--help`, `-V` / `--version`.

`outboundsync` with no command prints the command list. `outboundsync syncs` prints the sync subcommands.

```bash
outboundsync openapi
outboundsync openapi --format json
outboundsync me
outboundsync account status
outboundsync account metrics --since 24h
outboundsync setup
outboundsync connections list
outboundsync sources list
outboundsync sources requests 42 --since 7d --limit 50
outboundsync sources syncs 42 --from 2026-08-01T00:00:00Z --to 2026-08-08T00:00:00Z --status error
outboundsync sources retry-syncs 42 --yes
outboundsync contacts outreach --email ada@example.com
outboundsync contacts outreach --profile-url example.com/in/ada --profile-url example.com/in/ada-2
outboundsync contacts outreach --file contacts.jsonl
outboundsync requests list --since 24h --source-id 42
outboundsync requests metrics --since 30d
outboundsync syncs list --since 24h --status warning --connection-id 7
outboundsync syncs get 1001
outboundsync syncs metrics --since 7d
outboundsync syncs retry 1001
outboundsync destinations list
outboundsync destinations get 3
outboundsync destinations reply-relays
outboundsync destinations deliveries 3 --since 24h --status error
outboundsync destinations delivery-metrics 3 --since 7d
outboundsync destinations replay 3 900
outboundsync deliveries list --since 24h --destination-id 3
outboundsync blocklists list --connection-id 7
outboundsync blocklists pause 8
outboundsync blocklists resync 8 --yes
outboundsync webhooks list
outboundsync webhooks get oswhk_…
outboundsync webhooks create --url https://example.com/hooks/outboundsync --event sync.failed
outboundsync webhooks update oswhk_… --active false
outboundsync webhooks delete oswhk_… --yes
outboundsync webhooks rotate-secret oswhk_… --yes
outboundsync webhooks test oswhk_…
outboundsync webhooks deliveries oswhk_… --status FAILED
outboundsync webhooks replay oswhk_… oswhd_…
outboundsync events list --type sync.failed --delivered false --limit 25
outboundsync events get osevt_…
```

### Dates

Commands that take a range need either both `--from` and `--to`, or `--since 24h|7d|30d`.

Timestamps are full ISO-8601 values with a timezone offset (`2026-08-01T00:00:00Z`). A date with no time is rejected. `--since` sets `--to` to now and cannot be combined with `--from` or `--to`. The span can be at most 31 days. A span of exactly 31 days is allowed.

### Pages

Cursor endpoints (`requests`, `syncs`, destination deliveries, webhook deliveries, events) accept `--cursor`, `--limit`, and `--all`.

Activity lists default to 100 and cap at 500. Webhook deliveries and events default to 25 and cap at 100. The CLI does not send a limit unless you pass `--limit`.

`--all` follows `nextCursor` until `hasMore` is false. The default cap is 200 pages. `--max-pages` raises it and is only valid with `--all`. Hitting the cap prints the pages already fetched, writes a stderr line, and exits 1. The first HTTP error stops the walk and keeps that call's exit code.

### Contact file

`contacts outreach --file` reads JSONL or CSV. `--file -` reads stdin. Do not combine `--file` with `--email` or `--profile-url`.

JSONL objects use `email` and/or `profileUrl` (`profile_url` is also accepted). CSV needs a header row with `email` and/or `profile_url`. Each row is one API call. At most 5 profile URLs per row.

Stdout is JSONL. A successful row is `{ "input": { … }, …response }`. A failed row is `{ "input": { … }, "error": { "status", "message" } }`. The command keeps going after a per-row HTTP error and exits with the highest code from the run. A malformed file exits 1 before any request.

### Writes and the signing secret

These commands exit 1 without calling the API unless you pass `--yes`:

- `sources retry-syncs` re-queues recorded errors from the last 30 days for that source, once per source per 24 hours.
- `blocklists resync` reloads the list from the CRM.
- `webhooks delete` soft-deletes the endpoint. The API cannot restore it.
- `webhooks rotate-secret` replaces the signing secret. The previous secret stops verifying.

`syncs retry`, `destinations replay`, `blocklists pause`, `webhooks create`, `webhooks update`, `webhooks test`, and `webhooks replay` do not use that gate.

`webhooks create` and `webhooks rotate-secret` print the `oswhsec_…` signing secret on stdout once, and a stderr line: `Signing secret shown once; store it now.` Store it somewhere else. A later GET does not return it. On any error, `oswhsec_…` values are redacted.

`webhooks update` needs at least one of `--url`, `--description`, `--event`, or `--active true|false`. `--active` takes the words `true` and `false` so you can disable an endpoint. Repeat `--event` to replace `enabledEvents`. Omit it on create to enable every event.

`webhooks delete` returns `{ "ok": true }` for the API's empty 204.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success, including `account status` with `ready: false` |
| 1 | Usage, local validation, or a missing `--yes` |
| 2 | 401 unauthorized |
| 3 | 403 forbidden |
| 4 | 429 after one retry |
| 5 | 5xx, 504, timeout, network error, or a non-JSON 2xx |
| 6 | Any other HTTP status |

A 429 is retried once when `Retry-After` fits a 30 second budget, then the command exits 4. One GET 5xx (except 504) is retried once after 1 second. POST, PATCH, and DELETE are not retried. A 504 exits 5 and asks you to narrow `--from` / `--to` or pass `--connection-id`.

The API key is redacted from both streams. On errors, outreach addresses you sent are redacted too. They still appear in a successful response, which is the lookup result.

## Rate limits

General API calls share 120 requests per 60 seconds per account. `contacts outreach` has its own 600 requests per 60 seconds. `--all` and `--file` sleep before the next call only when `X-RateLimit-Remaining` is 1 or 0 and `X-RateLimit-Reset` is present. `X-RateLimit-Reset` is a number of seconds, not a timestamp. If those headers are absent, the CLI does not invent a delay.

## Publishing

Versions on npm use calendar versioning, `YYYY.M.DDNN`, computed in UTC by `scripts/release-calver.mjs`. The `publish.yml` workflow publishes from `main` with npm trusted publishing (`npm publish --provenance`). It has no `NPM_TOKEN`.

Before the first publish from `main`, a person has to add this repository's `publish.yml` workflow as the trusted publisher for the npm package `outboundsync`. Until that exists, the workflow skips or fails. `package.json` on `main` stays at `0.0.0-dev`; the workflow writes the CalVer version only in the publish job.

Preview the next version locally:

```bash
npm run release:preview
```

## Keeping the command list honest

`src/registry.ts` is the only command list. Help text, the flag allowlist, and the HTTP request are derived from it. `test/contract.test.ts` fails when `test/fixtures/v1.yaml` and the registry disagree.

When the API adds or changes a v1 route, refresh the fixture from the app repo and update the registry in the same change:

```bash
cp path/to/outboundsync/apps/server/openapi/v1.yaml test/fixtures/v1.yaml
```

The only spec routes intentionally left out of the CLI are `GET /health/live` and `GET /health/ready`. `openapi` covers both `GET /openapi.yaml` and `GET /openapi.json`.
