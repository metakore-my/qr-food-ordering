#!/bin/sh
set -e

# Config-file guard: this script is the CMD of Dockerfile.cron, which sets
# CRON_RUNNER=1. If the cron SERVICE was built from the APP build config (the app
# Dockerfile) because the cron service's config-file path wasn't applied, this env
# var is absent and we abort immediately with a clear error — instead of the
# misleading "healthcheck never became healthy" timeout that the app image produces
# on a container with no HTTP server. Stricter-by-construction: the cron Dockerfile
# is the ONLY thing that sets this sentinel.
if [ "${CRON_RUNNER}" != "1" ]; then
  echo "[FATAL] CRON_RUNNER not set — this container was NOT built from"
  echo "        Dockerfile.cron. The cron service's build config-file path is wrong"
  echo "        (it built the app instead). Point it at the cron config file and"
  echo "        redeploy. Refusing to run."
  exit 1
fi

echo "[INFO] Starting cleanup cron job"

# POST to the cleanup endpoint and capture the HTTP status separately from the body.
# Hardening against a silent no-op (the failure this guards against):
#   -L            follow redirects, so an http:// APP_URL that 301s to https still
#                 reaches the endpoint instead of curl treating the 301 as "done".
#   -w http_code  we then REQUIRE a 200; any 3xx/4xx/5xx fails the job loudly.
# A bare `curl -sf` (no -L) silently succeeded on the 301 redirect — exit 0, body
# empty, cleanup never ran — so "completed" was logged while nothing was deleted.
# Do NOT drop the explicit status check or the -L.
HTTP_CODE=$(curl -sS -L -X POST "${APP_URL}/api/cron/cleanup" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -o /tmp/cleanup-response.json \
  -w "%{http_code}")

echo "[INFO] Cleanup endpoint returned HTTP ${HTTP_CODE}"
cat /tmp/cleanup-response.json 2>/dev/null || true
echo ""

if [ "${HTTP_CODE}" != "200" ]; then
  echo "[ERROR] Cleanup did NOT succeed (expected HTTP 200, got ${HTTP_CODE}) — failing the job"
  exit 1
fi

echo "[INFO] Cleanup cron job completed"
