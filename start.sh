#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Check yt-dlp ────────────────────────────────────────────────────────────
YTDLP_FOUND=0
for candidate in yt-dlp /usr/local/bin/yt-dlp /opt/homebrew/bin/yt-dlp "$HOME/.local/bin/yt-dlp"; do
  if command -v "$candidate" &>/dev/null || { [[ "$candidate" == /* ]] && [[ -x "$candidate" ]]; }; then
    YTDLP_FOUND=1
    break
  fi
done

if [[ $YTDLP_FOUND -eq 0 ]]; then
  echo "yt-dlp nenalezeno — instaluji přes Homebrew…"
  if ! command -v brew &>/dev/null; then
    echo "Homebrew není nainstalováno. Nainstaluj ho z https://brew.sh a zkus to znovu."
    exit 1
  fi
  brew install yt-dlp
fi

# ── Install Python dependencies ─────────────────────────────────────────────
echo "Instaluji Python závislosti…"
pip install -q -r "$SCRIPT_DIR/server/requirements.txt"

# ── Start server ─────────────────────────────────────────────────────────────
echo ""
echo "  Server běží na http://localhost:3333"
echo "  Zastav ho pomocí Ctrl+C"
echo ""
cd "$SCRIPT_DIR/server"
uvicorn main:app --host 127.0.0.1 --port 3333
