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

let allMatches=[];
let activeSport="all";
let activeGrade="all";

const $=id=>document.getElementById(id);
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

function todayUTC(){ return new Date().toISOString().slice(0,10).replaceAll("-",""); }
function formatDate(iso){
  try{return new Intl.DateTimeFormat("es-ES",{weekday:"short",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(iso));}
  catch{return iso;}
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function pct(v){
  const n=num(v); if(n===null)return null;
  return n<=1 ? n*100 : n;
}
function extractTeams(event){
  const c=event.competitions?.[0];
  const competitors=c?.competitors||[];
  const home=competitors.find(x=>x.homeAway==="home")||competitors[0];
  const away=competitors.find(x=>x.homeAway==="away")||competitors[1];
  return {home,away};
}
function teamName(c){return c?.team?.displayName||c?.team?.name||"Equipo";}
function getOdds(event){
  const c=event.competitions?.[0];
  const o=c?.odds?.[0]||c?.pickcenter?.[0];
  if(!o)return null;
  const homeLine=num(o.homeTeamOdds?.moneyLine ?? o.homeMoneyLine ?? o.homeTeamOdds?.moneyline);
  const awayLine=num(o.awayTeamOdds?.moneyLine ?? o.awayMoneyLine ?? o.awayTeamOdds?.moneyline);
  const spread=num(o.spread ?? o.details?.spread);
  const total=num(o.overUnder ?? o.total);
  return {raw:o,homeLine,awayLine,spread,total};
}
function getPredictor(event){
  const c=event.competitions?.[0];
  const sources=[c?.odds?.[0],c?.pickcenter?.[0]];
  for(const pc of sources){
    if(!pc)continue;
    const hp=pct(pc.homeTeamOdds?.winPercentage ?? pc.homeWinPercentage ?? pc.homeTeam?.winPercentage ?? pc.homeTeamOdds?.winProbability);
    const ap=pct(pc.awayTeamOdds?.winPercentage ?? pc.awayWinPercentage ?? pc.awayTeam?.winPercentage ?? pc.awayTeamOdds?.winProbability);
    if(hp!==null&&ap!==null)return {hp:clamp(hp,0,100),ap:clamp(ap,0,100)};
  }
  return null;
}
function recordPct(c){
  const records=c?.records||[];
  for(const r of records){
    const summary=String(r.summary||"");
    const m=summary.match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
    if(m){
      const w=Number(m[1]),l=Number(m[2]),t=Number(m[3]||0);
      const total=w+l+t; if(total>0)return (w+0.5*t)/total*100;
    }
  }
  return null;
}
function makeAnalysis(item){
  const {event,kind}=item;
  const {home,away}=extractTeams(event);
  if(!home||!away)return null;
  const pred=getPredictor(event);
  const odds=getOdds(event);
  const homeRecord=recordPct(home), awayRecord=recordPct(away);
  const signals=[];
  let hp=null, ap=null;

  if(pred){
    hp=pred.hp; ap=pred.ap;
    signals.push({name:"Modelo ESPN", value:Math.abs(hp-ap), weight:45, detail:`${hp.toFixed(0)}% / ${ap.toFixed(0)}%`});
  }
  if(homeRecord!==null&&awayRecord!==null){
    const baseH=homeRecord, baseA=awayRecord;
    const total=baseH+baseA;
    if(total>0){
      const rh=baseH/total*100, ra=baseA/total*100;
      hp=hp===null?rh:(hp*0.7+rh*0.3);
      ap=ap===null?ra:(ap*0.7+ra*0.3);
      signals.push({name:"Récord", value:Math.abs(rh-ra), weight:25, detail:`${rh.toFixed(0)}% / ${ra.toFixed(0)}%`});
    }
  }
  if(odds?.homeLine&&odds?.awayLine){
    const implied=m=>m>0?100/(m+100):100/(1+Math.abs(m)/100)*100;
    let ih=implied(odds.homeLine), ia=implied(odds.awayLine);
    const s=ih+ia; ih=ih/s*100; ia=ia/s*100;
    hp=hp===null?ih:(hp*0.75+ih*0.25);
    ap=ap===null?ia:(ap*0.75+ia*0.25);
    signals.push({name:"Mercado", value:Math.abs(ih-ia), weight:20, detail:`${ih.toFixed(0)}% / ${ia.toFixed(0)}%`});
  }

  if(hp===null||ap===null)return {title:"Sin pick fiable",grade:"none",confidence:null,detail:"Datos insuficientes. La app no inventa una predicción.",signals:[]};

  const total=hp+ap; hp=hp/total*100; ap=ap/total*100;
  const edge=Math.abs(hp-ap);
  const favorite=hp>=ap?home:away;
  const confidence=clamp(Math.round(50+edge*0.95),50,96);
  const independent=Math.min(3,signals.length);
  let grade="medium";
  if(independent>=3&&confidence>=75)grade="premium";
  else if(independent>=2&&confidence>=68)grade="strong";
  else if(confidence>=60)grade="medium";
  else grade="avoid";

  const detail=`${favorite?teamName(favorite):"Equipo"} · ${Math.max(hp,ap).toFixed(0)}% estimado · ${independent} señales`;
  return {title:`Gana ${teamName(favorite)}`,grade,confidence,detail,probabilities:{hp,ap},signals};
}
function normalizeEvent(event,league){
  const {home,away}=extractTeams(event); if(!home&&!away)return null;
  return {id:event.id,kind:league.kind,label:league.label,date:event.date,status:event.status?.type?.description||event.status?.type?.shortDetail||"",home:teamName(home),away:teamName(away),event,analysis:null};
}
async function fetchLeague(league){
  const url=`https://site.api.espn.com/apis/site/v2/sports/${league.sport}/${league.league}/scoreboard?dates=${todayUTC()}`;
  const res=await fetch(url,{cache:"no-store"}); if(!res.ok)throw new Error(`${res.status}`);
  const data=await res.json(); return (data.events||[]).map(e=>normalizeEvent(e,league)).filter(Boolean);
}
async function load(){
  $("status").textContent="Buscando eventos y calculando señales…";
  $("matches").innerHTML="";
  allMatches=[];
  const results=await Promise.allSettled(leagues.map(fetchLeague));
  results.forEach(r=>{if(r.status==="fulfilled")allMatches.push(...r.value);});
  const map=new Map(allMatches.map(x=>[x.id,x]));
  allMatches=[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));
  allMatches.forEach(x=>x.analysis=makeAnalysis(x));
  const ok=results.filter(x=>x.status==="fulfilled").length;
  $("updated").textContent=`Actualizado ${new Date().toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})} · ${ok}/${leagues.length} competiciones`;
  render();
}
function gradeLabel(g){return {premium:"PREMIUM",strong:"FUERTE",medium:"MEDIO",avoid:"NO BET",none:"SIN DATOS"}[g]||"SIN DATOS";}
function render(){
  let list=activeSport==="all"?allMatches:allMatches.filter(x=>x.kind===activeSport);
  if(activeGrade!=="all")list=list.filter(x=>x.analysis?.grade===activeGrade);
  if(!list.length){$("status").textContent="No hay eventos que cumplan este filtro.";$("matches").innerHTML=`<div class="empty">Prueba otro filtro o pulsa «Actualizar».</div>`;return;}
  const picks=list.filter(x=>x.analysis?.grade&&x.analysis.grade!=="none"&&x.analysis.grade!=="avoid").length;
  $("status").textContent=`${list.length} eventos · ${picks} picks con señales suficientes`;
  $("matches").innerHTML=list.map(m=>{
    const a=m.analysis||{}; const p=a.probabilities;
    const prob=p?`<div class="prob"><span>${m.home} ${p.hp.toFixed(0)}%</span><span>${m.away} ${p.ap.toFixed(0)}%</span></div>`:"";
    return `<article class="match grade-${a.grade||"none"}">
      <div class="match-top"><span>${m.label}</span><span>${formatDate(m.date)}</span></div>
      <div class="teams">${m.home} <span class="vs">vs</span> ${m.away}</div>
      ${m.status?`<span class="badge">${m.status}</span>`:""}
      <div class="pick"><div><span class="grade">${gradeLabel(a.grade)}</span><strong>🎯 ${a.title||"Sin pick"}</strong></div><span>${a.detail||""}</span></div>
      ${prob}
    </article>`;
  }).join("");
}
document.querySelectorAll(".filter").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(b=>b.classList.remove("active"));btn.classList.add("active");activeSport=btn.dataset.sport;render();}));
document.querySelectorAll(".grade-filter").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".grade-filter").forEach(b=>b.classList.remove("active"));btn.classList.add("active");activeGrade=btn.dataset.grade;render();}));
$("refresh").addEventListener("click",load);
load().catch(err=>{$("status").textContent="No se pudieron cargar los datos.";$("matches").innerHTML=`<div class="empty">Comprueba la conexión y pulsa «Actualizar».<br><small>${err.message}</small></div>`;});
