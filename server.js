const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3789);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'products.json');
const BASE_URL = 'https://inongjia.net';
const LIST_URL = `${BASE_URL}/Product/List?cid=1&pageNum=`;

const status = {
  running: false,
  phase: 'idle',
  current: 0,
  total: 0,
  message: '尚未扫描',
  startedAt: null,
  completedAt: null,
  error: null
};

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { scannedAt: null, totalScanned: 0, products: [] };
  }
}

function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}

function decodeHtml(value = '') {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => entities[n.toLowerCase()] ?? m)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; YearRoundFruitFinder/1.0)',
          Accept: 'text/html,application/xhtml+xml'
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 700 * attempt));
    }
  }
  throw lastError;
}

function extractVueResult(html) {
  const marker = 'result:';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error('列表页中未找到商品数据');
  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) throw new Error('商品数据格式异常');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('商品数据不完整');
}

function detailField(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}[\\s\\S]{0,120}?<span[^>]*>([\\s\\S]*?)<\\/span>`, 'i');
  const match = html.match(pattern);
  return match ? decodeHtml(match[1]) : '';
}

function parseDetail(html) {
  const titleMatch = html.match(/details_msg_title[\s\S]{0,600}?<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const serviceBlock = html.match(/服务类型:[\s\S]{0,700}?<\/ul>/i)?.[0] || '';
  const services = [...serviceBlock.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(match => decodeHtml(match[1]))
    .filter(Boolean);
  return {
    title: titleMatch ? decodeHtml(titleMatch[1]) : '',
    period: detailField(html, '产品周期:'),
    origin: detailField(html, '产&emsp;&emsp;地:'),
    services: [...new Set(services)]
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function scan() {
  if (status.running) return;
  Object.assign(status, {
    running: true,
    phase: 'list',
    current: 0,
    total: 0,
    message: '正在读取商品列表…',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  });

  try {
    const first = extractVueResult(await fetchText(`${LIST_URL}1`));
    const totalPages = Math.ceil(first.TotalCount / first.PageSize);
    status.total = totalPages;
    const pages = [first];
    if (totalPages > 1) {
      const rest = await mapLimit(
        Array.from({ length: totalPages - 1 }, (_, i) => i + 2),
        4,
        async page => {
          const result = extractVueResult(await fetchText(`${LIST_URL}${page}`));
          status.current++;
          status.message = `正在读取商品列表 ${status.current + 1}/${totalPages}`;
          return result;
        }
      );
      pages.push(...rest);
    }

    const byId = new Map();
    for (const page of pages) {
      for (const item of page.ProductList || []) byId.set(String(item.ProductId), item);
    }
    const items = [...byId.values()];
    Object.assign(status, {
      phase: 'detail',
      current: 0,
      total: items.length,
      message: `正在检查详情 0/${items.length}`
    });

    const oldData = loadData();
    const oldById = new Map(oldData.products.map(item => [String(item.id), item]));
    const now = new Date().toISOString();
    const failures = [];
    const details = await mapLimit(items, 6, async item => {
      try {
        const html = await fetchText(`${BASE_URL}/Product/Detail?id=${item.ProductId}`);
        return { item, detail: parseDetail(html) };
      } catch (error) {
        failures.push({ id: item.ProductId, error: error.message });
        return null;
      } finally {
        status.current++;
        status.message = `正在检查详情 ${status.current}/${items.length}`;
      }
    });

    const products = details
      .filter(Boolean)
      .filter(({ detail }) => detail.period.replace(/\s/g, '') === '全年')
      .map(({ item, detail }) => {
        const old = oldById.get(String(item.ProductId));
        return {
          id: String(item.ProductId),
          name: detail.title || item.Name,
          subtitle: item.SubName || '',
          price: Number(item.Price),
          image: item.Pic || '',
          period: detail.period,
          origin: detail.origin,
          services: detail.services,
          url: `${BASE_URL}/Product/Detail?id=${item.ProductId}`,
          firstSeenAt: old?.firstSeenAt || now,
          lastSeenAt: now
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    saveData({
      scannedAt: now,
      totalScanned: items.length,
      totalPages,
      failedCount: failures.length,
      failures,
      products
    });
    Object.assign(status, {
      running: false,
      phase: 'done',
      current: items.length,
      total: items.length,
      completedAt: now,
      message: `扫描完成：找到 ${products.length} 个全年水果${failures.length ? `，${failures.length} 个详情读取失败` : ''}`
    });
  } catch (error) {
    Object.assign(status, {
      running: false,
      phase: 'error',
      error: error.message,
      message: `扫描失败：${error.message}`
    });
  }
}

function json(res, value, code = 200) {
  const body = JSON.stringify(value);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(path.resolve(PUBLIC)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/products' && req.method === 'GET') return json(res, loadData());
  if (pathname === '/api/status' && req.method === 'GET') return json(res, status);
  if (pathname === '/api/scan' && req.method === 'POST') {
    if (status.running) return json(res, { ok: true, alreadyRunning: true, status }, 202);
    scan();
    return json(res, { ok: true, status }, 202);
  }
  serveStatic(req, res);
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n农甲全年水果检索工具已启动： http://127.0.0.1:${PORT}\n`);
  });
}

module.exports = { scan, status, loadData };
