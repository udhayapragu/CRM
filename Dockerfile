# Production image for Luxe CRM (web + worker share the same image)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 1001 luxe && mkdir -p /app/uploads && chown luxe /app/uploads
COPY --from=build --chown=luxe /app ./
USER luxe
EXPOSE 3000
# Apply pending migrations, then start the web server
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
