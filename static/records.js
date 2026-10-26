// Раздел „Записи“: старт/стоп на запис, списък и отчет за избран запис.
// Адресът е #records за списъка и #records/<id> за отчета.

let sessions = [];
let currentSession = null;
let report = null;
let reportCharts = null;

const deviceLabel = (name) => (name === 'demo' || name === 'Демо сигнал' ? t('Демо сигнал') : name);

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
  const tt = fmtDuration(Date.now() / 1000 - recording.started_at);
  $('rec-time').textContent = tt;
  $('side-rec-time').textContent = tt;
}
setInterval(updateRecordingTime, 1000);

$('rec-start').addEventListener('click', () => action(async () => {
  const typed = $('rec-name').value.trim();
  const name = typed || t('Запис {date}', { date: new Date().toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) });
  const res = await api('/api/recording/start', { name });
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

// ---------- график ----------

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
let scheduleDays = new Set([0, 1, 2, 3, 4, 5, 6]);

function daysText(days) {
  if (days.length === 7) return t('всеки ден');
  if (days === '01234') return t('делнични дни');
  if (days === '56') return t('събота и неделя');
  return [...days].map((d) => t(DAY_NAMES[Number(d)])).join(', ');
}

function renderDayButtons() {
  $('sch-days').replaceChildren(...DAY_NAMES.map((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t(name);
    b.setAttribute('aria-pressed', scheduleDays.has(i));
    b.addEventListener('click', () => {
      if (scheduleDays.has(i)) scheduleDays.delete(i); else scheduleDays.add(i);
      renderDayButtons();
    });
    return b;
  }));
}

function renderSchedules(list) {
  const ul = $('sch-list');
  ul.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'py-2 text-sm text-ink3';
    li.textContent = t('Няма график.');
    ul.appendChild(li);
  }
  for (const s of list) {
    const li = document.createElement('li');
    li.className = 'flex flex-wrap items-center justify-between gap-3 py-2';
    li.innerHTML = `
      <label class="flex min-w-0 items-center gap-3"><input type="checkbox" class="h-4 w-4 accent-accent">
        <span class="min-w-0"><span class="block truncate font-medium"></span><span class="text-sm text-ink3"></span></span></label>
      <button class="btn px-2.5 py-1 text-crit-ink"></button>`;
    const [toggle] = li.getElementsByTagName('input');
    const spans = li.querySelectorAll('label > span > span');
    toggle.checked = !!s.enabled;
    spans[0].textContent = s.name;
    spans[1].textContent = `${s.start_time}–${s.end_time}, ${daysText(s.days)}`;
    toggle.addEventListener('change', () => saveSchedule({ ...s, enabled: toggle.checked }, s.id));
    const del = li.querySelector('button');
    del.textContent = t('Изтрий');
    del.addEventListener('click', async () => {
      if (!confirm(t('Да изтрия ли графика „{name}“?', { name: s.name }))) return;
      try { renderSchedules((await api(`/api/schedules/${s.id}`, undefined, 'DELETE')).schedules); } catch (e) { showError(e.message); }
    });
    ul.appendChild(li);
  }
}

async function loadSchedules() {
  try { renderSchedules((await api('/api/schedules')).schedules); } catch { /* не е критично */ }
}

async function saveSchedule(data, id) {
  const body = { name: data.name, days: data.days, start_time: data.start_time, end_time: data.end_time, enabled: !!data.enabled };
  try {
    const res = id ? await api(`/api/schedules/${id}`, body, 'PUT') : await api('/api/schedules', body);
    renderSchedules(res.schedules);
    showError('');
  } catch (e) {
    showError(e.message);
  }
}

$('sch-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!scheduleDays.size) { showError(t('Избери поне един ден.')); return; }
  saveSchedule({
    name: $('sch-name').value.trim(),
    days: [...scheduleDays].sort().join(''),
    start_time: $('sch-start').value,
    end_time: $('sch-end').value,
    enabled: true,
  });
  $('sch-name').value = '';
});
$('sch-night').addEventListener('click', () => saveSchedule({
  name: t('Нощ'), days: '0123456', start_time: '23:00', end_time: '07:00', enabled: true,
}));

function onScheduleDone(m) {
  loadList();
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(t('Отчетът е готов'), { body: t('Записът „{name}“ приключи.', { name: m.name }) });
    n.onclick = () => { window.focus(); location.hash = `#records/${m.session_id}`; };
  }
}

// ---------- списък ----------

