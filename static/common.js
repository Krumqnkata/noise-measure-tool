// Общи помощни функции и стилови константи за интерфейса на шумомера

const $ = (id) => document.getElementById(id);

// Цветовете на графиките – същите като CSS променливите в index.html
const COLORS = {
  grid: '#263643',
  axis: '#8597a5',
  ink: '#ecf1f4',
  surface: '#17232d',
  track: '#22323e',
  accent: '#3987e5',
  accentWash: 'rgba(57, 135, 229, 0.10)',
  hold: '#fab219',
};
const FONT = '11px Onest, ui-sans-serif, system-ui, sans-serif';

// Статусна палитра (валидирана за тъмна повърхност). Цветът винаги върви с надпис.
const LEVELS = [
  { max: 60, color: '#0ca30c', label: 'Тихо' },
  { max: 80, color: '#fab219', label: 'Умерено шумно' },
  { max: 90, color: '#ec835a', label: 'Шумно' },
  { max: Infinity, color: '#d03b3b', label: 'Много шумно' },
];
const levelInfo = (v) => LEVELS.find((l) => v < l.max);
const levelColor = (v) => (Number.isFinite(v) ? levelInfo(v).color : '');

// Ориентировъчни нива на познати звуци (dB SPL), през 10 dB
const NOISE_REFERENCES = [
  { db: 0, icon: '🔇', name: 'Праг на чуваемост' },
  { db: 10, icon: '🫁', name: 'Дишане' },
  { db: 20, icon: '🍃', name: 'Шумолене на листа' },
  { db: 30, icon: '🤫', name: 'Шепот' },
  { db: 40, icon: '📚', name: 'Тиха библиотека' },
  { db: 50, icon: '🌧️', name: 'Умерен дъжд, хладилник' },
  { db: 60, icon: '💬', name: 'Нормален разговор' },
  { db: 70, icon: '🧹', name: 'Прахосмукачка' },
  { db: 80, icon: '🚗', name: 'Натоварен трафик' },
  { db: 90, icon: '🚇', name: 'Метро, косачка' },
  { db: 100, icon: '🏍️', name: 'Мотоциклет, бормашина' },
  { db: 110, icon: '🎸', name: 'Рок концерт, клаксон' },
  { db: 120, icon: '🚑', name: 'Сирена, гръмотевица' },
  { db: 130, icon: '🔨', name: 'Къртач – праг на болка' },
  { db: 140, icon: '✈️', name: 'Реактивен двигател' },
];
const noiseReference = (v) => NOISE_REFERENCES[Math.min(14, Math.max(0, Math.round(v / 10)))];

// Шумова доза: при ниво L допустимото време е 8 ч / 2^((L − критерий) / обменен коеф.)
const DOSE_STANDARDS = {
  niosh: { label: 'NIOSH', criterion: 85, exchange: 3, threshold: 80 },
  osha: { label: 'OSHA', criterion: 90, exchange: 5, threshold: 80 },
};
const WORK_DAY = 8 * 3600;
const allowedSeconds = (L, std) => WORK_DAY / 2 ** ((L - std.criterion) / std.exchange);
const twaFromDose = (dose, std) => (dose > 0 ? std.criterion + (std.exchange / Math.log10(2)) * Math.log10(dose / 100) : NaN);
const doseColor = (d) => (d < 50 ? LEVELS[0].color : d < 100 ? LEVELS[2].color : LEVELS[3].color);

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
const fmtPct = (d) => `${d < 10 ? d.toFixed(2) : d.toFixed(1)}%`;

function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return (h ? `${h}:` : '') + `${pad(m)}:${pad(r)}`;
}
function fmtLongDuration(sec) {
  if (!Number.isFinite(sec)) return '∞';
  if (sec < 60) return `${Math.round(sec)} s`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}
const fmtDateTime = (t) => new Date(t * 1000).toLocaleString('bg-BG', { dateStyle: 'short', timeStyle: 'medium' });
const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString('bg-BG');

