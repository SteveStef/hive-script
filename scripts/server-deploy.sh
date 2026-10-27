#!/usr/bin/env bash
# Runs on the server: pulls main, rebuilds and restarts the game, then checks it answers.
# GitHub Actions runs it after every push to main (with a key that can run nothing else),
# and npm run deploy runs it from your computer.

# Everything is in a function, so a pull that changes this file can't confuse the copy that's running.
main() {
  set -euo pipefail
  cd ~/hive-script
  exec 9>/tmp/hive-deploy.lock
  flock 9 # one deploy at a time
  git pull --ff-only --quiet
  echo "Deploying $(git log -1 --format='%h %s')"
  local compose=(docker compose -f docker-compose.prod.yml --env-file .env.production)
  "${compose[@]}" up -d --build --quiet-pull
  docker image prune -f >/dev/null
  local site
  site=$(grep '^SITE=' .env.production | cut -d= -f2)
  for _ in $(seq 1 30); do
    # /api/me answers 401 to a visitor who isn't signed in: that means the game server is up
    local code
    code=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$site:443:127.0.0.1" "https://$site/api/me" || true)
    if [ "$code" = 401 ] || [ "$code" = 200 ]; then
      echo "Live at https://$site"
      return 0
    fi
    sleep 2
  done
  echo "The game didn't come back up. Its latest logs:" >&2
  "${compose[@]}" logs --tail 40 app >&2
  return 1
}
main "$@"
