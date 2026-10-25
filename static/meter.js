// Раздели „Ниво“ и „Доза“: циферблат, „прилича на“, жива скала, статистика,
// графика за последната минута, шумова доза, цял екран и снимка.

const HISTORY_MS = 60000;
const history = [];
// Статистика за сесията; samples се взимат 4 пъти в секунда за L10/L50/L90
const stats = { min: Infinity, max: -Infinity, energy: 0, n: 0, start: Date.now(), samples: [], frame: 0 };
const dose = { niosh: 0, osha: 0, elapsed: 0, lastT: null };

const gaugeCv = setupCanvas($('gauge'), markDirty);
const historyCv = setupCanvas($('history'), markDirty);

// ---------- циферблат ----------

const G_MIN = 0, G_MAX = 140;
const G_START = Math.PI * 0.75, G_SWEEP = Math.PI * 1.5;   // 270°, отворен отдолу
const gaugeAngle = (v) => G_START + G_SWEEP * Math.min(1, Math.max(0, (v - G_MIN) / (G_MAX - G_MIN)));
let gaugeValue = 0, gaugeTarget = 0;

function drawGauge() {
  const { ctx, w, h } = gaugeCv;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10;
  const band = Math.max(10, r * 0.1);
  const polar = (a, rr) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];

  // Празна писта и тънък външен пръстен със зоните 60 / 80 / 90 dB
  ctx.lineCap = 'butt';
  ctx.lineWidth = band; ctx.strokeStyle = COLORS.track;
  ctx.beginPath(); ctx.arc(cx, cy, r - band / 2, G_START, G_START + G_SWEEP); ctx.stroke();
  ctx.lineWidth = 3;
  const zones = [[0, 60], [60, 80], [80, 90], [90, 140]];
  zones.forEach(([a, b], i) => {
    ctx.strokeStyle = LEVELS[i].color;
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, gaugeAngle(a) + 0.01, gaugeAngle(b) - 0.01); ctx.stroke();
  });

  if (latest) {
    ctx.lineWidth = band; ctx.lineCap = 'round'; ctx.strokeStyle = levelColor(gaugeValue);
    ctx.beginPath(); ctx.arc(cx, cy, r - band / 2, G_START, Math.max(G_START + 0.001, gaugeAngle(gaugeValue))); ctx.stroke();
  }

  ctx.lineCap = 'butt';
  ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let v = G_MIN; v <= G_MAX; v += 10) {
    const a = gaugeAngle(v), major = v % 20 === 0;
    const r1 = r - band - 5, r2 = r1 - (major ? 7 : 4);
    ctx.strokeStyle = major ? '#5d7180' : '#3a4c59';
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(...polar(a, r1)); ctx.lineTo(...polar(a, r2)); ctx.stroke();
    if (major) { ctx.fillStyle = COLORS.axis; ctx.fillText(v, ...polar(a, r2 - 12)); }
  }

  // Отметка за максимума в сесията
  if (Number.isFinite(stats.max)) {
    const a = gaugeAngle(stats.max);
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(...polar(a, r - band - 1)); ctx.lineTo(...polar(a, r + 7)); ctx.stroke();
  }
}

// ---------- жива скала на шума ----------
// Редовете са от 140 dB горе до 0 dB долу; маркерът се движи плавно между тях.

const REF_ROWS = NOISE_REFERENCES.length;
const refTop = (v) => ((G_MAX - Math.min(G_MAX, Math.max(G_MIN, v))) / 10 + 0.5) / REF_ROWS * 100;
let refRow = null;

(function buildRefScale() {
  const ol = $('ref-scale');
  for (const ref of [...NOISE_REFERENCES].reverse()) {
    const li = document.createElement('li');
    li.dataset.db = ref.db;
    li.className = 'flex items-center gap-2 rounded-lg px-2 py-1';
    li.innerHTML = '<span class="w-7 shrink-0 text-right text-xs tabular-nums text-ink3"></span>' +
      '<span class="w-6 shrink-0 text-center leading-none" aria-hidden="true"></span>' +
      '<span class="min-w-0 flex-1 truncate text-sm text-ink2"></span>' +
      '<span hidden class="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums"></span>';
    li.children[0].textContent = ref.db;
    li.children[1].textContent = ref.icon;
    li.children[2].textContent = ref.name;
    ol.appendChild(li);
  }
  // Цветовете на лентата следват праговете 60/80/90 по позициите на редовете
  const p = (v) => `${refTop(v + 5)}%`;
  const [g, y, o, c] = LEVELS.map((l) => l.color);
  $('ref-bar').style.background = `linear-gradient(to bottom, ${c} 0%, ${c} ${p(85)}, ${o} ${p(85)},
    ${o} ${p(75)}, ${y} ${p(75)}, ${y} ${p(55)}, ${g} ${p(55)}, ${g} 100%)`;
})();

