// KI Trading Bot – Hintergrund-Empfänger für Push-Nachrichten
// Der Server klopft nur an; hier holen wir die neuen Nachrichten ab und zeigen sie an.
const SRV = new URL(self.location).searchParams.get("srv") || "";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

async function getLast() {
  try { const r = await (await caches.open("kibot")).match("last-shown"); return r ? +(await r.text()) : 0; } catch (_) { return 0; }
}
async function setLast(t) {
  try { await (await caches.open("kibot")).put("last-shown", new Response(String(t))); } catch (_) { /* egal */ }
}

self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let notes = [];
    try {
      const since = (await getLast()) || Date.now() - 15 * 60000;
      const r = await fetch(SRV + "/api/notes?since=" + since, { cache: "no-store" });
      notes = (await r.json()).notes || [];
    } catch (_) { /* unten Ersatz-Nachricht */ }
    if (!notes.length) {
      await self.registration.showNotification("KI Trading Bot", { body: "Neue Aktivität – tippe zum Ansehen.", tag: "kibot", icon: "icon-192.png" });
      return;
    }
    for (const n of notes.slice(-5)) {
      await self.registration.showNotification(n.title, { body: n.msg, tag: "kibot-" + n.t, icon: "icon-192.png" });
    }
    await setLast(notes[notes.length - 1].t);
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow("./"))));
});
