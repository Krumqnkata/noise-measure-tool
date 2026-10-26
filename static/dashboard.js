// „Записи“ → „Табло“: карта ден × час, прогноза, източници по час и сравнение на два записа

const SERIES_B = '#eb6834';   // втората серия при сравнение (категориален слот 2)
let dashDays = store.get('dashDays', 30);
let dash = null;
let cmp = { a: null, b: null };

let heatCv = null, forecastCv = null, cmpCv = null;
heatCv = setupCanvas($('dash-heat'), () => drawHeatmap());
forecastCv = setupCanvas($('dash-forecast'), () => drawForecast());
cmpCv = setupCanvas($('cmp-chart'), () => drawCompare());

function showRecordsView(view) {
  $('records-dashboard').hidden = view !== 'dashboard';
  $('records-list-view').hidden = view === 'dashboard';
  $('seg-records-view').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === view));
  if (view === 'dashboard') loadDashboard();
}
$('seg-records-view').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.value;
  if (v) location.hash = v === 'dashboard' ? '#records/dashboard' : '#records';
});

function renderDaysSeg() {
  $('seg-dash-days').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.value) === dashDays));
}
$('seg-dash-days').addEventListener('click', (e) => {
  const v = Number(e.target.closest('button')?.dataset.value);
  if (v) { dashDays = v; store.set('dashDays', v); renderDaysSeg(); loadDashboard(); }
});

async function loadDashboard() {
  renderDaysSeg();
  try {
    if (!sessions.length) await loadList();   // за сравнението трябва списъкът със записи
    dash = await api(`/api/dashboard?days=${dashDays}`);
  } catch (e) {
    showError(e.message);
    return;
  }
  $('dash-summary').textContent = t('Данни от {n} дни с записи за последните {days} дни.', { n: dash.days_covered, days: dash.days });
  // Височината на картата следва броя дни (по 18 px на ред)
  $('dash-heat').style.height = `${Math.max(60, dash.dates.length * 18) + 26}px`;
  renderSourcesByHour();
  drawHeatmap();
  drawForecast();
  fillCompareSelects();
}

// ---------- карта ден × час ----------

let heatRange = { lo: 30, hi: 80 };

attachTooltip(heatCv, (x, y) => {
  if (!dash || !heatCv.box) return null;
  const { L, T, pw } = heatCv.box;
  const hour = Math.floor(((x - L) / pw) * 24);
  const row = Math.floor((y - T) / 18);
  const date = dash.dates[dash.dates.length - 1 - row];
  const cell = dash.heatmap.find((c) => c.date === date && c.hour === hour);
  if (!cell) return null;
  return {
    x: L + (pw / 24) * (hour + 0.5),
    title: `${new Date(`${date}T00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })}, ${hour}:00`,
    rows: [{ value: `${cell.laeq.toFixed(1)} dB`, label: t('LAeq за {m} мин', { m: cell.minutes }) }],
  };
}, () => drawHeatmap());

function drawHeatmap() {
  const cv = heatCv;
  if (!cv) return;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  if (!w || !dash) return;
  const box = { L: 64, T: 4, pw: w - 72, ph: h - 26 };
  cv.box = box;
  const levels = dash.heatmap.map((c) => c.laeq);
  heatRange = levels.length ? { lo: Math.floor(Math.min(...levels) / 5) * 5, hi: Math.ceil(Math.max(...levels) / 5) * 5 } : { lo: 30, hi: 80 };
  if (heatRange.hi - heatRange.lo < 10) heatRange.hi = heatRange.lo + 10;
  // Последователна скала в един цвят: по-плътно = по-шумно (работи и в двете теми)
  const shade = (v) => Math.min(1, Math.max(0.08, (v - heatRange.lo) / (heatRange.hi - heatRange.lo)));
  const cellW = box.pw / 24;
  const dates = [...dash.dates].reverse();
  ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'; ctx.fillStyle = COLORS.axis;
  dates.forEach((d, row) => {
    ctx.fillText(new Date(`${d}T00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }), box.L - 8, box.T + row * 18 + 9);
  });
  const byKey = new Map(dash.heatmap.map((c) => [`${c.date} ${c.hour}`, c]));
  dates.forEach((d, row) => {
    for (let hour = 0; hour < 24; hour++) {
      const cell = byKey.get(`${d} ${hour}`);
      const x0 = box.L + hour * cellW + 1, y0 = box.T + row * 18 + 1;
      ctx.fillStyle = cell ? COLORS.accent.replace('/ 1)', `/ ${shade(cell.laeq)})`) : COLORS.raised;
      ctx.beginPath(); ctx.roundRect(x0, y0, cellW - 2, 16, 3); ctx.fill();
    }
  });
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = COLORS.axis;
  for (let hour = 0; hour < 24; hour += 3) ctx.fillText(`${hour}:00`, box.L + cellW * (hour + 0.5), h - 16);
  if (!dates.length) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t('Още няма записи в този период.'), box.L + box.pw / 2, box.T + 30);
  }

  $('dash-lo').textContent = `${heatRange.lo} dB`;
  $('dash-hi').textContent = `${heatRange.hi} dB`;
  $('dash-legend').style.background = `linear-gradient(to right, ${COLORS.accent.replace('/ 1)', '/ 0.08)')}, ${COLORS.accent})`;
}

