(() => {
  "use strict";

  const REFRESH_MS = 10 * 60 * 1000;
  const TOP_RECENT_MS = 48 * 60 * 60 * 1000;
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
    const d = new Date(year, Number(m[2])-1, Number(m[1]),
                       m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function dateText(v) {
    const t = publishedTime(v);
    return t ? new Date(t).toLocaleString("es-ES", {
      day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
    }) : (v || "Hora no disponible");
  }

  function sportOf(p) {
    const s = String(p.sport || "").toLowerCase();
    if (/basket|nba|ncaab/.test(s)) return "basketball";
    if (/tennis|atp|wta/.test(s)) return "tennis";
    if (/soccer|football|futbol|fútbol/.test(s)) return "football";
    return "other";
  }

  // Normalized identity used to prevent the same event/market from occupying
  // several TOP-5 slots when different sources publish the same pick.
  function keyOf(p) {
    const norm = v => String(v ?? "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .replace(/[^a-z0-9]+/g," ").trim();
    return [
      norm(p.match), norm(p.pick), norm(p.market), norm(p.league)
    ].join("|");
  }

  function qualityScore(p) {
    const base = Number(p.filter_score);
    if (!Number.isFinite(base)) return -Infinity;

    // The stored filter_score is only a filter, not a probability.
    // Apply conservative penalties to incomplete/ambiguous records.
    let s = base;
    if (!p.match || String(p.match).length < 5) s -= 12;
    if (!p.pick || String(p.pick).length < 3) s -= 12;
    if (p.odds == null || !Number.isFinite(Number(p.odds))) s -= 8;
    if (!p.market) s -= 5;
    if (!p.published_at || !publishedTime(p.published_at)) s -= 8;

    // Do not pretend this is a win probability.
    return Math.max(0, Math.min(100, s));
  }

  function ensure() {
    document.body.innerHTML = `
      <main id="picksApp">
        <header>
          <h1>🏆 TOP PICKS MULTIFUENTE</h1>
          <p>Ranking conservador por calidad de señal, no por antigüedad.</p>
        </header>
        <section class="controls">
          <select id="source"><option value="all">Todas las fuentes</option></select>
          <select id="sport">
            <option value="all">Todos los deportes</option>
            <option value="football">⚽ Fútbol</option>
            <option value="basketball">🏀 Baloncesto</option>
            <option value="tennis">🎾 Tenis</option>
            <option value="other">🏅 Otros</option>
          </select>
          <button id="refresh">🔄 Actualizar</button>
        </section>
        <div id="status">Cargando datos…</div>
        <section id="top"></section>
        <section id="list"></section>
        <footer>La puntuación es un filtro interno; no es una probabilidad de acierto ni una garantía.</footer>
      </main>`;

    $("#source").onchange = e => { sourceFilter=e.target.value; render(); };
    $("#sport").onchange = e => { sportFilter=e.target.value; render(); };
    $("#refresh").onclick = load;
  }

  async function load() {
    $("#status").textContent = "Consultando datos de las fuentes…";
    try {
      const r = await fetch(`data.json?t=${Date.now()}`, {cache:"no-store"});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      picks = Array.isArray(data.picks) ? data.picks : [];

      const sources = [...new Set(picks.map(p=>p.source).filter(Boolean))].sort();
      const select = $("#source");
      const current = sourceFilter;
      select.innerHTML = `<option value="all">Todas las fuentes</option>` +
        sources.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
      select.value = sources.includes(current) ? current : "all";
      sourceFilter = select.value;

      $("#status").textContent =
        `${picks.length} picks · actualizado ${dateText(data.updated_at)}` +
        (data.errors && Object.keys(data.errors).length
          ? " · Algunas fuentes no respondieron" : "");
      render();
    } catch(e) {
      $("#status").textContent = "No se pudo leer data.json: " + e.message;
      $("#top").innerHTML = `<div class="empty">Todavía no hay datos publicados.</div>`;
      $("#list").innerHTML = "";
    }
  }

  function filtered() {
    return picks.filter(p =>
      (sourceFilter==="all" || p.source===sourceFilter) &&
      (sportFilter==="all" || sportOf(p)===sportFilter)
    );
  }

  function topPicks() {
    const cutoff = Date.now() - TOP_RECENT_MS;

    // CRITICAL FIX:
    // 1) recent picks only
    // 2) minimum quality threshold
    // 3) rank by quality first, recency second
    // 4) deduplicate the same event/market
    const candidates = filtered()
      .map(p => ({p, score: qualityScore(p), time: publishedTime(p.published_at)}))
      .filter(x => x.time > 0 && x.time >= cutoff && x.score >= TOP_MIN_SCORE)
      .sort((a,b) => b.score - a.score || b.time - a.time);

    const seen = new Set();
    const out = [];
    for (const x of candidates) {
      const key = keyOf(x.p);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x);
      if (out.length === 5) break;
    }
    return out;
  }

  function render() {
    const top = topPicks();

    $("#top").innerHTML = `
      <h2>🔥 TOP 5 — CALIDAD</h2>
      ${top.length ? top.map((x,i)=>card(x.p,x.score,i+1,true)).join("") :
        `<div class="empty">No hay suficientes picks recientes con puntuación de calidad ≥ ${TOP_MIN_SCORE}.</div>`}`;

    const items = filtered().slice().sort((a,b) =>
      publishedTime(b.published_at)-publishedTime(a.published_at) ||
      qualityScore(b)-qualityScore(a)
    );

    $("#list").innerHTML = `
      <h2>📋 Picks disponibles (${items.length})</h2>
      ${items.slice(0,50).map(p=>card(p,qualityScore(p),null,false)).join("")}`;
  }

  function card(p, score, rank, isTop) {
    const odds = p.odds == null ? "—" : Number(p.odds).toFixed(2);
    return `<article class="card ${isTop ? "topCard":""}">
      <div class="meta">${rank ? rank+". " : ""}${esc(p.source)} · ${esc(p.tipster)}</div>
      <div class="match">${esc(p.match)}</div>
      <div class="pick">${esc(p.pick)}</div>
      <div class="row">
        <span>Cuota: <b>${odds}</b></span>
        <span>Calidad: <b>${Number.isFinite(score) ? Math.round(score) : "—"}/100</b></span>
      </div>
      <div class="meta">${esc(p.market||"")} · ${esc(p.league||"")} · ${dateText(p.published_at)}</div>
    </article>`;
  }

  const style=document.createElement("style");
  style.textContent=`
    :root{--bg:#0b1020;--card:#151c2d;--card2:#202a40;--border:#303b55;--text:#f5f7fb;--muted:#9eabc1;--accent:#5b8cff}
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(180deg,#080d19,#121a2b);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #picksApp{max-width:820px;margin:auto;padding:18px 14px 50px}
    header{padding:10px 2px 16px} h1{font-size:25px;margin:0 0 5px} h2{font-size:19px;margin:18px 0 10px}
    header p,.meta,footer{color:var(--muted);font-size:12px}
    .controls{display:grid;grid-template-columns:1fr 1fr auto;gap:8px}
    select,button{min-height:44px;border:1px solid var(--border);border-radius:12px;background:var(--card);color:var(--text);padding:0 12px;font-size:14px}
    button{background:var(--accent);border-color:var(--accent);font-weight:700}
    .card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px;margin:9px 0}
    .topCard{border-width:2px}
    .match{font-weight:750;font-size:16px;margin:8px 0}.pick{font-size:18px;font-weight:800;background:var(--card2);padding:10px;border-radius:11px;margin:8px 0}
    .row{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin:7px 0}
    .empty{padding:18px;border:1px solid var(--border);border-radius:15px;color:var(--muted)}
    footer{text-align:center;margin-top:18px;line-height:1.5}
    @media(max-width:600px){.controls{grid-template-columns:1fr 1fr}.controls button{grid-column:1/-1}}
  `;
  document.head.appendChild(style);
  ensure(); load(); setInterval(load,REFRESH_MS);
})();