PREDICCIÓN APUESTAS V5 — SIN ESPN

Qué cambia:
- ESPN eliminado por completo.
- NBA: API-Sports NBA como fuente principal + The Odds API para moneyline.
- Fútbol: API-Sports Football como fuente principal.
- No se inventan picks si faltan datos.
- Las claves se guardan en localStorage del navegador y NO están incluidas en el código.

Fuentes verificadas en octubre de 2026:
- API-Sports: 100 peticiones/día gratis por API; NBA y Football disponen de endpoints de partidos y estadísticas.
- The Odds API: NBA moneyline disponible en el plan gratuito; otros mercados/deportes dependen del plan.
- TheSportsDB se mantiene como posible fallback futuro para calendarios, pero no se usa para fabricar probabilidades.

IMPORTANTE:
1. Abre la web.
2. Pulsa ⚙️ Fuentes.
3. Introduce tu API-Sports key.
4. Para cuotas NBA, introduce también tu The Odds API key.
5. Guarda y pulsa Cargar partidos.

Seguridad:
GitHub Pages es frontend público. No subas una API key dentro de app.js. Esta versión usa localStorage.
Para una versión pública definitiva, conviene usar un backend/proxy (por ejemplo Cloudflare Worker) para ocultar las claves y controlar las peticiones.

Limitación actual:
- NBA: el pick automático de esta V5 se basa en moneyline real cuando existe y exige un umbral de mercado.
- Fútbol: esta primera base carga partidos reales pero deja el pick en ESPERAR DATOS hasta integrar estadísticas/odds de forma segura. Esto evita repetir el problema de picks inventados.

Fuentes oficiales:
https://api-sports.io/sports/nba
https://www.api-football.com/
https://theoddsapi.com/docs/
