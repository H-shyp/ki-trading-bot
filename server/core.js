// KI Trading Bot – Bot-Logik (plattformunabhängig)
// Paper-Trading mit Spielgeld auf Basis echter Krypto-Kurse.
//
// Geheime Variablen (im Cloudflare-Dashboard eintragen):
//   NTFY_TOPIC  – Kanalname für Handy-Nachrichten über die App „ntfy“
//   BOT_KEY     – Schlüssel, mit dem die Web-App den Bot steuern darf
//
// io = { env(name), getMany([...keys]) -> {key: value}, putMany({key: value}) }
export function makeBot(io) {
const env = (k) => String(io.env(k) || "").trim();

/* ================= Einstellungen ================= */
const SYMS_DEF = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "LINK", "DOT", "LTC", "TRX",
  "POL", "SHIB", "ATOM", "NEAR", "UNI", "ARB", "OP", "SUI", "PEPE", "APT", "INJ", "FIL"];
const CG = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin",
  AVAX: "avalanche-2", LINK: "chainlink", DOT: "polkadot", LTC: "litecoin", TRX: "tron", POL: "polygon-ecosystem-token",
  SHIB: "shiba-inu", ATOM: "cosmos", NEAR: "near", UNI: "uniswap", ARB: "arbitrum", OP: "optimism", SUI: "sui", PEPE: "pepe",
  APT: "aptos", INJ: "injective-protocol", FIL: "filecoin", TON: "the-open-network", XLM: "stellar", BCH: "bitcoin-cash",
  ETC: "ethereum-classic", HBAR: "hedera-hashgraph", AAVE: "aave", RENDER: "render-token", WIF: "dogwifcoin", BONK: "bonk",
  SEI: "sei-network", TIA: "celestia", ALGO: "algorand", VET: "vechain", ICP: "internet-computer", FET: "fetch-ai", TAO: "bittensor" };
const DEF_CFG = { startCash: 500, maxPosPct: 15, maxPositions: 5, sl: 2.5, tp: 5, trail: 1.5, fee: 0.1,
  buyTh: 0.35, sellTh: -0.25, trendFilter: true, minHoldMin: 20, confirmTicks: 3, cooldownMin: 30, maxHoldMin: 240, notifyBuys: false, notifySells: true, dailyHour: 21, symbols: SYMS_DEF };
const EXPERTS = ["Trendfolger", "Momentum", "Mean-Reversion", "Breakout", "KI-Modell"];
const H = 10, WARM = 30, WMAX = 0.4, MAXBARS = 120, ETA = 0.03, LR = 0.03, L2 = 1e-4;
const BINANCE = ["https://data-api.binance.vision", "https://api.binance.com", "https://api1.binance.com"];

/* ================= Helfer ================= */
const nf = (v, d = 2) => Number(v).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => nf(v, 2) + " $";
const smoney = (v) => (v >= 0 ? "+" : "−") + nf(Math.abs(v), 2) + " $";
const pct = (v) => (v >= 0 ? "+" : "−") + nf(Math.abs(v * 100), 2) + " %";
const sc = (v) => (v >= 0 ? "+" : "−") + nf(Math.abs(v), 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sigm = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const r7 = (v) => (v == null ? null : Number(Number(v).toPrecision(7)));
function fp(p) { const a = Math.abs(p); return nf(p, a >= 10 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 5 : 8); }
function fq(q) { if (q >= 1000) return nf(q, 0); if (q >= 1) return Number.isInteger(q) ? nf(q, 0) : nf(q, 3); return nf(q, 6); }
function dur(ms) { const m = Math.round(ms / 60000); if (m < 60) return m + " Min."; const h = Math.floor(m / 60); return h + " Std. " + (m % 60) + " Min."; }
async function fetchT(url, ms = 8000, opt = {}) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; KI-Trading-Bot/1.0; +https://h-shyp.github.io/ki-trading-bot/)", "Accept": "application/json", ...(opt.headers || {}) };
  try { return await fetch(url, { ...opt, headers, signal: ac.signal }); } finally { clearTimeout(t); }
}
function berlin(ts) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, time: `${p.hour}:${p.minute}` };
}