async function loadList() {
  try {
    ({ sessions } = await api('/api/sessions'));
  } catch (e) {
    showError(e.message);
    return;
  }
  const list = $('list');
  list.replaceChildren();
  if (!sessions.length) {
    const p = document.createElement('p');
    p.className = 'text-sm text-ink3';
    p.textContent = t('Още няма записи. Въведи име горе и натисни „Започни запис“.');
    list.appendChild(p);
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
    dur.textContent = s.active ? t('записва, {time}', { time: fmtDuration(s.duration) }) : fmtDuration(s.duration);
    if (s.active) dur.classList.add('text-crit-ink');
    list.appendChild(a);
  }
}

// ---------- отчет ----------

async function openSession(id) {
  if (id !== currentSession) intervalSec = null;   // нов запис – нов подходящ интервал
  currentSession = id;
  if (!id) {
    report = null;
    reportCharts = null;
    const empty = document.createElement('div');
    empty.className = 'rounded-2xl border border-dashed border-line p-10 text-center text-ink3';
    empty.textContent = t('Избери запис от списъка, за да видиш отчета.');
    $('report').replaceChildren(empty);
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
  d.children[0].title = hint ? t(hint) : '';
  d.children[1].textContent = fmtDb(value);
  return d;
}

function metaItem(label, value) {
  const d = document.createElement('div');
  d.innerHTML = '<dt class="inline text-ink3"></dt> <dd class="inline text-ink2"></dd>';
  d.children[0].textContent = t(label);
  d.children[1].textContent = value;
  return d;
}

function renderReport() {
  const { session, summary } = report;
  const root = $('report-template').content.cloneNode(true);
  applyI18n(root);
  const f = (name) => root.querySelector(`[data-f="${name}"]`);
  const a = (name) => root.querySelector(`[data-a="${name}"]`);

  f('name').textContent = session.name;
  f('meta').append(
    metaItem('Начало', fmtDateTime(session.started_at)),
    metaItem('Продължителност', report.active ? t('{time}, записва се', { time: fmtDuration(report.duration) }) : fmtDuration(report.duration)),
    metaItem('Офсет', `${session.calibration_offset} dB`),
  );
  if (session.device) f('meta').append(metaItem('Микрофон', deviceLabel(session.device)));
  if (session.note) {
    f('note').textContent = session.note;
    f('note').hidden = false;
  }

  a('csv').href = `/api/sessions/${session.id}/csv`;
  a('pdf').href = `/report/${session.id}?print=1`;
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
    f('ref-name').textContent = t('{name}, около {db} dB', { name: t(ref.name), db: ref.db });
    f('loudest').textContent = t('Най-шумно в {time}: {db} dB', { time: fmtTime(summary.loudest_at), db: fmtDb(summary.lafmax) });

    f('tiles').append(
      tile('LAeq', summary.laeq, 'Средно A-претеглено ниво за целия запис'),
      tile('LAFmax', summary.lafmax),
      tile('LAFmin', summary.lafmin),
      tile('LAImax', summary.laimax, 'Максимум с времево претегляне Impulse'),
      tile('LCeq', summary.lceq),
      tile('LCpeak', summary.lcpeak, 'Най-високият пик с C-претегляне – за работното място'),
      tile('LZeq', summary.lzeq),
      tile('LZpeak', summary.lzpeak, 'Най-високият моментен пик, без претегляне'),
      tile('L10', summary.l10, 'Надвишено 10% от времето – шумните моменти'),
      tile('L50', summary.l50, 'Медиана'),
      tile('L90', summary.l90, 'Надвишено 90% от времето – фонът'),
      tile('SEL', summary.lae, 'Звукова експозиция: цялата енергия на записа, сведена до 1 s (LAE)'),
    );
    for (const [p, v] of Object.entries(summary.ln)) {
      const d = document.createElement('div');
      d.innerHTML = '<dt class="inline text-ink3"></dt> <dd class="inline font-semibold tabular-nums"></dd>';
      d.children[0].textContent = `L${p}`;
      d.children[1].textContent = fmtDb(v);
      f('ln').appendChild(d);
    }

    renderWorkplaceReport(f, summary);
    renderEnvironmentReport(f);
    if (report.sleep) renderSleep(f, report.sleep);

    const diff = summary.lceq - summary.laeq;
    f('lowfreq').textContent = `LCeq − LAeq = ${diff.toFixed(1)} dB. ` + (diff > 15
      ? t('Голямата разлика показва много нискочестотен шум – бучене, вентилация, бас.')
      : t('Няма изразен нискочестотен шум.'));
    f('lowfreq').className = 'text-sm ' + (diff > 15 ? 'text-warn-ink' : 'text-ink3');

    const total = summary.seconds;
    for (const row of report.above) {
      const pct = total ? (100 * row.seconds) / total : 0;
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="mb-1.5 flex justify-between gap-2"><span></span><span class="tabular-nums text-ink2"></span></div>
        <div class="h-2 overflow-hidden rounded-full bg-raised"><div class="h-full rounded-full"></div></div>`;
      const spans = el.querySelectorAll('span');
      spans[0].textContent = t('Над {thr} dB', { thr: row.threshold });
      spans[1].textContent = `${fmtDuration(row.seconds)} (${pct.toFixed(1)}%)`;
      const bar = el.querySelector('.h-full');
      bar.style.width = `${pct}%`;
      bar.style.background = levelColor(row.threshold + 0.1);
      f('above').appendChild(el);
    }

    if (report.sources.length) {
      renderBars(f('sources'), report.sources.map((s) => ({
        icon: soundCategory(s.category).icon, label: soundName(s.category),
        value: `${Math.round(s.share * 100)}%`, pct: s.share * 100,
      })));
    } else {
      const p = document.createElement('p');
      p.className = 'text-sm text-ink3';
      p.textContent = t('Няма данни – разпознаването не е било включено по време на записа.');
      f('sources').appendChild(p);
    }

    for (const [key, std] of Object.entries(DOSE_STANDARDS)) {
      const d = report.dose[key];
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="text-sm text-ink2"></div>
        <div class="mt-1 text-3xl font-semibold"></div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-raised"><div class="h-full rounded-full"></div></div>
        <div class="mt-2 text-sm text-ink3"></div>`;
      el.children[0].textContent = t('{label}: {crit} dB за 8 ч, през {ex} dB', { label: std.label, crit: std.criterion, ex: std.exchange });
      el.children[1].textContent = fmtPct(d.dose);
      const bar = el.children[2].firstElementChild;
      bar.style.width = `${Math.min(100, d.dose)}%`;
      bar.style.background = doseColor(d.dose);
      el.children[3].textContent = t('TWA {twa}, прогноза за 8 ч {proj}%', {
        twa: d.twa === null ? '--' : `${fmtDb(d.twa)} dB`, proj: d.projected.toFixed(0),
      });
      f('dose').appendChild(el);
    }
  }

  const tbody = f('events');
  if (!report.events.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" class="py-2 text-ink3"></td>';
    tr.firstElementChild.textContent = t('Няма събития в този запис.');
    tbody.appendChild(tr);
  }
  for (const e of [...report.events].reverse()) {
    const tr = document.createElement('tr');
    const dur = e.ended_at ? fmtDuration(e.ended_at - e.started_at) : t('продължава');
    const sel = e.sel === null || e.sel === undefined ? '--' : `${fmtDb(e.sel)} dB`;
    const kind = e.kind === 'alarm' || !e.kind ? `${t('Аларма')} > ${e.threshold} dB` : eventLabel(e);
    for (const text of [fmtDateTime(e.started_at), dur, kind, `${fmtDb(e.max_level)} dB`, sel]) {
      const td = document.createElement('td');
      td.className = 'py-2 pr-4';
      td.textContent = text;
      tr.appendChild(td);
    }
    const td = document.createElement('td');
    td.className = 'py-2';
    if (e.clip_id) td.appendChild(clipButton(e.clip_id));
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  $('report').replaceChildren(root);

  reportCharts = null;   // старите графики (от предишния отчет) вече не са на страницата
  if (summary) {
    const q = (name) => $('report').querySelector(`[data-f="${name}"]`);
    reportCharts = {
      timeline: setupCanvas(q('timeline'), redrawReport),
      histogram: setupCanvas(q('histogram'), redrawReport),
      intervals: setupCanvas(q('intervals'), redrawReport),
    };
    attachTooltip(reportCharts.timeline, pickTimeline, redrawReport);
    attachTooltip(reportCharts.histogram, pickHistogram, redrawReport);
    attachTooltip(reportCharts.intervals, pickInterval, redrawReport);
    setupIntervalSeg(q('interval-seg'));
    redrawReport();
  } else {
    reportCharts = null;
  }
}

function redrawReport() {
  if (reportCharts) { drawTimeline(); drawHistogram(); drawIntervals(); }
}

// ---------- сън ----------

function renderSleep(f, sleep) {
  f('sleep-box').hidden = false;
  const n = sleep.events.length;
  const verdict = f('sleep-verdict');
  verdict.textContent = n === 0
    ? t('Тиха нощ – нито едно събитие над {thr} dB(A).', { thr: sleep.threshold })
    : n <= sleep.max_events
      ? t('{n} шумни събития над {thr} dB(A) – в препоръката на СЗО (до 10–15).', { n, thr: sleep.threshold })
      : t('{n} шумни събития над {thr} dB(A) – повече от препоръчаните 10–15; сънят може да е нарушен.', { n, thr: sleep.threshold });
  verdict.className = 'mt-3 font-medium ' + (n > sleep.max_events ? 'text-crit-ink' : '');
  const ol = f('sleep-events');
  for (const ev of sleep.events) {
    const li = document.createElement('li');
    li.className = 'flex flex-wrap items-center justify-between gap-x-4 py-1.5';
    li.innerHTML = '<span class="tabular-nums text-ink2"></span><span class="flex items-center gap-2"><span aria-hidden="true"></span><span></span></span><span class="tabular-nums font-semibold"></span>';
    const spans = li.querySelectorAll('span');
    spans[0].textContent = fmtTime(ev.at);
    const cat = ev.source ? soundCategory(ev.source) : null;
    spans[2].textContent = cat ? cat.icon : '';
    spans[3].textContent = cat ? soundName(ev.source) : t('неразпознат източник');
    spans[4].textContent = `${ev.max.toFixed(1)} dB`;
    ol.appendChild(li);
  }
}

// ---------- работно място и околна среда в отчета ----------

function renderWorkplaceReport(f, summary) {
  const hoursInput = f('wp-hours');
  const update = () => {
    const hours = parseFloat(hoursInput.value);
    const seconds = Number.isFinite(hours) && hours > 0 ? hours * 3600 : summary.seconds;
    const lex = lex8h(summary.laeq, seconds);
    const reached = workplaceReached(lex, summary.lcpeak ?? -Infinity);
    f('wp-lex').textContent = fmtDb(lex);
    f('wp-peak').textContent = fmtDb(summary.lcpeak);
    const status = f('wp-status');
    if (reached) {
      status.textContent = `${t(WORKPLACE_INFO[reached].label)} – ${t('достигнати')}. ${t(WORKPLACE_INFO[reached].action)}`;
      status.className = 'mt-4 text-sm text-warn-ink';
    } else {
      status.textContent = t('Под долните стойности за действие (80 dB(A) и 135 dB(C)).');
      status.className = 'mt-4 text-sm text-ink2';
    }
  };
  // По подразбиране – колкото е продължил записът
  hoursInput.value = (summary.seconds / 3600).toFixed(2);
  hoursInput.addEventListener('input', update);
  update();
}

function renderEnvironmentReport(f) {
  const select = f('env-zone');
  fillEnvSelect(select);
  select.addEventListener('change', (e) => setEnvSelection(e.target.value));
  const env = report.environment;
  const limits = envLimitsFor();
  const tbody = f('env');
  for (const period of ['day', 'evening', 'night']) {
    const row = env[period];
    const tr = document.createElement('tr');
    const over = row.laeq !== null && limits && row.laeq > limits[period];
    const cells = [
      `${t(ENV_PERIOD_NAMES[period])} (${t(ENV_PERIOD_HOURS[period])})`,
      row.laeq === null ? '—' : `${row.laeq.toFixed(1)} dB`,
      limits ? `${limits[period]} dB` : '--',
      `${Math.round(row.coverage * 100)}%`,
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.className = 'py-1.5 pr-3' + (i === 1 && over ? ' font-semibold text-crit-ink' : '');
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  f('lden').textContent = env.lden === null
    ? t('Lden изисква данни и за трите периода – направи запис за цяло денонощие.')
    : `Lden = ${env.lden.toFixed(1)} dB`;
}

// ---------- LAeq по интервали ----------

let intervalSec = null;

function setupIntervalSeg(root) {
  const duration = report.summary.seconds;
  // Подходящ интервал според дължината на записа
  if (!intervalSec) intervalSec = duration < 2 * 3600 ? 60 : duration < 12 * 3600 ? 900 : 3600;
  const render = () => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.value) === intervalSec));
  root.addEventListener('click', (e) => {
    const v = Number(e.target.closest('button')?.dataset.value);
    if (v) { intervalSec = v; render(); redrawReport(); }
  });
  render();
}

