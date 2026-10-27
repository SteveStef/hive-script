#!/usr/bin/env bash
# Deploys the latest main to the server: pull, rebuild, restart, then check the site answers.
# Run from your computer: npm run deploy (push main to GitHub first).
set -euo pipefail
SERVER="${DEPLOY_SERVER:-ubuntu@40.160.90.18}" # the IP: Cloudflare only proxies web traffic, not SSH
SITE="${DEPLOY_SITE:-bee.stevestef.com}"

ssh "$SERVER" 'set -euo pipefail
  cd ~/hive-script
  git pull --ff-only
  docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
  docker image prune -f >/dev/null'

echo "Waiting for https://$SITE ..."
for _ in $(seq 1 30); do
  # /api/me answers 401 to a visitor who isn't signed in: that means the game server is up
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$SITE/api/me" || true)
  if [ "$code" = "401" ] || [ "$code" = "200" ]; then echo "Live."; exit 0; fi
  sleep 2
done
echo "The site didn't answer in time. Logs: ssh $SERVER 'cd ~/hive-script && docker compose -f docker-compose.prod.yml logs --tail 50 app'" >&2
exit 1
