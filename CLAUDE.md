# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Puppeteer-driven automation that logs into the Danish housing portal `aarhusbolig.dk` and automatically declines every pending housing offer on the user's account. The entire program is a single script: `src/main.ts`.

## Running

```bash
npm install
npm start          # runs `tsx src/main.ts`
```

Required env vars (parsed via the zod `ENV` schema at the top of `src/main.ts`):

- `USER` — medlemsnummer / email login. This deliberately reuses the name `USER`; the overlap with the standard Unix `$USER` env var is known and intentional — don't flag it or rename it.
- `PASSWORD` — account password
- `HEADLESS` — `"1"` or `"0"` (must be set; not optional)
- `OUTPUT_DIR` — optional; when set, success/error screenshots are written here
- `SENTRY_DSN` — optional; when set, errors are reported to Sentry via `@sentry/node`. Unset = SDK stays disabled, so reporting is opt-in.

`.envrc` is used with direnv for local development. With `HEADLESS=0` the browser stays open for 20s after completion (in `main()`'s `finally` block) so you can watch what happened.

**Verifying decline-loop changes needs a real pending offer.** With none, `npm start` logs in, hits an empty list, prints `No offers to decline, quitting!` and exits _before_ the confirm/refresh code runs — so a clean run on an empty account exercises none of the decline loop. CI only lints/type-checks; it never drives the browser.

Scheduling/periodic execution is handled externally (outside this repo) — don't add a cron or scheduled workflow here; the script is meant to be invoked as a one-shot.

Docker:

```bash
docker compose up --build
```

The compose file mounts `./output` into the container as `/output` for screenshots. Image is published to `ghcr.io/dhedegaard/abbot:main` via `.github/workflows/docker-publish.yml` on push to `main`.

When bumping `puppeteer`, also bump the `ghcr.io/puppeteer/puppeteer:<version>` base-image tag in the `Dockerfile` to the exact same version — they must stay in lockstep so `npm ci` reuses the image's pre-installed Chromium instead of downloading a second copy.

## Architecture notes

- **No test suite, no build step** — `tsx` runs the TypeScript directly; `tsconfig.json` exists only for type-checking (`npm run typecheck`, i.e. `tsc --noEmit`), not for emitting. It extends `@tsconfig/node22` + `@tsconfig/strictest`. Don't assume a bundler or test runner exists.
- **`findVisible(page, selector, description)`** is the shared helper for every UI interaction: it waits for a `visible: true` element and, on the resulting `TimeoutError`, rethrows a readable `Could not find <description> (selector: <selector>)` (original error kept as `cause`). Prefer it over raw `waitForSelector` so a broken Danish selector names the failing step instead of producing an opaque timeout. The one deliberate exception is the decline loop's `#answer` probe, which needs a short custom timeout and treats the `TimeoutError` as a normal "no offers left" exit.
- **Selectors are text-based and Danish.** The script uses Puppeteer's `::-p-text(...)` pseudo-selector matching exact UI strings like `Afvis alle`, `Log ind`, `Se boligtilbud`, `Ugyldigt login`, `Du ønsker at svare nej til et tilbud`, `Ja, jeg bekræfter mit svar`, `Aktuelle tilbud`. If aarhusbolig.dk changes copy, these break — they are the primary failure mode.
- **Login verification** (end of `doLoginFlow`): after submitting the form it races two signals — `Se boligtilbud` (the offers link, shown only on success) against `Ugyldigt login` (the modal error on bad credentials) — and throws a clear invalid-credentials error if the latter wins, instead of timing out 30s later on the missing offers link. Do **not** key failure off `Adgang nægtet`: that is the resting state of the unauthenticated page (present before login too), not a failure signal. On success `doLoginFlow` returns the offers-link handle for `main()` to click.
- **Angular clicks are flaky.** aarhusbolig is an AngularJS SPA and clicks sometimes land before the handler is bound, silently doing nothing. Any click that matters must be verified against an observable effect and retried. `clickAwaitingRequest` is the shared helper for this: it re-clicks until the expected `POST` is _sent_ (keying off the request, not its response, so a slow round-trip can't look swallowed and double-submit a state-changing call), then awaits that request's response and throws on a non-2xx. It backs both the confirm-decline click (`AnswerOffer`) and the refresh click (`GetOffers`). The offers-link click is verified separately, against the URL changing to the offers page (otherwise the run would falsely end as "no offers").
- **Decline loop** (the `for` loop in `main()`): selects `Decline` on `#answer`, waits for the confirmation modal, clicks confirm, then clicks "Aktuelle tilbud" to refresh the list. Both the confirm and refresh clicks go through `clickAwaitingRequest` (see above): confirm is confirmed by `POST /Umbraco/api/Offer/AnswerOffer`, refresh by `POST /Umbraco/api/Offer/GetOffers` (clicking the already-active tab still fires it — verified against the live site). Don't key off `/MyOffers/GetMyOffers`: that endpoint only fires on the min-side dashboard, never on the offers page — waiting for it is what originally made healthy runs time out. After the refetch, the declined offer's node detaching is checked best-effort (logged, not fatal). Exits via a 10s `TimeoutError` on the `#answer` check when no offers remain (with `visible: true`, `waitForSelector` never returns `null` — it resolves the element or throws). The loop is capped at 50 iterations as a runaway guard. `select('Decline')` is checked against its returned matches and throws loudly if the option is gone (it would otherwise silently no-op and stall on a confirm modal that never opens).
- **Error handling writes a screenshot** named `error-<iso-timestamp>.png` into `OUTPUT_DIR` if set; success path writes `success-<iso-timestamp>.png`. Colons in the ISO timestamp are replaced with `-` for filesystem safety.
- **Sentry error reporting** (`@sentry/node`, initialized once at the top of `src/main.ts`): `Sentry.captureException` is called both in `main()`'s catch and the top-level `.catch` (the latter covers `launch()`, which runs before the try). Because this is a short-lived one-shot, `await Sentry.flush(5_000)` runs after `main()` so buffered events actually send before the process exits. `sendDefaultPii` is off — the script handles login credentials. With no `SENTRY_DSN` the SDK is a no-op.
- Puppeteer launches with `--no-sandbox` and a fixed 1600×1000 viewport. The Docker image is pinned to `linux/amd64` (the compose file also forces this platform).

## Formatting & linting

Prettier is configured in `.prettierrc.json`: no semicolons, single quotes, 100-char width, 2-space tabs, ES5 trailing commas. Run `npm run format` to write, `npm run format:check` to verify.

`format:check` runs `prettier --check .` over the whole repo — Markdown/YAML too, not just `src`. Run `npm run format` before committing doc-only edits (e.g. `*x*` → `_x_` in CLAUDE.md), or CI can go red on formatting alone.

ESLint uses a flat config (`eslint.config.mjs`) with typescript-eslint's type-aware `recommendedTypeChecked` preset (scoped to `src/**/*.ts`; `eslint-config-prettier` disables formatting rules). Run `npm run lint` (or `lint:fix`).

## CI

`.github/workflows/ci.yml` runs `npm run format:check`, `npm run typecheck`, and `npm run lint` on every push to `main` and on PRs (with `PUPPETEER_SKIP_DOWNLOAD=true` so it skips the Chromium download). Keep them green.
