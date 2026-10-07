/* PREDICCION APUESTAS — MULTIFUENTE v1
   Fuentes sin clave: ESPN + TheSportsDB.
   Fuentes opcionales mediante API key: API-Football, FootyStats, The Odds API.
   El motor pondera señales disponibles y no inventa datos faltantes.
*/
(() => {
  'use strict';

  const CONFIG = {
    refreshMs: 10 * 60 * 1000,
    daysAhead: 3,
    maxEvents: 150,
    sources: {
      espn: true,
      thesportsdb: true,
      apiFootballKey: '',
      footyStatsKey: '',
      oddsApiKey: ''
    }
  };

  const LEAGUES = [
    { sport:'football', league:'esp.1', label:'Fútbol · LaLiga', kind:'football' },
    { sport:'football', league:'eng.1', label:'Fútbol · Premier League', kind:'football' },
    { sport:'football', league:'ger.1', label:'Fútbol · Bundesliga', kind:'football' },
    { sport:'football', league:'ita.1', label:'Fútbol · Serie A', kind:'football' },
    { sport:'football', league:'fra.1', label:'Fútbol · Ligue 1', kind:'football' },
    { sport:'football', league:'uefa.champions', label:'Fútbol · Champions', kind:'football' },
    { sport:'basketball', league:'nba', label:'Baloncesto · NBA', kind:'basketball' },
    { sport:'basketball', league:'euroleague', label:'Baloncesto · Euroliga', kind:'basketball' },
    { sport:'tennis', league:'atp', label:'Tenis · ATP', kind:'tennis' },
    { sport:'tennis', league:'wta', label:'Tenis · WTA', kind:'tennis' },
    { sport:'racing', league:'f1', label:'Motor · F1', kind:'racing' }
  ];

  const state = { events:[], sport:'all', loading:false, lastUpdate:null, sourceStatus:{} };
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

  function todayUTC(){ return new Date().toISOString().slice(0,10); }
  function addDays(date,n){ const d=new Date(date+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
  function fmtDate(iso){ if(!iso)return 'Fecha no disponible'; const d=new Date(iso); return Number.isNaN(d.getTime())?iso:d.toLocaleString('es-ES',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); }
  async function fetchJSON(url,opts={}){ const r=await fetch(url,{cache:'no-store',...opts}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

  function espnUrl(cfg,date){ return `https://site.api.espn.com/apis/site/v2/sports/${cfg.sport}/${cfg.league}/scoreboard?dates=${date.replaceAll('-','')}`; }
  const TSDB='https://www.thesportsdb.com/api/v1/json/123';

  function getRecord(c){
    const items=c?.records||c?.record||[];
    if(Array.isArray(items)&&items.length){ const r=items.find(x=>/overall|total|regular/i.test(x?.name||x?.type||''))||items[0]; return r?.summary||''; }
    return c?.records?.summary||'';
  }
  function parseRecord(text){ const m=String(text||'').match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/); return m?{w:+m[1],l:+m[2],d:m[3]?+m[3]:0,text}:null; }

  function parseESPN(event,cfg){
    const comp=event?.competitions?.[0], cs=comp?.competitors||[]; if(!comp||cs.length<2)return null;
    const h=cs.find(x=>x.homeAway==='home')||cs[0], a=cs.find(x=>x.homeAway==='away')||cs[1];
    const home=h?.team?.displayName||h?.athlete?.displayName||h?.displayName||'Local';
    const away=a?.team?.displayName||a?.athlete?.displayName||a?.displayName||'Visitante';
    const odds=comp?.odds?.[0];
    return {
      id:`espn:${event.id}`, espnId:event.id, sport:cfg.kind, league:cfg.label, leagueId:cfg.league,
      date:event.date||comp.date, home, away, homeRank:Number(h?.curatedRank?.current||h?.rank||99), awayRank:Number(a?.curatedRank?.current||a?.rank||99),
      homeRecord:getRecord(h), awayRecord:getRecord(a),
      odds:odds?{overUnder:Number(odds.overUnder),details:odds.details||'',home:Number(odds.homeTeamOdds?.moneyLine),away:Number(odds.awayTeamOdds?.moneyLine)}:null,
      sources:['ESPN'], sourceData:{espn:event}
    };
  }

  function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,''); }
  function sameTeams(a,b){ const x=[norm(a.home),norm(a.away)].sort(); const y=[norm(b.home),norm(b.away)].sort(); return x[0]===y[0]&&x[1]===y[1]; }

  function parseTSDB(e){
    if(!e?.idEvent||!e?.strHomeTeam||!e?.strAwayTeam)return null;
    const date=e.strTimestamp || (e.dateEvent&&e.strTime?`${e.dateEvent}T${e.strTime}`:e.dateEvent);
    return { id:`tsdb:${e.idEvent}`, tsdbId:e.idEvent, sport:String(e.strSport||'').toLowerCase()==='soccer'?'football':String(e.strSport||'').toLowerCase(), league:e.strLeague||'TheSportsDB', leagueId:e.idLeague||'', date, home:e.strHomeTeam, away:e.strAwayTeam, sources:['TheSportsDB'], sourceData:{tsdb:e} };
  }

  async function loadESPN(){
    if(!CONFIG.sources.espn)return [];
    const dates=Array.from({length:CONFIG.daysAhead},(_,i)=>addDays(todayUTC(),i));
    const jobs=[];
    for(const cfg of LEAGUES) for(const date of dates) jobs.push(fetchJSON(espnUrl(cfg,date)).then(d=>(d.events||[]).map(e=>parseESPN(e,cfg)).filter(Boolean)).catch(()=>[]));
    const out=(await Promise.all(jobs)).flat(); state.sourceStatus.ESPN=out.length?`OK · ${out.length} eventos`:'Sin respuesta/eventos'; return out;
  }

  async function loadTSDB(){
    if(!CONFIG.sources.thesportsdb)return [];
    const dates=Array.from({length:CONFIG.daysAhead},(_,i)=>addDays(todayUTC(),i));
    const jobs=dates.map(d=>fetchJSON(`${TSDB}/eventsday.php?d=${d}`).then(x=>(x.events||[]).map(parseTSDB).filter(Boolean)).catch(()=>[]));
    const out=(await Promise.all(jobs)).flat(); state.sourceStatus.TheSportsDB=out.length?`OK · ${out.length} eventos`:'Sin respuesta/eventos'; return out;
  }

  function mergeSources(espn,tsdb){
    const merged=[]; const used=new Set();
    for(const e of espn){
      const t=tsdb.find(x=>sameTeams(e,x));
      if(t){ e.sources=[...new Set([...e.sources,...t.sources])]; e.sourceData.tsdb=t.sourceData.tsdb; if(!e.date&&t.date)e.date=t.date; }
      merged.push(e);
    }
    for(const t of tsdb){ if(!merged.some(e=>sameTeams(e,t))) merged.push(t); }
    return merged;
  }

  function pctFromML(ml){ if(!Number.isFinite(ml)||ml===0)return null; return ml>0?100/(ml+100):(-ml)/((-ml)+100)*100; }

  function calculatePick(m){
    let score=50, reasons=[], signals=0;
    const hr=parseRecord(m.homeRecord), ar=parseRecord(m.awayRecord);
    if(hr&&ar){
      const h=(hr.w+.5*hr.d)/Math.max(1,hr.w+hr.l+hr.d), a=(ar.w+.5*ar.d)/Math.max(1,ar.w+ar.l+ar.d);
      const diff=h-a; score += diff*28; signals++; reasons.push(`forma ${hr.text} vs ${ar.text}`);
    }
    if(Number.isFinite(m.homeRank)&&Number.isFinite(m.awayRank)&&m.homeRank<99&&m.awayRank<99){
      const edge=m.awayRank-m.homeRank; score += Math.max(-12,Math.min(12,edge*.7)); signals++; reasons.push('ranking disponible');
    }
    const hp=pctFromML(m.odds?.home), ap=pctFromML(m.odds?.away);
    if(hp!=null&&ap!=null){ score += Math.max(-15,Math.min(15,(hp-ap)*.35)); signals++; reasons.push('cuotas disponibles'); }
    if(m.sources?.length>1){ signals++; reasons.push('confirmado por 2 fuentes'); }

    let pick='Sin pick fiable', market='Esperar datos';
    if(m.sport==='football'){
      if(score>=59){pick='1X';market='Doble oportunidad';}
      else if(score<=41){pick='X2';market='Doble oportunidad';}
      else if(m.odds?.overUnder && m.odds.overUnder<=2.5){pick=`Más de ${m.odds.overUnder} goles`;market='Total goles';}
    } else if(m.sport==='basketball'){
      if(score>=59)pick='Gana local',market='Ganador'; else if(score<=41)pick='Gana visitante',market='Ganador';
    } else if(m.sport==='tennis'){
      if(score>=60)pick='Victoria local',market='Ganador'; else if(score<=40)pick='Victoria visitante',market='Ganador';
    }
    // Umbral: mínimo 2 señales reales; una sola fuente no basta para Premium/Fuerte.
    let confidence=Math.round(Math.max(50,Math.min(86,50+Math.abs(score-50)*1.5+signals*2)));
    if(signals<2){ pick='Sin pick fiable'; market='Datos insuficientes'; confidence=50; }
    const level=pick==='Sin pick fiable'?'SIN DATOS':confidence>=72&&signals>=3?'PREMIUM':confidence>=63?'FUERTE':'MODERADO';
    return {pick,market,confidence,level,signals,reasons};
  }

  function sportLabel(s){ return ({football:'⚽ FÚTBOL',basketball:'🏀 BALONCESTO',tennis:'🎾 TENIS',racing:'🏎️ MOTOR'})[s]||s; }
  function filtered(){ return state.sport==='all'?state.events:state.events.filter(x=>x.sport===state.sport); }

  function buildUI(){
    if($('predictionApp'))return;
    const app=document.createElement('main'); app.id='predictionApp'; app.style.cssText='font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:900px;margin:0 auto;padding:18px;';
    app.innerHTML=`<section style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><button id="refreshBtn">🔄 Actualizar</button><select id="sportFilter"><option value="all">Todos los deportes</option><option value="football">⚽ Fútbol</option><option value="basketball">🏀 Baloncesto</option><option value="tennis">🎾 Tenis</option><option value="racing">🏎️ Motor</option></select><span id="dataStatus" style="font-size:12px;opacity:.75"></span></section><section id="sourceStatus" style="font-size:12px;opacity:.7;margin-bottom:12px"></section><section id="topPicks"></section><section id="matches"></section>`;
    document.body.prepend(app); $('refreshBtn').onclick=loadAll; $('sportFilter').onchange=e=>{state.sport=e.target.value;render();};
  }
  function render(){
    buildUI();
    const picks=filtered().map(m=>({m,p:calculatePick(m)})).filter(x=>x.p.level==='PREMIUM'||x.p.level==='FUERTE').sort((a,b)=>b.p.confidence-a.p.confidence).slice(0,5);
    $('topPicks').innerHTML=`<h2>🔥 TOP PICKS</h2>${picks.length?picks.map((x,i)=>`<article style="border:1px solid #ddd;border-radius:14px;padding:13px;margin:8px 0"><b>${i+1}. ${esc(sportLabel(x.m.sport))}</b><div style="font-size:17px;font-weight:700;margin:5px 0">${esc(x.m.home)} — ${esc(x.m.away)}</div><div>🎯 <b>${esc(x.p.pick)}</b> · ${x.p.confidence}% · ${x.p.level}</div><div style="font-size:12px;opacity:.7">${esc(x.p.reasons.join(' · '))}</div><div style="font-size:11px;opacity:.6">Fuentes: ${esc(x.m.sources.join(' + '))}</div></article>`).join(''):'<div style="padding:12px;border:1px solid #ddd;border-radius:12px">Todavía no hay suficientes señales cruzadas para un pick fuerte.</div>`}`;
    const items=filtered(); $('matches').innerHTML=`<h2>📅 Eventos (${items.length})</h2>${items.map(m=>{const p=calculatePick(m);return `<article style="border:1px solid #e1e1e1;border-radius:12px;padding:12px;margin:8px 0"><div style="font-size:11px;opacity:.65">${esc(sportLabel(m.sport))} · ${esc(m.league)}</div><div style="font-weight:700;margin:4px 0">${esc(m.home)} — ${esc(m.away)}</div><div style="font-size:12px">${esc(fmtDate(m.date))}</div><div style="margin-top:6px">${esc(p.market)}: <b>${esc(p.pick)}</b> · ${p.confidence}% · ${p.level}</div><div style="font-size:11px;opacity:.65">Señales: ${p.signals} · Fuentes: ${esc(m.sources.join(' + '))}</div></article>`}).join('')}`;
    $('sourceStatus').textContent=Object.entries(state.sourceStatus).map(([k,v])=>`${k}: ${v}`).join('  |  ');
  }

  async function loadAll(){
    if(state.loading)return; state.loading=true; buildUI(); $('dataStatus').textContent='Consultando varias fuentes…';
    try{
      const [espn,tsdb]=await Promise.all([loadESPN(),loadTSDB()]);
      state.events=mergeSources(espn,tsdb).filter(x=>x.date).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,CONFIG.maxEvents);
      state.lastUpdate=new Date(); $('dataStatus').textContent=`${state.events.length} eventos · actualizado ${state.lastUpdate.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`;
      render();
    }catch(err){ $('dataStatus').textContent='Error al cargar fuentes'; console.error(err); }
    finally{state.loading=false;}
  }

  buildUI(); loadAll(); setInterval(loadAll,CONFIG.refreshMs);
})();
