#!/usr/bin/env bash
set -euo pipefail
cd "${1}"
export COMPOSE_PROJECT_NAME=sharkbowl
compose=(docker compose -f compose.yaml -f compose.production.yaml)
if [[ -f .deploy.env ]]; then
  compose=(docker compose --env-file .env --env-file .deploy.env -f compose.yaml -f compose.production.yaml)
fi
"${compose[@]}" config --quiet
"${compose[@]}" build
"${compose[@]}" run --rm pocketbase /pb/pocketbase migrate up --dir=/pb/pb_data --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations
"${compose[@]}" up -d --wait
