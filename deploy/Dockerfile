# ============================================================================
# Tau ERP — Docker image (multi-stage, production standalone build)
# Build:  docker build -f deploy/Dockerfile -t tau-erp .
# Run:    see deploy/docker-compose.yml
# ============================================================================

# ---------- Stage 1: dependencies ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# ---------- Stage 2: build ----------
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN bunx prisma generate && bun run build

# ---------- Stage 3: runtime ----------
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=Asia/Kolkata
ENV NEXT_TELEMETRY_DISABLED=1

# standalone bundle already contains server.js + trimmed node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/db ./db

# SQLite lives on a volume so data survives container replacement
VOLUME ["/app/db"]

EXPOSE 3000
USER bun
CMD ["bun", "server.js"]
