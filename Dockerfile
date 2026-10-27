# The game server for production: builds the pages, then serves them and the API on port 3001.
# Run it with docker-compose.prod.yml, behind Caddy.
FROM node:20-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 STATIC_DIR=dist
EXPOSE 3001
CMD ["npx", "tsx", "server/main.ts"]
