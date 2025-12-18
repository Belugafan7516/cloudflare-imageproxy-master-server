export default {
  async fetch(request) {
    const url = new URL(request.url);

    const target = url.searchParams.get('url');
    const format = url.searchParams.get('format')?.toLowerCase();
    const filename = url.searchParams.get('filename');
    const download = url.searchParams.get('download') === 'true';

    if (!target) {
      return new Response('Missing ?url parameter', { status: 400 });
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: { 'User-Agent': 'UniversalProxyMaster/1.0' }
      });
    } catch {
      return new Response('Failed to fetch media from source', { status: 502 });
    }

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status });
    }

    const headers = new Headers(upstream.headers);

    const mimeMap = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff', ico: 'image/x-icon',
      svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic',
      mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
      mp3: 'audio/mpeg', wav: 'audio/wav', pdf: 'application/pdf',
      txt: 'text/plain', html: 'text/html', json: 'application/json',
      zip: 'application/zip'
    };

    if (format && mimeMap[format]) {
      headers.set('Content-Type', mimeMap[format]);
    }

    if (filename) {
      const ext = format || target.split('.').pop()?.split('?')[0] || 'bin';
      headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}.${ext}"`);
    } else {
      headers.set('Content-Disposition', download ? 'attachment' : 'inline');
    }

    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('X-Frame-Options');
    headers.delete('Content-Security-Policy');

    return new Response(upstream.body, {
      status: upstream.status,
      headers
    });
  }
};

