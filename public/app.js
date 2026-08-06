const $ = selector => document.querySelector(selector);
let data = { products: [], scannedAt: null };
let statusTimer;
const staticMode = !['127.0.0.1', 'localhost'].includes(location.hostname) && location.protocol !== 'file:';
const dataUrl = staticMode ? 'data/products.json' : '/api/products';

function connectionMessage(error) {
  if (location.protocol === 'file:') {
    return '打开方式不正确：请关闭本页，回到软件目录双击 start.bat，不要直接打开 index.html。';
  }
  return `本地服务未连接：请保持 start.bat 的黑色窗口开启，然后刷新本页。${error?.message ? `（${error.message}）` : ''}`;
}

function formatTime(value) {
  if (!value) return '暂无历史扫描';
  return `上次完成：${new Date(value).toLocaleString('zh-CN', { hour12: false })}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function isNew(item) {
  if (!data.scannedAt || !item.firstSeenAt) return false;
  return Math.abs(new Date(data.scannedAt) - new Date(item.firstSeenAt)) < 5000;
}

function render() {
  const term = $('#searchInput').value.trim().toLowerCase();
  const origin = $('#originFilter').value;
  const products = data.products.filter(item => {
    const haystack = `${item.name} ${item.subtitle} ${item.origin}`.toLowerCase();
    return (!term || haystack.includes(term)) && (!origin || item.origin === origin);
  });
  $('#count').textContent = products.length;
  $('#empty').classList.toggle('hidden', products.length > 0);
  $('#empty h3').textContent = data.products.length ? '没有符合筛选条件的商品' : '还没有扫描结果';
  $('#grid').innerHTML = products.map(item => `
    <article class="card">
      <div class="photo"><img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy"></div>
      <div class="card-body">
        <div class="badges"><span class="period">产品周期 · 全年</span>${isNew(item) ? '<span class="new">本次新增</span>' : ''}</div>
        <h3>${escapeHtml(item.name)}</h3>
        <div class="subtitle">${escapeHtml(item.subtitle || '暂无规格说明')}</div>
        <div class="meta"><span>${escapeHtml(item.origin || '产地未注明')}</span><span class="price">¥${Number(item.price).toFixed(2)}</span></div>
      </div>
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" aria-label="查看 ${escapeHtml(item.name)}"></a>
    </article>`).join('');
}

function fillOrigins() {
  const selected = $('#originFilter').value;
  const origins = [...new Set(data.products.map(item => item.origin).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  $('#originFilter').innerHTML = '<option value="">全部产地</option>' + origins.map(origin => `<option>${escapeHtml(origin)}</option>`).join('');
  if (origins.includes(selected)) $('#originFilter').value = selected;
}

async function loadProducts() {
  data = await fetch(`${dataUrl}?t=${Date.now()}`).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  fillOrigins();
  render();
  $('#scanTime').textContent = formatTime(data.scannedAt);
}

async function pollStatus() {
  if (staticMode) {
    $('#statusText').textContent = `公开版数据已就绪：共 ${data.products.length} 个全年水果`;
    $('#statusDot').className = 'dot live';
    $('#scanBtn span').textContent = '刷新数据';
    $('#progressBar').style.width = '100%';
    $('#progressText').textContent = '100%';
    return { running: false, phase: 'static' };
  }
  const state = await fetch('/api/status').then(response => response.json());
  $('#statusText').textContent = state.message;
  $('#statusDot').className = `dot ${state.running ? 'live' : state.error ? 'error' : ''}`;
  $('#scanBtn').disabled = state.running;
  $('#scanBtn span').textContent = state.running ? '扫描中…' : '开始扫描';
  const percent = state.total ? Math.round(state.current / state.total * 100) : 0;
  $('#progressBar').style.width = `${percent}%`;
  $('#progressText').textContent = state.running || state.phase === 'done' ? `${percent}%` : '—';
  if (!state.running && statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
    if (state.phase === 'done') await loadProducts();
  }
  return state;
}

async function startScan() {
  if (staticMode) {
    $('#statusText').textContent = '正在读取最新公开数据…';
    await loadProducts();
    await pollStatus();
    return;
  }
  $('#scanBtn').disabled = true;
  try {
    await fetch('/api/scan', { method: 'POST' });
    await pollStatus();
    if (!statusTimer) statusTimer = setInterval(pollStatus, 700);
  } catch (error) {
    $('#statusText').textContent = connectionMessage(error);
    $('#statusDot').className = 'dot error';
    $('#scanBtn').disabled = false;
  }
}

function exportCsv() {
  if (!data.products.length) return alert('暂无数据，请先扫描。');
  const rows = [['商品ID', '商品名称', '规格', '价格', '产品周期', '产地', '服务类型', '详情链接']];
  for (const item of data.products) rows.push([item.id, item.name, item.subtitle, item.price, item.period, item.origin, item.services.join('/'), item.url]);
  const csv = '\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `全年水果_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

$('#scanBtn').addEventListener('click', startScan);
$('#exportBtn').addEventListener('click', exportCsv);
$('#searchInput').addEventListener('input', render);
$('#originFilter').addEventListener('change', render);

if (location.protocol === 'file:') {
  $('#statusText').textContent = connectionMessage();
  $('#statusDot').className = 'dot error';
  $('#scanBtn').disabled = true;
} else (staticMode ? loadProducts().then(pollStatus) : Promise.all([loadProducts(), pollStatus()]).then(async () => {
  const state = await pollStatus();
  if (state.running && !statusTimer) statusTimer = setInterval(pollStatus, 700);
})).catch(error => {
  $('#statusText').textContent = connectionMessage(error);
  $('#statusDot').className = 'dot error';
});