/* ================= Speicher ================= */
function freshState(cfg = DEF_CFG) {
  return { cfg: { ...cfg }, cash: cfg.startCash, positions: {}, W: EXPERTS.map(() => 1 / EXPERTS.length),
    acc: EXPERTS.map(() => ({ h: 0, n: 0 })), ai: [0, 0, 0, 0, 0, 0, 0], learnSteps: 0, paused: false,
    createdAt: Date.now(), lastRun: 0, source: "", srcErr: "", cool: {}, stats: { sells: 0, wins: 0, realized: 0, sumWin: 0, sumLoss: 0 },
    day: null, lastDaily: "", lastWarm: 0 };
}
async function loadAll() {
  const v = await io.getMany(["st", "bars", "trades", "log", "eq"]);
  const s = v.st ? { ...freshState(), ...v.st } : freshState();
  s.cfg = { ...DEF_CFG, ...(s.cfg || {}) };
  if (!s.cfgV || s.cfgV < 2) { s.cfg.buyTh = Math.max(s.cfg.buyTh, DEF_CFG.buyTh); s.cfg.sellTh = Math.min(s.cfg.sellTh, DEF_CFG.sellTh); s.cfgV = 2; normW(s); }
  if (s.cfgV < 3) { // Neustart mit 500 $ Spielgeld (Wunsch vom 19.11.); das Gelernte der KI bleibt
    const keep = { W: s.W, acc: s.acc, ai: s.ai, learnSteps: s.learnSteps, lastRun: s.lastRun, source: s.source, lastWarm: s.lastWarm };
    const n = { ...freshState({ ...s.cfg, startCash: 500 }), ...keep, cfgV: 3 };
    return { st: n, bars: v.bars || { t: [], s: {}, ref: {} }, trades: [], eq: [],
      log: [{ t: Date.now(), type: "INFO", msg: "Neues Depot mit 500,00 $ Spielgeld gestartet. Das Gelernte der KI bleibt erhalten." }] };
  }
  return { st: s, bars: v.bars || { t: [], s: {}, ref: {} }, trades: v.trades || [], log: v.log || [], eq: v.eq || [] };
}
async function saveAll(D) {
  if (D.trades.length > 100) D.trades = D.trades.slice(-100);
  if (D.log.length > 80) D.log = D.log.slice(-80);
  if (D.eq.length > 1400) { const old = D.eq.slice(0, 700).filter((_, i) => i % 2 === 0); D.eq = old.concat(D.eq.slice(700)); }
  await io.putMany({ st: D.st, bars: D.bars, trades: D.trades, log: D.log, eq: D.eq });
}
const addLog = (D, type, o) => D.log.push({ t: Date.now(), type, ...o });

