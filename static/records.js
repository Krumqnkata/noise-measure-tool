// Раздел „Записи“: старт/стоп на запис, списък и отчет за избран запис.
// Адресът е #records за списъка и #records/<id> за отчета.

let sessions = [];
let currentSession = null;
let report = null;
let reportCharts = null;

function onRecordingStatus(rec) {
  recording = rec;
  $('rec-idle').hidden = !!rec;
  $('rec-active').hidden = !rec;
  $('side-rec').hidden = !rec;
  if (rec) $('rec-label').textContent = rec.name;
  updateRecordingTime();
}

function updateRecordingTime() {
  if (!recording) return;
  const t = fmtDuration(Date.now() / 1000 - recording.started_at);
  $('rec-time').textContent = t;
  $('side-rec-time').textContent = t;
}
setInterval(updateRecordingTime, 1000);

$('rec-start').addEventListener('click', () => action(async () => {
  const res = await api('/api/recording/start', { name: $('rec-name').value });
  $('rec-name').value = '';
  loadList();
  return res;
}));
$('rec-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('rec-start').click(); });
$('rec-stop').addEventListener('click', async () => {
  const id = recording?.id;
  await action(() => api('/api/recording/stop', {}));
  if (id) location.hash = `#records/${id}`;   // веднага показваме отчета
  loadList();
});

// ---------- списък ----------

async function loadList() {
  try {
    ({ sessions } = await api('/api/sessions'));
  } catch (e) {
    showError(e.message);
    return;
  }
  const list = $('list');
  list.innerHTML = '';
  if (!sessions.length) {
    list.innerHTML = '<p class="text-sm text-ink3">Още няма записи. Въведи име горе и натисни „Започни запис“.</p>';
  }
  for (const s of sessions) {
    const a = document.createElement('a');
    a.href = `#records/${s.id}`;
    a.className = 'block rounded-xl px-3 py-2.5 transition-colors ' +
      (s.id === currentSession ? 'bg-raised ring-1 ring-accent/60' : 'hover:bg-panel');
    a.innerHTML = `
      <div class="flex items-baseline justify-between gap-2">
        <span class="truncate font-medium"></span>
        <span class="shrink-0 font-semibold"></span>
      </div>
      <div class="mt-0.5 flex items-center justify-between gap-2 text-xs text-ink3">
        <span></span><span class="tabular-nums"></span>
      </div>`;
    const [name, leq] = a.children[0].children;
    const [date, dur] = a.children[1].children;
    name.textContent = s.name;
    leq.textContent = s.laeq === null ? '--' : `${s.laeq.toFixed(1)} dB`;
    date.textContent = fmtDateTime(s.started_at);
    dur.textContent = s.active ? `записва, ${fmtDuration(s.duration)}` : fmtDuration(s.duration);
    if (s.active) dur.classList.add('text-red-300');
    list.appendChild(a);
  }
}

// ---------- отчет ----------

async function openSession(id) {
  currentSession = id;
  if (!id) {
    report = null;
    reportCharts = null;
    $('report').innerHTML = '<div class="rounded-2xl border border-dashed border-line p-10 text-center text-ink3">Избери запис от списъка, за да видиш отчета.</div>';
    loadList();
    return;
  }
  try {
    report = await api(`/api/sessions/${id}`);
  } catch (e) {
    showError(e.message);
    location.hash = '#records';
    return;
  }
  renderReport();
  loadList();
}

function tile(label, value, hint) {
  const d = document.createElement('div');
  d.className = 'bg-panel px-4 py-3';
  d.innerHTML = '<dt class="text-sm text-ink3"></dt><dd class="text-2xl font-semibold"></dd>';
  d.children[0].textContent = label;
  d.children[0].title = hint || '';
  d.children[1].textContent = fmtDb(value);
  return d;
}

function metaItem(label, value) {
  const d = document.createElement('div');
  d.innerHTML = '<dt class="inline text-ink3"></dt> <dd class="inline text-ink2"></dd>';
  d.children[0].textContent = label;
  d.children[1].textContent = value;
  return d;
}

function renderReport() {
  const { session, summary } = report;
  const root = $('report-template').content.cloneNode(true);
  const f = (name) => root.querySelector(`[data-f="${name}"]`);
  const a = (name) => root.querySelector(`[data-a="${name}"]`);

  f('name').textContent = session.name;
  f('meta').append(
    metaItem('Начало', fmtDateTime(session.started_at)),
    metaItem('Продължителност', report.active ? `${fmtDuration(report.duration)}, записва се` : fmtDuration(report.duration)),
    metaItem('Офсет', `${session.calibration_offset} dB`),
  );
  if (session.device) f('meta').append(metaItem('Микрофон', session.device));
  if (session.note) {
    f('note').textContent = session.note;
    f('note').hidden = false;
  }

  a('csv').href = `/api/sessions/${session.id}/csv`;
  a('print').addEventListener('click', () => window.print());
  a('rename').addEventListener('click', renameSession);
  a('note').addEventListener('click', editNote);
  a('delete').addEventListener('click', deleteSession);
  if (report.active) a('delete').hidden = true;

  if (!summary) {
    f('empty').hidden = false;
    f('body').hidden = true;
  } else {
    const ref = noiseReference(summary.laeq);
    f('ref-icon').textContent = ref.icon;
    f('ref-name').textContent = `${ref.name}, около ${ref.db} dB`;
    f('loudest').textContent = `Най-шумно в ${fmtTime(summary.loudest_at)}: ${fmtDb(summary.lafmax)} dB`;

    f('tiles').append(
      tile('LAeq', summary.laeq, 'Средно A-претеглено ниво за целия запис'),
      tile('LAFmax', summary.lafmax),
      tile('LAFmin', summary.lafmin),
      tile('LCeq', summary.lceq),
      tile('LZpeak', summary.lzpeak, 'Най-високият моментен пик, без претегляне'),
      tile('L10', summary.l10, 'Надвишено 10% от времето – шумните моменти'),
      tile('L50', summary.l50, 'Медиана'),
      tile('L90', summary.l90, 'Надвишено 90% от времето – фонът'),
      tile('LZeq', summary.lzeq),
    );
    // Десетата плочка пази решетката пълна на широк екран
    const filler = document.createElement('div');
    filler.className = 'hidden bg-panel md:block';
    f('tiles').appendChild(filler);

    const diff = summary.lceq - summary.laeq;
    f('lowfreq').textContent = `LCeq − LAeq = ${diff.toFixed(1)} dB. ` + (diff > 15
      ? 'Голямата разлика показва много нискочестотен шум – бучене, вентилация, бас.'
      : 'Няма изразен нискочестотен шум.');
    f('lowfreq').className = 'text-sm ' + (diff > 15 ? 'text-amber-200' : 'text-ink3');

    const total = summary.seconds;
    for (const row of report.above) {
      const pct = total ? (100 * row.seconds) / total : 0;
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="mb-1.5 flex justify-between gap-2"><span></span><span class="tabular-nums text-ink2"></span></div>
        <div class="h-2 overflow-hidden rounded-full bg-raised"><div class="h-full rounded-full"></div></div>`;
      const spans = el.querySelectorAll('span');
      spans[0].textContent = `Над ${row.threshold} dB`;
      spans[1].textContent = `${fmtDuration(row.seconds)} (${pct.toFixed(1)}%)`;
      const bar = el.querySelector('.h-full');
      bar.style.width = `${pct}%`;
      bar.style.background = levelColor(row.threshold + 0.1);
      f('above').appendChild(el);
    }

    for (const [key, std] of Object.entries(DOSE_STANDARDS)) {
      const d = report.dose[key];
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="text-sm text-ink2"></div>
        <div class="mt-1 text-3xl font-semibold"></div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-raised"><div class="h-full rounded-full"></div></div>
        <div class="mt-2 text-sm text-ink3"></div>`;
      el.children[0].textContent = `${std.label}: ${std.criterion} dB за 8 ч, през ${std.exchange} dB`;
      el.children[1].textContent = fmtPct(d.dose);
      const bar = el.children[2].firstElementChild;
      bar.style.width = `${Math.min(100, d.dose)}%`;
      bar.style.background = doseColor(d.dose);
      el.children[3].textContent = `TWA ${d.twa === null ? '--' : `${fmtDb(d.twa)} dB`}, прогноза за 8 ч ${d.projected.toFixed(0)}%`;
      f('dose').appendChild(el);
    }
  }

  const tbody = f('events');
  if (!report.events.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-2 text-ink3">Няма събития в този запис.</td></tr>';
  }
  for (const e of [...report.events].reverse()) {
    const tr = document.createElement('tr');
    const dur = e.ended_at ? fmtDuration(e.ended_at - e.started_at) : 'продължава';
    for (const text of [fmtDateTime(e.started_at), dur, `${e.threshold} dB`, `${fmtDb(e.max_level)} dB`]) {
      const td = document.createElement('td');
      td.className = 'py-2 pr-4';
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  $('report').innerHTML = '';
  $('report').appendChild(root);

  if (summary) {
    const draw = () => { if (reportCharts) { drawTimeline(); drawHistogram(); } };
    reportCharts = {
      timeline: setupCanvas($('report').querySelector('[data-f="timeline"]'), draw),
      histogram: setupCanvas($('report').querySelector('[data-f="histogram"]'), draw),
    };
    attachTooltip(reportCharts.timeline, pickTimeline, draw);
    attachTooltip(reportCharts.histogram, pickHistogram, draw);
    draw();
  } else {
    reportCharts = null;
  }
}

function pickTimeline(x) {
  const cv = reportCharts.timeline;
  const { t } = report.series;
  const target = cv.t0 + ((x - cv.box.L) / cv.box.pw) * (cv.t1 - cv.t0);
  let i = 0;
  for (let k = 1; k < t.length; k++) if (Math.abs(t[k] - target) < Math.abs(t[i] - target)) i = k;
  return {
    x: cv.x(t[i]),
    title: fmtTime(t[i]),
    rows: [
      { value: `${fmtDb(report.series.laeq[i])} dB`, label: 'LAeq', color: COLORS.accent },
      { value: `${fmtDb(report.series.lafmax[i])} dB`, label: 'LAFmax', color: '#7a8d9b' },
    ],
    points: [{ y: cv.y(report.series.laeq[i]), color: COLORS.accent }, { y: cv.y(report.series.lafmax[i]), color: '#7a8d9b' }],
  };
}

function drawTimeline() {
  const cv = reportCharts.timeline;
  const { ctx, w, h } = cv;
  const { series, session, events } = report;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 30 };
  const t0 = session.started_at;
  const t1 = Math.max(session.ended_at || Date.now() / 1000, series.t[series.t.length - 1], t0 + 1);
  const x = (t) => box.L + box.pw * ((t - t0) / (t1 - t0));
  const { lo, hi } = levelRange([...series.laeq, ...series.lafmax]);

  ctx.fillStyle = 'rgba(208, 59, 59, 0.22)';
  for (const e of events) {
    const xa = x(e.started_at), xb = x(e.ended_at || t1);
    ctx.fillRect(xa, box.T, Math.max(2, xb - xa), box.ph);
  }
  const y = drawLevelGrid(ctx, box, lo, hi);
  Object.assign(cv, { box, x, y, t0, t1 });

  ctx.fillStyle = COLORS.axis; ctx.textBaseline = 'top';
  for (let i = 0; i <= 4; i++) {
    const t = t0 + ((t1 - t0) * i) / 4;
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(fmtTime(t), x(t), h - 16);
  }

  const pts = (values) => values.map((v, i) => [x(series.t[i]), y(v)]);
  ctx.globalAlpha = 0.6;
  drawSeries(ctx, pts(series.lafmax), '#7a8d9b');
  ctx.globalAlpha = 1;
  drawSeries(ctx, pts(series.laeq), COLORS.accent, COLORS.accentWash, box.T + box.ph);
  cv.tip.refresh();
  drawCrosshair(cv);
}

function pickHistogram(x) {
  const cv = reportCharts.histogram;
  const { edges, counts } = report.histogram;
  const slot = cv.box.pw / counts.length;
  const i = Math.floor((x - cv.box.L) / slot);
  if (i < 0 || i >= counts.length) return null;
  const total = counts.reduce((s, c) => s + c, 0) || 1;
  return {
    x: cv.box.L + slot * (i + 0.5),
    title: `${edges[i]}–${edges[i + 1]} dB`,
    rows: [{ value: `${((100 * counts[i]) / total).toFixed(1)}%`, label: fmtDuration(counts[i]) }],
    index: i,
  };
}

function drawHistogram() {
  const cv = reportCharts.histogram;
  const { ctx, w, h } = cv;
  const { edges, counts } = report.histogram;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 28 };
  cv.box = box;
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const pcts = counts.map((c) => (100 * c) / total);
  const top = Math.max(10, Math.ceil(Math.max(...pcts) / 10) * 10);
  const y = (p) => box.T + box.ph * (1 - p / top);

  ctx.font = FONT; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let p = 0; p <= top; p += top / 2) {
    const yy = Math.round(y(p)) + 0.5;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath(); ctx.moveTo(box.L, yy); ctx.lineTo(box.L + box.pw, yy); ctx.stroke();
    ctx.fillStyle = COLORS.axis; ctx.fillText(`${p}%`, box.L - 8, yy);
  }

  cv.tip.refresh();
  const n = counts.length;
  const slot = box.pw / n;
  const barW = Math.min(24, slot - 2);
  const labelEvery = Math.ceil(n / 7);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  pcts.forEach((p, i) => {
    const bx = box.L + slot * i + (slot - barW) / 2;
    const hgt = box.T + box.ph - y(p);
    if (hgt >= 1) {
      ctx.fillStyle = cv.hover?.index === i ? '#5d9df0' : COLORS.accent;
      ctx.beginPath(); ctx.roundRect(bx, y(p), barW, hgt, [Math.min(4, hgt), Math.min(4, hgt), 0, 0]); ctx.fill();
    }
    if (i % labelEvery === 0) { ctx.fillStyle = COLORS.axis; ctx.fillText(edges[i], box.L + slot * i, h - 14); }
  });
}

