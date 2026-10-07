const $ = s => document.querySelector(s);
const state = { apiSportsKey:"", oddsKey:"", games:[] };

function todayMadrid(){
  const d = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  return d;
}
$("#date").value=todayMadrid();

function loadKeys(){
  state.apiSportsKey=localStorage.getItem("apiSportsKey")||"";
  state.oddsKey=localStorage.getItem("oddsKey")||"";
  $("#apiSportsKey").value=state.apiSportsKey;
  $("#oddsKey").value=state.oddsKey;
}
loadKeys();

$("#settingsBtn").onclick=()=>$("#settings").showModal();
$("#saveKeys").onclick=()=>{
  localStorage.setItem("apiSportsKey",$("#apiSportsKey").value.trim());
  localStorage.setItem("oddsKey",$("#oddsKey").value.trim());
  loadKeys();
  setStatus("Claves guardadas en este dispositivo.");
};

function setStatus(x){$("#status").textContent=x}

async function getJSON(url, headers={}){
  const r=await fetch(url,{headers});
  const text=await r.text();
  let data; try{data=JSON.parse(text)}catch{throw new Error("Respuesta no JSON ("+r.status+")")}
  if(!r.ok) throw new Error((data.message||data.errors?.[0]||"HTTP "+r.status));
  return data;
}

function badge(name,cls,text){return `<span class="badge ${cls}">${name}: ${text}</span>`}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

async function apiSportsNBA(date){
  if(!state.apiSportsKey) throw new Error("Falta API-Sports");
  const u=`https://v2.nba.api-sports.io/games?date=${date}`;
  const d=await getJSON(u,{"x-apisports-key":state.apiSportsKey});
  return d.response||[];
}

async function apiSportsFootball(date){
  if(!state.apiSportsKey) throw new Error("Falta API-Sports");
  const u=`https://v3.football.api-sports.io/fixtures?date=${date}`;
  const d=await getJSON(u,{"x-apisports-key":state.apiSportsKey});
  return d.response||[];
}

async function oddsNBA(){
  if(!state.oddsKey) return [];
  const u=`https://api.theoddsapi.com/odds/?sport_key=basketball_nba&regions=us&markets=h2h`;
  const d=await getJSON(u,{"x-api-key":state.oddsKey});
  return Array.isArray(d)?d:[];
}

function oddsMap(odds){
  const m=new Map();
  for(const e of odds){
    const names=(e.bookmakers||[]).flatMap(b=>b.markets||[]).flatMap(x=>x.outcomes||[]);
    const best={};
    for(const o of names) if(best[o.name]==null || o.price>best[o.name]) best[o.name]=o.price;
    m.set(norm(e.home_team)+"|"+norm(e.away_team),best);
  }
  return m;
}
function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9áéíóúüñ ]/gi,"").replace(/\s+/g," ").trim()}
function findOdds(map,h,a){
  const direct=map.get(norm(h)+"|"+norm(a)); if(direct) return direct;
  for(const [k,v] of map){ if(k.includes(norm(h))&&k.includes(norm(a))) return v; }
  return null;
}
function implied(p){return p>1?1/p:0}

function nbaPick(g,od){
  const home=g.teams?.home?.name||"Local", away=g.teams?.visitors?.name||"Visitante";
  if(!od || (!od[home]&&!od[away])){
    return {pick:"SIN PICK",conf:0,why:"Partido real detectado, pero no hay cuota moneyline verificable para calcular una probabilidad de mercado."};
  }
  const hp=od[home], ap=od[away];
  const ph=implied(hp), pa=implied(ap), total=ph+pa;
  if(!total) return {pick:"SIN PICK",conf:0,why:"Cuotas no válidas."};
  const h=ph/total, a=pa/total;
  const side=h>=a?home:away, conf=Math.round(Math.max(h,a)*100);
  if(conf<58) return {pick:"SIN PICK",conf,why:`Mercado demasiado equilibrado (${home} ${Math.round(h*100)}% vs ${away} ${Math.round(a*100)}%).`};
  return {pick:`Ganador: ${side}`,conf,why:`La cuota moneyline disponible implica aproximadamente ${Math.round(Math.max(h,a)*100)}% tras normalizar el margen. No se inventan lesiones ni estadísticas que no estén disponibles.`};
}