/* ================= Kursdaten ================= */
// Kraken: Paarnamen einmal laden und merken (BTC heißt dort XBT, DOGE heißt XDG)
const KR_ALIAS = { BTC: "XBT", DOGE: "XDG" };
let krMap = null, krMapAt = 0;
async function krakenPairs() {
  if (krMap && Date.now() - krMapAt < 6 * 3600e3) return krMap;
  const r = await fetchT("https://api.kraken.com/0/public/AssetPairs", 10000);
  if (!r.ok) throw new Error("Kraken " + r.status);
  const j = await r.json(); if (j.error && j.error.length) throw new Error("Kraken " + j.error[0]);
  const m = {};
  for (const [key, p] of Object.entries(j.result || {})) {
    if (!p.wsname || !p.wsname.endsWith("/USD")) continue;
    const base = p.wsname.split("/")[0];
    const sym = Object.keys(KR_ALIAS).find((k) => KR_ALIAS[k] === base) || base;
    m[sym] = { key, alt: p.altname };
  }
  krMap = m; krMapAt = Date.now(); return m;
}
async function pricesKraken(syms) {
  const m = await krakenPairs(); const have = syms.filter((s) => m[s]); if (!have.length) return {};
  const r = await fetchT("https://api.kraken.com/0/public/Ticker?pair=" + have.map((s) => m[s].alt).join(","));
  if (!r.ok) throw new Error("Kraken " + r.status);
  const j = await r.json(); if (j.error && j.error.length) throw new Error("Kraken " + j.error[0]);
  const data = {};
  for (const s of have) { const d = j.result[m[s].key] || j.result[m[s].alt]; if (d && d.c) data[s] = { price: +d.c[0], ref: +d.o || +d.c[0] }; }
  return data;
}
let binDownUntil = 0;
async function fetchPrices(syms) {
  const errs = [];
  for (const h of (Date.now() < binDownUntil ? [] : BINANCE)) {
    try {
      const r = await fetchT(`${h}/api/v3/ticker/24hr?type=MINI&symbols=${encodeURIComponent(JSON.stringify(syms.map((s) => s + "USDT")))}`);
      if (r.status === 400) { // ungültiges Symbol in der Liste → einzeln prüfen
        const ok = [];
        for (const s of syms) { const q = await fetchT(`${h}/api/v3/ticker/24hr?type=MINI&symbol=${s}USDT`); if (q.ok) { const d = await q.json(); ok.push(d); } }
        if (ok.length) return { src: "Binance", data: Object.fromEntries(ok.map((d) => [d.symbol.replace(/USDT$/, ""), { price: +d.lastPrice, ref: +d.openPrice }])) };
        errs.push(h + " 400"); continue;
      }
      if (!r.ok) { errs.push(h + " " + r.status); continue; }
      const arr = await r.json();
      return { src: "Binance", data: Object.fromEntries(arr.map((d) => [d.symbol.replace(/USDT$/, ""), { price: +d.lastPrice, ref: +d.openPrice }])) };
    } catch (e) { errs.push(h + " " + (e.name || "Fehler")); }
  }
  if (Date.now() >= binDownUntil) binDownUntil = Date.now() + 30 * 60000; // Binance 30 Min. nicht erneut versuchen
  try {
    const data = await pricesKraken(syms);
    if (Object.keys(data).length) return { src: "Kraken", data, note: errs.join(", ") };
    errs.push("Kraken leer");
  } catch (e) { errs.push(String(e.message || e.name || "Kraken Fehler")); }
  try {
    const r = await fetchT(`https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${syms.join(",")}&tsyms=USD`);
    if (r.ok) {
      const j = await r.json(); const raw = j.RAW || {}; const data = {};
      for (const s of syms) { const d = raw[s] && raw[s].USD; if (d && d.PRICE) data[s] = { price: +d.PRICE, ref: +(d.OPEN24HOUR || d.PRICE) }; }
      if (Object.keys(data).length) return { src: "CryptoCompare", data, note: errs.join(", ") };
      errs.push("CryptoCompare " + (j.Message || "leer"));
    } else errs.push("CryptoCompare " + r.status);
  } catch (e) { errs.push("CryptoCompare " + (e.name || "Fehler")); }
  try {
    const ids = [...new Set(syms.map((s) => CG[s]).filter(Boolean))];
    const r = await fetchT(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`);
    if (r.ok) {
      const j = await r.json(); const data = {};
      for (const s of syms) { const d = j[CG[s]]; if (d && d.usd) data[s] = { price: d.usd, ref: d.usd / (1 + (d.usd_24h_change || 0) / 100) }; }
      if (Object.keys(data).length) return { src: "CoinGecko", data, note: errs.join(", ") };
    } else errs.push("CoinGecko " + r.status);
  } catch (e) { errs.push("CoinGecko " + (e.name || "Fehler")); }
  return { src: "", data: {}, note: errs.join(", ") };
}
// Startverlauf: letzte 2 Stunden Minutenkerzen, damit der Bot sofort bewerten kann
async function klinesBinance(h, s) {
  const r = await fetchT(`${h}/api/v3/klines?symbol=${s}USDT&interval=1m&limit=${MAXBARS + 1}`);
  if (!r.ok) return null;
  return (await r.json()).slice(0, -1).map((k) => [Math.floor(k[0] / 60000) + 1, +k[4]]); // laufende Minute weglassen
}
async function klinesKraken(s) {
  const m = await krakenPairs(); if (!m[s]) return null;
  const r = await fetchT(`https://api.kraken.com/0/public/OHLC?pair=${m[s].alt}&interval=1`);
  if (!r.ok) return null;
  const j = await r.json(); const rows = j.result && (j.result[m[s].key] || j.result[m[s].alt]); if (!rows) return null;
  return rows.slice(-(MAXBARS + 1), -1).map((k) => [Math.floor(k[0] / 60) + 1, +k[4]]); // laufende Minute weglassen
}
async function klinesCC(s) {
  const r = await fetchT(`https://min-api.cryptocompare.com/data/v2/histominute?fsym=${s}&tsym=USD&limit=${MAXBARS}`);
  if (!r.ok) return null;
  const j = await r.json(); const rows = j && j.Data && j.Data.Data; if (!rows || !rows.length) return null;
  return rows.filter((k) => k.close > 0).map((k) => [Math.floor(k.time / 60) + 1, +k.close]);
}
async function warmup(D, syms) {
  // Quelle mit dem ersten Coin bestimmen (spart Abrufe – Cloudflare erlaubt nur 50 pro Runde)
  let load = null;
  for (const h of BINANCE) { try { if ((await klinesBinance(h, syms[0]))?.length) { load = (s) => klinesBinance(h, s); break; } } catch (_) { /* weiter */ } }
  if (!load) { try { if ((await klinesKraken(syms[0]))?.length) load = klinesKraken; } catch (_) { /* weiter */ } }
  if (!load) { try { if ((await klinesCC(syms[0]))?.length) load = klinesCC; } catch (_) { /* weiter */ } }
  if (!load) return 0;
  const series = {}; let base = null;
  for (const s of syms) {
    try {
      const rows = await load(s); if (!rows || !rows.length) continue;
      series[s] = new Map(rows);
      if (!base || rows.length > base.length) base = rows.map((x) => x[0]);
    } catch (_) { /* Coin überspringen */ }
  }
  if (!base) return 0;
  D.bars.t = base;
  D.bars.s = Object.fromEntries(syms.map((s) => [s, base.map((m) => (series[s] ? r7(series[s].get(m)) : null))]));
  return Object.keys(series).length;
}

/* ================= Analyse & KI ================= */
function emaArr(c, p) { const k = 2 / (p + 1); let e = c[0]; const out = [e]; for (let i = 1; i < c.length; i++) { e = c[i] * k + e * (1 - k); out.push(e); } return out; }
function rsiCalc(c, p = 14) {
  if (c.length < p + 1) return 50; let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } g /= p; l /= p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; }
  if (l === 0) return g === 0 ? 50 : 100; return 100 - 100 / (1 + g / l);
}
function analyze(c, st) {
  const n = c.length; if (n < WARM) return null;
  const eF = emaArr(c, 9), eS = emaArr(c, 21), eL = emaArr(c, 50); const p = c[n - 1];
  const rets = []; for (let i = Math.max(1, n - 30); i < n; i++) rets.push(c[i] / c[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.max(Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length), 2e-5);
  const rsi = rsiCalc(c.slice(-100)); const roc = p / c[n - 11] - 1;
  const win = c.slice(n - 21, n - 1); const hi = Math.max(...win), lo = Math.min(...win);
  const sTrend = Math.tanh((eF[n - 1] - eS[n - 1]) / eS[n - 1] / (vol * 1.5));
  const sMom = Math.tanh(roc / (vol * Math.sqrt(10)));
  const sRev = rsi < 30 ? Math.min(1, (30 - rsi) / 15) : rsi > 70 ? -Math.min(1, (rsi - 70) / 15) : 0;
  let sBrk = 0;
  if (p > hi) sBrk = Math.min(1, 0.5 + (p / hi - 1) / vol * 0.25); else if (p < lo) sBrk = -Math.min(1, 0.5 + (1 - p / lo) / vol * 0.25); else if (hi > lo) sBrk = ((p - lo) / (hi - lo) - 0.5) * 0.4;
  const r1 = Math.tanh((p / c[n - 2] - 1) / vol / 2);
  const x = [sTrend, sMom, sRev, sBrk, r1, (rsi - 50) / 50, 1];
  const pAI = sigm(dot(st.ai, x)); const sAI = Math.tanh((pAI - 0.5) * 5);
  const ex = [sTrend, sMom, sRev, sBrk, sAI];
  let score = 0; ex.forEach((e, i) => (score += st.W[i] * e)); score /= st.W.reduce((a, b) => a + b, 0);
  const slope = (eL[n - 1] - eL[n - 6]) / eL[n - 6];
  let trend = "side";
  if (eF[n - 1] > eS[n - 1] && eS[n - 1] > eL[n - 1] && slope > 0) trend = "up";
  else if (eF[n - 1] < eS[n - 1] && eS[n - 1] < eL[n - 1] && slope < 0) trend = "down";
  return { p, vol, rsi, ex, x, score: clamp(score, -1, 1), trend, pAI };
}
function normW(st) {
  // Gewichte normieren: jeder Experte mind. 4 %, keiner über 40 % – damit nicht einer allein entscheidet
  let w = st.W.map((x) => Math.max(x, 1e-6));
  for (let k = 0; k < 6; k++) {
    const sum = w.reduce((a, b) => a + b, 0); w = w.map((x) => clamp(x / sum, 0.04, WMAX));
  }
  const sum = w.reduce((a, b) => a + b, 0); st.W = w.map((x) => x / sum);
}
function learnFrom(st, a, p1) {
  const ret = p1 / a.p - 1; if (Math.abs(ret) < a.vol * 0.5) return;
  const y = ret > 0 ? 1 : -1;
  a.ex.forEach((e, i) => {
    if (Math.abs(e) > 0.05) st.W[i] *= Math.exp(-ETA * ((1 - e * y) / 2 - 0.5));
    if (Math.abs(e) > 0.15) { st.acc[i].n++; if ((e > 0 ? 1 : -1) === y) st.acc[i].h++; }
  });
  normW(st);
  const g = sigm(dot(st.ai, a.x)) - (y > 0 ? 1 : 0);
  for (let j = 0; j < st.ai.length; j++) st.ai[j] -= LR * (g * a.x[j] + L2 * st.ai[j]);
  st.learnSteps++;
}
const closesOf = (D, s) => (D.bars.s[s] || []).filter((v) => v != null);
const trendTxt = (t) => (t === "up" ? "↑ Aufwärts" : t === "down" ? "↓ Abwärts" : "→ Seitwärts");

/* ================= Handel ================= */
function priceOf(D, s) { return D.prices?.[s]?.price || D.st.positions[s]?.last || D.st.positions[s]?.avg; }
function equity(D) { let v = D.st.cash; for (const [s, p] of Object.entries(D.st.positions)) v += p.qty * (priceOf(D, s) || p.avg); return v; }
function buy(D, s, budget, reason) {
  const st = D.st, p = D.prices[s].price, f = st.cfg.fee / 100;
  const qty = Math.floor(budget / (p * (1 + f)) * 1e6) / 1e6; if (qty <= 0) return;
  const cost = qty * p, fee = cost * f; if (cost + fee > st.cash + 1e-9) return;
  st.cash -= cost + fee;
  st.positions[s] = { qty, avg: p, t: Date.now(), peak: p, fee, last: p };
  const tr = { t: Date.now(), side: "BUY", sym: s, qty, price: p, fee, reason };
  D.trades.push(tr); addLog(D, "BUY", tr);
  if (st.cfg.notifyBuys) D.notes.push({ title: `🛒 Kauf: ${s}`, msg: `${fq(qty)} × ${fp(p)} $ = ${money(cost)}\n${reason}`, tags: ["shopping_cart"], prio: 2 });
}
function sell(D, s, reason) {
  const st = D.st, pos = st.positions[s]; if (!pos) return;
  const p = priceOf(D, s), gross = pos.qty * p, fee = gross * st.cfg.fee / 100;
  st.cash += gross - fee;
  const pnl = gross - fee - (pos.qty * pos.avg + pos.fee), pnlPct = pnl / (pos.qty * pos.avg);
  delete st.positions[s];
  st.cool[s] = (D.bars.t.length ? D.bars.t[D.bars.t.length - 1] : 0) + (st.cfg.cooldownMin || 30); // Pause für dieses Symbol
  const S = st.stats; S.sells++; S.realized += pnl; if (pnl > 0) { S.wins++; S.sumWin += pnl; } else S.sumLoss += pnl;
  const tr = { t: Date.now(), side: "SELL", sym: s, qty: pos.qty, price: p, fee, pnl, pnlPct, held: Date.now() - pos.t, reason };
  D.trades.push(tr); addLog(D, "SELL", tr);
  if (st.cfg.notifySells) {
    const eq = equity(D), tot = eq - st.cfg.startCash;
    D.notes.push({ title: `${pnl > 0 ? "✅ Plus" : "❌ Minus"}: ${s} ${smoney(pnl)} (${pct(pnlPct)})`,
      msg: `${reason}\nGehalten: ${dur(Date.now() - pos.t)}\nDepot: ${money(eq)} (${smoney(tot)} gesamt)`,
      tags: [pnl > 0 ? "white_check_mark" : "x"], prio: 3 });
  }
}
function botStep(D) {
  const st = D.st, c = st.cfg, nowMin = D.bars.t[D.bars.t.length - 1] || 0, fee2 = 2 * c.fee / 100;
  st.sm = st.sm || {}; st.neg = st.neg || {};
  // Geglätteter Score: reagiert nicht auf jedes Minuten-Zucken
  for (const [s, a] of Object.entries(D.an)) {
    if (!a) continue;
    st.sm[s] = st.sm[s] == null ? a.score : 0.5 * st.sm[s] + 0.5 * a.score; a.smooth = st.sm[s];
    st.neg[s] = a.smooth <= c.sellTh ? (st.neg[s] || 0) + 1 : 0;
  }
  // 1) Ausstiege
  for (const s of Object.keys(st.positions)) {
    const pos = st.positions[s], pr = D.prices[s]; if (!pr) continue;
    const p = pr.price, a = D.an[s]; pos.last = p; pos.peak = Math.max(pos.peak, p);
    const ch = p / pos.avg - 1, heldMin = (Date.now() - pos.t) / 60000; let r = null;
    if (ch <= -c.sl / 100) r = `Stop-Loss ausgelöst (${pct(ch)})`;
    else if (ch >= c.tp / 100) r = `Gewinnziel erreicht (${pct(ch)})`;
    else if (c.trail > 0 && pos.peak / pos.avg - 1 >= c.trail / 100 && p <= pos.peak * (1 - c.trail / 100)) r = `Trailing-Stop: ${nf(c.trail, 1)} % unter dem Hoch – Gewinn gesichert (${pct(ch)})`;
    // Signal-Ausstieg erst nach Mindesthaltedauer und wenn das Signal mehrere Minuten lang klar negativ ist
    else if (a && heldMin >= c.minHoldMin && (st.neg[s] || 0) >= c.confirmTicks) r = `KI-Signal seit ${st.neg[s]} Min. klar negativ (Score ${sc(a.smooth)})`;
    // Zeitstopp: nach langer Zeit ohne Bewegung Kapital für bessere Chancen freigeben
    else if (heldMin >= c.maxHoldMin && Math.abs(ch) < fee2 * 2) r = `Keine Bewegung seit ${dur(heldMin * 60000)} – Kapital wird freigegeben (${pct(ch)})`;
    if (r) { sell(D, s, r); st.neg[s] = 0; }
  }
  if (st.paused) return;
  // 2) Einstiege: nur klare Aufwärtstrends mit genug Bewegung, damit sich die Gebühren lohnen
  const eq = equity(D);
  const cands = Object.entries(D.an).filter(([s, a]) => a && D.prices[s] && !st.positions[s]
    && a.score >= c.buyTh && a.smooth >= c.buyTh * 0.8
    && (!c.trendFilter || a.trend === "up")
    && a.vol * Math.sqrt(c.minHoldMin) >= fee2 * 2.5
    && (st.cool[s] || 0) <= nowMin).sort((x, y) => y[1].smooth - x[1].smooth);
  for (const [s, a] of cands) {
    if (Object.keys(st.positions).length >= c.maxPositions) break;
    const strength = clamp((a.smooth - c.buyTh) / Math.max(0.05, 1 - c.buyTh), 0, 1);
    const budget = Math.min(eq * c.maxPosPct / 100 * (0.6 + 0.4 * strength), st.cash);
    if (budget < Math.max(10, eq * 0.01)) break;
    let bi = 0, bv = -9; a.ex.forEach((e, i) => { const v = st.W[i] * e; if (v > bv) { bv = v; bi = i; } });
    buy(D, s, budget, `KI-Score ${sc(a.smooth)} · Trend ${trendTxt(a.trend)} · RSI ${nf(a.rsi, 0)} · stärkstes Signal: ${EXPERTS[bi]} (${sc(a.ex[bi])})`);
  }
}

/* ================= Benachrichtigungen (ntfy) ================= */
let lastNotifyErr = "", lastNotifyOk = 0;
async function notify(n) {
  const topic = env("NTFY_TOPIC"); if (!topic) { lastNotifyErr = "NTFY_TOPIC ist nicht gesetzt"; return false; }
  const errs = [];
  // Mit eigenem ntfy-Konto (NTFY_TOKEN) gilt dein eigenes Tageslimit statt des geteilten Cloudflare-Limits
  const tok = env("NTFY_TOKEN"); const auth = tok ? { Authorization: "Bearer " + tok } : {};
  // Weg 1: JSON an ntfy.sh
  try {
    const r = await fetchT("https://ntfy.sh/", 8000, { method: "POST", headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ topic, title: n.title, message: n.msg, tags: n.tags || [], priority: n.prio || 3 }) });
    if (r.ok) { lastNotifyErr = ""; lastNotifyOk = Date.now(); return true; }
    errs.push("JSON " + r.status + " " + (await r.text()).slice(0, 120));
  } catch (e) { errs.push("JSON " + (e.message || e.name)); }
  // Weg 2: Text direkt an den Kanal, Titel als Adress-Parameter
  try {
    const q = new URLSearchParams({ title: n.title, tags: (n.tags || []).join(","), priority: String(n.prio || 3) });
    const r = await fetchT(`https://ntfy.sh/${encodeURIComponent(topic)}?${q}`, 8000, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8", ...auth }, body: n.msg });
    if (r.ok) { lastNotifyErr = ""; lastNotifyOk = Date.now(); return true; }
    errs.push("Text " + r.status + " " + (await r.text()).slice(0, 120));
  } catch (e) { errs.push("Text " + (e.message || e.name)); }
  lastNotifyErr = errs.join(" | ");
  if (!tok && /429/.test(lastNotifyErr)) lastNotifyErr = "Tageslimit der geteilten Cloudflare-Adresse erreicht – lege ein kostenloses ntfy-Konto an und trage den Zugangs-Token als NTFY_TOKEN bei Cloudflare ein. (" + lastNotifyErr.slice(0, 60) + "…)";
  if (tok && /401|403/.test(lastNotifyErr)) lastNotifyErr = "NTFY_TOKEN wird nicht akzeptiert – prüfe, ob er vollständig kopiert ist (beginnt mit tk_). (" + lastNotifyErr.slice(0, 60) + "…)";
  return false;
}
/* ================= Push direkt aufs Handy (Web Push) ================= */
// Der Server schickt nur ein „Anklopfen“ ohne Inhalt. Die App auf dem Handy holt sich dann
// die neuen Nachrichten über /api/notes und zeigt sie an. So braucht es keine Verschlüsselung
// und keinen fremden Dienst – nur den Push-Dienst von Apple/Google.
const b64u = (buf) => { let s = ""; for (const x of new Uint8Array(buf)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
let lastPushErr = "";
async function vapid() {
  let v = (await io.getMany(["vapid"])).vapid;
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
    await io.putMany({ vapid: v });
  }
  return v;
}
async function vapidJwt(aud, v) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ typ: "JWT", alg: "ES256" }) + "." + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://h-shyp.github.io/ki-trading-bot/" });
  const key = await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64u(sig);
}
async function webPushAll() {
  const push = (await io.getMany(["push"])).push || []; if (!push.length) { lastPushErr = "Noch kein Handy angemeldet"; return 0; }
  const v = await vapid(); let sent = 0; const keep = [], errs = [];
  for (const s of push) {
    try {
      const jwt = await vapidJwt(new URL(s.endpoint).origin, v);
      const r = await fetch(s.endpoint, { method: "POST", headers: { Authorization: `vapid t=${jwt}, k=${v.pub}`, TTL: "86400", Urgency: "high", "Content-Length": "0" } });
      if (r.status === 404 || r.status === 410) { errs.push("Handy hat sich abgemeldet"); continue; }
      keep.push(s); if (r.ok) sent++; else errs.push("Push " + r.status + " " + (await r.text()).slice(0, 100));
    } catch (e) { keep.push(s); errs.push("Push " + String(e.message || e)); }
  }
  if (keep.length !== push.length) await io.putMany({ push: keep });
  lastPushErr = errs.join(" | "); return sent;
}
// Nachrichten speichern (für /api/notes) und zustellen: Push aufs Handy, zusätzlich ntfy falls eingerichtet
async function deliver(notes) {
  if (!notes || !notes.length) return { push: 0, ntfy: false };
  const old = (await io.getMany(["notes"])).notes || []; const now = Date.now();
  const add = notes.map((n, i) => ({ t: now + i, title: n.title, msg: n.msg }));
  await io.putMany({ notes: old.concat(add).slice(-30) });
  const push = await webPushAll();
  let ntfy = false; if (env("NTFY_TOPIC")) for (const n of notes) ntfy = (await notify(n)) || ntfy;
  return { push, ntfy };
}

