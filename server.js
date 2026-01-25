/**
 * MIDDLEMAN PROXY (The Fetcher)
 * * Role: Receives a target URL from the Master, fetches it, and returns the raw stream.
 * * Fixes: Error 1003 (Host Header), Cookie forwarding
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const targetUrlStr = url.searchParams.get("q");

    if (!targetUrlStr) {
      return new Response("Middleman: No target specified.", { status: 400 });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch (e) {
      return new Response("Middleman: Invalid URL.", { status: 400 });
    }

    // Clone headers from the Master's request
    const newHeaders = new Headers(request.headers);

    // 1. CRITICAL FIX FOR ERROR 1003:
    // We MUST set the Host header to the target's hostname.
    // If we don't, Cloudflare thinks we are hitting the IP directly.
    newHeaders.set("Host", targetUrl.hostname);
    
    // 2. Set Referer/Origin to satisfy anti-hotlink protections
    newHeaders.set("Referer", targetUrl.origin + "/");
    newHeaders.set("Origin", targetUrl.origin);

    // 3. User-Agent is passed through from Master (which passes it from the User)
    // We don't overwrite it here to ensure the "browser fingerprint" stays consistent.

    // 4. Remove Cloudflare/Worker headers that expose us
    const headersToDelete = [
      "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "cf-worker", 
      "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "x-forwarded-host"
    ];
    headersToDelete.forEach(header => newHeaders.delete(header));

    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: "manual" // We handle redirects manually to rewrite the Location header
      });

      // Prepare headers for the response back to Master
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      
      // If the target redirects (301/302), we just send the status back.
      // The Master will handle rewriting the Location header if needed.

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


