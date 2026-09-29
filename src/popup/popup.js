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

    const id = await chrome.downloads.download({
      url: download.dataUrl,
      filename: download.filename,
      saveAs: true
    });

    status(`دانلود شروع شد. شناسه: ${id}`);
  } catch (e) {
    console.error(e);
    status(`خطا: ${e?.message || e}`);
  } finally {
    disabled(false);
  }
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