async function renameSession() {
  const name = prompt('Ново име на записа:', report.session.name);
  if (!name || !name.trim()) return;
  try {
    await api(`/api/sessions/${currentSession}`, { name: name.trim() }, 'PATCH');
    openSession(currentSession);
  } catch (e) {
    showError(e.message);
  }
}

async function editNote() {
  const note = prompt('Бележка към записа – място, източник на шума…', report.session.note || '');
  if (note === null) return;
  try {
    await api(`/api/sessions/${currentSession}`, { note }, 'PATCH');
    openSession(currentSession);
  } catch (e) {
    showError(e.message);
  }
}

async function deleteSession() {
  if (!confirm(`Да изтрия ли „${report.session.name}“? Това не може да се върне.`)) return;
  try {
    await api(`/api/sessions/${currentSession}`, undefined, 'DELETE');
    location.hash = '#records';
  } catch (e) {
    showError(e.message);
  }
}

function recordsOnShow(param) {
  openSession(param ? parseInt(param, 10) || null : null);
}

// Отвореният активен запис се опреснява на всеки 5 секунди
setInterval(() => {
  if (currentSectionId !== 'records' || document.hidden) return;
  if (report?.active) openSession(currentSession);
  else if (sessions.some((s) => s.active)) loadList();
}, 5000);
