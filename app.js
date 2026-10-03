const $=id=>document.getElementById(id);

function analyze(){
  const match=$("match").value.trim();
  const sport=$("sport").value;
  if(!match){
    alert("Escribe un partido primero.");
    return;
  }

  // Modelo heurístico inicial: no representa datos reales en tiempo real.
  // La estructura queda preparada para conectar una API/fuente de datos.
  const result=$("result");
  const pick=$("pick");
  const details=$("details");

  result.classList.remove("hidden");
  pick.innerHTML='<div class="pick">Análisis pendiente de datos</div>';
  details.innerHTML=`
    <div class="badge">${sport}</div>
    <div class="badge">${escapeHtml(match)}</div>
    <p class="muted">Para generar un pick basado en estadísticas reales necesitamos alimentar esta pantalla con datos de partidos, cuotas y resultados de una fuente accesible.</p>
    <p><strong>Estado:</strong> interfaz funcionando correctamente.</p>
  `;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

$("analyze").addEventListener("click",analyze);
$("match").addEventListener("keydown",e=>{if(e.key==="Enter")analyze();});
