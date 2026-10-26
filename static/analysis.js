// Раздел „Анализ“: разпознаване на звука, спектър, форма на вълната,
// третинооктавни ленти и спектрограма

const F_MIN = 20, F_MAX = 20000;
const LOG_RANGE = Math.log10(F_MAX / F_MIN);
const freqPos = (f) => Math.log10(f / F_MIN) / LOG_RANGE;   // 0..1 по логаритмичната ос
const posFreq = (p) => F_MIN * 10 ** (p * LOG_RANGE);
const OCTAVE_NOMINAL = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000];
const OCTAVE_LABELS = [31.5, 125, 500, 2000, 8000];

const waveCv = setupCanvas($('waveform'), markDirty);
const specCv = setupCanvas($('spectrum'), markDirty);
const octCv = setupCanvas($('octaves'), markDirty);
let maxHold = null;

function resetAnalysis() {
  maxHold = null;
  dirty = true;
}

// ---------- разпознаване на звука ----------

let lastSound = null;
let classifierStatus = { state: 'starting', error: null };

function onSound(m) {
  lastSound = m;
  const cat = soundCategory(m.category);
  const name = soundName(m.category);
  const pct = `${Math.round(m.score * 100)}%`;

  $('src-icon').textContent = cat.icon;
  $('src-name').textContent = name;
  $('src-score').textContent = t('сигурност {pct}', { pct });
  $('side-source').hidden = false;
  $('side-source').textContent = `${cat.icon} ${name}`;

  $('cls-icon').textContent = cat.icon;
  $('cls-name').textContent = name;
  // Имената от модела са на английски (AudioSet); показваме ги като подсказка
  $('cls-labels').textContent = `${t('Модел:')} ${m.model === 'panns' ? 'PANNs CNN14' : 'YAMNet'} – ${m.labels.map((l) => `${l.name} ${Math.round(l.score * 100)}%`).join(', ')}`;
  renderBars($('cls-bars'), m.categories.map((c) => ({
    icon: soundCategory(c.id).icon, label: soundName(c.id),
    value: `${Math.round(c.score * 100)}%`, pct: c.score * 100,
  })));
}

function renderClassifierStatus(status) {
  classifierStatus = status;
  renderModelChoice(status);
  const messages = {
    starting: 'Моделът се зарежда…',
    downloading: 'Свалям модела за разпознаване (~4 MB)…',
    ready: 'Работи. Моделът е YAMNet на Google (AudioSet, 521 вида звуци, лиценз Apache 2.0).',
    missing_runtime: 'Изключено – липсва библиотеката. Инсталирай я с „pip install -r requirements-ml.txt“ и рестартирай сървъра.',
    disabled: 'Изключено с флага --no-classifier.',
    error: 'Грешка: {error}',
  };
  const text = t(messages[status.state] || status.state, { error: status.error || '' });
  $('cls-status').textContent = text;
  const ready = status.state === 'ready';
  $('cls-notice').hidden = ready;
  $('cls-notice').textContent = text;
  $('cls-body').hidden = !ready;
  if (!ready) {
    $('src-icon').textContent = '❔';
    $('src-name').textContent = t('Няма разпознаване');
    $('src-score').textContent = status.state === 'downloading' ? t('моделът се сваля…') : '';
  }
}

// Избор на модела (Настройки): бърз YAMNet или точен PANNs CNN14
function renderModelChoice(status) {
  const available = !['disabled', 'missing_runtime'].includes(status.state);
  document.querySelectorAll('input[name=cls-model]').forEach((el) => {
    el.checked = el.value === (status.choice || 'yamnet');
    el.disabled = !available;
  });
  const acc = status.accurate || { state: 'idle' };
  const messages = {
    starting: 'Пускам точния модел…',
    downloading: 'Свалям точния модел… {pct}%',
    ready: 'Точният модел работи. PANNs CNN14 (Kong и др., 2020), тегла CC-BY-4.0. Собствените звуци и аномалиите ползват YAMNet.',
    error: 'Точният модел не тръгна: {error}. Дотогава разпознава YAMNet.',
  };
  const el = $('cls-model-status');
  el.hidden = status.choice !== 'panns' || !messages[acc.state];
  if (!el.hidden) el.textContent = t(messages[acc.state], { pct: Math.round(acc.progress * 100), error: acc.error || '' });
}
$('cls-model').addEventListener('change', (e) => {
  action(() => api('/api/classifier/model', { model: e.target.value }));
});

