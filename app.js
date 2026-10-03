const leagues = [
  {sport:"soccer", league:"esp.1", label:"Fútbol · LaLiga", kind:"football"},
  {sport:"soccer", league:"eng.1", label:"Fútbol · Premier League", kind:"football"},
  {sport:"soccer", league:"ger.1", label:"Fútbol · Bundesliga", kind:"football"},
  {sport:"soccer", league:"ita.1", label:"Fútbol · Serie A", kind:"football"},
  {sport:"soccer", league:"fra.1", label:"Fútbol · Ligue 1", kind:"football"},
  {sport:"soccer", league:"uefa.champions", label:"Fútbol · Champions", kind:"football"},
  {sport:"basketball", league:"nba", label:"Baloncesto · NBA", kind:"basketball"},
  {sport:"basketball", league:"euroleague", label:"Baloncesto · Euroliga", kind:"basketball"},
  {sport:"tennis", league:"atp", label:"Tenis · ATP", kind:"tennis"},
  {sport:"tennis", league:"wta", label:"Tenis · WTA", kind:"tennis"},
  {sport:"racing", league:"f1", label:"Motor · F1", kind:"racing"}
];

let allMatches = [];
let activeSport = "all";

const $ = id => document.getElementById(id);

function todayUTC(){
  const d = new Date();
  return d.toISOString().slice(0,10).replaceAll("-","");
}

function formatDate(iso){
  try { return new Intl.DateTimeFormat("es-ES",{weekday:"short",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(iso)); }
  catch { return iso; }
}

function extractTeams(event){
  const c = event.competitions?.[0];
  const competitors = c?.competitors || [];
  const home = competitors.find(x=>x.homeAway==="home") || competitors[0];
  const away = competitors.find(x=>x.homeAway==="away") || competitors[1];
  return {home,away};
}

function predictorFromEvent(event){
  const c = event.competitions?.[0];
  const odds = c?.odds?.[0];
  const pc = odds?.provider ? odds : c?.pickcenter?.[0];
  if(!pc) return null;

  // ESPN schemas vary. Try common predictor/probability fields.
  const hp = Number(pc.homeTeamOdds?.winPercentage ?? pc.homeWinPercentage ?? pc.homeTeam?.winPercentage);
  const ap = Number(pc.awayTeamOdds?.winPercentage ?? pc.awayWinPercentage ?? pc.awayTeam?.winPercentage);
  if(Number.isFinite(hp) && Number.isFinite(ap)) return {hp,ap};

  const homeProb = Number(pc.homeTeamOdds?.winProbability);
  const awayProb = Number(pc.awayTeamOdds?.winProbability);
  if(Number.isFinite(homeProb) && Number.isFinite(awayProb)) return {hp:homeProb*100,ap:awayProb*100};

  return null;
}

function makePick(item){
  const {event, kind} = item;
  const {home,away} = extractTeams(event);
  if(!home || !away) return null;

  const pred = predictorFromEvent(event);
  if(pred){
    const max = Math.max(pred.hp,pred.ap);
    if(max >= 55){
      const team = pred.hp >= pred.ap ? home : away;
      return {title:`Gana ${team.team?.displayName || team.team?.name || "equipo"}`, detail:`Modelo público: ${max.toFixed(0)}% de probabilidad estimada`, confidence:Math.round(max)};
    }
  }

  // Fallback deliberately conservative: no invented pick.
  return {title:"Sin pick fiable", detail:"No hay datos públicos suficientes para generar una predicción automática.", confidence:null};
}

function normalizeEvent(event, league){
  const {home,away}=extractTeams(event);
  if(!home && !away) return null;
  return {
    id:event.id, kind:league.kind, label:league.label, date:event.date,
    status:event.status?.type?.description || event.status?.type?.shortDetail || "",
    home:home?.team?.displayName || home?.team?.name || "Local",
    away:away?.team?.displayName || away?.team?.name || "Visitante",
    event, pick:null
  };
}

async function fetchLeague(league){
  const url=`https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${todayUTC()}`;
  const res=await fetch(url,{cache:"no-store"});
  if(!res.ok) throw new Error(`${res.status}`);
  const data=await res.json();
  return (data.events||[]).map(e=>normalizeEvent(e,league)).filter(Boolean);
}

async function load(){
  $("status").textContent="Buscando partidos y eventos de hoy…";
  $("matches").innerHTML="";
  allMatches=[];

  const results=await Promise.allSettled(leagues.map(fetchLeague));
  results.forEach((r,i)=>{
    if(r.status==="fulfilled") allMatches.push(...r.value);
  });

  // Remove duplicate IDs and sort by start time.
  const map=new Map(allMatches.map(x=>[x.id,x]));
  allMatches=[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
  allMatches.forEach(x=>x.pick=makePick(x));

  $("updated").textContent=`Actualizado ${new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}`;
  render();
}

function render(){
  const list=activeSport==="all" ? allMatches : allMatches.filter(x=>x.kind===activeSport);
  if(!list.length){
    $("status").textContent="No se han encontrado eventos de esta categoría hoy.";
    $("matches").innerHTML=`<div class="empty">Prueba con «Todos» o pulsa «Actualizar».</div>`;
    return;
  }
  $("status").textContent=`${list.length} eventos encontrados`;
  $("matches").innerHTML=list.map(m=>`
    <article class="match">
      <div class="match-top"><span>${m.label}</span><span>${formatDate(m.date)}</span></div>
      <div class="teams">${m.home} <span style="font-weight:500;color:#8a94a3">vs</span> ${m.away}</div>
      ${m.status ? `<span class="badge">${m.status}</span>` : ""}
      <div class="pick">
        <strong>🎯 ${m.pick?.title || "Sin pick"}</strong>
        <span>${m.pick?.detail || ""}${m.pick?.confidence ? ` · Confianza orientativa: ${m.pick.confidence}%` : ""}</span>
      </div>
    </article>
  `).join("");
}

document.querySelectorAll(".filter").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    activeSport=btn.dataset.sport;
    render();
  });
});
$("refresh").addEventListener("click",load);
load().catch(err=>{
  $("status").textContent="No se pudieron cargar los datos.";
  $("matches").innerHTML=`<div class="empty">Comprueba la conexión y pulsa «Actualizar».<br><small>${err.message}</small></div>`;
});