function dailyCheck(D) {
  const st = D.st, b = berlin(Date.now()), eq = equity(D);
  if (!st.day || st.day.date !== b.date) st.day = { date: b.date, eq };
  if (b.hour >= st.cfg.dailyHour && st.lastDaily !== b.date) {
    st.lastDaily = b.date;
    const todays = D.trades.filter((t) => t.side === "SELL" && berlin(t.t).date === b.date);
    const pnl = eq - st.day.eq, wins = todays.filter((t) => t.pnl > 0).length;
    D.notes.push({ title: `📊 Tagesbilanz: ${smoney(pnl)} (${pct(pnl / st.day.eq)})`,
      msg: `${todays.length} Trades heute, davon ${wins} im Plus.\nDepot: ${money(eq)} · gesamt ${smoney(eq - st.cfg.startCash)} (${pct((eq - st.cfg.startCash) / st.cfg.startCash)})\nOffene Positionen: ${Object.keys(st.positions).length}`,
      tags: ["bar_chart"], prio: 3 });
  }
}

/* ================= Ein Durchlauf (jede Minute) ================= */
let running = false;
async function tick(force = false) {
  if (running) return { skipped: true }; running = true;
  try {
    const D = await loadAll(); D.notes = []; const st = D.st, now = Date.now();
    if (!force && now - st.lastRun < 40000) return { skipped: true }; // doppelte Aufrufe vermeiden
    const syms = st.cfg.symbols;
    // Verlauf aufbauen (beim ersten Start oder nach Änderung der Symbole)
    const have = Object.keys(D.bars.s);
    if ((!D.bars.t.length || syms.some((s) => !have.includes(s))) && now - (st.lastWarm || 0) > 3 * 60000) {
      st.lastWarm = now;
      const n = await warmup(D, syms);
      if (n) addLog(D, "INFO", { msg: `Kursverlauf der letzten 2 Stunden für ${n} Coins geladen – der Bot kann sofort bewerten.` });
      else { D.bars = { t: [], s: Object.fromEntries(syms.map((s) => [s, []])) }; addLog(D, "INFO", { msg: "Kein Kursverlauf verfügbar – der Bot sammelt jetzt 30 Minuten Daten, bevor er handelt." }); }
    }
    // Aktuelle Kurse
    const pr = await fetchPrices(syms); D.prices = pr.data;
    if (pr.src !== st.source) {
      if (pr.src) addLog(D, "INFO", { msg: `Kursquelle: ${pr.src}${pr.note ? " (Binance nicht erreichbar)" : ""}.` });
      else addLog(D, "WARN", { msg: "Keine Kurse erreichbar – neuer Versuch in einer Minute. " + (pr.note || "") });
    }
    st.source = pr.src; st.srcErr = pr.note || "";
    if (!pr.src) { st.lastRun = now; await saveAll(D); return { ok: false, err: pr.note }; }
    D.bars.ref = Object.fromEntries(Object.entries(pr.data).map(([s, d]) => [s, r7(d.ref)]));
    // Lernen: Vorhersage von vor H Minuten mit dem heutigen Kurs vergleichen
    for (const s of syms) {
      const c = closesOf(D, s), p = pr.data[s]?.price;
      if (p && c.length >= WARM + H - 1) { const a = analyze(c.slice(0, c.length - H + 1), st); if (a) learnFrom(st, a, p); }
    }
    st.W = st.W.map((w) => w * 0.998 + 0.002 / EXPERTS.length); normW(st);
    // Neue Minutenkerze anhängen
    const m = Math.floor(now / 60000);
    D.bars.t.push(m);
    for (const s of syms) { if (!D.bars.s[s]) D.bars.s[s] = D.bars.t.slice(0, -1).map(() => null); D.bars.s[s].push(r7(pr.data[s]?.price)); }
    for (const s of Object.keys(D.bars.s)) if (!syms.includes(s)) delete D.bars.s[s];
    if (D.bars.t.length > MAXBARS) { const cut = D.bars.t.length - MAXBARS; D.bars.t = D.bars.t.slice(cut); for (const s in D.bars.s) D.bars.s[s] = D.bars.s[s].slice(cut); }
    // Bewerten und handeln
    D.an = {}; for (const s of syms) D.an[s] = pr.data[s] ? analyze(closesOf(D, s), st) : null;
    botStep(D);
    D.eq.push([now, Math.round(equity(D) * 100) / 100]);
    dailyCheck(D);
    st.lastRun = now; st.lastScores = Object.fromEntries(Object.entries(D.an).filter(([, a]) => a).map(([s, a]) => [s,
      { score: +a.score.toFixed(3), trend: a.trend, rsi: +a.rsi.toFixed(1), pAI: +a.pAI.toFixed(3), ex: a.ex.map((e) => +e.toFixed(3)) }]));
    await saveAll(D);
    await deliver(D.notes);
    return { ok: true, src: pr.src, trades: D.notes.length };
  } finally { running = false; }
}


