# Predicción Apuestas — Blogabet Filter v1

Esta versión cambia el enfoque de la aplicación:

- Blogabet como fuente de picks.
- Historial del tipster como filtro.
- Consenso entre tipsters.
- Puntuación 0–100.
- No se muestran picks débiles solo para llenar la pantalla.
- Importación JSON para probar el motor sin depender de una web externa.

## Importante sobre GitHub Pages

GitHub Pages ejecuta JavaScript en el navegador. No es un servidor y no puede garantizar acceso directo a Blogabet debido a CORS/anti-bot.

Por eso el proyecto incluye `worker.js` como punto de entrada para un proxy propio.

El Worker incluido NO intenta saltarse CAPTCHA ni autenticación. Si Blogabet bloquea la petición, la aplicación lo comunica.

## Formato JSON de prueba

[
  {
    "tipster": "Ejemplo",
    "event": "Equipo A - Equipo B",
    "market": "Over 2.5",
    "odds": 2.02,
    "sport": "football",
    "league": "Liga",
    "verified": true,
    "history": {
      "picks": 1200,
      "profit": 18,
      "yield": 9.4,
      "winRate": 57,
      "recentYield": 12,
      "verifiedPct": 96
    }
  }
]

## Siguiente fase

El parser debe adaptarse al HTML/endpoint real que podamos utilizar para obtener el feed de picks.
Después se puede conectar una segunda fuente de datos de partidos para validar:
- forma,
- goles,
- BTTS,
- over/under,
- local/visitante,
- cuotas,
- y valor esperado.

La aplicación nunca debe convertir una puntuación interna en una garantía de acierto.
