const API = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const $ = id => document.getElementById(id);

const leagueNames = {
  "esp.1":"LaLiga","eng.1":"Premier League","ita.1":"Serie A",
  "ger.1":"Bundesliga","fra.1":"Ligue 1","uefa.champions":"Champions League"
};

function todayISO(){
  const d = new Date();
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
}
$("date").value = todayISO();

function fmtTime(iso){
  try { return new Intl.DateTimeFormat("es-ES",{hour:"2-digit",minute:"2-digit"}).format(new Date(iso)); }
  catch { return ""; }
}

function statusText(ev){
  const s=ev?.competitions?.[0]?.status || ev?.status;
  if(!s) return "";
  if(s.type?.completed) return "FINAL";
  if(s.type?.state==="in") return s.displayClock ? `EN DIRECTO · ${s.displayClock}` : "EN DIRECTO";
  return fmtTime(ev.date);
}

function getTeams(ev){
  const c=ev.competitions?.[0]?.competitors || [];
  const home=c.find(x=>x.homeAway==="home") || c[0];
  const away=c.find(x=>x.homeAway==="away") || c[1];
  return {home,away};
}

function num(v){ const n=parseFloat(v); return Number.isFinite(n)?n:null; }

function records(team){
  const r=team?.records || [];
  const text=r.map(x=>x.summary||"").find(Boolean) || "";
  const m=text.match(/(\d+)-(\d+)(?:-(\d+))?/);
  if(!m) return null;
  return {w:+m[1],l:+m[2],d:m[3]?+m[3]:0,text};
}

function marketOdds(ev){
  const odds=ev?.competitions?.[0]?.odds;
  if(!Array.isArray(odds)||!odds.length) return null;
  const o=odds[0];
  const details=o.details || "";
  const overUnder=num(o.overUnder);
  const home=num(o.homeTeamOdds?.moneyLine);
  const away=num(o.awayTeamOdds?.moneyLine);
  const draw=num(o.drawOdds?.moneyLine);
  return {details,overUnder,home,away,draw};
}

function pctFromMoneyline(ml){
  if(ml==null) return null;
  return ml>0 ? 100/(ml+100) : (-ml)/((-ml)+100)*100;
}

function buildPick(ev){
  const {home,away}=getTeams(ev);
  const hr=records(home), ar=records(away), odds=marketOdds(ev);
  const hs=num(home?.score), as=num(away?.score);
  const live=ev?.status?.type?.state==="in" || ev?.competitions?.[0]?.status?.type?.state==="in";

  // 1) If the match is live, only use the current score for a conservative goals signal.
  if(live && hs!=null && as!=null){
    const total=hs+as;
    if(total>=1) return {
      market:"Goles", pick:"Más de 0.5 goles",
      confidence:Math.min(91,72+total*5),
      reason:`Ya hay ${total} gol${total===1?"":"es"} en el partido. La señal es únicamente de mercado de goles y no implica que vaya a marcar un equipo concreto.`
    };
    return {
      market:"Goles", pick:"Sin pick todavía",
      confidence:50,
      reason:"El partido sigue 0-0. Con el marcador disponible no hay suficiente información para justificar un pick fuerte."
    };
  }

  // 2) Pre-match heuristic from records and available moneyline.
  let score=0, reasons=[];
  if(hr && ar){
    const hRate=(hr.w+0.5*hr.d)/Math.max(1,hr.w+hr.d+hr.l);
    const aRate=(ar.w+0.5*ar.d)/Math.max(1,ar.w+ar.d+ar.l);
    const diff=hRate-aRate;
    score += diff*55;
    reasons.push(`balance reciente: ${hr.text} vs ${ar.text}`);
  }
  const hp=pctFromMoneyline(odds?.home), ap=pctFromMoneyline(odds?.away);
  if(hp!=null && ap!=null){
    score += (hp-ap)*0.7;
    reasons.push("hay cuota 1X2 disponible en los datos");
  }

  if(Math.abs(score)>=10){
    const homePick=score>0;
    const pick=homePick ? `Gana ${home?.team?.displayName||"local"}` : `Gana ${away?.team?.displayName||"visitante"}`;
    const confidence=Math.round(Math.min(82,55+Math.abs(score)*0.65));
    return {market:"1X2",pick,confidence,reason:reasons.join(" · ")};
  }

  if(odds?.overUnder!=null){
    return {
      market:"Total goles",
      pick:`Más de ${odds.overUnder} goles`,
      confidence:57,
      reason:`La línea disponible es ${odds.overUnder}. Sin estadísticas ofensivas/defensivas suficientes, se mantiene una confianza moderada.`
    };
  }

  return {
    market:"Sin pick",
    pick:"Esperar más datos",
    confidence:50,
    reason:"No hay suficientes señales prepartido en la respuesta pública para justificar una selección."
  };
}

function card(ev){
  const {home,away}=getTeams(ev);
  const live=ev?.status?.type?.state==="in";
  const p=buildPick(ev);
  const status=statusText(ev);
  return `<article class="card">
    <div class="matchtop"><span>${ev?.league?.name||leagueNames[$("league").value]||"Fútbol"}</span><span class="${live?"live":""}">${status}</span></div>
    <div class="teams">
      <div class="team">${home?.team?.displayName||"Local"}</div>
      <div class="score">${live || ev?.status?.type?.completed ? `${home?.score??0} - ${away?.score??0}` : "VS"}</div>
      <div class="team away">${away?.team?.displayName||"Visitante"}</div>
    </div>
    <div class="pick">
      <div class="label">${p.market}</div>
      <strong>${p.pick}</strong>
      <div class="meta"><span>Confianza estimada</span><span class="confidence">${p.confidence}%</span></div>
      <p class="reason">${p.reason}</p>
    </div>
  </article>`;
}

async function load(){
  $("status").textContent="Cargando datos…";
  $("matches").innerHTML="";
  const league=$("league").value, date=$("date").value.replaceAll("-","");
  const url=`${API}/${league}/scoreboard?dates=${date}`;
  try{
    const res=await fetch(url,{cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    const events=(data.events||[]).filter(e=>e?.name);
    events.sort((a,b)=>new Date(a.date)-new Date(b.date));
    $("updated").textContent=`Actualizado ${new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}`;

    const live=events.filter(e=>e?.status?.type?.state==="in").length;
    $("summary").classList.remove("hidden");
    $("summary").innerHTML=`
      <div class="stat"><b>${events.length}</b><span>Partidos encontrados</span></div>
      <div class="stat"><b>${live}</b><span>En directo</span></div>
      <div class="stat"><b>${events.filter(e=>buildPick(e).pick!=="Sin pick todavía"&&buildPick(e).pick!=="Esperar más datos").length}</b><span>Con señal</span></div>`;

    $("status").textContent=`${leagueNames[league]||league} · ${date}`;
    $("matches").innerHTML=events.length ? events.map(card).join("") :
      `<div class="empty">No aparecen partidos para esta competición y fecha. Prueba otra competición o fecha.</div>`;
  }catch(err){
    console.error(err);
    $("status").textContent="No se pudieron cargar los datos.";
    $("matches").innerHTML=`<div class="empty">La fuente de datos no ha respondido. Pulsa «Actualizar» o prueba otra competición. <br><br><small>${err.message}</small></div>`;
  }
}

$("refreshBtn").addEventListener("click",load);
$("league").addEventListener("change",load);
$("date").addEventListener("change",load);
load();