(() => {
"use strict";

const REFRESH_MS = 10 * 60 * 1000;
const TOP_RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const TOP_MIN_SCORE = 70;

let picks = [];
let sourceFilter = "all";
let sportFilter = "all";

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "")
  .replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;")
  .replaceAll("'","&#039;");

function publishedTime(v) {
  if (!v) return 0;
  const s = String(v).trim();
  const direct = Date.parse(s);
  if (!Number.isNaN(direct)) return direct;
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?(?:[,\s]+(\d{1,2})(?::(\d{2}))?)?/);
  if (!m) return 0;
  let year = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, Number(m[2])-1, Number(m[1]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function dateText(v) {
  const t = publishedTime(v);
  return t ? new Date(t).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : (v || "Hora no disponible");
}

function sportOf(p) {
  const s = String(p.sport || "").toLowerCase();
  if (/basket|nba|ncaab|wnba/.test(s)) return "basketball";
  if (/tennis|atp|wta/.test(s)) return "tennis";
  if (/soccer|football|futbol|fútbol|mls|europa|premier|liga|champions/.test(s)) return "football";
  if (/baseball|mlb/.test(s)) return "baseball";
  if (/hockey|nhl/.test(s)) return "hockey";
  if (/boxing|boxeo/.test(s)) return "boxing";
  if (/ufc|mma/.test(s)) return "mma";
  if (/nfl|american football/.test(s)) return "american_football";
  if (/formula|motogp|nascar|racing|motorsport/.test(s)) return "motorsport";
  if (/rugby/.test(s)) return "rugby";
  if (/handball/.test(s)) return "handball";
  return "other";
}

function resultIsActive(p) {
  const r = String(p.result || "").toLowerCase().trim();
  return !["win","loss","push","void","cancelled","canceled","won","lost"].includes(r);
}

function eventKey(p) {
  const norm = v => String(v ?? "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g," ").trim();

  const raw = norm(p.match);
  const teams = raw.split(/\s+(?:vs|v|at)\s+|\s*@\s*|\s+—\s+|\s+-\s+/)
    .map(x => x.trim()).filter(Boolean);

  return teams.length >= 2 ? teams.sort().join("|") : raw;
}

function qualityScore(p) {
  const base = Number(p.filter_score);
  if (!Number.isFinite(base)) return -Infinity;
  let s = base;
  if (!p.match || String(p.match).length < 5) s -= 12;
  if (!p.pick || String(p.pick).length < 3) s -= 12;
  if (p.odds == null || !Number.isFinite(Number(p.odds))) s -= 8;
  if (!p.market) s -= 5;
  if (!p.published_at || !publishedTime(p.published_at)) s -= 8;
  return Math.max(0, Math.min(100, s));
}

function filtered() {
  return picks.filter(p =>
    (sourceFilter === "all" || p.source === sourceFilter) &&
    (sportFilter === "all" || sportOf(p) === sportFilter)
  );
}

function topPicks() {
  const cutoff = Date.now() - TOP_RECENT_MS;
  const candidates = filtered()
    .map(p => ({p, score: qualityScore(p), time: publishedTime(p.published_at)}))
    .filter(x => x.time > 0 && x.time >= cutoff && x.score >= TOP_MIN_SCORE && resultIsActive(x.p))
    .sort((a,b) => b.score - a.score || b.time - a.time);

  const seen = new Set();
  const out = [];
  for (const x of candidates) {
    const key = eventKey(x.p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
    if (out.length === 5) break;
  }
  return out;
}

function card(p, score, rank, isTop) {
  const odds = p.odds == null ? "—" : Number(p.odds).toFixed(2);
  const state = p.result ? ` · Estado: ${esc(p.result)}` : "";
  return `<article class="card ${isTop ? "topCard":""}">
    <div class="meta">${rank ? rank+". " : ""}${esc(p.source)} · ${esc(p.tipster)}</div>
    <div class="match">${esc(p.match)}</div>
    <div class="pick">${esc(p.pick)}</div>
    <div class="row"><span>Cuota: <b>${odds}</b></span><span>Calidad: <b>${Number.isFinite(score) ? Math.round(score) : "—"}/100</b></span></div>
    <div class="meta">${esc(p.market||"")} · ${esc(p.league||"")} · ${dateText(p.published_at)}${state}</div>
  </article>`;
}

async function load() {
  $("#status").textContent = "Consultando datos…";
  try {
    const r = await fetch(`data.json?t=${Date.now()}`, {cache:"no-store"});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();

    picks = Array.isArray(data.picks) ? data.picks : [];

    const sources = [...new Set(picks.map(p=>p.source).filter(Boolean))].sort();
    const source = $("#source");
    const current = sourceFilter;
    source.innerHTML = `<option value="all">Todas las fuentes</option>` +
      sources.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
    source.value = sources.includes(current) ? current : "all";
    sourceFilter = source.value;

    const errors = data.errors && Object.keys(data.errors).length;
    $("#status").textContent =
      `${picks.length} picks · actualizado ${dateText(data.updated_at)}` +
      (errors ? " · Algunas fuentes no respondieron" : "");

    render();
  } catch(e) {
    $("#status").textContent = "No se pudo leer data.json: " + e.message;
    $("#top").innerHTML = `<div class="empty">No se pudieron cargar los picks.</div>`;
    $("#list").innerHTML = "";
  }
}

function render() {
  const top = topPicks();

  $("#top").innerHTML = `
    <h2>🔥 TOP 5 — PICKS ACTIVOS</h2>
    ${top.length
      ? top.map((x,i)=>card(x.p,x.score,i+1,true)).join("")
      : `<div class="empty">No hay picks activos recientes con calidad ≥ ${TOP_MIN_SCORE}. No se muestran picks ya resueltos ni se repiten partidos.</div>`}`;

  const items = filtered().slice().sort((a,b) =>
    publishedTime(b.published_at)-publishedTime(a.published_at) ||
    qualityScore(b)-qualityScore(a)
  );

  $("#list").innerHTML = `
    <h2>📋 Picks disponibles (${items.length})</h2>
    ${items.slice(0,50).map(p=>card(p,qualityScore(p),null,false)).join("")}`;
}

$("#source").onchange = e => { sourceFilter=e.target.value; render(); };
$("#sport").onchange = e => { sportFilter=e.target.value; render(); };
$("#refresh").onclick = load;

load();
setInterval(load, REFRESH_MS);
})();