// ---------- прогноза ----------

attachTooltip(forecastCv, (x) => {
  const f = dash?.forecast;
  if (!f?.length || !forecastCv.box) return null;
  const { L, pw } = forecastCv.box;
  const i = Math.max(0, Math.min(f.length - 1, Math.round(((x - L) / pw) * (f.length - 1))));
  if (f[i].median === null) return null;
  return {
    x: forecastCv.x(i),
    title: new Date(f[i].t * 1000).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
    rows: [
      { value: `${f[i].median.toFixed(1)} dB`, label: t('типично'), color: COLORS.accent },
      { value: `${f[i].p10.toFixed(0)}–${f[i].p90.toFixed(0)} dB`, label: t('обхват 10–90%') },
    ],
    points: [{ y: forecastCv.y(f[i].median), color: COLORS.accent }],
  };
}, () => drawForecast());

function drawForecast() {
  const cv = forecastCv;
  if (!cv) return;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  const f = dash?.forecast || [];
  const known = f.filter((p) => p.median !== null);
  const note = $('dash-forecast-note');
  note.hidden = f.length > 0 || !dash;
  if (dash && !f.length) {
    note.textContent = t('Прогнозата се появява след поне 7 дни със записи (сега: {n}). Записите по график са най-лесният начин.', { n: dash.days_covered });
  }
  if (!w || !known.length) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 28 };
  const { lo, hi } = levelRange([...known.map((p) => p.p10), ...known.map((p) => p.p90)]);
  const y = drawLevelGrid(ctx, box, lo, hi);
  const x = (i) => box.L + box.pw * (i / Math.max(1, f.length - 1));
  Object.assign(cv, { box, x, y });

  // Непрекъснатите участъци с данни – часовете без данни остават празни
  const runs = [];
  f.forEach((p, i) => {
    if (p.median === null) return;
    if (runs.length && runs[runs.length - 1].at(-1) === i - 1) runs[runs.length - 1].push(i);
    else runs.push([i]);
  });
  for (const run of runs) {
    // Обхватът 10–90% като лека площ, медианата – линия (единична точка – като точка)
    ctx.beginPath();
    run.forEach((i, k) => (k ? ctx.lineTo(x(i), y(f[i].p90)) : ctx.moveTo(x(i), y(f[i].p90))));
    [...run].reverse().forEach((i) => ctx.lineTo(x(i), y(f[i].p10)));
    ctx.closePath();
    ctx.fillStyle = COLORS.accentWash; ctx.fill();
    if (run.length > 1) drawSeries(ctx, run.map((i) => [x(i), y(f[i].median)]), COLORS.accent);
    else {
      ctx.beginPath(); ctx.arc(x(run[0]), y(f[run[0]].median), 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.accent; ctx.fill();
    }
  }
  ctx.fillStyle = COLORS.axis; ctx.textBaseline = 'top';
  f.forEach((p, i) => {
    if (i % 4 !== 0) return;
    ctx.textAlign = i === 0 ? 'left' : 'center';
    ctx.fillText(new Date(p.t * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }), x(i), h - 16);
  });
  cv.tip.refresh();
  drawCrosshair(cv);
}

// ---------- източници по час ----------

function renderSourcesByHour() {
  const box = $('dash-sources');
  box.replaceChildren();
  const byHour = new Map((dash?.sources_by_hour || []).map((s) => [s.hour, s]));
  if (!byHour.size) {
    const p = document.createElement('p');
    p.className = 'col-span-full text-sm text-ink3';
    p.textContent = t('Няма разпознати източници в този период.');
    box.appendChild(p);
    return;
  }
  for (let hour = 0; hour < 24; hour++) {
    const s = byHour.get(hour);
    const cell = document.createElement('div');
    cell.className = 'rounded-lg bg-raised px-1 py-1.5 text-center';
    cell.innerHTML = '<div class="text-xs text-ink3"></div><div class="text-lg leading-tight" aria-hidden="true"></div>';
    cell.children[0].textContent = `${hour}:00`;
    cell.children[1].textContent = s ? soundCategory(s.category).icon : '·';
    cell.title = s ? `${t(soundCategory(s.category).name)} – ${Math.round(s.share * 100)}%` : t('няма данни');
    box.appendChild(cell);
  }
}

