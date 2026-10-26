// Общи помощни функции и стилови константи за интерфейса на шумомера

const $ = (id) => document.getElementById(id);

// Безопасен localStorage (може да липсва в частен прозорец)
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* няма значение */ }
  },
};

// ---------- тема ----------
// Цветовете са CSS променливи (в index.html) за светла и тъмна тема. Графиките
// ги прочитат оттам и се прерисуват при смяна на темата.

const COLORS = {};
const FONT = '11px Onest, ui-sans-serif, system-ui, sans-serif';

function refreshColors() {
  const css = getComputedStyle(document.documentElement);
  const rgb = (name, alpha = 1) => `rgb(${css.getPropertyValue(`--${name}`).trim()} / ${alpha})`;
  Object.assign(COLORS, {
    grid: rgb('grid'), axis: rgb('axis'), ink: rgb('ink'), ink3: rgb('ink3'),
    surface: rgb('panel'), raised: rgb('raised'), track: rgb('track'),
    tick: rgb('tick'), tickMinor: rgb('tick-minor'), crosshair: rgb('ink', 0.35),
    accent: rgb('accent'), accentHover: rgb('accent', 0.7), accentWash: rgb('accent', 0.1),
    hold: '#fab219',
  });
}

const themeQuery = window.matchMedia('(prefers-color-scheme: light)');
let themePref = store.get('theme', 'system');

function applyTheme() {
  const theme = themePref === 'system' ? (themeQuery.matches ? 'light' : 'dark') : themePref;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f5f7' : '#101a22');
  refreshColors();
}
themeQuery.addEventListener('change', () => { if (themePref === 'system') { applyTheme(); window.onThemeChange?.(); } });
applyTheme();

// ---------- нива и справочни данни (текстовете се превеждат с t()) ----------

// Статусна палитра (валидирана за двете теми). Цветът винаги върви с надпис.
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

// Категориите на разпознаването (същите като в backend/classifier.py)
const SOUND_CATEGORIES = {
  people: { icon: '🗣️', name: 'Хора и гласове' },
  music: { icon: '🎵', name: 'Музика' },
  dog: { icon: '🐕', name: 'Куче' },
  animals: { icon: '🐾', name: 'Животни' },
  traffic: { icon: '🚗', name: 'Трафик' },
  construction: { icon: '🔨', name: 'Ремонт и инструменти' },
  alarm: { icon: '🚨', name: 'Сирена или аларма' },
  nature: { icon: '🌧️', name: 'Природа' },
  household: { icon: '🏠', name: 'Домакинство' },
  bang: { icon: '💥', name: 'Удари и трясъци' },
  noise: { icon: '〰️', name: 'Шум и бучене' },
  silence: { icon: '🔇', name: 'Тишина' },
  unknown: { icon: '❔', name: 'Не е ясно' },
};
// Собствените звуци идват като "custom:<id>"; имената им се зареждат от сървъра (sounds.js)
let CUSTOM_SOUNDS = {};
function soundCategory(id) {
  if (String(id).startsWith('custom:')) {
    const s = CUSTOM_SOUNDS[String(id).slice(7)];
    return { icon: s?.icon || '🔔', name: s?.name || 'Мой звук', custom: true };
  }
  return SOUND_CATEGORIES[id] || SOUND_CATEGORIES.unknown;
}
// Името на категория за показване: собствените звуци не се превеждат
const soundName = (id) => { const c = soundCategory(id); return c.custom ? c.name : t(c.name); };

