(() => {
  "use strict";

  const REFRESH_MS = 10 * 60 * 1000;
  let picks = [];
  let sourceFilter = "all";
  let sportFilter = "all";

  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");

  function dateText(v) {
    if (!v) return "Hora no disponible";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleString("es-ES", {
      day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
    });
  }

  function sportOf(p) {
    const s = String(p.sport || "").toLowerCase();
    if (/basket|nba|ncaab/.test(s)) return "basketball";
    if (/tennis|atp|wta/.test(s)) return "tennis";
    if (/soccer|football|futbol|fútbol/.test(s)) return "football";
    return "other";
  }

  function ensure() {
    document.body.innerHTML = `
      <main id="picksApp">
        <header>
          <h1>🏆 TOP PICKS MULTIFUENTE</h1>
          <p>Combinamos varias fuentes públicas y filtramos los picks disponibles.</p>
        </header>
        <section class="controls">
          <select id="source"><option value="all">Todas las fuentes</option></select>
          <select id="sport">
            <option value="all">Todos los deportes</option>
            <option value="football">⚽ Fútbol</option>
            <option value="basketball">🏀 Baloncesto</option>
            <option value="tennis">🎾 Tenis</option>
            <option value="other">Otros</option>
          </select>
          <button id="refresh">🔄 Actualizar</button>
        </section>
        <div id="status">Cargando datos…</div>
        <section id="top"></section>
        <section id="list"></section>
        <footer>La puntuación es un filtro interno, no una probabilidad de acierto ni una garantía de resultado.</footer>
      </main>`;
    $("#source").onchange = e => { sourceFilter = e.target.value; render(); };
    $("#sport").onchange = e => { sportFilter = e.target.value; render(); };
    $("#refresh").onclick = load;
  }

  async function load() {
    const status = $("#status");
    status.textContent = "Consultando datos de las fuentes…";
    try {
      const r = await fetch(`data.json?t=${Date.now()}`, {cache:"no-store"});
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      picks = Array.isArray(data.picks) ? data.picks : [];
      const sources = [...new Set(picks.map(p => p.source).filter(Boolean))].sort();
      const select = $("#source");
      const current = sourceFilter;
      select.innerHTML = `<option value="all">Todas las fuentes</option>` +
        sources.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
      select.value = sources.includes(current) ? current : "all";
      sourceFilter = select.value;
      status.textContent =
        `${picks.length} picks · actualizado ${dateText(data.updated_at)}` +
        (data.errors && Object.keys(data.errors).length ? " · Algunas fuentes no respondieron" : "");
      render();
    } catch (e) {
      status.textContent = "No se pudo leer data.json: " + e.message;
      $("#top").innerHTML = `<div class="empty">Todavía no hay datos publicados.</div>`;
      $("#list").innerHTML = "";
    }
  }

  function filtered() {
    return picks.filter(p =>
      (sourceFilter === "all" || p.source === sourceFilter) &&
      (sportFilter === "all" || sportOf(p) === sportFilter)
    );
  }

  function render() {
    // La lista general sigue mostrando los picks más recientes.
    const items = filtered().slice().sort((a,b) => {
      const ta = Date.parse(a.published_at || "") || 0;
      const tb = Date.parse(b.published_at || "") || 0;
      if (tb !== ta) return tb - ta;
      return Number(b.filter_score || 0) - Number(a.filter_score || 0);
    });

    // TOP 5 = ranking real por puntuación, no simplemente los 5 más recientes.
    // Si empatan, primero el evento que empieza antes.
    const top = items
      .filter(p => Number(p.filter_score || 0) >= 60)
      .slice()
      .sort((a,b) => {
        const sa = Number(a.filter_score || 0);
        const sb = Number(b.filter_score || 0);
        if (sb !== sa) return sb - sa;
        const ta = Date.parse(a.event_at || a.published_at || "") || Number.MAX_SAFE_INTEGER;
        const tb = Date.parse(b.event_at || b.published_at || "") || Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })
      .slice(0,5);

    $("#top").innerHTML = `
      <h2>🔥 TOP 5</h2>
      ${top.length ? top.map(card).join("") :
        `<div class="empty">No hay 5 picks que superen el filtro mínimo en este momento.</div>`}`;

    $("#list").innerHTML = `
      <h2>📋 Picks disponibles (${items.length})</h2>
      ${items.slice(0,50).map(card).join("")}`;
  }

  function card(p) {
    const odds = p.odds == null ? "—" : Number(p.odds).toFixed(2);
    return `<article class="card">
      <div class="meta">${esc(p.source)} · ${esc(p.tipster)}</div>
      <div class="match">${esc(p.match)}</div>
      <div class="pick">${esc(p.pick)}</div>
      <div class="row">
        <span>Cuota: <b>${odds}</b></span>
        <span>Filtro: <b>${esc(p.filter_score ?? "—")}/100</b></span>
      </div>
      <div class="meta">${esc(p.market || "")} · ${esc(p.league || "")} · Publicado: ${dateText(p.published_at)}${p.event_at ? ` · Empieza: ${dateText(p.event_at)}` : ""}</div>
    </article>`;
  }

  const style = document.createElement("style");
  style.textContent = `
    :root{--bg:#0b1020;--card:#151c2d;--card2:#202a40;--border:#303b55;--text:#f5f7fb;--muted:#9eabc1;--accent:#5b8cff}
    *{box-sizing:border-box} body{margin:0;background:linear-gradient(180deg,#080d19,#121a2b);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    #picksApp{max-width:820px;margin:auto;padding:18px 14px 50px} header{padding:10px 2px 16px}
    h1{font-size:25px;margin:0 0 5px} h2{font-size:19px;margin:18px 0 10px}
    header p,.meta,footer{color:var(--muted);font-size:12px}.controls{display:grid;grid-template-columns:1fr 1fr auto;gap:8px}
    select,button{min-height:44px;border:1px solid var(--border);border-radius:12px;background:var(--card);color:var(--text);padding:0 12px;font-size:14px}
    button{background:var(--accent);border-color:var(--accent);font-weight:700}.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:14px;margin:9px 0}
    .match{font-weight:750;font-size:16px;margin:8px 0}.pick{font-size:18px;font-weight:800;background:var(--card2);padding:10px;border-radius:11px;margin:8px 0}
    .row{display:flex;justify-content:space-between;gap:10px;font-size:13px;margin:7px 0}.empty{padding:18px;border:1px solid var(--border);border-radius:15px;color:var(--muted)}
    footer{text-align:center;margin-top:18px;line-height:1.5}@media(max-width:600px){.controls{grid-template-columns:1fr 1fr}.controls button{grid-column:1/-1}}
  `;
  document.head.appendChild(style);

  ensure();
  load();
  setInterval(load, REFRESH_MS);
})();
