/*
  CLOUDFLARE WORKER — Blogabet proxy skeleton
  ------------------------------------------------
  Deployment:
  1. Crear un Cloudflare Worker.
  2. Pegar este archivo.
  3. Publicar.
  4. En app.js añadir:
       window.BLOGABET_PROXY_URL = "https://TU-WORKER.workers.dev/?url=https://usuario.blogabet.com/";

  Nota:
  Blogabet puede aplicar anti-bot/CAPTCHA. Este Worker no intenta
  saltarse CAPTCHA ni autenticación. Si Blogabet rechaza la petición,
  el frontend mostrará el error en lugar de inventar datos.
*/

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response("", {headers:corsHeaders()});
    }

    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    if (!target || !/^https:\/\/([a-z0-9-]+\.)?blogabet\.com\//i.test(target)) {
      return json({error:"URL Blogabet no válida"},400);
    }

    try {
      const upstream = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; PicksFilter/1.0)"
        }
      });

      if (!upstream.ok) {
        return json({error:`Blogabet respondió ${upstream.status}`}, upstream.status);
      }

      /*
        En esta primera versión devolvemos HTML.
        El parser específico se deja separado para no asumir una estructura
        HTML que Blogabet pueda cambiar.
      */
      const html = await upstream.text();

      return json({
        ok:true,
        source:target,
        html,
        warning:"El HTML debe transformarse a picks según la estructura vigente de Blogabet."
      });
    } catch (e) {
      return json({error:String(e?.message || e)},502);
    }
  }
};
