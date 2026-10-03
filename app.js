/* PREDICCION APUESTAS - APP.JS
   Versión nueva: carga automática de eventos desde ESPN y genera picks
   heurísticos. No usa cuotas ni promete aciertos.
*/

(() => {
  "use strict";

  const CONFIG = {
    refreshMs: 10 * 60 * 1000,
    daysAhead: 3,
    maxEvents: 120
  };

  const LEAGUES = [
    { sport: "football", league: "esp.1", label: "Fútbol · LaLiga", kind: "football" },
    { sport: "football", league: "eng.1", label: "Fútbol · Premier League", kind: "football" },
    { sport: "football", league: "ger.1", label: "Fútbol · Bundesliga", kind: "football" },
    { sport: "football", league: "ita.1", label: "Fútbol · Serie A", kind: "football" },
    { sport: "football", league: "fra.1", label: "Fútbol · Ligue 1", kind: "football" },
    { sport: "football", league: "uefa.champions", label: "Fútbol · Champions", kind: "football" },
    { sport: "basketball", league: "nba", label: "Baloncesto · NBA", kind: "basketball" },
    { sport: "basketball", league: "euroleague", label: "Baloncesto · Euroliga", kind: "basketball" },
    { sport: "tennis", league: "atp", label: "Tenis · ATP", kind: "tennis" },
    { sport: "tennis", league: "wta", label: "Tenis · WTA", kind: "tennis" },
    { sport: "racing", league: "f1", label: "Motor · F1", kind: "racing" }
  ];

  let allMatches = [];
  let activeSport = "all";

  const $ = id => document.getElementById(id);

  function todayUTC() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(date, amount) {
    const d = new Date(date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0, 10);
  }

  function fmtDate(iso) {
    if (!iso) return "Fecha no disponible";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-ES", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function apiUrl(cfg, date) {
    return `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${date.replaceAll("-", "")}`;
  }

  async function fetchJSON(url) {
    const r = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function parseEvent(event, cfg) {
    const comp = event?.competitions?.[0];
    const competitors = comp?.competitors || [];
    if (!comp || competitors.length < 2) return null;

    const home = competitors.find(x => x.homeAway === "home") || competitors[0];
    const away = competitors.find(x => x.homeAway === "away") || competitors[1];

    const hName = home?.team?.displayName || home?.athlete?.displayName || home?.displayName || "Local";
    const aName = away?.team?.displayName || away?.athlete?.displayName || away?.displayName || "Visitante";

    return {
      id: event.id,
      sport: cfg.kind,
      league: cfg.label,
      leagueId: cfg.league,
      date: event.date || comp.date,
      status: event.status?.type?.description || event.status?.type?.shortDetail || "",
      state: event.status?.type?.state || "",
      home: hName,
      away: aName,
      homeRecord: getRecord(home),
      awayRecord: getRecord(away),
      homeRank: Number(home?.curatedRank?.current || home?.rank || 99),
      awayRank: Number(away?.curatedRank?.current || away?.rank || 99),
      homeScore: Number(home?.score || 0),
      awayScore: Number(away?.score || 0)
    };
  }

  function getRecord(c) {
    const items = c?.records || c?.record || [];
    if (Array.isArray(items) && items.length) {
      const r = items.find(x => /overall|total|regular/i.test(x?.name || x?.type || "")) || items[0];
      return r?.summary || "";
    }
    return c?.records?.summary || "";
  }

  function parseAll(data, cfg) {
    return (data?.events || [])
      .map(e => parseEvent(e, cfg))
      .filter(Boolean);
  }

  async function loadMatches() {
    setStatus("Buscando partidos y eventos reales…");
    const dates = Array.from({ length: CONFIG.daysAhead }, (_, i) => addDays(todayUTC(), i));
    const jobs = [];

    for (const cfg of LEAGUES) {
      for (const date of dates) {
        jobs.push(
          fetchJSON(apiUrl(cfg, date))
            .then(data => parseAll(data, cfg))
            .catch(() => [])
        );
      }
    }

    const chunks = await Promise.all(jobs);
    const flat = chunks.flat();

    const unique = new Map();
    flat.forEach(m => unique.set(`${m.leagueId}:${m.id}`, m));

    allMatches = [...unique.values()]
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .slice(0, CONFIG.maxEvents);

    if (!allMatches.length) {
      setStatus("No se han encontrado eventos en la fuente pública. Prueba de nuevo en unos minutos.");
    } else {
      setStatus(`${allMatches.length} eventos cargados · ${new Date().toLocaleTimeString("es-ES", {hour:"2-digit", minute:"2-digit"})}`);
    }

    render();
  }

  function sportLabel(s) {
    return ({
      football: "⚽ FÚTBOL",
      basketball: "🏀 BALONCESTO",
      tennis: "🎾 TENIS",
      racing: "🏎️ MOTOR"
    })[s] || s;
  }

  function calculatePick(m) {
    const hRank = Number.isFinite(m.homeRank) ? m.homeRank : 99;
    const aRank = Number.isFinite(m.awayRank) ? m.awayRank : 99;
    const rankEdge = aRank - hRank;

    let pick = "Mercado no recomendado";
    let score = 50;
    let reason = "Datos insuficientes para una señal fuerte.";

    if (m.sport === "football") {
      if (rankEdge >= 5) {
        pick = "1X";
        score = Math.min(82, 61 + rankEdge);
        reason = "Ventaja de posición/ranking del equipo local.";
      } else if (rankEdge <= -5) {
        pick = "X2";
        score = Math.min(82, 61 + Math.abs(rankEdge));
        reason = "Ventaja de posición/ranking del equipo visitante.";
      } else {
        pick = "Más de 1,5 goles";
        score = 57;
        reason = "No hay una diferencia suficiente de ranking para elegir 1X2.";
      }
    } else if (m.sport === "basketball") {
      if (rankEdge >= 5) {
        pick = "Local gana";
        score = Math.min(84, 62 + rankEdge);
        reason = "Ventaja de ranking local.";
      } else if (rankEdge <= -5) {
        pick = "Visitante gana";
        score = Math.min(84, 62 + Math.abs(rankEdge));
        reason = "Ventaja de ranking visitante.";
      } else {
        pick = "Mercado no recomendado";
        score = 52;
        reason = "Diferencia insuficiente entre ambos equipos.";
      }
    } else if (m.sport === "tennis") {
      if (rankEdge >= 10) {
        pick = "Victoria local";
        score = Math.min(86, 64 + Math.floor(rankEdge / 2));
        reason = "Diferencia relevante en ranking.";
      } else if (rankEdge <= -10) {
        pick = "Victoria visitante";
        score = Math.min(86, 64 + Math.floor(Math.abs(rankEdge) / 2));
        reason = "Diferencia relevante en ranking.";
      } else {
        pick = "Mercado no recomendado";
        score = 51;
        reason = "Ranking demasiado parejo.";
      }
    } else if (m.sport === "racing") {
      pick = "Sin pick automático";
      score = 50;
      reason = "La F1 necesita datos específicos de clasificación, pilotos y circuito.";
    }

    // Penalización por falta de datos.
    if (!m.homeRecord && !m.awayRecord) score -= 5;
    score = Math.max(50, Math.min(90, Math.round(score)));

    return { pick, score, reason };
  }

  function filtered() {
    if (activeSport === "all") return allMatches;
    return allMatches.filter(m => m.sport === activeSport);
  }

  function topPicks() {
    return filtered()
      .map(m => ({ m, p: calculatePick(m) }))
      .filter(x => x.p.score >= 55 && !/no recomendado|sin pick/i.test(x.p.pick))
      .sort((a, b) => b.p.score - a.p.score)
      .slice(0, 5);
  }

  function ensureUI() {
    if ($("matches")) return;

    const root = document.body;
    const app = document.createElement("main");
    app.id = "predictionApp";
    app.style.cssText = "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:900px;margin:0 auto;padding:18px;";

    app.innerHTML = `
      <section style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
        <button id="refreshBtn">🔄 Actualizar</button>
        <select id="sportFilter">
          <option value="all">Todos los deportes</option>
          <option value="football">⚽ Fútbol</option>
          <option value="basketball">🏀 Baloncesto</option>
          <option value="tennis">🎾 Tenis</option>
          <option value="racing">🏎️ Motor</option>
        </select>
        <span id="dataStatus" style="font-size:13px;opacity:.75"></span>
      </section>
      <section id="topPicks"></section>
      <section id="matches"></section>
    `;
    root.prepend(app);

    $("refreshBtn").onclick = loadMatches;
    $("sportFilter").onchange = e => {
      activeSport = e.target.value;
      render();
    };
  }

  function setStatus(text) {
    const el = $("dataStatus");
    if (el) el.textContent = text;
  }

  function renderTop() {
    const box = $("topPicks");
    if (!box) return;

    const picks = topPicks();

    box.innerHTML = `
      <div style="margin:12px 0">
        <h2 style="margin-bottom:6px">🔥 TOP 5 PICKS AUTOMÁTICOS</h2>
        <div style="font-size:12px;opacity:.7;margin-bottom:12px">
          Señales calculadas con los datos disponibles. No son garantías de resultado.
        </div>
        ${picks.length ? picks.map((x, i) => `
          <article style="border:1px solid #ddd;border-radius:14px;padding:14px;margin:9px 0;background:#fff">
            <div style="font-size:12px;opacity:.7">${i + 1}. ${esc(sportLabel(x.m.sport))} · ${esc(x.m.league)}</div>
            <div style="font-weight:700;font-size:17px;margin:5px 0">${esc(x.m.home)} — ${esc(x.m.away)}</div>
            <div style="font-size:18px;font-weight:700">🎯 ${esc(x.p.pick)}</div>
            <div style="margin-top:5px">Confianza algorítmica: <b>${x.p.score}/100</b></div>
            <div style="font-size:13px;opacity:.75;margin-top:5px">${esc(x.p.reason)}</div>
            <div style="font-size:12px;opacity:.65;margin-top:6px">${esc(fmtDate(x.m.date))}</div>
          </article>
        `).join("") : `<div style="padding:14px;border:1px solid #ddd;border-radius:14px">No hay suficientes señales para generar un Top 5 ahora mismo.</div>`}
      </div>
    `;
  }

  function renderMatches() {
    const box = $("matches");
    if (!box) return;

    const items = filtered();

    box.innerHTML = `
      <h2>📅 Eventos encontrados</h2>
      ${items.length ? items.map(m => {
        const p = calculatePick(m);
        return `
          <article style="border:1px solid #e1e1e1;border-radius:12px;padding:12px;margin:8px 0">
            <div style="font-size:12px;opacity:.7">${esc(sportLabel(m.sport))} · ${esc(m.league)}</div>
            <div style="font-weight:650;margin:4px 0">${esc(m.home)} — ${esc(m.away)}</div>
            <div style="font-size:13px">${esc(fmtDate(m.date))}</div>
            <div style="margin-top:6px">Pick: <b>${esc(p.pick)}</b> · ${p.score}/100</div>
          </article>
        `;
      }).join("") : `<div>No hay eventos para este filtro.</div>`}
    `;
  }

  function render() {
    ensureUI();
    renderTop();
    renderMatches();
  }

  function boot() {
    ensureUI();
    loadMatches();
    setInterval(loadMatches, CONFIG.refreshMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
