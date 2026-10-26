// Раздел „Помещение“: време на реверберация RT60 (ISO 3382-2, импулсен източник)

// Ориентировъчни стойности на RT60 за различни помещения, s
const ROOM_TARGETS = [
  { name: 'Звукозапис, домашно студио', range: [0.2, 0.4] },
  { name: 'Спалня', range: [0.3, 0.5] },
  { name: 'Хол, класна стая', range: [0.4, 0.6] },
  { name: 'Офис', range: [0.5, 0.8] },
  { name: 'Ресторант', range: [0.8, 1.2] },
  { name: 'Концертна зала', range: [1.6, 2.2] },
];

let rtResult = null;
let rtBand = 1000;
// setupCanvas вика прерисуването веднага, затова променливата трябва да съществува преди това
let rtCv = null;
rtCv = setupCanvas($('rt-chart'), () => drawRt());

const fmtSec = (s) => (s === null || s === undefined ? '--' : `${s.toFixed(2)} s`);

function renderRtTargets() {
  const ul = $('rt-targets');
  ul.replaceChildren();
  const rt = rtResult?.rt60;
  for (const target of ROOM_TARGETS) {
    const [lo, hi] = target.range;
    const inside = rt !== null && rt !== undefined && rt >= lo && rt <= hi;
    const li = document.createElement('li');
    li.className = 'flex justify-between gap-3 rounded-lg px-2 py-1' + (inside ? ' bg-raised font-medium' : ' text-ink2');
    li.innerHTML = '<span></span><span class="tabular-nums"></span>';
    li.children[0].textContent = (inside ? '✓ ' : '') + t(target.name);
    li.children[1].textContent = `${lo}–${hi} s`;
    ul.appendChild(li);
  }
}

function renderRt() {
  renderRtTargets();
  if (!rtResult) return;
  const rt = rtResult.rt60;
  $('rt-value').textContent = rt === null ? '--' : rt.toFixed(2);
  const matches = ROOM_TARGETS.filter((x) => rt !== null && rt >= x.range[0] && rt <= x.range[1]).map((x) => t(x.name));
  $('rt-verdict').textContent = rt === null
    ? t('Плясъкът беше твърде слаб спрямо шума в стаята. Опитай по-силно или в по-тиха обстановка.')
    : matches.length
      ? t('Подходящо за: {list}.', { list: matches.join(', ') })
      : rt < 0.2 ? t('Много „сухо“ – като на открито или в силно заглушена стая.') : t('Много „ехтящо“ – помагат килими, завеси, мека мебел, панели.');

  $('rt-details').hidden = false;
  const seg = $('seg-rt-band');
  seg.replaceChildren(...rtResult.bands.map((b) => {
    const button = document.createElement('button');
    button.dataset.value = b.band;
    button.textContent = fmtHz(b.band);
    button.setAttribute('aria-pressed', b.band === rtBand);
    return button;
  }));
  const tbody = $('rt-table');
  tbody.replaceChildren();
  for (const b of rtResult.bands) {
    const tr = document.createElement('tr');
    for (const text of [`${fmtHz(b.band)} Hz`, fmtSec(b.t20), fmtSec(b.t30), `${b.range_db} dB`]) {
      const td = document.createElement('td');
      td.className = 'py-1.5 pr-4';
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  drawRt();
}

$('seg-rt-band').addEventListener('click', (e) => {
  const v = Number(e.target.closest('button')?.dataset.value);
  if (v) { rtBand = v; renderRt(); }
});

attachTooltip(rtCv, (x) => {
  const curve = rtResult?.bands.find((b) => b.band === rtBand)?.curve;
  if (!curve?.length || !rtCv.box) return null;
  const tt = rtCv.tx(x);
  let best = curve[0];
  for (const p of curve) if (Math.abs(p[0] - tt) < Math.abs(best[0] - tt)) best = p;
  return {
    x: rtCv.x(best[0]),
    title: `${best[0].toFixed(2)} s`,
    rows: [{ value: `${best[1].toFixed(1)} dB`, label: `${fmtHz(rtBand)} Hz`, color: COLORS.accent }],
    points: [{ y: rtCv.y(best[1]), color: COLORS.accent }],
  };
}, () => drawRt());

function drawRt() {
  const cv = rtCv;
  if (!cv) return;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  const curve = rtResult?.bands.find((b) => b.band === rtBand)?.curve;
  if (!w || !curve?.length) return;
  const box = { L: 40, T: 8, pw: w - 48, ph: h - 30 };
  const tMax = Math.max(0.5, curve[curve.length - 1][0]);
  const lo = -60;
  const x = (tt) => box.L + box.pw * (tt / tMax);
  const y = (v) => box.T + box.ph * (Math.max(v, lo) / lo);
  Object.assign(cv, { box, x, y, tx: (px) => ((px - box.L) / box.pw) * tMax });

  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = 0; v >= lo; v -= 10) {
    const yy = Math.round(y(v)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(box.L, yy); ctx.lineTo(box.L + box.pw, yy); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(v, box.L - 8, yy);
  }
  // Границите на оценката (−5, −25, −35 dB) – прекъснати, защото са прагове
  ctx.setLineDash([3, 4]);
  for (const v of [-5, -25, -35]) {
    ctx.strokeStyle = COLORS.tick;
    ctx.beginPath(); ctx.moveTo(box.L, y(v)); ctx.lineTo(box.L + box.pw, y(v)); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = COLORS.axis;
  const step = tMax > 2 ? 0.5 : tMax > 1 ? 0.25 : 0.1;
  for (let tt = 0; tt <= tMax + 1e-9; tt += step) ctx.fillText(`${tt.toFixed(step < 0.25 ? 1 : 2)} s`, x(tt), h - 16);

  drawSeries(ctx, curve.map(([tt, v]) => [x(tt), y(v)]), COLORS.accent);
  cv.tip.refresh();
  drawCrosshair(cv);
}

$('rt-start').addEventListener('click', async () => {
  const button = $('rt-start');
  button.disabled = true;
  $('rt-status').textContent = demoMode ? t('Демо: симулирам плясък…') : t('Пляскай сега – чакам до 15 s…');
  $('rt-status').classList.add('animate-pulse');
  try {
    rtResult = await api('/api/room/rt60', {});
    $('rt-status').textContent = t('Готово.');
    renderRt();
  } catch (e) {
    $('rt-status').textContent = e.message;
  } finally {
    button.disabled = false;
    $('rt-status').classList.remove('animate-pulse');
  }
});

renderRtTargets();
