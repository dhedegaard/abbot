# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

Puppeteer automation that logs into the Danish housing portal `aarhusbolig.dk` and declines every pending housing offer on the account. Three small modules under `src/`: `main.ts` (orchestration — login flow, decline loop, error/screenshot handling), `env.ts` (the zod `ENV` schema + parsed `env`), and `puppeteer-helpers.ts` (the generic `findVisible` / `clickAwaitingRequest` helpers).

## Running

```bash
npm install
npm start          # runs `tsx src/main.ts`
```

Env vars (parsed via the zod `ENV` schema in `src/env.ts`):

- `USER` — medlemsnummer / email login. Reusing the name `USER` (and its overlap with Unix `$USER`) is intentional — don't flag or rename it.
- `PASSWORD` — account password.
- `HEADLESS` — `"1"` or `"0"` (required, not optional).
- `OUTPUT_DIR` — optional; success/error screenshots are written here when set.
- `SENTRY_DSN` — optional; errors report to Sentry (`@sentry/node`) when set. Unset = SDK disabled, so reporting is opt-in.

`.envrc` + direnv for local dev. With `HEADLESS=0` the browser stays open 20s after completion (`main()`'s `finally`) so you can watch.

**Running `npm start` is a live, irreversible action** — it uses the real `.envrc` credentials against the production account and declines every pending offer for real. There is no dry-run/sandbox mode. Safe to run to verify wiring when the account is empty (exits at `No offers to decline`); if offers are pending it _will_ decline them. For a quick headless verification that skips the 20s watch window, `HEADLESS=1 npm start`.

**Verifying decline-loop changes needs a real pending offer.** With none, `npm start` exits at `No offers to decline, quitting!` before the confirm/refresh code runs — a clean run on an empty account exercises none of it. CI only lints/type-checks; it never drives the browser.

Scheduling is external — don't add a cron or scheduled workflow here; the script is a one-shot.

Docker:

```bash
docker compose up --build
```

Compose mounts `./output` → `/output` for screenshots. Image publishes to `ghcr.io/dhedegaard/abbot:main` via `.github/workflows/docker-publish.yml` on push to `main`.

When bumping `puppeteer`, bump the `ghcr.io/puppeteer/puppeteer:<version>` base tag in the `Dockerfile` to the exact same version — they must stay in lockstep so `npm ci` reuses the image's Chromium instead of downloading a second copy.

## Architecture notes

- **No test suite, no build step.** `tsx` runs the TypeScript directly; `tsconfig.json` is type-check only (`npm run typecheck` = `tsc --noEmit`), extending `@tsconfig/node24` + `@tsconfig/strictest`. No bundler or test runner exists. `moduleResolution` is `nodenext`, so relative imports use `.js` specifiers that resolve to the `.ts` files (`./env.js`, `./puppeteer-helpers.js`).
- **`src/env.ts` conventions** — `import * as z from 'zod'` (namespace import, preferred for tree-shaking; don't rewrite to `import { z }`). The env shape is an `interface ENV extends z.infer<typeof ENV> {}`; `@typescript-eslint/no-empty-object-type` is turned `off` in `eslint.config.mjs` so this empty-interface form is allowed. `ENV.parse` passes `{ reportInput: true }`.
- **`findVisible(page, selector, description)`** (`src/puppeteer-helpers.ts`) — shared helper for every UI interaction: waits for a `visible: true` element, and on `TimeoutError` rethrows a readable `Could not find <description> (selector: <selector>)` (original kept as `cause`). Prefer it over raw `waitForSelector` so a broken Danish selector names the failing step. Sole exception: the decline loop's `#answer` probe uses a short custom timeout and treats `TimeoutError` as the normal "no offers left" exit.
- **Selectors are text-based and Danish** — Puppeteer's `::-p-text(...)` matching exact UI strings (`Afvis alle`, `Log ind`, `Se boligtilbud`, `Ugyldigt login`, `Du ønsker at svare nej til et tilbud`, `Ja, jeg bekræfter mit svar`, `Aktuelle tilbud`). If aarhusbolig.dk changes copy these break — the primary failure mode.
- **Login verification** (end of `doLoginFlow`): after submit, races `Se boligtilbud` (offers link, success-only) against `Ugyldigt login` (bad-credentials modal), throwing a clear invalid-credentials error if the latter wins instead of timing out 30s later on the missing offers link. Don't key failure off `Adgang nægtet` — that's the unauthenticated page's resting state (present before login too), not a failure signal. On success returns the offers-link handle for `main()`.
- **Angular clicks are flaky** — clicks sometimes land before the handler is bound and silently do nothing, so any click that matters is verified against an observable effect and retried. `clickAwaitingRequest` (`src/puppeteer-helpers.ts`) is the shared helper: it re-clicks until the expected `POST` is _sent_ (keying off the request, not its response, so a slow round-trip can't look swallowed and double-submit a state-changing call), then awaits the response and throws on a non-2xx. It backs the confirm-decline click (`AnswerOffer`) and the refresh click (`GetOffers`). The offers-link click is verified separately, against the URL changing to the offers page (else the run would falsely end as "no offers").
- **Decline loop** (the `for` loop in `main()`):
  - Selects `Decline` on `#answer`, waits for the confirm modal, clicks confirm, then clicks "Aktuelle tilbud" to refresh. Confirm and refresh both go through `clickAwaitingRequest`: confirm → `POST /Umbraco/api/Offer/AnswerOffer`, refresh → `POST /Umbraco/api/Offer/GetOffers` (clicking the already-active tab still fires it — verified live).
  - Don't key off `/MyOffers/GetMyOffers` — it only fires on the min-side dashboard, never the offers page; waiting for it is what originally made healthy runs time out.
  - After the refetch, the declined node detaching is checked best-effort (logged, not fatal).
  - Exits via a 10s `TimeoutError` on the `#answer` check when no offers remain (`visible: true` → `waitForSelector` resolves the element or throws, never `null`). Capped at 50 iterations as a runaway guard.
  - `select('Decline')` is checked against its returned matches and throws loudly if the option is gone (else it silently no-ops and stalls on a confirm modal that never opens).
- **Error handling** writes `error-<iso-timestamp>.png` to `OUTPUT_DIR` if set (success path: `success-<iso-timestamp>.png`); colons in the ISO stamp become `-` for filesystem safety.
- **Sentry** (`@sentry/node`, init once atop `src/main.ts`): `captureException` runs in `main()`'s catch and the top-level `.catch` (the latter covers `launch()`, before the try). Being a short-lived one-shot, `await Sentry.flush(5_000)` runs after `main()` so buffered events send before exit. `sendDefaultPii` is off (login credentials). No `SENTRY_DSN` = no-op.
- **Launch:** `--no-sandbox`, fixed 1600×1000 viewport. Docker image pinned to `linux/amd64` (compose forces the platform too).

## Formatting & linting

Prettier (`.prettierrc.json`): no semicolons, single quotes, 100-char width, 2-space tabs, ES5 trailing commas. `npm run format` writes, `npm run format:check` verifies.

`format:check` runs `prettier --check .` over the whole repo (Markdown/YAML too, not just `src`) — run `npm run format` before committing doc-only edits (e.g. `*x*` → `_x_`), or CI goes red on formatting alone.

ESLint (`eslint.config.mjs`, flat config): typescript-eslint `recommendedTypeChecked`, scoped to `src/**/*.ts`; `eslint-config-prettier` disables formatting rules. `npm run lint` (or `lint:fix`).

## CI

`.github/workflows/ci.yml` runs `format:check`, `typecheck`, `lint` on every push to `main` and on PRs (`PUPPETEER_SKIP_DOWNLOAD=true` skips the Chromium download). Keep green.
