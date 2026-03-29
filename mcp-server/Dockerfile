# mcp-chess Stockfish Engine Container
#
# Runs a lightweight HTTP-to-UCI bridge (engine-server/server.js) around the
# native Stockfish binary so the MCP Node server can reach it over HTTP.
#
# Build:  docker build -t mcp-chess-stockfish .
# Run:    docker run -d -p 8090:8090 --name stockfish mcp-chess-stockfish
#
# Env vars (all optional):
#   STOCKFISH_THREADS  — CPU threads for Stockfish (default: 4)
#   STOCKFISH_HASH     — Hash table size in MB    (default: 256)
#   STOCKFISH_PORT     — HTTP port                (default: 8090)
#   STOCKFISH_TIMEOUT  — Per-request timeout ms   (default: 30000)

# ---- Stage 1: install engine-server dependencies ----
FROM node:20-bookworm-slim AS deps

WORKDIR /app
COPY engine-server/package.json ./
RUN npm install --omit=dev --no-fund --no-audit

# ---- Stage 2: runtime ----
FROM node:20-bookworm-slim AS runtime

# Install Stockfish from Debian repos and symlink to /usr/local/bin
RUN apt-get update && \
    apt-get install -y --no-install-recommends stockfish && \
    ln -sf /usr/games/stockfish /usr/local/bin/stockfish && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY engine-server/server.js ./

ENV STOCKFISH_PATH=/usr/local/bin/stockfish \
    STOCKFISH_THREADS=4 \
    STOCKFISH_HASH=256 \
    STOCKFISH_PORT=8090 \
    STOCKFISH_TIMEOUT=30000

EXPOSE 8090

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8090/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{const b=JSON.parse(d);process.exit(b.status==='ready'?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
