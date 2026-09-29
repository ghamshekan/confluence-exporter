const $ = id => document.getElementById(id);
let tab;

function status(text) { $('status').textContent = text; }
function disabled(v) { $('html').disabled = v; $('zip').disabled = v; }

async function getTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function ensureContentScript() {
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
    return await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
  }
}

async function exportPage(mode) {
  disabled(true);
  try {
    status('در حال خواندن صفحه رندرشده...');
    await ensureContentScript();

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXPORT_PAGE',
      options: {
        images: $('images').checked,
        css: $('css').checked,
        clean: $('clean').checked
      }
    });

    if (!result?.ok) throw new Error(result?.error || 'خطا در استخراج صفحه');

    status(mode === 'zip' ? 'در حال ساخت ZIP...' : 'در حال آماده‌سازی HTML...');
    const download = await chrome.runtime.sendMessage({
      type: 'BUILD_DOWNLOAD',
      mode,
      payload: result.payload
    });

    if (!download?.ok) throw new Error(download?.error || 'خطا در ساخت فایل خروجی');

    const id = await downloadWithFallback(download.dataUrl, download.filename, mode);

    status(download.fallback
      ? `ZIP ساخته نشد؛ HTML جایگزین دانلود شد. شناسه: ${id}`
      : `دانلود شروع شد. شناسه: ${id}`);
  } catch (e) {
    console.error(e);
    status(`خطا: ${e?.message || e}`);
  } finally {
    disabled(false);
  }
}

async function downloadWithFallback(dataUrl, filename, mode) {
  const extension = mode === 'zip' ? 'zip' : 'html';
  const primary = safeDownloadFilename(filename, extension);

  try {
    return await chrome.downloads.download({
      url: dataUrl,
      filename: primary,
      saveAs: true
    });
  } catch (firstError) {
    console.warn('Primary filename rejected. Retrying with fallback.', firstError);

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fallback = `confluence-page-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${extension}`;

    try {
      return await chrome.downloads.download({
        url: dataUrl,
        filename: fallback,
        saveAs: true
      });
    } catch (secondError) {
      console.error('Fallback filename also failed.', secondError);
      throw new Error(
        `ذخیره فایل ناموفق بود. نام اولیه: ${primary} | نام جایگزین: ${fallback} | ` +
        `${secondError?.message || firstError?.message || 'Unknown error'}`
      );
    }
  }
}

function safeDownloadFilename(name, extension) {
  const fallback = `confluence-page-${Date.now()}`;
  let value = String(name ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1F\x80-\x9F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .replace(/^\.+$/, '');

  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;
  if (!value || value === '.' || value === '..' || reserved.test(value)) {
    value = fallback;
  }

  value = value.slice(0, 120).replace(/[. ]+$/g, '') || fallback;
  const ext = String(extension || '').replace(/^\./, '');
  if (ext && !value.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) value += `.${ext}`;
  return value;
}

$('html').addEventListener('click', () => exportPage('html'));
$('zip').addEventListener('click', () => exportPage('zip'));

(async () => {
  try {
    tab = await getTab();
    const info = await ensureContentScript();
    $('page').textContent = info?.title || tab?.title || 'صفحه فعلی';
  } catch (e) {
    $('page').textContent = 'این صفحه قابل استخراج نیست.';
    status(e?.message || String(e));
  }
})();