function updateRefScale(v) {
  const top = refTop(v);
  $('ref-marker').style.top = `${top}%`;
  $('ref-dim').style.height = `${top}%`;
  const ref = noiseReference(v);
  if (refRow?.dataset.db !== String(ref.db)) {
    if (refRow) {
      refRow.style.background = '';
      refRow.children[3].hidden = true;
      refRow.children[2].classList.replace('text-ink', 'text-ink2');
      refRow.children[2].classList.remove('font-medium');
    }
    refRow = $('ref-scale').querySelector(`[data-db="${ref.db}"]`);
    refRow.style.background = '#1e2d39';
    refRow.children[3].hidden = false;
    refRow.children[2].classList.replace('text-ink2', 'text-ink');
    refRow.children[2].classList.add('font-medium');
  }
  // Етикетът е вътре в цветна плочка – текстът е тъмен, за да има контраст
  const pill = refRow.children[3];
  pill.style.background = levelColor(v);
  pill.style.color = v >= 90 ? '#fff' : '#101a22';
  pill.textContent = v.toFixed(0);

  $('ref-icon').textContent = ref.icon;
  $('ref-name').textContent = ref.name;
  $('ref-db').textContent = `около ${ref.db} dB`;
}

// ---------- графика за последната минута ----------

attachTooltip(historyCv, (x) => {
  if (history.length < 2) return null;
  const { L, pw } = historyCv.box;
  const now = historyCv.now;
  const t = now - (1 - (x - L) / pw) * HISTORY_MS;
  let best = history[0];
  for (const p of history) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  const bx = historyCv.x(best.t);
  return {
    x: bx,
    title: `преди ${Math.max(0, (now - best.t) / 1000).toFixed(0)} s`,
    rows: [{ value: `${best.v.toFixed(1)} dB`, label: metricName(), color: COLORS.accent }],
    points: [{ y: historyCv.y(best.v), color: COLORS.accent }],
  };
}, markDirty);

function drawHistory() {
  const cv = historyCv;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 30 };
  const now = performance.now();
  const { lo, hi } = levelRange(history.map((p) => p.v));
  const y = drawLevelGrid(ctx, box, lo, hi);
  const x = (t) => box.L + box.pw * (1 - (now - t) / HISTORY_MS);
  Object.assign(cv, { box, now, x, y });

  ctx.fillStyle = COLORS.axis; ctx.textBaseline = 'top';
  for (let s = 60; s >= 0; s -= 15) {
    ctx.textAlign = s === 0 ? 'right' : s === 60 ? 'left' : 'center';
    ctx.fillText(s === 0 ? 'сега' : `−${s} s`, box.L + box.pw * (1 - s / 60), h - 16);
  }
  drawSeries(ctx, history.map((p) => [x(p.t), y(p.v)]), COLORS.accent, COLORS.accentWash, box.T + box.ph);
  cv.tip.refresh();
  drawCrosshair(cv);
}

// ---------- данни ----------

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function meterOnData(m) {
  const v = currentLevel(m);
  const now = performance.now();
  history.push({ t: now, v });
  while (history.length && history[0].t < now - HISTORY_MS) history.shift();

  stats.min = Math.min(stats.min, v);
  stats.max = Math.max(stats.max, v);
  // Средното на децибели се смята енергийно (Leq), не аритметично
  stats.energy += 10 ** (v / 10);
  stats.n++;
  if (stats.frame++ % 5 === 0) stats.samples.push(v);

  // Дозата се трупа по LAS независимо от избраното претегляне
  if (dose.lastT !== null) {
    const dt = Math.min(0.5, (now - dose.lastT) / 1000);
    const las = m.levels.A.S;
    for (const [key, std] of Object.entries(DOSE_STANDARDS)) {
      if (las >= std.threshold) dose[key] += (100 * dt) / allowedSeconds(las, std);
    }
    dose.elapsed += dt;
  }
  dose.lastT = now;

  gaugeTarget = v;
  updateMeterReadout(m);
  updateDose(m.levels.A.S);
}

const sessionLeq = () => (stats.n ? 10 * Math.log10(stats.energy / stats.n) : NaN);

