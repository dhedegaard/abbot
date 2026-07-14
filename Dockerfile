# check=skip=SecretsUsedInArgOrEnv,FromPlatformFlagConstDisallowed
# USER/PASSWORD are declared empty here and injected at runtime, not baked in.
# The amd64 platform is pinned on purpose; this image is amd64-only.

# Tag must match the puppeteer version in package.json, else npm ci downloads a
# second Chromium instead of reusing the image's pre-installed one.

# Typecheck stage: full deps + tsc, so a type error fails the build and a broken
# image never publishes. No browser needed here, so skip the Chromium download.
FROM --platform=linux/amd64 ghcr.io/puppeteer/puppeteer:25.1.0 AS typecheck
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD="true"
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run typecheck

# Runtime stage.
FROM --platform=linux/amd64 ghcr.io/puppeteer/puppeteer:25.1.0

WORKDIR /app

ENV USER="" \
  PASSWORD="" \
  HEADLESS="1" \
  OUTPUT_DIR=""

COPY package.json package-lock.json ./
# Runtime needs only prod deps; skip devDeps.
RUN npm ci --omit=dev

# Source comes from the typecheck stage, so the build depends on it — a type
# error fails the typecheck stage and this image is never produced.
COPY --from=typecheck /app/src ./src

# Matches OUTPUT_DIR / the compose bind-mount target where screenshots land.
VOLUME /output
CMD [ "node", "src/main.ts" ]