// ---------- форма на вълната ----------

let waveScale = 0.05;

function drawWaveform() {
  const { ctx, w, h } = waveCv;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, Math.round(h / 2) + 0.5); ctx.lineTo(w, Math.round(h / 2) + 0.5); ctx.stroke();
  const data = latest?.waveform;
  if (!data) return;

  // Автоматичен мащаб: бързо нагоре, плавно надолу, за да не „скача“ картината
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const target = Math.max(peak, 1e-4);
  waveScale = target > waveScale ? target : waveScale * 0.95 + target * 0.05;
  $('wave-scale').textContent = t('усилено ×{n}', { n: (1 / waveScale).toFixed(0) });

  const amp = h / 2 - 6;
  drawSeries(ctx, data.map((v, i) => [(i / (data.length - 1)) * w, h / 2 - (v / waveScale) * amp]), COLORS.accent);
}

// ---------- спектър ----------
// Данните идват в dBFS; етикетите показват калибрираните стойности.

const SPEC_MIN = -120, SPEC_MAX = 0;
const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const LABEL_FREQS = [100, 1000, 10000];

$('spec-hold').addEventListener('change', (e) => {
  maxHold = null;
  $('spec-legend').hidden = !e.target.checked;
  dirty = true;
});

attachTooltip(specCv, (x) => {
  const bands = latest?.spectrum;
  if (!bands) return null;
  const { L, pw } = specCv.box;
  const n = bands.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(((x - L) / pw) * n)));
  const bx = L + pw * ((i + 0.5) / n);
  const rows = [{ value: `${(bands[i] + calOffset).toFixed(1)} dB`, label: t('сега'), color: COLORS.accent }];
  const points = [{ y: specCv.y(bands[i]), color: COLORS.accent }];
  if (maxHold) {
    rows.push({ value: `${(maxHold[i] + calOffset).toFixed(1)} dB`, label: t('максимум'), color: COLORS.hold });
    points.push({ y: specCv.y(maxHold[i]), color: COLORS.hold });
  }
  return { x: bx, title: fmtFreq(posFreq((i + 0.5) / n)), rows, points };
}, markDirty);

function drawSpectrum() {
  const cv = specCv;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 28 };
  const y = (v) => box.T + box.ph * (1 - (Math.max(v, SPEC_MIN) - SPEC_MIN) / (SPEC_MAX - SPEC_MIN));
  Object.assign(cv, { box, y });

  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = SPEC_MIN; v <= SPEC_MAX; v += 20) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(box.L, yy); ctx.lineTo(box.L + box.pw, yy); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(Math.round(v + calOffset), box.L - 8, yy);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const f of GRID_FREQS) {
    const xx = Math.round(box.L + box.pw * freqPos(f)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(xx, box.T); ctx.lineTo(xx, box.T + box.ph); ctx.stroke();
    if (LABEL_FREQS.includes(f)) { ctx.fillStyle = COLORS.axis; ctx.fillText(`${fmtHz(f)} Hz`, xx, h - 14); }
  }

  const bands = latest?.spectrum;
  if (!bands) return;
  // Лентите са равномерни по логаритмичната ос, затова всяка заема еднаква ширина
  const n = bands.length;
  const bx = (i) => box.L + box.pw * ((i + 0.5) / n);
  if (maxHold) drawSeries(ctx, maxHold.map((v, i) => [bx(i), y(v)]), COLORS.hold);
  drawSeries(ctx, bands.map((v, i) => [bx(i), y(v)]), COLORS.accent, COLORS.accentWash, box.T + box.ph);
  cv.tip.refresh();
  drawCrosshair(cv);
}

// ---------- третинооктавни ленти ----------

let octView = store.get('octView', 'chart');
const octTable = $('oct-table');
const octCells = OCTAVE_NOMINAL.map((f) => {
  const cell = document.createElement('div');
  cell.className = 'flex justify-between gap-2 border-b border-line py-1.5';
  cell.innerHTML = '<span class="text-ink3"></span><span class="tabular-nums">--</span>';
  cell.children[0].textContent = `${fmtHz(f)} Hz`;
  octTable.appendChild(cell);
  return cell.children[1];
});

