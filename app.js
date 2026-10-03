const $ = id => document.getElementById(id);
const pct = n => `${Math.round(n)}%`;

function poissonOver(lambda, line){
  let sum=0;
  for(let k=0;k<=line;k++) sum += Math.exp(-lambda)*Math.pow(lambda,k)/factorial(k);
  return 1-sum;
}
function factorial(n){let r=1;for(let i=2;i<=n;i++)r*=i;return r;}

$("analyze").addEventListener("click",()=>{
  const h=$("home").value.trim()||"Local";
  const a=$("away").value.trim()||"Visitante";
  const odd1=parseFloat($("odd1").value)||1.8;
  const oddX=parseFloat($("oddX").value)||3.6;
  const odd2=parseFloat($("odd2").value)||4.2;
  const xg=Math.max(0.2,parseFloat($("xg").value)||2.5);
  const fh=parseFloat($("formH").value)||5;
  const fa=parseFloat($("formA").value)||5;
  const ah=parseFloat($("attackH").value)||5;
  const aa=parseFloat($("attackA").value)||5;

  // Modelo heurístico: combina mercado + forma + presión ofensiva.
  const implied=[1/odd1,1/oddX,1/odd2];
  const total=implied.reduce((x,y)=>x+y,0);
  let ph=implied[0]/total, pd=implied[1]/total, pa=implied[2]/total;
  const formEdge=((fh-fa)*0.018)+((ah-aa)*0.012)+0.035;
  ph=Math.min(.86,Math.max(.08,ph+formEdge));
  pa=Math.min(.86,Math.max(.05,pa-formEdge*.75));
  pd=Math.max(.06,1-ph-pa);
  const norm=ph+pd+pa; ph/=norm;pd/=norm;pa/=norm;

  const over15=poissonOver(xg,1);
  const over25=poissonOver(xg,2);
  const btts=Math.min(.92,Math.max(.18,0.25+0.22*xg+(ah+aa-10)*.025));

  $("pHome").textContent=pct(ph*100);
  $("pDraw").textContent=pct(pd*100);
  $("pAway").textContent=pct(pa*100);
  $("over15").textContent=pct(over15*100);
  $("over25").textContent=pct(over25*100);
  $("btts").textContent=pct(btts*100);
  $("xgOut").textContent=xg.toFixed(1);
  $("edge").textContent=ph-pa>0.12?`Hacia ${h}`:pa-ph>0.12?`Hacia ${a}`:"Equilibrado";

  const fairHome=1/ph, fairAway=1/pa, fairDraw=1/pd;
  const values=[
    {name:`1 · ${h}`,v:odd1/fairHome},
    {name:`X · Empate`,v:oddX/fairDraw},
    {name:`2 · ${a}`,v:odd2/fairAway}
  ].sort((x,y)=>y.v-x.v);
  const top=values[0];
  $("value").textContent=top.v>=1.05?`Posible valor (${top.name})`:"Sin valor claro";

  let pick,reason;
  if(over25>=.62 && btts>=.55){
    pick="Más de 2.5 goles";
    reason=`El modelo estima ${pct(over25*100)} para superar 2.5 goles y ${pct(btts*100)} para ambos marcan.`;
  }else if(over15>=.72){
    pick="Más de 1.5 goles";
    reason=`El volumen de goles esperado (${xg.toFixed(1)} xG) favorece un partido con al menos 2 goles.`;
  }else if(ph>=.55){
    pick=`1X · ${h} o empate`;
    reason=`La probabilidad estimada de que ${h} no pierda es ${pct((ph+pd)*100)}.`;
  }else if(pa>=.50){
    pick=`X2 · ${a} o empate`;
    reason=`La probabilidad estimada de que ${a} no pierda es ${pct((pa+pd)*100)}.`;
  }else{
    pick="No apostar";
    reason="Los indicadores están demasiado equilibrados para justificar una selección fuerte.";
  }

  const confidence=Math.round(50+Math.abs(ph-pa)*45+Math.abs(over25-.5)*25);
  $("confidenceBadge").textContent=`Confianza orientativa ${Math.min(88,confidence)}%`;
  $("mainPick").textContent=pick;
  $("reason").textContent=reason;
  $("results").classList.remove("hidden");
  $("results").scrollIntoView({behavior:"smooth"});
});

let deferredPrompt;
window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault();deferredPrompt=e;$("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$("installBtn").classList.add("hidden");
});
