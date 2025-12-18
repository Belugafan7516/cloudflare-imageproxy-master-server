export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Extract parameters forwarded by the Transmitter
    const target = url.searchParams.get('url');
    const format = url.searchParams.get('format')?.toLowerCase();
    const filename = url.searchParams.get('filename');
    const download = url.searchParams.get('download') === 'true';

    // Validation
    if (!target) {
      return new Response('Master Proxy: Missing ?url parameter', { status: 400 });
    }

    let upstream;
    try {
      // 1. The ACTUAL fetch to the external internet
      upstream = await fetch(target, {
        headers: {
          'User-Agent': 'UniversalMasterProxy/1.0',
          // Optional: Forward specific headers if needed, be careful with host headers
        }
      });
    } catch (e) {
      return new Response(`Master Proxy: Failed to fetch source media. ${e.message}`, { status: 502 });
    }

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.statusText}`, { status: upstream.status });
    }

    // 2. Process Headers
    const headers = new Headers(upstream.headers);

    // MASSIVE MIME MAP
    const mimeMap = {
      // images
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      tiff: 'image/tiff',
      ico: 'image/x-icon',
      svg: 'image/svg+xml',
      avif: 'image/avif',
      heic: 'image/heic',
      raw: 'image/raw',

      // video
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      flv: 'video/x-flv',
      m4v: 'video/x-m4v',

      // audio
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
      aac: 'audio/aac',
      m4a: 'audio/mp4',
      opus: 'audio/opus',

      // documents
      pdf: 'application/pdf',
      txt: 'text/plain',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      xml: 'application/xml',
      md: 'text/markdown',

      // archives
      zip: 'application/zip',
      rar: 'application/vnd.rar',
      '7z': 'application/x-7z-compressed',
      tar: 'application/x-tar',
      gz: 'application/gzip',

      // fonts
      ttf: 'font/ttf',
      otf: 'font/otf',
      woff: 'font/woff',
      woff2: 'font/woff2',

      // misc
      exe: 'application/octet-stream',
      bin: 'application/octet-stream',
      iso: 'application/x-iso9660-image'
    };

    // 3. Format Override Logic
    // If user requested specific format (e.g. ?format=png), force that content-type
    if (format && mimeMap[format]) {
      headers.set('Content-Type', mimeMap[format]);
    }

    // 4. Filename & Content-Disposition Logic
    if (filename) {
      // Determine extension: explicit format > existing url ext > binary default
      const ext =
        format ||
        target.split('.').pop()?.split('?')[0] ||
        'bin';

      headers.set(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${filename}.${ext}"`
      );
    } else {
      // If no filename provided, just handle the download/inline boolean
      headers.set(
        'Content-Disposition',
        download ? 'attachment' : 'inline'
      );
    }

    // 5. Security Headers
    headers.set('Access-Control-Allow-Origin', '*');
    // Remove security headers from upstream that might block embedding
    headers.delete('X-Frame-Options');
    headers.delete('Content-Security-Policy');

    // 6. Return the response to the Transmitter
    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  }
};