// Пускане на аудио клип; повторно натискане го спира
let clipAudio = null;
function playClip(clipId, button) {
  if (clipAudio) {
    const sameClip = clipAudio.dataset.clip === String(clipId);
    clipAudio.pause();
    clipAudio.button.textContent = '▶';
    clipAudio = null;
    if (sameClip) return;
  }
  const audio = new Audio(`/api/clips/${clipId}`);
  audio.dataset.clip = clipId;
  audio.button = button;
  audio.onended = () => { button.textContent = '▶'; clipAudio = null; };
  button.textContent = '■';
  audio.play().catch(() => { button.textContent = '▶'; });
  clipAudio = audio;
}
function clipButton(clipId) {
  const b = document.createElement('button');
  b.className = 'btn px-2 py-0.5 text-xs';
  b.textContent = '▶';
  b.title = t('Пусни клипа');
  b.addEventListener('click', () => playClip(clipId, b));
  return b;
}
// Как се показва събитие според вида му
function eventLabel(e) {
  if (e.kind === 'custom') return `🔔 ${e.label}`;
  if (e.kind === 'anomaly') return `⚠ ${t('Аномалия')}: ${e.label}`;
  return t('Аларма');
}

// Наредба № 6/2006, Приложение 2 – имената на териториите (табл. 2) и помещенията (табл. 1).
// Числата идват от сървъра (/api/norms), за да има един източник.
const ENV_ZONE_NAMES = {
  residential: 'Жилищни зони и територии',
  central: 'Смесени централни градски части',
  road: 'Територии с интензивен автомобилен трафик',
  rail: 'Територии с релсов железопътен и трамваен транспорт',
  aviation: 'Територии с авиационен шум',
  industrial: 'Производствено-складови територии и зони',
  recreation: 'Зони за обществен и индивидуален отдих',
  medical: 'Зони за лечебни заведения',
  education: 'Зони за научноизследователска и учебна дейност',
  quiet: 'Тихи зони извън урбанизираните територии',
};
const INDOOR_ROOM_NAMES = {
  hospital: 'Стаи и операционни зали в лечебни заведения',
  living: 'Жилищни стаи, спални, хотелски стаи',
  doctor: 'Лекарски кабинети, конферентни и зрителни зали',
  classroom: 'Класни стаи, аудитории, читални',
  office: 'Работни помещения в административни сгради',
  catering: 'Заведения за хранене, фоайета, салони',
  shop: 'Търговски зали, зали за пътници в гари',
};
const ENV_PERIOD_NAMES = { day: 'Ден', evening: 'Вечер', night: 'Нощ' };
const ENV_PERIOD_HOURS = { day: '7–19 ч', evening: '19–23 ч', night: '23–7 ч' };
const envPeriodOf = (hour) => (hour >= 7 && hour < 19 ? 'day' : hour >= 19 && hour < 23 ? 'evening' : 'night');

// Директива 2003/10/ЕО / Наредба № 6 от 2005 г. – праговете и какво изискват
const WORKPLACE_INFO = {
  lower: { label: 'Долни стойности за действие', action: 'Работодателят осигурява антифони, информация и обучение; аудиометрия при поискване.' },
  upper: { label: 'Горни стойности за действие', action: 'Антифоните са задължителни; програма от мерки срещу шума; зоната се обозначава.' },
  limit: { label: 'Гранични стойности', action: 'Не бива да се превишават дори с антифоните – нужни са незабавни мерки.' },
};

let NORMS = null;
async function loadNorms() {
  if (!NORMS) NORMS = await api('/api/norms');
  return NORMS;
}

// Избраната зона/помещение за сравнение с Наредба № 6/2006 – обща за „Норми“ и отчетите
let envSelection = store.get('envZone', { kind: 'zone', id: 'residential', tonal: false });
function envLimitsFor(sel = envSelection) {
  if (!NORMS) return null;
  const values = sel.kind === 'zone' ? NORMS.env_zones[sel.id] : NORMS.indoor_rooms[sel.id];
  const penalty = sel.kind === 'room' && sel.tonal && NORMS.indoor_tonal_penalty_rooms.includes(sel.id) ? 5 : 0;
  return { day: values[0] - penalty, evening: values[1] - penalty, night: values[2] - penalty };
}
const envSelectionName = (sel = envSelection) => t((sel.kind === 'zone' ? ENV_ZONE_NAMES : INDOOR_ROOM_NAMES)[sel.id]);