// ---------- сравнение на два записа ----------

function fillCompareSelects() {
  for (const [id, key, fallback] of [['cmp-a', 'a', 1], ['cmp-b', 'b', 0]]) {
    const sel = $(id);
    sel.replaceChildren(...sessions.map((s) => new Option(`${s.name} – ${fmtDateTime(s.started_at)}`, s.id)));
    if (!cmp[key] && sessions[fallback]) cmp[key] = sessions[fallback].id;
    if (cmp[key]) sel.value = cmp[key];
  }
  loadCompare();
}
$('cmp-a').addEventListener('change', (e) => { cmp.a = Number(e.target.value); loadCompare(); });
$('cmp-b').addEventListener('change', (e) => { cmp.b = Number(e.target.value); loadCompare(); });

let cmpReports = [null, null];

async function loadCompare() {
  if (!cmp.a || !cmp.b) { cmpReports = [null, null]; renderCompareTable(); drawCompare(); return; }
  try {
    cmpReports = await Promise.all([api(`/api/sessions/${cmp.a}`), api(`/api/sessions/${cmp.b}`)]);
  } catch (e) {
    showError(e.message);
    return;
  }
  renderCompareTable();
  drawCompare();
}

function renderCompareTable() {
  const tbody = $('cmp-table');
  tbody.replaceChildren();
  const [a, b] = cmpReports;
  if (!a?.summary || !b?.summary) return;
  const rows = [
    ['LAeq', 'laeq'], ['LAFmax', 'lafmax'], ['L10', 'l10'], ['L50', 'l50'], ['L90', 'l90'], ['LCpeak', 'lcpeak'],
  ];
  for (const [label, key] of rows) {
    const va = a.summary[key], vb = b.summary[key];
    const diff = Number.isFinite(va) && Number.isFinite(vb) ? vb - va : NaN;
    const tr = document.createElement('tr');
    for (const text of [label, fmtDb(va), fmtDb(vb), Number.isFinite(diff) ? `${diff > 0 ? '+' : ''}${diff.toFixed(1)} dB` : '--']) {
      const td = document.createElement('td');
      td.className = 'py-1.5 pr-4';
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  const tr = document.createElement('tr');
  for (const text of [t('Продължителност'), fmtDuration(a.duration), fmtDuration(b.duration), '']) {
    const td = document.createElement('td');
    td.className = 'py-1.5 pr-4';
    td.textContent = text;
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
}

attachTooltip(cmpCv, (x) => {
  const [a, b] = cmpReports;
  if (!a?.series || !b?.series || !cmpCv.box) return null;
  const minute = cmpCv.tx(x);
  const at = (r) => {
    const t0 = r.session.started_at;
    let best = 0;
    r.series.t.forEach((tt, i) => { if (Math.abs((tt - t0) / 60 - minute) < Math.abs((r.series.t[best] - t0) / 60 - minute)) best = i; });
    return r.series.laeq[best];
  };
  return {
    x, title: t('{m} мин от началото', { m: minute.toFixed(1) }),
    rows: [{ value: `${fmtDb(at(a))} dB`, label: 'A', color: COLORS.accent }, { value: `${fmtDb(at(b))} dB`, label: 'B', color: SERIES_B }],
  };
}, () => drawCompare());

function drawCompare() {
  const cv = cmpCv;
  if (!cv) return;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  const [a, b] = cmpReports;
  if (!w || !a?.series || !b?.series) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 28 };
  const minutes = (r) => r.series.t.map((tt) => (tt - r.session.started_at) / 60);
  const ma = minutes(a), mb = minutes(b);
  const maxM = Math.max(1, ma[ma.length - 1], mb[mb.length - 1]);
  const { lo, hi } = levelRange([...a.series.laeq, ...b.series.laeq]);
  const y = drawLevelGrid(ctx, box, lo, hi);
  const x = (m) => box.L + box.pw * (m / maxM);
  Object.assign(cv, { box, x, y, tx: (px) => ((px - box.L) / box.pw) * maxM });
  ctx.fillStyle = COLORS.axis; ctx.textBaseline = 'top';
  for (let i = 0; i <= 4; i++) {
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(t('{m} мин', { m: Math.round((maxM * i) / 4) }), x((maxM * i) / 4), h - 16);
  }
  drawSeries(ctx, a.series.laeq.map((v, i) => [x(ma[i]), y(v)]), COLORS.accent);
  drawSeries(ctx, b.series.laeq.map((v, i) => [x(mb[i]), y(v)]), SERIES_B);
  cv.tip.refresh();
  drawCrosshair(cv);
}

function redrawDashboard() {
  drawHeatmap();
  drawForecast();
  drawCompare();
}
