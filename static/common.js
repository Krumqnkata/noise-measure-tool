// Общи помощни функции за страниците на шумомера

const $ = (id) => document.getElementById(id);

const GRID = 'rgba(148, 163, 184, 0.14)';
const LABEL = '#94a3b8';
const FONT = '11px ui-sans-serif, system-ui, sans-serif';

const LEVELS = [
  { max: 60, color: '#4ade80', label: 'Тихо' },
  { max: 80, color: '#facc15', label: 'Умерено шумно' },
  { max: 90, color: '#fb923c', label: 'Шумно' },
  { max: Infinity, color: '#f87171', label: 'Много шумно – вредно при продължително излагане' },
];
const levelInfo = (v) => LEVELS.find((l) => v < l.max);
const levelColor = (v) => (Number.isFinite(v) ? levelInfo(v).color : '');

async function api(path, body, method) {
  const opts = {};
  if (body !== undefined || method) {
    opts.method = method || 'POST';
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // FastAPI връща грешките при валидация като списък
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => d.msg).join('; ') : data.detail;
    throw new Error(detail || res.statusText);
  }
  return data;
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

const fmtDb = (v) => (Number.isFinite(v) ? v.toFixed(1) : '--');
const fmtFreq = (f) => (f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`);
const fmtHz = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return (h ? `${h}:` : '') + `${pad(m)}:${pad(r)}`;
}
const fmtDateTime = (t) => new Date(t * 1000).toLocaleString('bg-BG', { dateStyle: 'short', timeStyle: 'medium' });
const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString('bg-BG');

// Canvas, който следи размера си и рисува остро на екрани с висока плътност
function setupCanvas(canvas, onResize) {
  const s = { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0 };
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    s.w = r.width; s.h = r.height;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  return s;
}

// Обхват по Y, закръглен до 10 dB, с поне minSpan dB
function levelRange(values, minSpan = 30) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (lo === Infinity) { lo = 30; hi = 90; }
  lo = Math.floor((lo - 3) / 10) * 10;
  hi = Math.ceil((hi + 3) / 10) * 10;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = Math.floor((mid - minSpan / 2) / 10) * 10;
    hi = lo + minSpan;
  }
  return { lo, hi };
}

// Хоризонтална мрежа с етикети в dB и прекъснати линии за праговете 60/80/90
function drawLevelGrid(ctx, box, lo, hi) {
  const { L, T, pw, ph } = box;
  const y = (v) => T + ph * (1 - (v - lo) / (hi - lo));
  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const step = hi - lo > 60 ? 20 : 10;
  for (let v = lo; v <= hi; v += step) {
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(L, y(v)); ctx.lineTo(L + pw, y(v)); ctx.stroke();
    ctx.fillStyle = LABEL; ctx.fillText(v, L - 6, y(v));
  }
  ctx.setLineDash([4, 4]);
  for (const l of LEVELS.slice(0, 3)) {
    if (l.max > lo && l.max < hi) {
      ctx.strokeStyle = l.color + '80';
      ctx.beginPath(); ctx.moveTo(L, y(l.max)); ctx.lineTo(L + pw, y(l.max)); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  return y;
}

// Безопасен localStorage (може да липсва в частен прозорец)
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* няма значение */ }
  },
};