// Canvas, който следи размера си и рисува остро на екрани с висока плътност.
// Скрит раздел има размер 0; при показване ResizeObserver го преоразмерява.
function setupCanvas(canvas, onResize) {
  const s = { canvas, ctx: canvas.getContext('2d'), w: 0, h: 0, box: null, hover: null, tip: null };
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

// Хоризонтална мрежа (плътни тънки линии) с етикети в dB. Праговете 60/80/90 са
// прекъснати линии – те наистина са прагове, а не мрежа.
function drawLevelGrid(ctx, box, lo, hi) {
  const { L, T, pw, ph } = box;
  const y = (v) => T + ph * (1 - (v - lo) / (hi - lo));
  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const step = hi - lo > 60 ? 20 : 10;
  for (let v = lo; v <= hi; v += step) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + pw, yy); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(v, L - 8, yy);
  }
  ctx.setLineDash([3, 4]);
  for (const l of LEVELS.slice(0, 3)) {
    if (l.max > lo && l.max < hi) {
      ctx.strokeStyle = l.color + '80';
      ctx.beginPath(); ctx.moveTo(L, y(l.max)); ctx.lineTo(L + pw, y(l.max)); ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  return y;
}

// Линия + лека площ под нея (2px линия, ~10% заливка)
function drawSeries(ctx, points, color, wash, baseline) {
  if (points.length < 2) return;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  if (wash) {
    ctx.lineTo(points[points.length - 1][0], baseline);
    ctx.lineTo(points[0][0], baseline);
    ctx.closePath();
    ctx.fillStyle = wash; ctx.fill();
  }
}

// Вертикална линия под курсора и точки с пръстен в цвета на повърхността
function drawCrosshair(cv) {
  const h = cv.hover;
  if (!h || !cv.box) return;
  const { ctx } = cv;
  const x = Math.round(h.x) + 0.5;
  ctx.strokeStyle = 'rgba(236, 241, 244, 0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, cv.box.T); ctx.lineTo(x, cv.box.T + cv.box.ph); ctx.stroke();
  for (const p of h.points || []) {
    ctx.beginPath(); ctx.arc(h.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = COLORS.surface; ctx.stroke();
  }
}

// Подсказка над графика. pick(x, y) връща {x, title, rows: [{value, label, color}], points}
// или null. Стойността е водеща, името – второстепенно; текстът е в неутрален цвят.
function attachTooltip(cv, pick, onChange) {
  const host = cv.canvas.parentElement;
  host.classList.add('relative');
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.appendChild(tip);
  let pointer = null;

  const refresh = () => {
    const res = pointer && cv.box ? pick(pointer.x, pointer.y) : null;
    cv.hover = res;
    if (!res) { tip.hidden = true; return; }
    tip.replaceChildren();
    if (res.title) {
      const t = document.createElement('div');
      t.className = 'mb-1 text-ink3';
      t.textContent = res.title;
      tip.appendChild(t);
    }
    for (const row of res.rows) {
      const line = document.createElement('div');
      line.className = 'flex items-center gap-2';
      if (row.color) {
        const key = document.createElement('span');
        key.className = 'inline-block h-0.5 w-3 rounded-full';
        key.style.background = row.color;
        line.appendChild(key);
      }
      const v = document.createElement('strong');
      v.className = 'font-semibold text-ink';
      v.textContent = row.value;
      const l = document.createElement('span');
      l.className = 'text-ink3';
      l.textContent = row.label || '';
      line.append(v, l);
      tip.appendChild(line);
    }
    tip.hidden = false;
    const w = tip.offsetWidth;
    const left = res.x + 14 + w > cv.w ? res.x - 14 - w : res.x + 14;
    tip.style.left = `${cv.canvas.offsetLeft + Math.max(0, left)}px`;
    tip.style.top = `${cv.canvas.offsetTop + 6}px`;
  };

  cv.canvas.addEventListener('pointermove', (e) => {
    const r = cv.canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    refresh();
    onChange?.();
  });
  cv.canvas.addEventListener('pointerleave', () => { pointer = null; refresh(); onChange?.(); });
  cv.tip = { refresh };
  return cv.tip;
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