function updateMeterReadout(m) {
  const v = currentLevel(m);
  const info = levelInfo(v);
  const text = v.toFixed(1);
  for (const id of ['level', 'side-level', 'top-level']) $(id).textContent = text;
  $('status-dot').style.background = info.color;
  $('status-label').textContent = info.label;
  $('dba').textContent = fmtDb(m.dba);
  $('dbc').textContent = fmtDb(m.dbc);
  $('peak-db').textContent = `${fmtDb(m.peak_db)} dB`;
  $('peak-freq').textContent = fmtFreq(m.peak_freq);
  updateRefScale(v);

  const leq = sessionLeq();
  $('stat-min').textContent = fmtDb(stats.min);
  $('stat-avg').textContent = fmtDb(leq);
  $('stat-max').textContent = fmtDb(stats.max);

  if (!$('big').hidden) {
    const ref = noiseReference(v);
    $('big-level').textContent = text;
    $('big-dot').style.background = info.color;
    $('big-status').textContent = info.label;
    $('big-ref').textContent = `${ref.icon} ${ref.name}`;
    $('big-min').textContent = fmtDb(stats.min);
    $('big-avg').textContent = fmtDb(leq);
    $('big-max').textContent = fmtDb(stats.max);
  }
}

// Процентилите изискват сортиране, затова ги смятаме веднъж на 2 секунди
setInterval(() => {
  const sorted = [...stats.samples].sort((a, b) => a - b);
  $('stat-l10').textContent = fmtDb(percentile(sorted, 0.9));
  $('stat-l50').textContent = fmtDb(percentile(sorted, 0.5));
  $('stat-l90').textContent = fmtDb(percentile(sorted, 0.1));
}, 2000);

setInterval(() => {
  $('session-time').textContent = fmtDuration((Date.now() - stats.start) / 1000);
  $('dose-elapsed').textContent = fmtDuration(dose.elapsed);
}, 1000);

// ---------- доза ----------

const DOSE_TABLE_LEVELS = [80, 85, 88, 90, 91, 94, 95, 97, 100, 103, 105, 110, 115];
let doseRow = null;

(function buildDoseTable() {
  const tbody = $('dose-table');
  for (const L of DOSE_TABLE_LEVELS) {
    const tr = document.createElement('tr');
    tr.dataset.level = L;
    tr.className = 'border-b border-line last:border-0';
    const cells = [`${L} dB`, noiseReference(L).name,
      fmtLongDuration(allowedSeconds(L, DOSE_STANDARDS.niosh)), fmtLongDuration(allowedSeconds(L, DOSE_STANDARDS.osha))];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.className = 'px-4 py-2' + (i === 1 ? ' text-ink2' : '');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
})();

function updateDose(las) {
  for (const [key, std] of Object.entries(DOSE_STANDARDS)) {
    const root = document.querySelector(`[data-std="${key}"]`);
    const f = (name) => root.querySelector(`[data-f="${name}"]`);
    const d = dose[key];
    f('dose').textContent = fmtPct(d);
    f('bar').style.width = `${Math.min(100, d)}%`;
    f('bar').style.background = doseColor(d);
    f('twa').textContent = d > 0 ? `${fmtDb(twaFromDose(d, std))} dB` : '--';
    f('proj').textContent = dose.elapsed > 10 ? `${((d * WORK_DAY) / dose.elapsed).toFixed(0)}%` : '--';
  }

  const std = DOSE_STANDARDS.niosh;
  const el = $('safe-time');
  if (dose.niosh >= 100) {
    el.textContent = '⚠ Дневната доза по NIOSH е надвишена – ползвай защита за слуха или намали шума.';
    el.className = 'mt-6 rounded-xl bg-crit/15 px-4 py-3 text-red-200 ring-1 ring-crit/40';
  } else if (las < std.threshold) {
    el.textContent = `✓ При ${las.toFixed(0)} dB(A) няма ограничение във времето – под ${std.threshold} dB не се брои.`;
    el.className = 'mt-6 rounded-xl bg-panel px-4 py-3 ring-1 ring-line';
  } else {
    const remaining = (1 - dose.niosh / 100) * allowedSeconds(las, std);
    el.textContent = `При ${las.toFixed(0)} dB(A) остават около ${fmtLongDuration(remaining)}, докато стигнеш дневния лимит по NIOSH.`;
    el.className = 'mt-6 rounded-xl bg-warn/10 px-4 py-3 text-amber-100 ring-1 ring-warn/40';
  }

  // Отбелязваме реда от таблицата, най-близък отдолу до текущото ниво
  const row = [...DOSE_TABLE_LEVELS].reverse().find((L) => las >= L);
  if (doseRow?.dataset.level !== String(row)) {
    if (doseRow) { doseRow.style.background = ''; doseRow.style.boxShadow = ''; }
    doseRow = row === undefined ? null : $('dose-table').querySelector(`[data-level="${row}"]`);
    if (doseRow) { doseRow.style.background = '#1e2d39'; doseRow.style.boxShadow = 'inset 3px 0 0 #3987e5'; }
  }
}

// ---------- нулиране ----------

function resetStats() {
  Object.assign(stats, { min: Infinity, max: -Infinity, energy: 0, n: 0, start: Date.now(), samples: [], frame: 0 });
  for (const id of ['stat-min', 'stat-avg', 'stat-max', 'stat-l10', 'stat-l50', 'stat-l90']) $(id).textContent = '--';
  $('session-time').textContent = '00:00';
  dirty = true;
}

function resetSession() {
  resetStats();
  Object.assign(dose, { niosh: 0, osha: 0, elapsed: 0, lastT: null });
  history.length = 0;
  resetAnalysis();
}

// ---------- цял екран ----------

function openBig() {
  $('big').hidden = false;
  $('big').requestFullscreen?.().catch(() => {});
  if (latest) updateMeterReadout(latest);
}
function closeBig() {
  $('big').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) closeBig(); });

