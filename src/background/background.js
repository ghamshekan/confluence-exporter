const textEncoder = new TextEncoder();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'BUILD_DOWNLOAD') return;

  buildDownload(message).then(sendResponse).catch(error => {
    sendResponse({ ok: false, error: error?.stack || error?.message || String(error) });
  });

  return true;
});

async function buildDownload(message) {
  const { payload, mode } = message;
  if (!payload?.html) throw new Error('Export payload is missing HTML.');

  const zip = new ZipStore();

  if (mode === 'html') {
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    return { ok: true, filename: safeFilename(payload.title, 'html'), dataUrl };
  }

  const failures = [];

  for (const asset of payload.assets || []) {
    try {
      if (!asset?.url) throw new Error('Asset URL is missing.');
      const response = await fetch(asset.url, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const zipPath = safeZipPath(asset.path, asset.kind);
      zip.addBytes(zipPath, bytes);
      asset.exportedPath = zipPath;
    } catch (e) {
      failures.push({ url: asset?.url || null, path: asset?.path || null, error: e?.message || String(e) });
    }
  }

  const html = rewritePlaceholders(payload.html, payload.assets || []);
  zip.addText('index.html', html);

  const manifest = {
    exporter: 'Confluence HTML Exporter',
    version: '1.0.0',
    sourceUrl: payload.url,
    exportedAt: new Date().toISOString(),
    assets: payload.assets || [],
    failures
  };
  zip.addText('manifest.json', JSON.stringify(manifest, null, 2));

  let blob;
  try {
    blob = zip.finish();
  } catch (e) {
    failures.push({ url: null, path: null, error: `ZIP generation failed: ${e?.message || String(e)}` });
    // Last-resort export: always provide the HTML even if ZIP assembly fails.
    const fallbackHtml = payload.html || '<!doctype html><html><body><p>Export failed.</p></body></html>';
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fallbackHtml);
    return {
      ok: true,
      filename: safeFilename(payload.title, 'html'),
      dataUrl,
      fallback: true,
      failures
    };
  }

  let dataUrl;
  try {
    dataUrl = await blobToDataUrl(blob);
  } catch (e) {
    failures.push({ url: null, path: null, error: `ZIP data conversion failed: ${e?.message || String(e)}` });
    const fallbackHtml = payload.html || '<!doctype html><html><body><p>Export failed.</p></body></html>';
    dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(fallbackHtml);
    return {
      ok: true,
      filename: safeFilename(payload.title, 'html'),
      dataUrl,
      fallback: true,
      failures
    };
  }

  return { ok: true, filename: safeFilename(payload.title, 'zip'), dataUrl, failures };
}

function rewritePlaceholders(html, assets) {
  let result = html;
  for (const asset of assets) {
    const marker = `__CONFLUENCE_ASSET__${encodeURIComponent(asset.url)}__`;
    result = result.split(marker).join(`./${asset.exportedPath || safeZipPath(asset.path, asset.kind)}`);
  }
  return result;
}

function safeZipPath(path, kind) {
  const fallbackDir = kind === 'css' ? 'assets/css' : 'assets/images';
  const fallbackExt = kind === 'css' ? '.css' : (kind === 'image' ? '.bin' : '.bin');
  try {
    const raw = String(path ?? '');
    const parts = raw.split('/').filter(Boolean);
    let file = parts.pop() || `asset-${timestampForFilename()}${fallbackExt}`;
    file = safeFilename(file);
    // Avoid path traversal and directory names from external data.
    const dir = kind === 'css' ? 'assets/css' : (parts[0] === 'assets' && parts[1] === 'images' ? 'assets/images' : fallbackDir);
    return `${dir}/${file}`;
  } catch {
    return `${fallbackDir}/asset-${timestampForFilename()}${fallbackExt}`;
  }
}

function safeFilename(name, extension = '') {
  const fallback = `confluence-page-${timestampForFilename()}`;
  let value = String(name ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1F\x80-\x9F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  // Windows/Chrome rejects trailing dots/spaces and some DOS device names.
  value = value.replace(/[. ]+$/g, '');
  value = value.replace(/^\.+$/, '');

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
  if (!value || value === '.' || value === '..' || reserved.test(value)) {
    value = fallback;
  }

  value = value.slice(0, 120).replace(/[. ]+$/g, '') || fallback;

  const ext = extension ? (String(extension).startsWith('.') ? String(extension) : `.${extension}`) : '';
  if (ext && !value.toLowerCase().endsWith(ext.toLowerCase())) value += ext;
  return value;
}

function timestampForFilename() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join('') + '-' + [
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join('');
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

class ZipStore {
  constructor() { this.files = []; }
  addText(name, value) { this.addBytes(name, textEncoder.encode(value)); }
  addBytes(name, bytes) { this.files.push({ name, bytes }); }

  finish() {
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const file of this.files) {
      const name = textEncoder.encode(file.name);
      const data = file.bytes;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length);
      const l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true);
      l.setUint16(4, 20, true);
      l.setUint16(6, 0x0800, true);
      l.setUint16(8, 0, true);
      l.setUint16(10, 0, true);
      l.setUint16(12, 0, true);
      l.setUint32(14, crc, true);
      l.setUint32(18, data.length, true);
      l.setUint32(22, data.length, true);
      l.setUint16(26, name.length, true);
      l.setUint16(28, 0, true);
      local.set(name, 30);
      local.set(data, 30 + name.length);

      const central = new Uint8Array(46 + name.length);
      const c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, 0, true);
      c.setUint16(14, 0, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint16(30, 0, true);
      c.setUint16(32, 0, true);
      c.setUint16(34, 0, true);
      c.setUint16(36, 0, true);
      c.setUint32(38, 0, true);
      c.setUint32(42, offset, true);
      central.set(name, 46);

      locals.push(local);
      centrals.push(central);
      offset += local.length;
    }

    const centralSize = centrals.reduce((n, x) => n + x.length, 0);
    const end = new Uint8Array(22);
    const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.files.length, true);
    e.setUint16(10, this.files.length, true);
    e.setUint32(12, centralSize, true);
    e.setUint32(16, offset, true);

    return new Blob([...locals, ...centrals, end], { type: 'application/zip' });
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