/* ================= Web-Schnittstelle für die App ================= */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function stateJson() {
  const D = await loadAll(); const st = D.st; const b = D.bars;
  const prices = {}; for (const s of Object.keys(b.s)) { const c = b.s[s]; let v = null; for (let i = c.length - 1; i >= 0 && v == null; i--) v = c[i]; if (v) prices[s] = { price: v }; }
  for (const [s, p] of Object.entries(st.positions)) if (!prices[s]) prices[s] = { price: p.last };
  D.prices = prices;
  const cfg = { ...st.cfg };
  return { ok: true, now: Date.now(), lastRun: st.lastRun, source: st.source, srcErr: st.srcErr, paused: st.paused, createdAt: st.createdAt,
    cfg, cash: st.cash, equity: equity(D), positions: st.positions, trades: D.trades, log: D.log, eq: D.eq,
    W: st.W, acc: st.acc, learnSteps: st.learnSteps, stats: st.stats, notify: !!env("NTFY_TOPIC"), notifyErr: lastNotifyErr, notifyOk: lastNotifyOk, control: !!env("BOT_KEY"),
    bars: { t: b.t, s: b.s, ref: b.ref || {} }, scores: st.lastScores || {},
    vapidPublic: (await vapid()).pub, pushDevices: ((await io.getMany(["push"])).push || []).length, pushErr: lastPushErr };
}

