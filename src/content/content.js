(() => {
  if (window.__CONFLUENCE_EXPORTER_LOADED__) return;
  window.__CONFLUENCE_EXPORTER_LOADED__ = true;

  const CONTENT_SELECTORS = [
    '#main-content',
    '[data-testid="content-body"]',
    '[data-testid="page-content"]',
    '.ak-renderer-document',
    '.confluence-content',
    '.wiki-content'
  ];

  const REMOVE_SELECTORS = [
    'script', 'noscript', 'iframe', 'object', 'embed',
    'button', 'input', 'textarea', 'select',
    'nav', '[role="navigation"]',
    'header',
    '[aria-label*="breadcrumb" i]',
    '[data-testid*="breadcrumb" i]',
    '[data-testid*="sidebar" i]',
    '[data-testid*="comment" i]',
    '[data-testid*="toolbar" i]',
    '[data-testid*="page-action" i]'
  ];

  function title() {
    return document.querySelector('h1')?.innerText?.trim() || document.title || 'confluence-page';
  }

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch { return null; }
  }

  function safeName(name) {
    return (name || 'asset')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^\.+/, '')
      .slice(0, 120) || 'asset';
  }

  function contentRoot() {
    for (const selector of CONTENT_SELECTORS) {
      const el = document.querySelector(selector);
      if (el && el.innerText?.trim()) return el;
    }
    return document.body;
  }

  function clean(root, enabled) {
    if (!enabled) return;
    root.querySelectorAll(REMOVE_SELECTORS.join(',')).forEach(el => el.remove());
    root.querySelectorAll('[data-testid], [data-component], [data-key]').forEach(el => {
      // Keep semantic data-* attributes only when they are likely useful to the exported content.
      for (const attr of [...el.attributes]) {
        if (/^data-(testid|component|key)$/i.test(attr.name)) el.removeAttribute(attr.name);
      }
    });
  }

  function fixSvg(root) {
    root.querySelectorAll('svg').forEach(svg => {
      if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!svg.getAttribute('xmlns:xlink')) svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      svg.removeAttribute('aria-hidden');
    });
  }

  function removeConfluenceOnlyAttrs(root) {
    root.querySelectorAll('*').forEach(el => {
      for (const attr of [...el.attributes]) {
        // These frequently contain runtime-specific React/Atlassian state.
        if (/^(data-reactroot|data-reactid)$/i.test(attr.name)) el.removeAttribute(attr.name);
      }
    });
  }

  function collectImages(root) {
    const assets = [];
    const seen = new Map();
    let index = 1;

    root.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || img.currentSrc;
      const url = absolute(src);
      if (!url || /^data:|^blob:/i.test(url)) return;

      let path = seen.get(url);
      if (!path) {
        const u = new URL(url);
        let filename = safeName(decodeURIComponent(u.pathname.split('/').pop() || `image-${index}`));
        if (!/\.[a-z0-9]{2,8}$/i.test(filename)) filename += '.bin';
        path = `assets/images/${String(index++).padStart(3, '0')}-${filename}`;
        seen.set(url, path);
        assets.push({ url, path, kind: 'image' });
      }
      img.setAttribute('src', `__CONFLUENCE_ASSET__${encodeURIComponent(url)}__`);
      img.removeAttribute('srcset');
      img.removeAttribute('loading');
      img.removeAttribute('fetchpriority');
    });

    return assets;
  }

  function collectStylesheets(root, includeCss) {
    if (!includeCss) return [];

    const assets = [];
    const seen = new Set();
    let index = 1;

    document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
      const href = absolute(link.getAttribute('href'));
      if (!href || seen.has(href)) return;
      seen.add(href);
      const u = new URL(href);
      let filename = safeName(decodeURIComponent(u.pathname.split('/').pop() || `style-${index}`));
      if (!/\.css$/i.test(filename)) filename += '.css';
      const path = `assets/css/${String(index++).padStart(2, '0')}-${filename}`;
      assets.push({ url: href, path, kind: 'css' });
    });

    return assets;
  }

  function htmlDocument(titleText, root, includePageCss, stylesheetAssets) {
    const inlineStyles = includePageCss
      ? [...document.querySelectorAll('style')]
          .map(x => x.textContent || '')
          .filter(Boolean)
          .join('\n')
      : '';

    const styles = inlineStyles
      ? `<style data-exporter="inline">${inlineStyles.replace(/<\/style/gi, '<\\/style')}</style>`
      : '';

    const links = includePageCss
      ? (stylesheetAssets || [])
          .map(asset => `<link rel="stylesheet" href="./${escapeAttr(asset.path)}">`)
          .join('\n')
      : '';

    const rtl = /[\u0600-\u06FF]/.test(root.innerText || '');
    const bodyClass = rtl ? 'exported-confluence rtl' : 'exported-confluence';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titleText)}</title>
${links}
<style>
html,body{margin:0;padding:0;background:#fff}
body.exported-confluence{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#172b4d;line-height:1.55}
.exported-confluence .exporter-content{max-width:1100px;margin:40px auto;padding:0 28px}
.exported-confluence img{max-width:100%;height:auto}
.exported-confluence svg{max-width:100%;height:auto}
.exported-confluence table{border-collapse:collapse;max-width:100%}
.exported-confluence pre{overflow:auto}
.exported-confluence.rtl{direction:rtl;text-align:right}
.exported-confluence a{color:inherit}
</style>
${styles}
</head>
<body class="${bodyClass}">
<main class="exporter-content">
${root.innerHTML}
</main>
</body>
</html>`;
  }

  function escapeAttr(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }

  function replaceCanvases(originalRoot, cloneRoot) {
    const originals = [...originalRoot.querySelectorAll('canvas')];
    const clones = [...cloneRoot.querySelectorAll('canvas')];

    originals.forEach((canvas, i) => {
      const target = clones[i];
      if (!target) return;
      try {
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = 'Exported chart';
        target.replaceWith(img);
      } catch {
        // Tainted canvases cannot be read due to browser security restrictions.
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  }

  function exportPage(options = {}) {
    const original = contentRoot();
    const root = original.cloneNode(true);

    clean(root, options.clean !== false);
    removeConfluenceOnlyAttrs(root);
    fixSvg(root);
    replaceCanvases(original, root);

    const assets = [];
    if (options.images !== false) assets.push(...collectImages(root));

    const cssAssets = collectStylesheets(root, options.css === true);
    assets.push(...cssAssets);

    const html = htmlDocument(title(), root, options.css === true, cssAssets);

    return {
      title: title(),
      url: location.href,
      assets,
      html
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_PAGE_INFO') {
      sendResponse({ ok: true, title: title(), url: location.href });
      return;
    }

    if (message?.type === 'EXPORT_PAGE') {
      try {
        sendResponse({ ok: true, payload: exportPage(message.options || {}) });
      } catch (e) {
        sendResponse({ ok: false, error: e?.stack || e?.message || String(e) });
      }
    }
  });
})();
