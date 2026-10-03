/* ============================================================
   PREDICCIÓN MULTIDEPORTE — app.js
   Fuente: TheSportsDB V1 (clave pública 123)
   Sin cuenta ni API key personal.
   ============================================================ */

(() => {
  "use strict";

  const API = "https://www.thesportsdb.com/api/v1/json/123";
  const SPORTS = [
    { id: "all", name: "Todos", icon: "🌍" },
    { id: "Soccer", name: "Fútbol", icon: "⚽" },
    { id: "Basketball", name: "Baloncesto", icon: "🏀" },
    { id: "Tennis", name: "Tenis", icon: "🎾" },
    { id: "Motorsport", name: "Motor", icon: "🏎️" },
    { id: "Ice Hockey", name: "Hockey", icon: "🏒" },
    { id: "Baseball", name: "Béisbol", icon: "⚾" },
    { id: "American Football", name: "NFL", icon: "🏈" },
    { id: "Rugby", name: "Rugby", icon: "🏉" },
    { id: "Volleyball", name: "Voleibol", icon: "🏐" },
    { id: "Handball", name: "Balonmano", icon: "🤾" },
    { id: "Fighting", name: "Combate", icon: "🥊" },
    { id: "Golf", name: "Golf", icon: "⛳" },
    { id: "Cycling", name: "Ciclismo", icon: "🚴" }
  ];

  const state = {
    events: [],
    sport: "all",
    date: localISO(),
    loading: false,
    lastUpdate: null
  };

  const $ = (s, root = document) => root.querySelector(s);

  function localISO(date = new Date()) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function esc(v) {
    return String(v ?? "")
      .replaceAll("&","&amp;").replaceAll("<","&lt;")
      .replaceAll(">","&gt;").replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function sportInfo(s) {
    return SPORTS.find(x => x.id === s) || {name:s || "Deporte", icon:"🏆"};
  }

  function eventSport(e) {
    return e?.strSport || e?.strSportName || "Otros";
  }

  function eventTime(e) {
    const raw = e?.strTimestamp || (e?.dateEvent && e?.strTime
      ? `${e.dateEvent}T${e.strTime}` : e?.dateEvent);
    if (!raw) return "Hora no disponible";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return e?.strTime || "Hora no disponible";
    return new Intl.DateTimeFormat("es-ES", {
      day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit"
    }).format(d);
  }

  function isCompleted(e) {
    const s = String(e?.strStatus || "").toLowerCase();
    return !!(e?.intHomeScore != null || e?.intAwayScore != null) ||
      ["match finished","finished","ft","final","aot","after penalties"].includes(s);
  }

  function isLive(e) {
    const s = String(e?.strStatus || "").toLowerCase();
    return ["1h","2h","ht","live","in progress","q1","q2","q3","q4"].includes(s);
  }

  function status(e) {
    if (isLive(e)) return "🔴 EN DIRECTO";
    if (isCompleted(e)) return "FINALIZADO";
    return "PRÓXIMO";
  }

  function availableScore(e) {
    const h = Number(e?.intHomeScore);
    const a = Number(e?.intAwayScore);
    if (Number.isFinite(h) && Number.isFinite(a)) return `${h} - ${a}`;
    return "VS";
  }

  /*
   * Importante:
   * TheSportsDB proporciona calendarios/resultados y algunos datos
   * de eventos. No inventamos probabilidades cuando no existen datos
   * suficientes. El motor devuelve "Sin pick" hasta disponer de señales.
   */
  function analyse(e) {
    const sport = eventSport(e);
    const h = Number(e?.intHomeScore);
    const a = Number(e?.intAwayScore);

    if (isCompleted(e) && Number.isFinite(h) && Number.isFinite(a)) {
      return {
        market: "Resultado",
        pick: `${e.strHomeTeam || "Local"} ${h}-${a} ${e.strAwayTeam || "Visitante"}`,
        confidence: null,
        reason: "Resultado oficial disponible. No se presenta como predicción."
      };
    }

    // No fabricamos picks. La primera versión usa solo señales
    // que realmente estén presentes en la fuente.
    if (sport === "Soccer" && e?.strLeague) {
      return {
        market: "Análisis",
        pick: "Esperar datos",
        confidence: null,
        reason: "Hay partido, pero esta fuente gratuita no aporta suficientes estadísticas prepartido para justificar un pick."
      };
    }

    return {
      market: "Análisis",
      pick: "Esperar datos",
      confidence: null,
      reason: "Evento localizado. Se necesita información estadística adicional antes de generar una señal."
    };
  }

  function buildStyles() {
    if ($("#pred-app-styles")) return;
    const style = document.createElement("style");
    style.id = "pred-app-styles";
    style.textContent = `
      :root{--bg:#071018;--card:#0e1a24;--card2:#142431;--border:#223746;
      --text:#f4f7fa;--muted:#91a4b2;--accent:#54d6a7;--danger:#ff7373}
      *{box-sizing:border-box}
      body{margin:0;background:linear-gradient(180deg,#071018,#09151e 55%,#071018);
      color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .pred-wrap{max-width:760px;margin:auto;padding:18px 14px 35px}
      .pred-head{padding:10px 2px 16px}
      .pred-head h1{font-size:25px;margin:0 0 6px}
      .pred-head p{margin:0;color:var(--muted);font-size:13px}
      .pred-controls{display:grid;grid-template-columns:1fr 150px 100px;gap:8px;margin-bottom:12px}
      select,input,button{width:100%;border:1px solid var(--border);background:var(--card);
      color:var(--text);border-radius:12px;padding:12px;font-size:14px}
      button{background:var(--accent);color:#062016;border:0;font-weight:800}
      button:disabled{opacity:.55}
      .sports{display:flex;gap:7px;overflow:auto;padding:2px 0 12px;scrollbar-width:none}
      .sports::-webkit-scrollbar{display:none}
      .sport-btn{white-space:nowrap;width:auto;padding:9px 12px;background:var(--card);
      border:1px solid var(--border);color:var(--text);border-radius:999px}
      .sport-btn.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
      .pred-info{color:var(--muted);font-size:12px;margin:8px 2px 12px}
      .pred-card{background:var(--card);border:1px solid var(--border);border-radius:17px;
      padding:14px;margin-bottom:10px}
      .top{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:11px}
      .teams{display:grid;grid-template-columns:1fr 55px 1fr;gap:7px;align-items:center;
      margin:15px 0 12px}
      .team{font-size:16px;font-weight:750}
      .away{text-align:right}.score{text-align:center;font-weight:850;font-size:16px}
      .time{text-align:center;color:var(--muted);font-size:12px;margin-bottom:12px}
      .pick{background:var(--card2);border-radius:13px;padding:12px}
      .label{color:var(--muted);font-size:10px;text-transform:uppercase}
      .pick strong{display:block;font-size:18px;margin:4px 0}
      .reason{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.45}
      .empty,.error{background:var(--card);border:1px solid var(--border);border-radius:16px;
      padding:22px;text-align:center;color:var(--muted)}
      .error{color:#ffabab}
      .footer{margin-top:16px;text-align:center;color:var(--muted);font-size:10px;line-height:1.5}
      @media(max-width:560px){.pred-controls{grid-template-columns:1fr 105px}.pred-controls button{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function shell() {
    buildStyles();
    let root = $("#pred-app");
    if (!root) {
      root = document.createElement("main");
      root.id = "pred-app";
      document.body.innerHTML = "";
      document.body.appendChild(root);
    }

    root.innerHTML = `
      <section class="pred-head">
        <h1>🏆 Predicción Multideporte</h1>
        <p>Partidos y eventos disponibles, con análisis sin inventar estadísticas.</p>
      </section>

      <div class="sports" id="sports">
        ${SPORTS.map(s => `
          <button class="sport-btn ${s.id === "all" ? "active" : ""}" data-sport="${esc(s.id)}">
            ${s.icon} ${esc(s.name)}
          </button>`).join("")}
      </div>

      <div class="pred-controls">
        <input id="pred-date" type="date" value="${state.date}">
        <select id="pred-sport">
          ${SPORTS.map(s => `<option value="${esc(s.id)}">${s.icon} ${esc(s.name)}</option>`).join("")}
        </select>
        <button id="pred-refresh">Actualizar</button>
      </div>

      <div id="pred-info" class="pred-info">Preparando datos…</div>
      <section id="pred-list"></section>

      <div class="footer">
        Fuente de eventos: TheSportsDB V1. La fuente gratuita permite consultar calendarios
        y resultados de múltiples deportes. No se muestran probabilidades inventadas.
      </div>
    `;

    $("#pred-sport").value = state.sport;
    $("#pred-date").addEventListener("change", e => {
      state.date = e.target.value || localISO();
      load();
    });
    $("#pred-sport").addEventListener("change", e => {
      state.sport = e.target.value;
      syncSportButtons();
      load();
    });
    $("#pred-refresh").addEventListener("click", load);

    $("#sports").querySelectorAll("[data-sport]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.sport = btn.dataset.sport;
        $("#pred-sport").value = state.sport;
        syncSportButtons();
        load();
      });
    });
  }

  function syncSportButtons() {
    $("#sports")?.querySelectorAll("[data-sport]").forEach(b => {
      b.classList.toggle("active", b.dataset.sport === state.sport);
    });
  }

  async function fetchSport(sport) {
    const url = `${API}/eventsday.php?d=${encodeURIComponent(state.date)}&s=${encodeURIComponent(sport)}`;
    const res = await fetch(url, { cache:"no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    const info = $("#pred-info");
    const list = $("#pred-list");
    const btn = $("#pred-refresh");

    if (btn) { btn.disabled = true; btn.textContent = "Cargando…"; }
    if (info) info.textContent = "Consultando eventos…";
    if (list) list.innerHTML = "";

    try {
      const sports = state.sport === "all"
        ? SPORTS.filter(s => s.id !== "all")
        : [sportInfo(state.sport)];

      // La API gratuita limita cada consulta a 3 eventos.
      // Consultamos los deportes seleccionados y unimos resultados.
      const chunks = await Promise.allSettled(sports.map(s => fetchSport(s.id)));
      const events = [];
      chunks.forEach((r, i) => {
        if (r.status === "fulfilled") {
          r.value.forEach(e => events.push({
            ...e,
            _sport: sports[i].id
          }));
        }
      });

      const unique = [...new Map(events.map(e => [e.idEvent || `${e.strEvent}-${e.dateEvent}`, e])).values()];
      unique.sort((a,b) => {
        const ta = new Date(a.strTimestamp || `${a.dateEvent || state.date}T${a.strTime || "00:00"}`).getTime();
        const tb = new Date(b.strTimestamp || `${b.dateEvent || state.date}T${b.strTime || "00:00"}`).getTime();
        return (Number.isFinite(ta)?ta:0) - (Number.isFinite(tb)?tb:0);
      });

      state.events = unique;
      state.lastUpdate = new Date();
      render();
    } catch (err) {
      console.error(err);
      if (info) info.textContent = "Error al consultar la fuente.";
      if (list) list.innerHTML = `
        <div class="error">
          No se han podido cargar los eventos.<br><br>
          Pulsa <b>Actualizar</b> para intentarlo de nuevo.
        </div>`;
    } finally {
      state.loading = false;
      if (btn) { btn.disabled = false; btn.textContent = "Actualizar"; }
    }
  }

  function render() {
    const list = $("#pred-list");
    const info = $("#pred-info");
    if (!list) return;

    const events = state.events;
    if (!events.length) {
      list.innerHTML = `<div class="empty">No hay eventos disponibles para este deporte y fecha.</div>`;
      if (info) info.textContent = "0 eventos encontrados.";
      return;
    }

    if (info) {
      info.textContent = `${events.length} eventos · ${state.date} · actualizado ${
        state.lastUpdate.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})
      }`;
    }

    list.innerHTML = events.map(card).join("");
  }

  function card(e) {
    const sport = sportInfo(eventSport(e));
    const analysis = analyse(e);
    const home = e.strHomeTeam || e.strPlayer1 || e.strEvent || "Participante 1";
    const away = e.strAwayTeam || e.strPlayer2 || "";
    const isOneSided = !away;

    return `
      <article class="pred-card">
        <div class="top">
          <span>${sport.icon} ${esc(e.strLeague || eventSport(e))}</span>
          <span>${esc(status(e))}</span>
        </div>

        <div class="teams">
          <div class="team">${esc(home)}</div>
          <div class="score">${esc(availableScore(e))}</div>
          <div class="team away">${esc(away)}</div>
        </div>

        <div class="time">${esc(eventTime(e))}</div>

        <div class="pick">
          <div class="label">${esc(analysis.market)}</div>
          <strong>${esc(analysis.pick)}</strong>
          <p class="reason">${esc(analysis.reason)}</p>
        </div>
      </article>`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    shell();
    load();
  });
})();