function pickInterval(x) {
  const cv = reportCharts.intervals;
  const rows = report.intervals[String(intervalSec)];
  const slot = cv.box.pw / rows.length;
  const i = Math.floor((x - cv.box.L) / slot);
  if (i < 0 || i >= rows.length) return null;
  return {
    x: cv.box.L + slot * (i + 0.5),
    title: fmtTime(rows[i].t),
    rows: [{ value: `${rows[i].laeq.toFixed(1)} dB`, label: 'LAeq' }],
    index: i,
  };
}

function drawIntervals() {
  const cv = reportCharts.intervals;
  const { ctx, w, h } = cv;
  ctx.clearRect(0, 0, w, h);
  if (!w) return;
  const rows = report.intervals[String(intervalSec)];
  const box = { L: 36, T: 8, pw: w - 44, ph: h - 28 };
  cv.box = box;
  const { lo, hi } = levelRange(rows.map((r) => r.laeq));
  const y = drawLevelGrid(ctx, box, lo, hi);
  cv.tip.refresh();
  const slot = box.pw / rows.length;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const labelEvery = Math.ceil(rows.length / 6);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  rows.forEach((r, i) => {
    const top = y(r.laeq), hgt = box.T + box.ph - top;
    if (hgt >= 1) {
      ctx.fillStyle = cv.hover?.index === i ? COLORS.accentHover : COLORS.accent;
      ctx.beginPath();
      ctx.roundRect(box.L + slot * i + (slot - barW) / 2, top, barW, hgt, [Math.min(4, hgt, barW / 2), Math.min(4, hgt, barW / 2), 0, 0]);
      ctx.fill();
    }
    if (i % labelEvery === 0) {
      ctx.fillStyle = COLORS.axis;
      ctx.fillText(new Date(r.t * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }), box.L + slot * (i + 0.5), h - 14);
    }
  });
}

