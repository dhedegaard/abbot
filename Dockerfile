FROM --platform=linux/amd64 ghcr.io/puppeteer/puppeteer:23

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
