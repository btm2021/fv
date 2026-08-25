# ── STAGE 1: BUILD DEPENDENCIES (Compiles native sqlite3 bindings) ──
FROM node:20-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production || npm install --omit=dev

# ── STAGE 2: PURE NODEJS RUNTIME (Zero Python, Ultra-lightweight for 256MB RAM) ──
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Ensure persistent data directory exists
RUN mkdir -p /app/data

# Environment configuration optimized for 256MB Machine
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=192"

EXPOSE 3000

# Start 24/7 Quantum Trading Hub Server
CMD ["node", "server.js"]
