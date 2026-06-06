# check=skip=SecretsUsedInArgOrEnv,FromPlatformFlagConstDisallowed
# USER/PASSWORD are declared empty here and injected at runtime, not baked in.
# The amd64 platform is pinned on purpose; this image is amd64-only.

# Tag must match the puppeteer version in package.json, else npm ci downloads a
# second Chromium instead of reusing the image's pre-installed one.
FROM --platform=linux/amd64 ghcr.io/puppeteer/puppeteer:25.1.0

WORKDIR /app

ENV USER="" \
  PASSWORD="" \
  HEADLESS="1" \
  OUTPUT_DIR=""

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./

VOLUME /app/output
CMD [ "npx", "tsx", "src/main.ts" ]
