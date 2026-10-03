const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const $ = id => document.getElementById(id);

const leagueNames = {
  "esp.1":"LaLiga",
  "eng.1":"Premier League",
  "ita.1":"Serie A",
  "ger.1":"Bundesliga",
  "fra.1":"Ligue 1",
  "uefa.champions":"Champions League"
};

function todayISO(){
  const d = new Date();
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}

if ($("date")) $("date").value = todayISO();

function fmtTime(iso){
  try {
    return new Intl.DateTimeFormat("es-ES",{hour:"2-digit",minute:"2-digit"}).format(new Date(iso));
  } catch {
    return "";
  }
}

function esc(v){
  return String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function statusText(ev){
  const s = ev?.competitions?.[0]?.status || ev?.status;
  if(!s) return "";
  if(s.type?.completed) return "FINAL";
  if(s.type?.state==="in"){
    return s.displayClock ? `EN DIRECTO · ${s.displayClock}` : "EN DIRECTO";
  }
  return fmtTime(ev.date);
}

function isLive(ev){
  return ev?.status?.type?.state==="in" ||
         ev?.competitions?.[0]?.status?.type?.state==="in";
}

function getTeams(ev){
  const c = ev?.competitions?.[0]?.competitors || [];
  const home = c.find(x=>x.homeAway==="home") || c[0];
  const away = c.find(x=>x.homeAway==="away") || c[1];
  return {home,away};
}

function num(v){
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function records(team){
  const r = team?.records || [];
  const text = r.map(x=>x.summary||"").find(Boolean) || "";
  const m = text.match(/(\d+)-(\d+)(?:-(\d+))?/);
  if(!m) return null;
  return {w:+m[1],l:+m[2],d:m[3]?+m[3]:0,text};
}

function marketOdds(ev){
  const odds = ev?.competitions?.[0]?.odds;
  if(!Array.isArray(odds) || !odds.length) return null;
  const o = odds[0];
  return {
    details:o.details || "",
    overUnder:num(o.overUnder),
    home:num(o.homeTeamOdds?.moneyLine),
    away:num(o.awayTeamOdds?.moneyLine),
    draw:num(o.drawOdds?.moneyLine)
  };
}

function pctFromMoneyline(ml){
  if(ml==null) return null;
  return ml>0 ? 100/(ml+100) : (-ml)/((-ml)+100)*100;
}

function statNumber(value){
  if(value == null) return null;
  if(typeof value === "number") return value;
  const m = String(value).replace(",",".").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function extractStats(summary, homeId, awayId){
  const out = {
    home:{shots:0,onTarget:0,corners:0,possession:null,attacks:null},
    away:{shots:0,onTarget:0,corners:0,possession:null,attacks:null}
  };

  const all = [];
  const walk = node => {
    if(!node || typeof node !== "object") return;
    if(Array.isArray(node)){
      node.forEach(walk);
      return;
    }
    if(node.statistics && Array.isArray(node.statistics)) all.push(node);
    Object.values(node).forEach(v => {
      if(v && typeof v === "object") walk(v);
    });
  };
  walk(summary);

  for(const block of all){
    const teamId = String(block.team?.id ?? block.id ?? "");
    const side = teamId === String(homeId) ? "home" :
                 teamId === String(awayId) ? "away" : null;
    if(!side) continue;

    for(const s of block.statistics || []){
      const name = String(s.name || s.label || "").toLowerCase();
      const value = statNumber(s.displayValue ?? s.value);
      if(value == null) continue;

      if(name.includes("shot on target") || name.includes("shots on target")){
        out[side].onTarget = value;
      } else if(name === "shots" || name.includes("total shots")){
        out[side].shots = value;
      } else if(name.includes("corner")){
        out[side].corners = value;
      } else if(name.includes("possession")){
        out[side].possession = value;
      } else if(name.includes("attack")){
        out[side].attacks = value;
      }
    }
  }
  return out;
}

async function fetchSummary(ev){
  if(!ev?.id) return null;
  const league = $("league")?.value;
  if(!league) return null;

  try{
    const url = `${API}/${league}/summary?event=${encodeURIComponent(ev.id)}`;
    const res = await fetch(url,{cache:"no-store"});
    if(!res.ok) return null;
    return await res.json();
  }catch{
    return null;
  }
}

function livePick(ev, stats){
  const {home,away} = getTeams(ev);
  const hs = num(home?.score), as = num(away?.score);
  const total = (hs ?? 0) + (as ?? 0);
  const h = stats?.home || {};
  const a = stats?.away || {};

  // A live signal needs more than just the score.
  if(total >= 1){
    let confidence = 68;
    const reasons = [`ya hay ${total} gol${total===1?"":"es"}`];

    const shots = (h.shots||0) + (a.shots||0);
    const onTarget = (h.onTarget||0) + (a.onTarget||0);
    const corners = (h.corners||0) + (a.corners||0);

    if(shots >= 8) { confidence += 5; reasons.push(`${shots} tiros`); }
    if(onTarget >= 3) { confidence += 5; reasons.push(`${onTarget} tiros a puerta`); }
    if(corners >= 4) { confidence += 3; reasons.push(`${corners} córners`); }

    return {
      market:"Goles",
      pick:"Más de 0.5 goles",
      confidence:Math.min(86,confidence),
      reason:`Señal en directo: ${reasons.join(" · ")}. No garantiza el resultado.`
    };
  }

  const shots = (h.shots||0) + (a.shots||0);
  const onTarget = (h.onTarget||0) + (a.onTarget||0);
  const corners = (h.corners||0) + (a.corners||0);
  const possession = Math.max(h.possession||0,a.possession||0);

  if(onTarget >= 3 || shots >= 9 || corners >= 5){
    const confidence = Math.min(74,55 + onTarget*3 + Math.max(0,shots-8));
    return {
      market:"Goles · En directo",
      pick:"Más de 0.5 goles",
      confidence:Math.round(confidence),
      reason:`0-0, pero hay presión ofensiva: ${shots} tiros, ${onTarget} a puerta y ${corners} córners. Posesión máxima ${possession || "N/D"}%.`
    };
  }

  return {
    market:"En directo",
    pick:"Esperar más señales",
    confidence:50,
    reason:"0-0 y las estadísticas disponibles todavía no muestran una presión ofensiva suficiente para generar una señal."
  };
}

function preMatchPick(ev){
  const {home,away} = getTeams(ev);
  const hr = records(home), ar = records(away), odds = marketOdds(ev);

  let score = 0;
  const reasons = [];

  if(hr && ar){
    const hRate = (hr.w + 0.5*hr.d) / Math.max(1,hr.w+hr.d+hr.l);
    const aRate = (ar.w + 0.5*ar.d) / Math.max(1,ar.w+ar.d+ar.l);
    const diff = hRate - aRate;
    score += diff * 55;
    reasons.push(`balance: ${hr.text} vs ${ar.text}`);
  }

  const hp = pctFromMoneyline(odds?.home);
  const ap = pctFromMoneyline(odds?.away);

  if(hp!=null && ap!=null){
    score += (hp-ap) * 0.7;
    reasons.push("cuota 1X2 disponible");
  }

  if(Math.abs(score) >= 10){
    const homePick = score > 0;
    const team = homePick ? home?.team?.displayName : away?.team?.displayName;
    const confidence = Math.round(Math.min(80,54 + Math.abs(score)*0.6));

    return {
      market:"1X2",
      pick:`Gana ${team || (homePick?"local":"visitante")}`,
      confidence,
      reason:reasons.join(" · ")
    };
  }

  if(odds?.overUnder!=null){
    return {
      market:"Total goles",
      pick:`Más de ${odds.overUnder} goles`,
      confidence:57,
      reason:`La línea disponible es ${odds.overUnder}. La señal es moderada porque faltan más estadísticas ofensivas/defensivas.`
    };
  }

  return {
    market:"Sin pick",
    pick:"Esperar más datos",
    confidence:50,
    reason:"No hay suficientes señales prepartido en los datos disponibles."
  };
}

function buildPick(ev, stats){
  return isLive(ev) ? livePick(ev,stats) : preMatchPick(ev);
}

function card(ev, stats){
  const {home,away} = getTeams(ev);
  const live = isLive(ev);
  const completed = ev?.status?.type?.completed;
  const p = buildPick(ev,stats);
  const status = statusText(ev);

  return `<article class="card">
    <div class="matchtop">
      <span>${esc(ev?.league?.name || leagueNames[$("league")?.value] || "Fútbol")}</span>
      <span class="${live?"live":""}">${esc(status)}</span>
    </div>
    <div class="teams">
      <div class="team">${esc(home?.team?.displayName || "Local")}</div>
      <div class="score">${live || completed ? `${esc(home?.score??0)} - ${esc(away?.score??0)}` : "VS"}</div>
      <div class="team away">${esc(away?.team?.displayName || "Visitante")}</div>
    </div>
    <div class="pick">
      <div class="label">${esc(p.market)}</div>
      <strong>${esc(p.pick)}</strong>
      <div class="meta">
        <span>Confianza estimada</span>
        <span class="confidence">${esc(p.confidence)}%</span>
      </div>
      <p class="reason">${esc(p.reason)}</p>
    </div>
  </article>`;
}

async function load(){
  if(!$("league") || !$("date")) return;

  $("status").textContent="Cargando datos…";
  $("matches").innerHTML="";

  const league = $("league").value;
  const date = $("date").value.replaceAll("-","");
  const url = `${API}/${league}/scoreboard?dates=${date}`;

  try{
    const res = await fetch(url,{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const events = (data.events||[]).filter(e=>e?.name);

    events.sort((a,b)=>new Date(a.date)-new Date(b.date));

    // For live matches, request the event summary so the live signal can use
    // shots, shots on target, corners and possession when ESPN provides them.
    const liveEvents = events.filter(isLive);
    const summaries = await Promise.all(liveEvents.map(fetchSummary));
    const statsMap = new Map();

    liveEvents.forEach((ev,i)=>{
      const summary = summaries[i];
      const {home,away} = getTeams(ev);
      if(summary){
        statsMap.set(ev.id, extractStats(
          summary,
          home?.team?.id,
          away?.team?.id
        ));
      }
    });

    $("updated").textContent =
      `Actualizado ${new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}`;

    const liveCount = events.filter(isLive).length;
    const picks = events.filter(ev=>{
      const p = buildPick(ev,statsMap.get(ev.id));
      return p.pick!=="Sin pick todavía" && p.pick!=="Esperar más datos";
    }).length;

    $("summary").classList.remove("hidden");
    $("summary").innerHTML=`
      <div class="stat"><b>${events.length}</b><span>Partidos encontrados</span></div>
      <div class="stat"><b>${liveCount}</b><span>En directo</span></div>
      <div class="stat"><b>${picks}</b><span>Con señal</span></div>`;

    $("status").textContent=`${leagueNames[league]||league} · ${date}`;

    $("matches").innerHTML = events.length
      ? events.map(ev=>card(ev,statsMap.get(ev.id))).join("")
      : `<div class="empty">No aparecen partidos para esta competición y fecha. Prueba otra competición o fecha.</div>`;

  }catch(err){
    console.error(err);
    $("status").textContent="No se pudieron cargar los datos.";
    $("matches").innerHTML=
      `<div class="empty">La fuente de datos no ha respondido. Pulsa «Actualizar» o prueba otra competición. <br><br><small>${esc(err.message)}</small></div>`;
  }
}

$("refreshBtn")?.addEventListener("click",load);
$("league")?.addEventListener("change",load);
$("date")?.addEventListener("change",load);

load();

// Actualización automática cada 60 segundos para que los partidos en directo
// no dependan de pulsar manualmente "Actualizar".
setInterval(()=>{
  if($("date")?.value === todayISO()) load();
},60000);
