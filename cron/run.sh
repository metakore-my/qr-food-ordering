#!/bin/sh
set -e

echo "[INFO] Starting cleanup cron job"
curl -sf -X POST "${APP_URL}/api/cron/cleanup" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json"
echo ""
echo "[INFO] Cleanup cron job completed"
