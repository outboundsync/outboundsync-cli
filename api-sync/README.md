# api-sync

Keeps the CLI's commands in step with the live OutboundSync API contract, `https://app.outboundsync.com/api/v1/openapi.json`.

- `openapi.snapshot.json` is the live spec as of the last merged sync, canonicalised with `jq -S .` (sorted keys, 2-space indent). It is written only by the `API sync` workflow (`.github/workflows/api-sync.yml`). Don't edit it by hand. Until the first sync PR merges, it doesn't exist.
- Every 6 hours the workflow fetches the live spec and compares it with the snapshot. When they differ, a Cursor CLI agent (`.github/prompts/api-sync.md`) updates `src/registry.ts`, the tests and the README. The workflow then writes the new snapshot, regenerates `commands.json` from the registry (`npm run commands:json`; the agent never edits it), and opens or updates a PR on `chore/api-sync`. A human reviews and merges it. Merging publishes a new `outboundsync` npm version.
- `npm run check:api-coverage` (`scripts/check-api-coverage.mjs`, run in CI) fails when an operation in the snapshot has no command, a command's route isn't in the snapshot, or a write command has no `--yes` confirmation. `test/contract.test.ts` checks the same routes against the built CLI.
