(() => {
'use strict';
const LEAGUES=[
 {sport:'football',league:'esp.1',label:'Fútbol · LaLiga'},
 {sport:'football',league:'eng.1',label:'Fútbol · Premier League'},
 {sport:'football',league:'ger.1',label:'Fútbol · Bundesliga'},
 {sport:'football',league:'ita.1',label:'Fútbol · Serie A'},
 {sport:'football',league:'fra.1',label:'Fútbol · Ligue 1'},
 {sport:'football',league:'uefa.champions',label:'Fútbol · Champions'},
 {sport:'basketball',league:'nba',label:'Baloncesto · NBA'},
 {sport:'basketball',league:'euroleague',label:'Baloncesto · Euroliga'},
 {sport:'tennis',league:'atp',label:'Tenis · ATP'},
 {sport:'tennis',league:'wta',label:'Tenis · WTA'},
 {sport:'racing',league:'f1',label:'Motor · F1'}
];
let events=[];
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function dateKey(d){return d.toISOString().slice(0,10).replaceAll('-','')}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
function url(c,date){return `https://site.api.espn.com/apis/site/v2/sports/${c.sport}/${c.league}/scoreboard?dates=${dateKey(date)}`}
async function get(c,date){const r=await fetch(url(c,date),{cache:'no-store'});if(!r.ok)throw Error(r.status);return r.json()}
function teams(e){const c=e?.competitions?.[0]?.competitors||[];return {h:c.find(x=>x.homeAway==='home')||c[0]||{},a:c.find(x=>x.homeAway==='away')||c[1]||{}}
function record(t){const rs=t?.records||t?.record||[];const r=Array.isArray(rs)?(rs.find(x=>/overall|total|regular/i.test(x?.name||x?.type||''))||rs[0]):rs;if(!r?.summary)return null;const m=String(r.summary).match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);if(!m)return null;return {w:+m[1],l:+m[2],d:m[3]?+m[3]:0,text:r.summary}}
function rank(t){const n=Number(t?.curatedRank?.current??t?.rank);return Number.isFinite(n)&&n>0?n:null}
function money(e){const o=e?.competitions?.[0]?.odds?.[0];if(!o)return null;return {home:Number(o.homeTeamOdds?.moneyLine),away:Number(o.awayTeamOdds?.moneyLine),ou:Number(o.overUnder)}}
function pick(e){const {h,a}=teams(e), type=e._sport, hr=record(h),ar=record(a),rkH=rank(h),rkA=rank(a), odds=money(e);
let p,score,reason;
if(type==='basketball'){
 const edgeRank=rkH!=null&&rkA!=null?rkA-rkH:null;
 const edgeRec=hr&&ar?((hr.w-hr.l)-(ar.w-ar.l)):0;
 if(edgeRank!=null&&Math.abs(edgeRank)>=4){p=edgeRank>0?'Local gana':'Visitante gana';score=Math.min(84,62+Math.abs(edgeRank));reason='Diferencia de ranking disponible.'}
 else if(hr&&ar&&Math.abs(edgeRec)>=3){p=edgeRec>0?'Local gana':'Visitante gana';score=Math.min(78,57+Math.abs(edgeRec)*2);reason=`Balance: ${hr.text} vs ${ar.text}.`}
 else if(Number.isFinite(odds?.home)&&Number.isFinite(odds?.away)){p=odds.home<odds.away?'Local gana':'Visitante gana';score=61;reason='El mercado ESPN disponible aporta una señal de ganador.'}
 else {p='Local gana';score=55;reason='No hay ranking/mercado suficiente; se aplica una señal mínima de localía.'}
} else if(type==='football'){
 const edgeRank=rkH!=null&&rkA!=null?rkA-rkH:null;
 const edgeRec=hr&&ar?((hr.w+.5*hr.d)-(ar.w+.5*ar.d)):0;
 if(edgeRank!=null&&Math.abs(edgeRank)>=5){p=edgeRank>0?'1X':'X2';score=Math.min(84,61+Math.abs(edgeRank));reason='Diferencia de ranking disponible.'}
 else if(hr&&ar&&Math.abs(edgeRec)>=2){p=edgeRec>0?'1X':'X2';score=Math.min(76,58+Math.abs(edgeRec)*2);reason=`Forma/registro: ${hr.text} vs ${ar.text}.`}
 else if(Number.isFinite(odds?.home)&&Number.isFinite(odds?.away)){p=odds.home<odds.away?'1X':'X2';score=60;reason='Señal basada en mercado ESPN disponible.'}
 else {p='Más de 1,5 goles';score=55;reason='Señal conservadora cuando faltan datos comparativos.'}
} else if(type==='tennis'){
 const edge=rkH!=null&&rkA!=null?rkA-rkH:null;
 if(edge!=null&&Math.abs(edge)>=8){p=edge>0?'Victoria local':'Victoria visitante';score=Math.min(84,64+Math.floor(Math.abs(edge)/2));reason='Diferencia relevante de ranking.'}
 else {p='Victoria local';score=54;reason='Sin diferencia de ranking suficiente; señal mínima de localía/orden del evento.'}
} else {p='Sin pick automático';score=50;reason='F1 requiere clasificación y parrilla específicas.'}
return {p,score,reason};}
function status(e){const s=e?.status?.type;if(s?.completed)return 'FINAL';if(s?.state==='in')return '🔴 EN DIRECTO';return new Date(e.date).toLocaleString('es-ES',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function render(){const filter=$('sport').value;const list=events.filter(e=>filter==='all'||e._sport===filter);const picks=list.map(e=>({e,p:pick(e)})).filter(x=>x.p.score>=54&&x.p.p!=='Sin pick automático').sort((a,b)=>b.p.score-a.p.score).slice(0,5);
$('top').innerHTML=`<section class="top"><h2>🔥 TOP 5 PICKS AUTOMÁTICOS</h2>${picks.length?picks.map((x,i)=>`<article class="pick"><div class="meta">${i+1}. ${esc(x.e._label)}</div><div class="teams">${esc(teams(x.e).h?.team?.displayName||teams(x.e).h?.athlete?.displayName||'Local')} — ${esc(teams(x.e).a?.team?.displayName||teams(x.e).a?.athlete?.displayName||'Visitante')}</div><div class="pickline"><span class="pickname">🎯 ${esc(x.p.p)}</span><span class="conf">${x.p.score}/100</span></div><div class="reason">${esc(x.p.reason)}</div></article>`).join(''):`<div>No hay señales suficientes.</div>`}</section>`;
$('events').innerHTML=list.length?list.map(e=>{const t=teams(e);const p=pick(e);const hn=t.h?.team?.displayName||t.h?.athlete?.displayName||'Local';const an=t.a?.team?.displayName||t.a?.athlete?.displayName||'Visitante';return `<article class="event"><div class="badge">${esc(e._label)}</div><div class="teams">${esc(hn)} — ${esc(an)}</div><div class="time">${esc(status(e))}</div><div class="pickline"><span>Pick: <b>${esc(p.p)}</b></span><span class="conf">${p.score}/100</span></div><div class="reason">${esc(p.reason)}</div></article>`}).join(''):`<div class="empty">No hay eventos para este filtro.</div>`}
async function load(){ $('status').textContent='Buscando eventos reales…';$('events').innerHTML='';const today=new Date();const jobs=[];for(const c of LEAGUES)for(let i=0;i<3;i++)jobs.push(get(c,addDays(today,i)).then(d=>(d.events||[]).map(e=>({...e,_sport:c.sport,_label:c.label})).catch(()=>[])).catch(()=>[]));const chunks=await Promise.all(jobs);const map=new Map();chunks.flat().forEach(e=>map.set(`${e._sport}:${e.id}`,e));events=[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,160);$('status').textContent=`${events.length} eventos cargados · actualizado ${new Date().toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`;render()}
$('refresh').onclick=load;$('sport').onchange=render;load();
})();