function footballPick(g){
  // API-Football puede ofrecer su propio endpoint de predicciones, pero se consulta
  // solo cuando el usuario lo pida para no gastar la cuota de peticiones.
  const h=g.teams?.home?.name||"Local", a=g.teams?.away?.name||"Visitante";
  return {pick:"ESPERAR DATOS",conf:0,why:`${h} vs ${a}. Para dar un pick serio necesitamos odds/estadísticas verificables; esta V5 no inventa probabilidades.`};
}

function renderSources(s){
  $("#sourceHealth").innerHTML=s.map(x=>badge(x[0],x[1],x[2])).join("");
}

async function load(){
  const sport=$("#sport").value, date=$("#date").value;
  $("#games").innerHTML="";
  setStatus("Consultando fuentes…");
  renderSources([]);
  let events=[], sources=[];
  try{
    if(sport==="nba"){
      events=await apiSportsNBA(date);
      sources.push(["API-Sports NBA","ok",`${events.length} eventos`]);
      let odds=[];
      try{ odds=await oddsNBA(); sources.push(["The Odds API","ok",`${odds.length} eventos con cuotas`]); }
      catch(e){ sources.push(["The Odds API","warn",e.message]); }
      const om=oddsMap(odds);
      state.games=events;
      renderSources(sources);
      if(!events.length){$("#games").innerHTML=`<div class="card"><b>No hay partidos NBA para ${date}.</b></div>`;setStatus("Consulta terminada.");return;}
      $("#games").innerHTML=events.map(g=>{
        const h=g.teams?.home?.name||"Local",a=g.teams?.visitors?.name||"Visitante";
        const od=findOdds(om,h,a), p=nbaPick(g,od);
        return `<article class="card"><h3>${esc(h)} 🆚 ${esc(a)}</h3>
        <div class="meta">${esc(g.date?.start||"")} · Estado: ${esc(g.status?.long||"")}</div>
        <div class="pick ${p.pick==="SIN PICK"?"no":"good"}">${esc(p.pick)}</div>
        <div class="confidence">${p.conf?`Confianza de mercado: ${p.conf}%`:"Sin confianza calculable"}</div>
        <p class="why">${esc(p.why)}</p>
        ${od?`<div class="line"><span>${esc(h)}</span><b>${od[h]??"—"}</b></div><div class="line"><span>${esc(a)}</span><b>${od[a]??"—"}</b></div>`:""}
        </article>`;
      }).join("");
      setStatus(`Cargados ${events.length} partidos NBA desde API-Sports. ESPN no se utiliza.`);
    }else{
      events=await apiSportsFootball(date);
      sources.push(["API-Sports Fútbol","ok",`${events.length} eventos`]);
      renderSources(sources);
      if(!events.length){$("#games").innerHTML=`<div class="card"><b>No hay partidos de fútbol para ${date}.</b></div>`;setStatus("Consulta terminada.");return;}
      $("#games").innerHTML=events.map(g=>{
        const p=footballPick(g);
        return `<article class="card"><h3>${esc(g.teams?.home?.name)} 🆚 ${esc(g.teams?.away?.name)}</h3>
        <div class="meta">${esc(g.fixture?.date||"")} · ${esc(g.league?.name||"")}</div>
        <div class="pick no">${p.pick}</div><p class="why">${esc(p.why)}</p></article>`;
      }).join("");
      setStatus(`Cargados ${events.length} partidos de fútbol desde API-Sports. ESPN no se utiliza.`);
    }
  }catch(e){
    renderSources([[sport==="nba"?"API-Sports NBA":"API-Sports Fútbol","bad",e.message]]);
    $("#games").innerHTML=`<div class="card"><h3>⚠️ No se pudieron cargar los datos</h3><p>${esc(e.message)}</p><p class="muted">Comprueba la API key y, si estás en GitHub Pages, si el proveedor permite peticiones desde navegador. Si aparece un error CORS, el siguiente paso será poner un pequeño proxy seguro.</p></div>`;
    setStatus("Error de fuente.");
  }
}
$("#loadBtn").onclick=load;
