# Optimized Production Dockerfile for Fly.io Deployment
FROM node:20-bookworm-slim AS base

# Install build dependencies for native modules (sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci --only=production || npm install --omit=dev

# Copy application files
COPY . .

# Create data directory for persistent volume mount
RUN mkdir -p /app/data

# Environment configuration
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Start 24/7 Quantum Trading Hub Server
CMD ["node", "server.js"]
