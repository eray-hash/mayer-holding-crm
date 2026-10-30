#!/bin/sh
# Fragt Supabase-Secret-Key und Anthropic-API-Key interaktiv ab (nicht sichtbar beim Tippen,
# landet nicht in der Shell-History) und startet danach cleanup-inbox.mjs damit — aus demselben
# Grund wie bei run-migration.sh (siehe dort).
#
# Standardmäßig DRY RUN (zeigt nur, was gelöscht würde, siehe scripts/cleanup-inbox-report.json).
# Erst mit "CONFIRM_DELETE=yes sh scripts/run-cleanup.sh" wird tatsächlich gelöscht.
cd "$(dirname "$0")/.."

printf "Supabase Secret Key: "
stty -echo
read SUPABASE_SERVICE_ROLE_KEY
stty echo
echo

printf "Anthropic API Key: "
stty -echo
read ANTHROPIC_API_KEY
stty echo
echo

SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
CONFIRM_DELETE="${CONFIRM_DELETE:-}" \
node scripts/cleanup-inbox.mjs
