#!/usr/bin/env bash
set -euo pipefail
cd "${1}"
export COMPOSE_PROJECT_NAME=sharkbowl
compose=(docker compose -f compose.yaml -f docker-compose.override.yml)
"${compose[@]}" config --quiet
"${compose[@]}" pull
"${compose[@]}" run --rm pocketbase migrate up --dir=/pb/pb_data --hooksDir=/pb/hooks --migrationsDir=/pb/migrations
"${compose[@]}" up -d --wait
