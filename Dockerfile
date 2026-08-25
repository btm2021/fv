# ── PRODUCTION DOCKERFILE FOR FLY.IO (256MB RAM, PURE NODEJS RUNTIME) ──
FROM node:20-bookworm-slim

WORKDIR /app

# 1. Install build tools for native compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 2. Copy package definitions
COPY package*.json ./

# 3. Force compile native sqlite3 from source against container's exact GLIBC version
RUN npm install --omit=dev --build-from-source=sqlite3

# 4. Purge compiler tools (removes Python & C++ compilers, leaving pure Node.js)
RUN apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /root/.npm /root/.node-gyp

# 5. Copy project files
COPY . .

# 6. Ensure persistent volume directory exists
RUN mkdir -p /app/data

# 7. Environment configuration optimized for 256MB Machine
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=192"

EXPOSE 3000

# Start 24/7 Quantum Trading Hub Server
CMD ["node", "server.js"]
