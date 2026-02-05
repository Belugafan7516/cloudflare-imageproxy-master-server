/**
 * BACKEND WORKER (The Fetcher)
 * Deploy this FIRST.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrlStr = url.searchParams.get("q");

    if (!targetUrlStr) return new Response("Middleman: No target specified", { status: 400 });

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch (e) {
      return new Response("Middleman: Invalid URL", { status: 400 });
    }

    // 1. Prepare Headers
    const newHeaders = new Headers(request.headers);

    // 2. CRITICAL FIX: Sanitize the Host Header for Cloudflare
    newHeaders.delete("Host");
    newHeaders.set("Host", targetUrl.hostname);
    newHeaders.set("Referer", targetUrl.origin + "/");
    newHeaders.set("Origin", targetUrl.origin);

    // 3. Remove Proxy Headers
    ["cf-connecting-ip", "cf-worker", "cf-ray", "cf-visitor", "x-real-ip", "x-forwarded-proto", "x-forwarded-for"].forEach(h => newHeaders.delete(h));

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: "manual"
      });

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "Location");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (e) {
      return new Response("Middleman Error: " + e.message, { status: 500 });
    }
  }
};


