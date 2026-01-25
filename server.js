/**
 * MASTER PROXY (The Frontend)
 * Deploy this script second.
 * * Role: Accepts user requests, forwards them to the Middleman, rewrites HTML,
 * and handles file downloads.
 */

// !!! IMPORTANT: Put your Middleman Worker URL here !!!
// Ensure this URL points to your Middleman script, NOT this Master script.
const MIDDLEMAN_URL = "https://masterproxy.powerstudios.workers.dev/";

export default {
  async fetch(request, env, ctx) {
    const masterUrl = new URL(request.url);
    const shouldDownload = masterUrl.searchParams.has("download");
    
    // 1. Extract the target URL from the path
    // Format: https://master.dev/https://example.com/page
    let targetUrlStr = masterUrl.pathname.slice(1) + masterUrl.search;
    
    // Strip the download param from the target string so we don't send it to the destination server
    if (shouldDownload) {
      targetUrlStr = targetUrlStr.replace(/[?&]download(=[^&]*)?$/, "");
      if (targetUrlStr.endsWith("?") || targetUrlStr.endsWith("&")) {
        targetUrlStr = targetUrlStr.slice(0, -1);
      }
    }

    // Show a simple landing page if no URL is provided
    if (!targetUrlStr || targetUrlStr === "/" || targetUrlStr === "/favicon.ico") {
      return new Response(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1>Master Proxy</h1>
          <form onsubmit="
            const url = document.getElementById('url').value;
            const isDownload = document.getElementById('download').checked;
            window.location.href = '/' + url + (isDownload ? '?download=true' : '');
            return false;
          ">
            <input type="text" id="url" placeholder="https://example.com" style="padding: 10px; width: 300px;">
            <button style="padding: 10px; cursor: pointer;">Go</button>
            <div style="margin-top: 15px;">
              <label style="cursor: pointer; user-select: none;">
                <input type="checkbox" id="download" style="transform: scale(1.2); margin-right: 5px;"> 
                Force Download File
              </label>
            </div>
          </form>
        </div>
      `, { headers: { "Content-Type": "text/html" } });
    }

    // 2. Validate and Fix URL
    let finalTarget = targetUrlStr;
    if (!finalTarget.startsWith("http")) {
      if (finalTarget.startsWith("www.")) finalTarget = "https://" + finalTarget;
      else finalTarget = "https://" + finalTarget;
    }

    // 3. Construct the request to the Middleman
    const middlemanRequestUrl = `${MIDDLEMAN_URL}?q=${encodeURIComponent(finalTarget)}`;

    try {
      // Start with the ACTUAL headers from the user's browser
      const proxyHeaders = new Headers(request.headers);
      
      // A. Spoof Referer/Origin to look like we are ON the target site 
      try {
        const targetObj = new URL(finalTarget);
        proxyHeaders.set("Referer", targetObj.origin + "/");
        proxyHeaders.set("Origin", targetObj.origin);
      } catch (e) {}

      // B. Remove Cloudflare & Worker specific headers
      const headersToDelete = [
        "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "cf-worker", 
        "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "x-forwarded-host"
      ];
      headersToDelete.forEach(header => proxyHeaders.delete(header));

      const response = await fetch(middlemanRequestUrl, {
        method: request.method,
        headers: proxyHeaders, 
        body: request.body
      });

      // Prepare URL object for rewriting logic
      let targetUrlObj;
      try {
        targetUrlObj = new URL(finalTarget);
      } catch (e) {
        targetUrlObj = new URL("https://example.com"); 
      }

      // C. CLEAN RESPONSE HEADERS
      const newResponseHeaders = new Headers(response.headers);
      
      // Remove CSP and Frame Options so verification scripts and images can load
      newResponseHeaders.delete("Content-Security-Policy");
      newResponseHeaders.delete("Content-Security-Policy-Report-Only");
      newResponseHeaders.delete("X-Frame-Options");
      newResponseHeaders.delete("X-XSS-Protection");

      // Fix Set-Cookie
      const setCookie = newResponseHeaders.get("Set-Cookie");
      if (setCookie) {
        const fixedCookie = setCookie.replace(/Domain=[^;]+;/gi, "");
        newResponseHeaders.set("Set-Cookie", fixedCookie);
      }

      const cleanResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders
      });

      // 4. Handle HTML Rewriting vs Raw Streaming
      const contentType = cleanResponse.headers.get("Content-Type") || "";
      
      if (contentType.includes("text/html") && !shouldDownload) {
        return new HTMLRewriter()
          // Navigation
          .on("a", new AttributeRewriter("href", masterUrl, targetUrlObj))
          .on("form", new AttributeRewriter("action", masterUrl, targetUrlObj))
          
          // Images & Responsive Images (srcset)
          .on("img", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .on("img", new AttributeRewriter("srcset", masterUrl, targetUrlObj))
          .on("img", new AttributeRewriter("data-src", masterUrl, targetUrlObj)) // Lazy loading
          .on("img", new AttributeRewriter("data-srcset", masterUrl, targetUrlObj)) // Lazy loading
          
          // Picture sources
          .on("source", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .on("source", new AttributeRewriter("srcset", masterUrl, targetUrlObj))
          
          // SVG Images
          .on("image", new AttributeRewriter("href", masterUrl, targetUrlObj)) // SVG xlink:href or href

          // Resources (JS, CSS)
          .on("script", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .on("link", new AttributeRewriter("href", masterUrl, targetUrlObj))
          
          // Media & Frames
          .on("iframe", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .on("audio", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .on("video", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .on("track", new AttributeRewriter("src", masterUrl, targetUrlObj))
          .transform(cleanResponse);
      } 
      
      // 5. Handle Download Mode
      if (shouldDownload) {
          const downloadHeaders = new Headers(cleanResponse.headers);
          let filename = "download";
          const pathSegments = targetUrlObj.pathname.split('/');
          const lastSegment = pathSegments[pathSegments.length - 1];
          if (lastSegment && lastSegment.includes('.')) {
              filename = lastSegment;
          }
          downloadHeaders.set("Content-Disposition", `attachment; filename="${filename}"`);
          return new Response(cleanResponse.body, {
              status: cleanResponse.status,
              statusText: cleanResponse.statusText,
              headers: downloadHeaders
          });
      }

      return cleanResponse;

    } catch (e) {
      return new Response("Master Proxy Error: " + e.message, { status: 500 });
    }
  }
};

/**
 * Helper: Rewrites HTML attributes to keep the user inside the proxy
 */
class AttributeRewriter {
  constructor(attributeName, masterUrl, targetUrlObj) {
    this.attributeName = attributeName;
    this.masterUrl = masterUrl;
    this.targetUrlObj = targetUrlObj;
  }

  element(element) {
    const value = element.getAttribute(this.attributeName);
    if (!value) return;

    // Special Handling for 'srcset' (Responsive Images)
    if (this.attributeName === "srcset" || this.attributeName === "data-srcset") {
      try {
        const newSrcset = value.split(",").map(entry => {
          // entry looks like " https://example.com/img.jpg 1000w"
          entry = entry.trim();
          const spaceIndex = entry.lastIndexOf(" ");
          
          let url, descriptor;
          if (spaceIndex === -1) {
             url = entry;
             descriptor = "";
          } else {
             url = entry.substring(0, spaceIndex);
             descriptor = entry.substring(spaceIndex); // includes the space
          }
          
          try {
             const absoluteUrl = new URL(url, this.targetUrlObj.href);
             const newUrl = `${this.masterUrl.origin}/${absoluteUrl.href}`;
             return `${newUrl}${descriptor}`;
          } catch(e) {
             return entry;
          }
        }).join(", ");
        
        element.setAttribute(this.attributeName, newSrcset);
      } catch (e) {
        // parsing failed, leave it alone
      }
      return;
    }

    // Standard Handling for src, href, action
    // Skip special protocols
    if (value.startsWith("data:") || value.startsWith("mailto:") || value.startsWith("#")) return;

    try {
      // 1. Resolve relative URLs (e.g. "../image.png" or "/style.css") to absolute URLs
      const absoluteUrl = new URL(value, this.targetUrlObj.href);
      
      // 2. Wrap it with the Master URL
      // Result: https://master.dev/https://target.com/image.png
      const newUrl = `${this.masterUrl.origin}/${absoluteUrl.href}`;
      
      element.setAttribute(this.attributeName, newUrl);
    } catch (e) {
      // Ignore invalid URLs
    }
  }
}


