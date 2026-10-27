#!/usr/bin/env bash
# Deploys main to the server by hand. Pushing to main does this by itself (GitHub Actions);
# use this to redeploy without a push. Run from your computer: npm run deploy
set -euo pipefail
SERVER="${DEPLOY_SERVER:-ubuntu@40.160.90.18}" # the IP: Cloudflare only proxies web traffic, not SSH
ssh "$SERVER" 'cd ~/hive-script && git pull --ff-only --quiet && scripts/server-deploy.sh'
