# KI Trading Bot

Paper-Trading-Bot: handelt mit **Spielgeld** auf Basis echter Krypto-Kurse und zeigt Depotwert, Gewinn/Verlust, Positionen und jede Entscheidung mit Begründung. Es werden keine echten Orders ausgeführt.

- **App:** https://h-shyp.github.io/ki-trading-bot/
- **Server-Bot** (läuft rund um die Uhr, jede Minute): Cloudflare Worker in `server/`

## Server-Bot einrichten (Cloudflare Workers, kostenlos)

1. Bei Cloudflare unter *Workers & Pages* → *Erstellen* → *Repository importieren* dieses GitHub-Projekt wählen. Die Einstellungen stehen in `wrangler.jsonc` (Zeitplan jede Minute, Speicher als Durable Object).
2. Im Worker unter *Einstellungen → Variablen und Geheimnisse* zwei **Geheimnisse** anlegen:
   - `NTFY_TOPIC` – geheimer Kanalname für Handy-Nachrichten (App „ntfy“)
   - `BOT_KEY` – geheimer Schlüssel, mit dem die App den Bot steuern darf
3. Die Adresse des Workers (`….workers.dev`) und den `BOT_KEY` in der Web-App unter **Einstellungen → Server-Bot** eintragen.

Schnittstellen: `GET /api/state` (Stand, öffentlich lesbar) · `POST /api/action` (Steuerung, nur mit `BOT_KEY`).
Code: `server/core.js` (Bot-Logik) · `server/worker.js` (Cloudflare-Anbindung).
