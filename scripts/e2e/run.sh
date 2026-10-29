#!/usr/bin/env bash
# Compila scripts/e2e/<nome>.ts e roda numa janela escondida do Electron.
# Uso: bash scripts/e2e/run.sh <nome> [porta do servidor local, padrão 8787] [limite em s, padrão 180]
# O servidor local precisa estar no ar: npx --prefix server wrangler dev --ip 127.0.0.1 --port <porta>
set -u
NAME="$1"
PORT="${2:-8787}"
LIMIT="${3:-180}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
E2E="$ROOT/scripts/e2e"
OUT="$E2E/out"
mkdir -p "$OUT"
cd "$ROOT"
npx esbuild "$E2E/$NAME.ts" --bundle --format=iife --target=es2022 --outfile="$OUT/$NAME.js" \
  --define:SERVER_URL="\"ws://127.0.0.1:$PORT\"" --define:__APP_VERSION__='"e2e"' --log-level=warning || exit 1
echo "<script src=\"$NAME.js\"></script>" > "$OUT/$NAME.html"
timeout $((LIMIT + 10)) node_modules/electron/dist/electron.exe --autoplay-policy=no-user-gesture-required \
  "$E2E/main.cjs" "$OUT/$NAME.html" "$OUT/$NAME.txt" $((LIMIT * 1000)) >/dev/null 2>&1
grep -v "Security\|unsafe-eval\|Policy set\|this app\|more information\|electronjs\|will not\|once the" "$OUT/$NAME.txt"
grep -q "^RESULT" "$OUT/$NAME.txt" && ! grep -q "FALHOU" "$OUT/$NAME.txt"
