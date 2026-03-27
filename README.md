# YT Downloader

Lokální nástroj pro stahování YouTube videí. Skládá se z Chrome rozšíření a FastAPI serveru, který používá `yt-dlp`.

---

## Požadavky

- macOS
- Python 3.9+
- [Homebrew](https://brew.sh) (pro automatickou instalaci `yt-dlp`)
- Chrome / Chromium

---

## Jak spustit server

### Varianta A — Docker (doporučeno, spustí se automaticky)

Vyžaduje [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up -d --build
```

Server poběží na pozadí a **automaticky se spustí při každém startu Docker Desktop**.
Docker Desktop nastav na spuštění při přihlášení: *Settings → General → Start Docker Desktop when you sign in*.

Zastavení:
```bash
docker compose down
```

Aktualizace yt-dlp (přebuildi image):
```bash
docker compose build --no-cache && docker compose up -d
```

### Varianta B — lokálně přes start.sh

```bash
./start.sh
```

Skript automaticky:
1. Zkontroluje, zda je nainstalováno `yt-dlp` — pokud ne, nainstaluje ho přes `brew install yt-dlp`
2. Nainstaluje Python závislosti (`fastapi`, `uvicorn`)
3. Spustí server na `http://localhost:3333`

Server zastav pomocí **Ctrl+C**.

---

## Jak načíst rozšíření v Chromu

1. Otevři Chrome a jdi na `chrome://extensions`
2. Zapni **Developer mode** (přepínač vpravo nahoře)
3. Klikni na **Load unpacked**
4. Vyber složku `extension/` z tohoto projektu
5. Rozšíření se objeví v liště prohlížeče

> Rozšíření funguje **pouze na stránkách** `youtube.com/watch?v=…`

---

## Použití

1. Spusť server přes `./start.sh`
2. Otevři libovolné YouTube video
3. Klikni na ikonu rozšíření v liště
4. Zvol **↓ MP4** nebo **♪ MP3**
5. Soubor se uloží do `~/Downloads`

---

## Troubleshooting

### „Server neběží — spusť start.sh"
Server není spuštěný. Otevři terminál v složce projektu a spusť `./start.sh`.

### „yt-dlp nenalezeno"
`yt-dlp` není v systému. Nainstaluj ho ručně:
```bash
brew install yt-dlp
```
nebo přes pip:
```bash
pip install yt-dlp
```
Poté restartuj server.

### Port je již obsazený
Pokud `3333` používá jiný proces:
```bash
lsof -i :3333          # zjisti, co port blokuje
kill -9 <PID>          # ukonči proces
./start.sh             # spusť znovu
```

### CORS chyba v konzoli rozšíření
Server musí být spuštěný **před** otevřením popupu. Restartuj server a obnov stránku.

### Stahování trvá dlouho
`yt-dlp` nejprve stahuje video i audio odděleně a pak je slučuje (pro MP4 ve vysoké kvalitě). Popup nech otevřený, nebo zkontroluj `~/Downloads` — soubor se ukládá průběžně.
