# abbot

Automatically declines pending housing offers on the Danish housing portal [aarhusbolig.dk](https://aarhusbolig.dk).

## What it does

`abbot` logs into your aarhusbolig.dk account with Puppeteer and declines every pending housing offer, so you don't have to click through them by hand. It is a single one-shot script (`src/main.ts`) — run it whenever you want your pending offers cleared.

## Prerequisites

- [Node.js](https://nodejs.org) 24 and npm, **or**
- Docker (no local Node needed)

## Configuration

Set the following environment variables:

| Variable     | Required | Description                                                   |
| ------------ | -------- | ------------------------------------------------------------- |
| `USER`       | yes      | Medlemsnummer / e-mail used to log in                         |
| `PASSWORD`   | yes      | Account password                                              |
| `HEADLESS`   | yes      | `1` to run headless, `0` to show the browser (stays open 20s) |
| `OUTPUT_DIR` | no       | Directory for success/error screenshots                       |

For local development these are loaded from `.envrc` via [direnv](https://direnv.net).

## Running

With Node:

```bash
npm install
npm start
```

With Docker:

```bash
docker compose up --build
```

A prebuilt image is also published to `ghcr.io/dhedegaard/abbot:main`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
```

The same checks (format, typecheck, lint) run in CI on every push and pull request.