// ---------- снимка (PNG) ----------

function snapshot() {
  if (!latest) { showError('Още няма измерване'); return; }
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const v = currentLevel(latest);
  const ref = noiseReference(v);
  const info = levelInfo(v);
  const font = (size, weight = 400) => `${weight} ${size}px Onest, ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
  const leq = sessionLeq();

  ctx.fillStyle = '#101a22'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = info.color; ctx.fillRect(0, 0, W, 8);

  ctx.textBaseline = 'top';
  ctx.fillStyle = '#a7b6c2'; ctx.font = font(28, 600);
  ctx.fillText('Шумомер', 60, 50);
  ctx.textAlign = 'right'; ctx.font = font(24);
  ctx.fillText(new Date().toLocaleString('bg-BG'), W - 60, 54);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ecf1f4'; ctx.font = font(210, 600);
  const num = v.toFixed(1);
  ctx.fillText(num, 52, 320);
  const numW = ctx.measureText(num).width;
  ctx.fillStyle = '#a7b6c2'; ctx.font = font(46);
  ctx.fillText(unitName(), 76 + numW, 320);
  ctx.fillStyle = '#7a8d9b'; ctx.font = font(26, 500);
  ctx.fillText(metricName(), 76 + numW, 254);

  ctx.fillStyle = info.color;
  ctx.beginPath(); ctx.arc(72, 378, 10, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ecf1f4'; ctx.font = font(32, 500);
  ctx.fillText(info.label, 96, 390);
  ctx.fillStyle = '#a7b6c2'; ctx.font = font(36);
  ctx.fillText(`${ref.icon}  ${ref.name}`, 60, 450);

  const cells = [['Мин', stats.min], ['Средно', leq], ['Макс', stats.max], ['Пик', latest.peak_db]];
  cells.forEach(([label, val], i) => {
    const x = 60 + i * 270;
    ctx.fillStyle = '#7a8d9b'; ctx.font = font(24); ctx.fillText(label, x, 520);
    ctx.fillStyle = '#ecf1f4'; ctx.font = font(42, 600); ctx.fillText(fmtDb(val), x, 570);
  });

  // Графика на последната минута вдясно горе
  if (history.length > 1) {
    const bx = 760, by = 120, bw = 380, bh = 220;
    const { lo, hi } = levelRange(history.map((p) => p.v));
    const t0 = history[0].t, t1 = history[history.length - 1].t;
    ctx.fillStyle = '#17232d'; ctx.fillRect(bx, by, bw, bh);
    const pts = history.map((p) => [bx + bw * ((p.t - t0) / Math.max(1, t1 - t0)), by + bh * (1 - (p.v - lo) / (hi - lo))]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = '#7a8d9b'; ctx.font = font(20); ctx.textAlign = 'right';
    ctx.fillText('последната минута', bx + bw, by + bh + 30);
  }

  c.toBlob((blob) => {
    const a = document.createElement('a');
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = `noise-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// ---------- рисуване ----------

function meterFrame(visible) {
  // Стрелката се движи плавно към новата стойност (без анимация при „намалено движение“)
  const diff = gaugeTarget - gaugeValue;
  const moving = Math.abs(diff) > 0.05;
  if (moving) gaugeValue = reducedMotion ? gaugeTarget : gaugeValue + diff * 0.25;
  if (!visible) return;
  if (dirty || moving) drawGauge();
  if (dirty) drawHistory();
}
