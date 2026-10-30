#!/bin/sh
# Fragt IMAP-Passwort und Supabase-Secret-Key interaktiv ab (nicht sichtbar beim Tippen,
# landet nicht in der Shell-History) und startet danach migrate-inbox.mjs damit. So muss
# niemand mehr den eigentlichen Befehl von Hand bearbeiten und versehentlich die Platzhalter
# durch echte Werte ersetzen — genau das hatte beim letzten Mal die Sonderzeichen im Passwort
# zum Problem gemacht (Shell-History-Expansion auf "!" innerhalb des eingetippten Befehls).
cd "$(dirname "$0")/.."

printf "IONOS IMAP-Passwort (info@amayer-holding.com): "
stty -echo
read IMAP_PASSWORD
stty echo
echo

printf "Supabase Secret Key: "
stty -echo
read SUPABASE_SERVICE_ROLE_KEY
stty echo
echo

IMAP_USER=info@amayer-holding.com \
SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co \
IMAP_PASSWORD="$IMAP_PASSWORD" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node scripts/migrate-inbox.mjs