async function action(body) {
  const key = env("BOT_KEY");
  if (!key) return json({ ok: false, err: "BOT_KEY ist bei Cloudflare nicht gesetzt – Steuerung deaktiviert." }, 403);
  if (body.key !== key) return json({ ok: false, err: "Falscher Bot-Schlüssel." }, 403);
  if (body.action === "tick") return json(await tick(true));
  if (body.action === "test") {
    const r = await deliver([{ title: "🔔 Test vom KI Trading Bot", msg: "Wenn du das liest, kommen die Nachrichten an!", tags: ["bell"] }]);
    const ok = r.push > 0 || r.ntfy;
    return json({ ok, push: r.push, err: ok ? "" : (lastPushErr || "Push nicht möglich") + (env("NTFY_TOPIC") ? " · ntfy: " + lastNotifyErr.slice(0, 80) : "") });
  }
  if (body.action === "subscribe") {
    const sub = body.sub || {};
    if (!/^https:\/\//.test(sub.endpoint || "")) return json({ ok: false, err: "Ungültige Anmeldung" }, 400);
    const push = ((await io.getMany(["push"])).push || []).filter((x) => x.endpoint !== sub.endpoint);
    push.push({ endpoint: sub.endpoint, t: Date.now() });
    await io.putMany({ push: push.slice(-5) });
    return json({ ok: true, devices: Math.min(push.length, 5) });
  }
  const D = await loadAll(); D.notes = []; const st = D.st;
  // aktuelle Kurse für manuelle Verkäufe
  D.prices = {}; for (const s of Object.keys(D.bars.s)) { const c = D.bars.s[s]; for (let i = c.length - 1; i >= 0; i--) if (c[i] != null) { D.prices[s] = { price: c[i] }; break; } }
  switch (body.action) {
    case "pause": st.paused = true; addLog(D, "INFO", { msg: "Bot pausiert – keine neuen Käufe. Offene Positionen werden weiter überwacht." }); break;
    case "resume": st.paused = false; addLog(D, "INFO", { msg: "Bot läuft wieder." }); break;
    case "sell": if (st.positions[body.sym]) sell(D, body.sym, "Manuell verkauft"); break;
    case "closeAll": Object.keys(st.positions).forEach((s) => sell(D, s, "Manuell geschlossen")); break;
    case "settings": {
      const n = body.cfg || {}, c = st.cfg, num = (v, a, b2, d) => (isFinite(+v) ? clamp(+v, a, b2) : d);
      const syms = Array.isArray(n.symbols) ? [...new Set(n.symbols.map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z0-9]{2,12}$/.test(x)))].slice(0, 40) : c.symbols;
      st.cfg = { ...c, maxPosPct: num(n.maxPosPct, 1, 100, c.maxPosPct), maxPositions: Math.round(num(n.maxPositions, 1, 20, c.maxPositions)),
        sl: num(n.sl, 0.2, 50, c.sl), tp: num(n.tp, 0.2, 100, c.tp), trail: num(n.trail, 0, 50, c.trail), fee: num(n.fee, 0, 5, c.fee),
        buyTh: num(n.buyTh, 0.05, 0.95, c.buyTh), sellTh: num(n.sellTh, -0.95, 0, c.sellTh), trendFilter: n.trendFilter ?? c.trendFilter,
        notifyBuys: n.notifyBuys ?? c.notifyBuys, notifySells: n.notifySells ?? c.notifySells, dailyHour: Math.round(num(n.dailyHour, 0, 23, c.dailyHour)), symbols: syms.length ? syms : c.symbols };
      addLog(D, "INFO", { msg: "Einstellungen geändert." }); break;
    }
    case "reset": {
      const cash = isFinite(+body.startCash) ? clamp(+body.startCash, 100, 1e9) : st.cfg.startCash;
      const keep = { W: st.W, acc: st.acc, ai: st.ai, learnSteps: st.learnSteps };
      D.st = { ...freshState({ ...st.cfg, startCash: cash }), ...keep, lastRun: st.lastRun, source: st.source };
      D.trades = []; D.eq = []; D.log = []; addLog(D, "INFO", { msg: `Depot zurückgesetzt: ${money(cash)} Spielgeld. Das Gelernte der KI bleibt erhalten.` }); break;
    }
    default: return json({ ok: false, err: "Unbekannte Aktion" }, 400);
  }
  await saveAll(D); await deliver(D.notes);
  return json({ ok: true });
}

async function handle(req) {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (url.pathname === "/api/state") return json(await stateJson());
    if (url.pathname === "/api/notes") {
      const since = +url.searchParams.get("since") || 0;
      return json({ ok: true, notes: ((await io.getMany(["notes"])).notes || []).filter((n) => n.t > since).slice(-10) });
    }
    if (url.pathname === "/api/action" && req.method === "POST") return await action(await req.json());
    if (url.pathname === "/" || url.pathname === "") {
      const D = await loadAll();
      const age = D.st.lastRun ? Math.round((Date.now() - D.st.lastRun) / 1000) + " s" : "noch nie";
      return new Response(`KI Trading Bot – Server läuft ✓\nLetzte Runde vor: ${age}\nKursquelle: ${D.st.source || "–"}\nDepot: ${money(equity({ ...D, prices: {} }))}\n\nTrage diese Adresse in der App unter Einstellungen → Server-Bot ein.`,
        { headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
    }
    return json({ ok: false, err: "Nicht gefunden" }, 404);
  } catch (e) { return json({ ok: false, err: String(e && e.message || e) }, 500); }
}

return { tick, handle };
}
