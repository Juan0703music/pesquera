# syntax=docker/dockerfile:1
# Marea — imagen de producción (Railway la construye sola al encontrar este archivo).
# Guía: docs/produccion.md

# ─── Dependencias completas y compilación ───
FROM node:24-bookworm-slim AS build
# Prisma (migraciones) necesita OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `postinstall` ejecuta `prisma generate`.
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# ─── Ejecución ───
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/prisma.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY public ./public
USER node
EXPOSE 3100
# Antes de arrancar se aplican las migraciones pendientes. Si una falla, el contenedor no arranca,
# la verificación de salud no pasa y Railway deja funcionando la versión anterior.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
