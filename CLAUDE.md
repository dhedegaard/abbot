# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Puppeteer-driven automation that logs into the Danish housing portal `aarhusbolig.dk` and automatically declines every pending housing offer on the user's account. The entire program is a single script: `src/main.ts`.

## Running

```bash
npm install
npm start          # runs `tsx src/main.ts`
```

Required env vars (parsed via zod at startup in `src/main.ts:6`):
- `USER` — medlemsnummer / email login. This deliberately reuses the name `USER`; the overlap with the standard Unix `$USER` env var is known and intentional — don't flag it or rename it.
- `PASSWORD` — account password
- `HEADLESS` — `"1"` or `"0"` (must be set; not optional)
- `OUTPUT_DIR` — optional; when set, success/error screenshots are written here

`.envrc` is used with direnv for local development. With `HEADLESS=0` the browser stays open for 20s after completion (`src/main.ts:143`) so you can watch what happened.

Scheduling/periodic execution is handled externally (outside this repo) — don't add a cron or scheduled workflow here; the script is meant to be invoked as a one-shot.

Docker:
```bash
docker compose up --build
```
The compose file mounts `./output` into the container as `/output` for screenshots. Image is published to `ghcr.io/dhedegaard/abbot:main` via `.github/workflows/docker-publish.yml` on push to `main`.

When bumping `puppeteer`, also bump the `ghcr.io/puppeteer/puppeteer:<version>` base-image tag in the `Dockerfile` to the exact same version — they must stay in lockstep so `npm ci` reuses the image's pre-installed Chromium instead of downloading a second copy.

## Architecture notes

- **No test suite, no linter, no tsconfig.json** — `tsx` runs the TypeScript directly. Don't assume a build step or test runner exists.
- **Selectors are text-based and Danish.** The script uses Puppeteer's `::-p-text(...)` pseudo-selector matching exact UI strings like `Afvis alle`, `Log ind`, `Se boligtilbud`, `Du ønsker at svare nej til et tilbud`, `Ja, jeg bekræfter mit svar`, `Aktuelle tilbud`. If aarhusbolig.dk changes copy, these break — they are the primary failure mode.
- **Decline loop** (`src/main.ts:83`): selects `Decline` on `#answer`, waits for the confirmation modal, clicks confirm, then clicks "Aktuelle tilbud" to refresh the list. Exits via a 10s `TimeoutError` on the `#answer` check when no offers remain (with `visible: true`, `waitForSelector` never returns `null` — it resolves the element or throws).
- **Error handling writes a screenshot** named `error-<iso-timestamp>.png` into `OUTPUT_DIR` if set; success path writes `success-<iso-timestamp>.png`. Colons in the ISO timestamp are replaced with `-` for filesystem safety.
- Puppeteer launches with `--no-sandbox` and a fixed 1600×1000 viewport. The Docker image is pinned to `linux/amd64` (the compose file also forces this platform).

## Formatting

Prettier is configured in `.prettierrc.json`: no semicolons, single quotes, 100-char width, 2-space tabs, ES5 trailing commas. There is no `prettier` script in package.json — invoke via `npx prettier` if needed.