(function setupOctView() {
  const root = $('seg-oct-view');
  const render = () => {
    root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === octView));
    $('octaves').hidden = octView !== 'chart';
    octTable.hidden = octView !== 'table';
    dirty = true;
  };
  root.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (v) { octView = v; store.set('octView', v); render(); }
  });
  render();
})();

attachTooltip(octCv, (x) => {
  const bands = latest?.octaves;
  if (!bands) return null;
  const { L, pw } = octCv.box;
  const slot = pw / bands.length;
  const i = Math.floor((x - L) / slot);
  if (i < 0 || i >= bands.length) return null;
  return {
    x: L + slot * (i + 0.5),
    title: `${fmtHz(OCTAVE_NOMINAL[i])} Hz`,
    rows: [{ value: `${bands[i].toFixed(1)} dB`, label: t('ниво') }],
    index: i,
  };
}, markDirty);

function drawOctaves() {
  const cv = octCv;
  const bands = latest?.octaves;
  if (bands && octView === 'table') bands.forEach((v, i) => { octCells[i].textContent = `${v.toFixed(1)} dB`; });
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 28 };
  cv.box = box;
  // Скалата следва калибрирането: 110 dB под офсета до самия офсет (= 0 dBFS)
  const hi = Math.ceil(calOffset / 10) * 10, lo = hi - 110;
  const y = (v) => box.T + box.ph * (1 - (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo));

  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = hi; v >= lo; v -= 20) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(box.L, yy); ctx.lineTo(box.L + box.pw, yy); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(v, box.L - 8, yy);
  }

  const n = OCTAVE_NOMINAL.length;
  const slot = box.pw / n;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = COLORS.axis;
  OCTAVE_NOMINAL.forEach((f, i) => {
    if (OCTAVE_LABELS.includes(f)) ctx.fillText(`${fmtHz(f)} Hz`, box.L + slot * (i + 0.5), h - 14);
  });

  cv.tip.refresh();
  if (!bands) return;
  // Колони до 24 px, заоблени отгоре и прави при основата, с въздух между тях
  const barW = Math.min(24, slot - 2);
  const base = box.T + box.ph;
  bands.forEach((v, i) => {
    const top = y(v);
    const hgt = base - top;
    if (hgt < 1) return;
    ctx.fillStyle = cv.hover?.index === i ? COLORS.accentHover : COLORS.accent;
    ctx.beginPath();
    ctx.roundRect(box.L + slot * i + (slot - barW) / 2, top, barW, hgt, [Math.min(4, hgt), Math.min(4, hgt), 0, 0]);
    ctx.fill();
  });
}

// ---------- NR / NC ----------
// Кривите NR 10…80 като тънки линии, измерените октави отгоре. Числата идват от /api/norms.

const nrCv = setupCanvas($('nr-chart'), markDirty);
const NR_SHOWN = [10, 20, 30, 40, 50, 60, 70, 80];

attachTooltip(nrCv, (x) => {
  const levels = latest?.octave_bands;
  const bands = NORMS?.nr_bands;
  if (!levels || !bands || !nrCv.box) return null;
  const { L, pw } = nrCv.box;
  const i = Math.floor(((x - L) / pw) * bands.length);
  if (i < 0 || i >= bands.length) return null;
  return {
    x: nrCv.x(i),
    title: `${fmtHz(bands[i])} Hz`,
    rows: [{ value: `${levels[i].toFixed(1)} dB`, label: t('октава'), color: COLORS.accent }],
    points: [{ y: nrCv.y(levels[i]), color: COLORS.accent }],
  };
}, markDirty);

