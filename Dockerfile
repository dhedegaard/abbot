FROM --platform=linux/amd64 ghcr.io/puppeteer/puppeteer:23

WORKDIR /app
ENV USER="" \
  PASSWORD="" \
  HEADLESS="1"

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
CMD [ "npx", "tsx", "src/main.ts" ]
