#!/bin/sh
# Einmalig ausführen: speichert Supabase Secret Key + Anthropic API Key lokal in .env.local,
# damit migrate-inbox.mjs und cleanup-inbox.mjs sie künftig automatisch laden (kein manuelles
# Eintippen mehr bei jedem Lauf). Werte landen NUR in dieser lokalen, gitignoreten Datei
# (siehe .gitignore: "*.local"), nie im Repo, nie in der Shell-History.
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

# Falls das Skript erneut läuft (z.B. nach Rotation eines Keys): alte Einträge für dieselben
# Variablen zuerst entfernen, statt sie zu duplizieren.
if [ -f .env.local ]; then
  grep -v '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | grep -v '^ANTHROPIC_API_KEY=' | grep -v '^SUPABASE_URL=' > .env.local.tmp
  mv .env.local.tmp .env.local
fi

{
  echo "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY"
  echo "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY"
  # Projekt-URL ist öffentlich (kein Secret), deshalb hier fest hinterlegt statt abgefragt.
  echo "SUPABASE_URL=https://qyqtxltwgetliddwceox.supabase.co"
} >> .env.local

echo "Gespeichert in .env.local. migrate-inbox.mjs und cleanup-inbox.mjs laden das jetzt automatisch."