function drawNr() {
  const cv = nrCv;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  const bands = NORMS?.nr_bands;
  if (!w || !bands) return;
  const levels = latest?.octave_bands;
  const box = { L: 36, T: 8, pw: w - 36 - 52, ph: h - 30 };
  const hi = Math.max(100, Math.ceil(((levels ? Math.max(...levels) : 0) + 10) / 20) * 20);
  const y = (v) => box.T + box.ph * (1 - Math.min(Math.max(v, 0), hi) / hi);
  const x = (i) => box.L + box.pw * ((i + 0.5) / bands.length);
  Object.assign(cv, { box, x, y });

  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = 0; v <= hi; v += 20) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(box.L, yy); ctx.lineTo(box.L + box.pw, yy); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(v, box.L - 8, yy);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  bands.forEach((f, i) => ctx.fillText(fmtHz(f), x(i), h - 16));

  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (const nr of NR_SHOWN) {
    const curve = NORMS.nr_curves[nr];
    ctx.beginPath();
    curve.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = COLORS.tickMinor; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = COLORS.axis;
    ctx.fillText(`NR ${nr}`, x(bands.length - 1) + 8, y(curve[curve.length - 1]));
  }

  cv.tip.refresh();
  if (!levels) return;
  drawSeries(ctx, levels.map((v, i) => [x(i), y(v)]), COLORS.accent);
  levels.forEach((v, i) => {
    ctx.beginPath(); ctx.arc(x(i), y(v), 4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.accent; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = COLORS.surface; ctx.stroke();
  });
  drawCrosshair(cv);
}

// ---------- спектрограма ----------
// Canvas с фиксирана резолюция: 1 колона на кадър, 1 ред на честотна лента.
// При всеки кадър картината се измества с 1 px наляво и се дорисува нова колона.

const SG_COLS = 600, SG_ROWS = 128, SG_MIN = -110, SG_MAX = -20;
const sgCanvas = $('spectrogram');
sgCanvas.width = SG_COLS; sgCanvas.height = SG_ROWS;
const sgCtx = sgCanvas.getContext('2d');
sgCtx.fillStyle = '#000004'; sgCtx.fillRect(0, 0, SG_COLS, SG_ROWS);
const sgColumn = sgCtx.createImageData(1, SG_ROWS);

// Цветова таблица (приближение на „inferno“) – 256 стойности
const COLORMAP = (() => {
  const stops = [[0, 0, 0, 4], [0.2, 66, 10, 104], [0.4, 147, 38, 103], [0.6, 221, 81, 58], [0.8, 252, 165, 10], [1, 252, 255, 164]];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const tt = i / 255;
    let k = 0;
    while (k < stops.length - 2 && tt > stops[k + 1][0]) k++;
    const [t0, ...c0] = stops[k], [t1, ...c1] = stops[k + 1];
    const f = (tt - t0) / (t1 - t0);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * f);
  }
  return lut;
})();

function pushSpectrogram(bands) {
  sgCtx.drawImage(sgCanvas, -1, 0);
  const px = sgColumn.data;
  const n = Math.min(bands.length, SG_ROWS);
  for (let i = 0; i < n; i++) {
    const tt = Math.min(1, Math.max(0, (bands[i] - SG_MIN) / (SG_MAX - SG_MIN)));
    const ci = Math.round(tt * 255) * 3;
    const o = (SG_ROWS - 1 - i) * 4;   // ниските честоти долу
    px[o] = COLORMAP[ci]; px[o + 1] = COLORMAP[ci + 1]; px[o + 2] = COLORMAP[ci + 2]; px[o + 3] = 255;
  }
  sgCtx.putImageData(sgColumn, SG_COLS - 1, 0);
}

for (const f of LABEL_FREQS) {
  const el = document.createElement('div');
  el.className = 'absolute right-0 -translate-y-1/2';
  el.style.top = `${(1 - freqPos(f)) * 100}%`;
  el.textContent = fmtHz(f);
  $('sg-axis').appendChild(el);
}

function updateSpectrogramLegend() {
  $('sg-lo').textContent = `${Math.round(SG_MIN + calOffset)} dB`;
  $('sg-hi').textContent = `${Math.round(SG_MAX + calOffset)} dB`;
}

// ---------- данни и рисуване ----------

function analysisOnData(m) {
  $('nr-value').textContent = m.nr;
  $('nc-value').textContent = m.nc <= 15 ? '≤ 15' : m.nc;
  if ($('spec-hold').checked) {
    maxHold = maxHold ? maxHold.map((x, i) => Math.max(x, m.spectrum[i])) : [...m.spectrum];
  }
  pushSpectrogram(m.spectrum);
}

function analysisFrame(visible) {
  if (!visible || !dirty) return;
  drawWaveform();
  drawSpectrum();
  drawOctaves();
  drawNr();
}
