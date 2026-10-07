/*
  PREDICCIÓN APUESTAS — Blogabet Filter v1
  ------------------------------------------------
  Objetivo:
  - Priorizar picks procedentes de Blogabet.
  - Puntuar la calidad histórica del tipster.
  - Detectar coincidencias entre tipsters.
  - Combinar la señal del tipster con datos del partido cuando estén disponibles.
  - No inventar picks cuando faltan datos.

  IMPORTANTE:
  GitHub Pages no puede saltarse por sí solo CORS/anti-bot de Blogabet.
  Este frontend acepta un proxy propio mediante window.BLOGABET_PROXY_URL.
  El proyecto incluye worker.js como ejemplo de proxy para Cloudflare Workers.

  Si no hay proxy, se puede probar el filtro pegando/importando JSON de picks.
*/
(() => {
  "use strict";

  const CONFIG = {
    refreshMs: 5 * 60 * 1000,
    minTipsterPicks: 100,
    minTipsterScore: 62,
    minFinalScore: 72,
    maxTopPicks: 10
  };

  const state = {
    picks: [],
    filtered: [],
    source: "none",
    lastUpdate: null,
    loading: false
  };

  const $ = (id) => document.getElementById(id);

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function n(v, fallback = null) {
    const x = Number(v);
    return Number.isFinite(x) ? x : fallback;
  }

  function clamp(x, a=0, b=100) {
    return Math.max(a, Math.min(b, x));
  }

  function normalizePick(p) {
    return {
      id: String(p.id ?? crypto.randomUUID()),
      tipster: String(p.tipster ?? p.user ?? p.author ?? "Desconocido"),
      event: String(p.event ?? p.match ?? p.fixture ?? ""),
      market: String(p.market ?? p.pick ?? p.selection ?? ""),
      odds: n(p.odds ?? p.price ?? p.odd),
      stake: n(p.stake ?? p.units),
      sport: String(p.sport ?? "football").toLowerCase(),
      league: String(p.league ?? ""),
      timestamp: p.timestamp ?? p.date ?? null,
      verified: Boolean(p.verified ?? p.isVerified ?? false),

      // Datos históricos del tipster.
      history: {
        picks: n(p.history?.picks ?? p.picksCount ?? p.totalPicks, 0),
        profit: n(p.history?.profit ?? p.profit, 0),
        yield: n(p.history?.yield ?? p.yield, 0),
        winRate: n(p.history?.winRate ?? p.winRate, null),
        followers: n(p.history?.followers ?? p.followers, 0),
        recentYield: n(p.history?.recentYield ?? p.recentYield, null),
        verifiedPct: n(p.history?.verifiedPct ?? p.verifiedPct, null)
      }
    };
  }

  /*
    Score del tipster.
    Pesos conservadores: tamaño de muestra + yield + consistencia reciente +
    verificación + win rate. El score no significa probabilidad de ganar.
  */
  function tipsterScore(p) {
    const h = p.history || {};
    let score = 50;

    const sample = h.picks || 0;
    if (sample >= 1000) score += 14;
    else if (sample >= 500) score += 11;
    else if (sample >= 250) score += 8;
    else if (sample >= 100) score += 5;
    else score -= 10;

    const y = h.yield ?? 0;
    if (y >= 20) score += 18;
    else if (y >= 12) score += 14;
    else if (y >= 8) score += 10;
    else if (y >= 4) score += 5;
    else if (y < 0) score -= 12;

    if (h.recentYield != null) {
      if (h.recentYield >= 10) score += 10;
      else if (h.recentYield >= 5) score += 6;
      else if (h.recentYield < 0) score -= 8;
    }

    if (h.winRate != null) {
      if (h.winRate >= 60) score += 7;
      else if (h.winRate >= 55) score += 4;
      else if (h.winRate < 48) score -= 6;
    }

    if (p.verified) score += 6;
    if (h.verifiedPct != null && h.verifiedPct >= 90) score += 4;

    return Math.round(clamp(score));
  }

  function keyForPick(p) {
    return `${p.event}|${p.market}`.toLowerCase().replace(/\s+/g," ").trim();
  }

  function calculatePickScore(p, group) {
    const ts = tipsterScore(p);
    let score = ts * 0.55;

    // Coincidencia independiente entre tipsters.
    const uniqueTipsters = new Set(group.map(x => x.tipster.toLowerCase())).size;
    if (uniqueTipsters >= 4) score += 25;
    else if (uniqueTipsters === 3) score += 19;
    else if (uniqueTipsters === 2) score += 11;

    // Cuotas demasiado bajas no reciben un bonus artificial.
    if (p.odds != null) {
      if (p.odds >= 1.60 && p.odds <= 2.80) score += 6;
      else if (p.odds > 4.50) score -= 5;
      else if (p.odds < 1.25) score -= 4;
    }

    // Stake alto no se interpreta automáticamente como calidad.
    if (p.stake != null && p.stake >= 8) score += 2;

    return Math.round(clamp(score));
  }

  function analyze() {
    const groups = new Map();
    for (const p0 of state.picks) {
      const p = normalizePick(p0);
      const k = keyForPick(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }

    const results = [];
    for (const [, group] of groups) {
      const unique = [...new Map(group.map(p => [p.tipster.toLowerCase(), p])).values()];
      const best = [...unique].sort((a,b) => tipsterScore(b)-tipsterScore(a))[0];

      const goodTipsters = unique.filter(p =>
        (p.history?.picks || 0) >= CONFIG.minTipsterPicks &&
        tipsterScore(p) >= CONFIG.minTipsterScore
      );

      const score = calculatePickScore(best, goodTipsters.length ? goodTipsters : unique);
      if (score < CONFIG.minFinalScore) continue;

      results.push({
        ...best,
        score,
        tipsterScore: tipsterScore(best),
        consensus: goodTipsters.length || 1,
        tipsters: unique.map(p => ({
          name: p.tipster,
          score: tipsterScore(p),
          yield: p.history?.yield ?? null,
          picks: p.history?.picks ?? 0
        }))
      });
    }

    state.filtered = results.sort((a,b) => b.score - a.score)
      .slice(0, CONFIG.maxTopPicks);

    render();
  }

  function render() {
    const info = $("info");
    const list = $("results");

    if (!list) return;

    info.textContent =
      `${state.picks.length} picks analizados · ${state.filtered.length} picks filtrados` +
      (state.lastUpdate ? ` · ${state.lastUpdate.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}` : "");

    if (!state.filtered.length) {
      list.innerHTML = `
        <div class="empty">
          <b>No hay picks que superen el filtro.</b>
          <p>No vamos a rellenar la pantalla con apuestas débiles. Cuando lleguen más datos, volveremos a calcular.</p>
        </div>`;
      return;
    }

    list.innerHTML = state.filtered.map((p,i) => `
      <article class="pick">
        <div class="rank">#${i+1} · ${esc(p.sport)} ${p.league ? "· "+esc(p.league) : ""}</div>
        <h2>${esc(p.event)}</h2>
        <div class="market">${esc(p.market)} ${p.odds != null ? `<b>@ ${p.odds.toFixed(2)}</b>` : ""}</div>
        <div class="score">
          <span>FILTRO ${p.score}/100</span>
          <span>Tipster ${p.tipsterScore}/100</span>
        </div>
        <div class="meta">
          👤 ${esc(p.tipster)}
          · 🤝 ${p.consensus} tipster${p.consensus === 1 ? "" : "s"} coinciden
          · ${p.verified ? "✓ Verificado" : "Sin verificación"}
        </div>
        <details>
          <summary>Ver tipsters que apoyan el pick</summary>
          <ul>
            ${p.tipsters.map(t => `<li>${esc(t.name)} — ${t.score}/100 · ${t.picks} picks · ${t.yield ?? "—"}% yield</li>`).join("")}
          </ul>
        </details>
      </article>
    `).join("");
  }

  async function loadFromProxy() {
    const base = window.BLOGABET_PROXY_URL;
    if (!base) throw new Error("BLOGABET_PROXY_URL no configurado");

    const response = await fetch(base, { cache:"no-store" });
    if (!response.ok) throw new Error(`Proxy ${response.status}`);

    const data = await response.json();
    const picks = Array.isArray(data) ? data : (data.picks || []);
    if (!picks.length) throw new Error("El proxy no devolvió picks");

    state.picks = picks.map(normalizePick);
    state.source = "Blogabet/proxy";
    state.lastUpdate = new Date();
    analyze();
  }

  function loadJSONText(text) {
    const data = JSON.parse(text);
    const picks = Array.isArray(data) ? data : (data.picks || []);
    state.picks = picks.map(normalizePick);
    state.source = "JSON importado";
    state.lastUpdate = new Date();
    analyze();
  }

  function renderShell() {
    document.body.innerHTML = `
      <main class="wrap">
        <header>
          <h1>🎯 Picks filtrados</h1>
          <p>Blogabet + historial de tipsters + consenso. Solo mostramos señales que superan el filtro.</p>
        </header>

        <section class="controls">
          <button id="refresh">🔄 Actualizar Blogabet</button>
          <label class="file">
            Importar JSON
            <input id="jsonFile" type="file" accept=".json,application/json">
          </label>
        </section>

        <div id="status" class="status">
          Fuente: <b id="source">—</b>
        </div>

        <div id="info" class="info">Esperando datos…</div>
        <section id="results"></section>

        <footer>
          El filtro es probabilístico y no garantiza resultados. No se muestran picks solo por tener una cuota alta.
        </footer>
      </main>
    `;

    $("refresh").onclick = async () => {
      if (state.loading) return;
      state.loading = true;
      $("refresh").disabled = true;
      $("refresh").textContent = "Cargando…";
      try {
        await loadFromProxy();
      } catch (e) {
        $("status").innerHTML =
          `⚠️ No se pudo leer Blogabet automáticamente. ${esc(e.message)}<br>` +
          `Configura <code>BLOGABET_PROXY_URL</code> o importa un JSON.`;
      } finally {
        state.loading = false;
        $("refresh").disabled = false;
        $("refresh").textContent = "🔄 Actualizar Blogabet";
      }
    };

    $("jsonFile").onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        loadJSONText(await file.text());
      } catch {
        $("status").textContent = "⚠️ JSON no válido.";
      }
    };
  }

  function start() {
    renderShell();
    render();
    $("source").textContent = state.source;
  }

  document.addEventListener("DOMContentLoaded", start);
})();