function pickTimeline(x) {
  const cv = reportCharts.timeline;
  const ts = report.series.t;
  const target = cv.t0 + ((x - cv.box.L) / cv.box.pw) * (cv.t1 - cv.t0);
  let i = 0;
  for (let k = 1; k < ts.length; k++) if (Math.abs(ts[k] - target) < Math.abs(ts[i] - target)) i = k;
  return {
    x: cv.x(ts[i]),
    title: fmtTime(ts[i]),
    rows: [
      { value: `${fmtDb(report.series.laeq[i])} dB`, label: 'LAeq', color: COLORS.accent },
      { value: `${fmtDb(report.series.lafmax[i])} dB`, label: 'LAFmax', color: COLORS.ink3 },
    ],
    points: [{ y: cv.y(report.series.laeq[i]), color: COLORS.accent }, { y: cv.y(report.series.lafmax[i]), color: COLORS.ink3 }],
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
  const x = (tt) => box.L + box.pw * ((tt - t0) / (t1 - t0));
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
    const tt = t0 + ((t1 - t0) * i) / 4;
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(fmtTime(tt), x(tt), h - 16);
  }

  const pts = (values) => values.map((v, i) => [x(series.t[i]), y(v)]);
  ctx.globalAlpha = 0.6;
  drawSeries(ctx, pts(series.lafmax), COLORS.ink3);
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
      ctx.fillStyle = cv.hover?.index === i ? COLORS.accentHover : COLORS.accent;
      ctx.beginPath(); ctx.roundRect(bx, y(p), barW, hgt, [Math.min(4, hgt), Math.min(4, hgt), 0, 0]); ctx.fill();
    }
    if (i % labelEvery === 0) { ctx.fillStyle = COLORS.axis; ctx.fillText(edges[i], box.L + slot * i, h - 14); }
  });
}