// Попълва <select> със зоните и помещенията (групирани)
function fillEnvSelect(select) {
  select.replaceChildren();
  for (const [kind, label, names] of [['zone', 'Територии', ENV_ZONE_NAMES], ['room', 'Помещения (проникващ шум)', INDOOR_ROOM_NAMES]]) {
    const group = document.createElement('optgroup');
    group.label = t(label);
    for (const [id, name] of Object.entries(names)) group.appendChild(new Option(t(name), `${kind}:${id}`));
    select.appendChild(group);
  }
  select.value = `${envSelection.kind}:${envSelection.id}`;
}

// Шумова доза: при ниво L допустимото време е 8 ч / 2^((L − критерий) / обменен коеф.)
const DOSE_STANDARDS = {
  niosh: { label: 'NIOSH', criterion: 85, exchange: 3, threshold: 80 },
  osha: { label: 'OSHA', criterion: 90, exchange: 5, threshold: 80 },
};
const WORK_DAY = 8 * 3600;
const lex8h = (laeq, seconds) => laeq + 10 * Math.log10(seconds / WORK_DAY);
const allowedSeconds = (L, std) => WORK_DAY / 2 ** ((L - std.criterion) / std.exchange);
const twaFromDose = (dose, std) => (dose > 0 ? std.criterion + (std.exchange / Math.log10(2)) * Math.log10(dose / 100) : NaN);
const doseColor = (d) => (d < 50 ? LEVELS[0].color : d < 100 ? LEVELS[2].color : LEVELS[3].color);

// ---------- сървър ----------

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
  if (!res.ok) throw new Error(errorText(data.detail) || res.statusText);
  return data;
}

// Сървърът връща грешките като код; тук ги превеждаме
function errorText(detail) {
  if (Array.isArray(detail)) return t('Невалидна стойност.');
  if (!detail || typeof detail === 'string') return detail;
  const messages = {
    demo_device: 'В демо режим микрофонът не може да се сменя.',
    device_open: 'Микрофонът не може да се отвори: {error}',
    offset_range: 'Офсетът трябва да е между −200 и 200 dB.',
    start_failed: 'Измерването не може да започне: {error}',
    not_found: 'Няма такъв запис.',
    name_empty: 'Името не може да е празно.',
    stop_first: 'Първо спри записа.',
    not_running: 'Първо пусни измерването (бутона Старт).',
    busy: 'Вече тече измерване – изчакай го.',
    no_impulse: 'Не долових плясък. Пляскай по-силно и по-близо до микрофона.',
    schedule_empty: 'Началото и краят на графика не може да съвпадат.',
    classifier_not_ready: 'Разпознаването на звуци не работи – виж раздел Анализ.',
  };
  return t(messages[detail.code] || detail.code, detail);
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

// ---------- форматиране ----------

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
  if (sec < 60) return t('{s} s', { s: Math.round(sec) });
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? t('{h} ч {m} мин', { h, m }) : t('{m} мин', { m });
}
const fmtDateTime = (t0) => new Date(t0 * 1000).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'medium' });
const fmtTime = (t0) => new Date(t0 * 1000).toLocaleTimeString(locale());

// ---------- графики ----------

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
      ctx.strokeStyle = l.color + '99';
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
  ctx.strokeStyle = COLORS.crosshair; ctx.lineWidth = 1;
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
      const title = document.createElement('div');
      title.className = 'mb-1 text-ink3';
      title.textContent = res.title;
      tip.appendChild(title);
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

// Хоризонтални ленти „име – стойност“ (разпознаване, източници в отчета)
function renderBars(container, rows) {
  container.replaceChildren();
  for (const row of rows) {
    const el = document.createElement('div');
    el.innerHTML = `
      <div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span class="flex min-w-0 items-center gap-2"><span aria-hidden="true"></span><span class="truncate"></span></span>
        <span class="shrink-0 tabular-nums text-ink2"></span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-raised"><div class="h-full rounded-full bg-accent"></div></div>`;
    const spans = el.querySelectorAll('span');
    spans[1].textContent = row.icon || '';
    spans[2].textContent = row.label;
    spans[3].textContent = row.value;
    el.querySelector('.bg-accent').style.width = `${Math.max(0, Math.min(100, row.pct))}%`;
    container.appendChild(el);
  }
}
