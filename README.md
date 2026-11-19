# KI Trading Bot

Paper-Trading-Bot: handelt mit **Spielgeld** auf Basis echter Krypto-Kurse und zeigt Depotwert, Gewinn/Verlust, Positionen und jede Entscheidung mit Begründung. Es werden keine echten Orders ausgeführt.

- **App:** https://h-shyp.github.io/ki-trading-bot/
- **Server-Bot** (läuft rund um die Uhr, jede Minute): `server/main.js` für Deno Deploy

## Server-Bot einrichten (Deno Deploy, kostenlos)

1. Auf https://console.deno.com mit GitHub anmelden, Organisation anlegen.
2. Neue App aus diesem Repository erstellen – Einstiegsdatei: `server/main.js`, kein Framework, kein Build-Befehl.
3. Unter *Databases* eine **Deno KV**-Datenbank anlegen und der App zuweisen.
4. Umgebungsvariablen setzen:
   - `NTFY_TOPIC` – geheimer Kanalname für Handy-Nachrichten (App „ntfy“)
   - `BOT_KEY` – geheimer Schlüssel, mit dem die App den Bot steuern darf
5. Die Adresse der App (`….deno.net`) und den `BOT_KEY` in der Web-App unter **Einstellungen → Server-Bot** eintragen.

Schnittstellen: `GET /api/state` (Stand, öffentlich lesbar) · `POST /api/action` (Steuerung, nur mit `BOT_KEY`).