async function renameSession() {
  const name = prompt(t('Ново име на записа:'), report.session.name);
  if (!name || !name.trim()) return;
  try {
    await api(`/api/sessions/${currentSession}`, { name: name.trim() }, 'PATCH');
    openSession(currentSession);
  } catch (e) {
    showError(e.message);
  }
}

async function editNote() {
  const note = prompt(t('Бележка към записа – място, източник на шума…'), report.session.note || '');
  if (note === null) return;
  try {
    await api(`/api/sessions/${currentSession}`, { note }, 'PATCH');
    openSession(currentSession);
  } catch (e) {
    showError(e.message);
  }
}

async function deleteSession() {
  if (!confirm(t('Да изтрия ли „{name}“? Това не може да се върне.', { name: report.session.name }))) return;
  try {
    await api(`/api/sessions/${currentSession}`, undefined, 'DELETE');
    location.hash = '#records';
  } catch (e) {
    showError(e.message);
  }
}

function recordsOnShow(param) {
  if (param === 'dashboard') {
    showRecordsView('dashboard');
    return;
  }
  showRecordsView('list');
  openSession(param ? parseInt(param, 10) || null : null);
  loadSchedules();
}

renderDayButtons();

// Отвореният активен запис се опреснява на всеки 5 секунди
setInterval(() => {
  if (currentSectionId !== 'records' || document.hidden) return;
  if (report?.active) openSession(currentSession);
  else if (sessions.some((s) => s.active)) loadList();
}, 5000);
