FROM node:22-slim AS client-deps
WORKDIR /app/app/client
COPY app/client/package.json app/client/package-lock.json* ./
RUN npm install

FROM oven/bun:1.2.17
WORKDIR /app

# Install server dependencies
COPY app/server/package.json app/server/bun.lock* app/server/
RUN cd app/server && bun install

# Copy client node_modules from Node stage
COPY --from=client-deps /app/app/client/node_modules app/client/node_modules

# Copy all source
COPY . .

# Install Node for running Vite dev server
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm && rm -rf /var/lib/apt/lists/*

EXPOSE 4001 5174

CMD ["sh", "-c", "cd /app/app/server && bun src/index.ts & cd /app/app/client && npx vite --host 0.0.0.0 --port 5174 & wait"]
