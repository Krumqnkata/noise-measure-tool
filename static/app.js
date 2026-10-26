// Обвивка на приложението: раздели и навигация, връзка със сървъра, общи контроли,
// тема и език

const ICON = (paths) => `<svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const SECTIONS = [
  { id: 'meter', label: 'Ниво', icon: ICON('<path d="M3.5 16a8.5 8.5 0 0 1 17 0"/><path d="M12 16l3.5-5.5"/><circle cx="12" cy="16" r="1.2"/>') },
  { id: 'analysis', label: 'Анализ', icon: ICON('<path d="M4 20V11M9 20V5M14 20v-8M19 20V8"/>') },
  { id: 'dose', label: 'Доза', icon: ICON('<path d="M12 3 5 6v5c0 4.4 3 8.2 7 10 4-1.8 7-5.6 7-10V6l-7-3Z"/><path d="M12 8v4l2.5 1.5"/>') },
  { id: 'records', label: 'Записи', icon: ICON('<circle cx="6.5" cy="7" r="2.5"/><path d="M12 7h8M4 13h16M4 18h16"/>') },
  { id: 'alarm', label: 'Аларма', icon: ICON('<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>') },
  { id: 'settings', label: 'Настройки', icon: ICON('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>') },
];
const SUN = ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
const MOON = ICON('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>');

let currentSectionId = null;

// ---------- навигация ----------

function buildNav() {
  const side = $('nav-side'), bottom = $('nav-bottom');
  side.replaceChildren();
  bottom.replaceChildren();
  SECTIONS.forEach((s, i) => {
    const label = t(s.label);
    const a = document.createElement('a');
    a.href = `#${s.id}`;
    a.dataset.section = s.id;
    a.title = `${label} (${i + 1})`;
    a.className = 'nav-link flex items-center gap-3 rounded-lg px-3 py-2 text-ink2 transition-colors hover:bg-panel hover:text-ink';
    a.innerHTML = `${s.icon}<span></span><span class="nav-badge ml-auto hidden h-2 w-2 rounded-full bg-crit"></span>`;
    a.children[1].textContent = label;
    side.appendChild(a);

    const b = document.createElement('a');
    b.href = `#${s.id}`;
    b.dataset.section = s.id;
    b.className = 'nav-link relative flex flex-col items-center gap-1 py-2 text-[11px] text-ink3';
    b.innerHTML = `${s.icon}<span class="max-w-full truncate px-0.5"></span><span class="nav-badge absolute right-[calc(50%-14px)] top-1.5 hidden h-2 w-2 rounded-full bg-crit"></span>`;
    b.children[1].textContent = label;
    bottom.appendChild(b);
  });
}

function route() {
  const [id, param] = location.hash.replace(/^#/, '').split('/');
  const section = SECTIONS.find((s) => s.id === id) ? id : 'meter';
  const changed = section !== currentSectionId;
  currentSectionId = section;
  document.querySelectorAll('[data-section]').forEach((el) => {
    if (el.tagName === 'SECTION') el.hidden = el.dataset.section !== section;
    else if (el.dataset.section === section) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  updateTitle();
  if (changed) { window.scrollTo(0, 0); showError(''); }
  if (section === 'records') recordsOnShow(param);
  setBadge('records', !!recording);
  setBadge('alarm', alarmActive);
  dirty = true;
}
window.addEventListener('hashchange', route);

function updateTitle() {
  const s = SECTIONS.find((x) => x.id === currentSectionId);
  document.title = !s || s.id === 'meter' ? t('Шумомер') : `${t(s.label)} – ${t('Шумомер')}`;
}

// Червена точка по раздела, където има нещо активно
function setBadge(section, on) {
  document.querySelectorAll(`.nav-link[data-section="${section}"] .nav-badge`).forEach((el) => el.classList.toggle('hidden', !on));
}

// ---------- сегментирани бутони ----------

function setupSegment(id, get, set) {
  const root = $(id);
  const render = () => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === get()));
  root.addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.value;
    if (!v || v === get()) return;
    set(v);
    render();
  });
  render();
  return render;
}
setupSegment('seg-weighting', () => weighting, (v) => { weighting = v; store.set('weighting', v); onMetricChange(); });
setupSegment('seg-time', () => timeWeighting, (v) => { timeWeighting = v; store.set('timeWeighting', v); onMetricChange(); });

function onMetricChange() {
  for (const id of ['metric-name', 'history-title', 'big-metric', 'side-metric']) $(id).textContent = metricName();
  for (const el of document.querySelectorAll('.side-unit')) el.textContent = unitName();
  $('level-unit').textContent = unitName();
  $('big-unit').textContent = unitName();
  history.length = 0;   // смесени величини в една графика нямат смисъл
  resetStats();
}

// ---------- тема и език ----------

const renderThemeSeg = setupSegment('seg-theme', () => themePref, (v) => setTheme(v));
const renderLangSeg = setupSegment('seg-lang', () => lang, (v) => setLanguage(v));

function setTheme(pref) {
  themePref = pref;
  store.set('theme', pref);
  applyTheme();
  onThemeChange();
}

// Бързият бутон превключва между светла и тъмна (спрямо това, което се вижда сега)
function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

window.onThemeChange = function onThemeChange() {
  renderThemeSeg();
  const dark = document.documentElement.dataset.theme === 'dark';
  $('side-theme').innerHTML = `<span class="flex items-center justify-center gap-2">${dark ? SUN : MOON}<span></span></span>`;
  $('side-theme').querySelector('span span').textContent = dark ? t('Светла') : t('Тъмна');
  dirty = true;
  redrawReport();
};

function setLanguage(next) {
  lang = next;
  store.set('lang', next);
  applyI18n();
  buildNav();
  route();
  renderRefScale();
  renderDoseTable();
  renderLangSeg();
  onThemeChange();
  $('side-lang').textContent = lang === 'bg' ? 'English' : 'Български';
  $('offset-default').textContent = t('Типичен ({n})', { n: defaultCalibration });
  $('mode-label').textContent = demoMode ? t('Демо режим: сигналът е симулиран, микрофонът не се ползва.') : t('Звукът се записва от микрофона на компютъра, на който върви сървърът.');
  for (const btn of document.querySelectorAll('.toggle')) btn.textContent = running ? t('Стоп') : t('Старт');
  renderClassifierStatus(classifierStatus);
  if (lastSound) onSound(lastSound);
  if (latest) updateMeterReadout(latest);
  setConn(connState);
  loadDevices();
  loadEvents();
}

$('side-theme').addEventListener('click', toggleTheme);
$('side-lang').addEventListener('click', () => setLanguage(lang === 'bg' ? 'en' : 'bg'));

// ---------- статус от сървъра ----------

function onStatus(s) {
  running = s.running;
  demoMode = s.demo;
  defaultCalibration = s.default_calibration;
  if (calOffset !== s.calibration_offset) {
    calOffset = s.calibration_offset;
    updateSpectrogramLegend();
    dirty = true;
  }
  for (const btn of document.querySelectorAll('.toggle')) {
    btn.textContent = running ? t('Стоп') : t('Старт');
    btn.classList.toggle('btn-primary', !running);
  }
  $('mode-label').textContent = s.demo
    ? t('Демо режим: сигналът е симулиран, микрофонът не се ползва.')
    : t('Звукът се записва от микрофона на компютъра, на който върви сървърът.');
  if (document.activeElement !== $('offset')) $('offset').value = s.calibration_offset;
  $('offset-default').textContent = t('Типичен ({n})', { n: defaultCalibration });
  const sel = $('device');
  sel.disabled = s.demo;
  if (!s.demo) sel.value = s.device === null ? '' : String(s.device);
  if (s.error) showError(s.error);
  else if (running) showError('');

  onRecordingStatus(s.recording);
  setBadge('records', !!s.recording);
  renderClassifierStatus(s.classifier);

  const a = s.alarm;
  $('alarm-enabled').checked = a.enabled;
  for (const [id, v] of [['alarm-threshold', a.threshold], ['alarm-duration', a.duration]]) {
    if (document.activeElement !== $(id)) $(id).value = v;
  }
}

async function loadDevices() {
  try {
    const { devices } = await api('/api/devices');
    const sel = $('device');
    sel.replaceChildren();
    if (!demoMode && devices.length && devices[0].index !== -1) {
      sel.add(new Option(t('По подразбиране (системният)'), ''));
    }
    for (const d of devices) {
      if (d.index === -1) { sel.add(new Option(t('Демо сигнал (симулация)'), '')); continue; }
      const label = d.hostapi ? `${d.name} (${d.hostapi})` : d.name;
      sel.add(new Option(d.default ? `${label} – ${t('системен')}` : label, String(d.index)));
    }
    if (!devices.length) sel.add(new Option(t('Няма намерени микрофони'), ''));
    onStatus(await api('/api/status'));
  } catch (e) {
    showError(t('Списъкът с микрофони не се зареди: {error}', { error: e.message }));
  }
}

async function action(fn) {
  try {
    const res = await fn();
    if (res?.type === 'status') onStatus(res);
    showError('');
    return true;
  } catch (e) {
    showError(e.message);
    return false;
  }
}

// ---------- контроли ----------

async function toggleRunning() {
  const buttons = document.querySelectorAll('.toggle');
  buttons.forEach((b) => { b.disabled = true; });
  await action(() => api(running ? '/api/stop' : '/api/start', {}));
  buttons.forEach((b) => { b.disabled = false; });
}
document.querySelectorAll('.toggle').forEach((b) => b.addEventListener('click', toggleRunning));

$('device').addEventListener('change', async (e) => {
  const v = e.target.value;
  await action(() => api('/api/device', { index: v === '' ? null : Number(v) }));
  onStatus(await api('/api/status'));
});

async function setOffset(v) {
  if (!Number.isFinite(v)) { showError(t('Въведи число за офсета.')); return; }
  if (await action(() => api('/api/calibration', { offset: v }))) resetSession();   // старите стойности са с друг офсет
}
$('offset-apply').addEventListener('click', () => setOffset(parseFloat($('offset').value)));
$('offset').addEventListener('keydown', (e) => { if (e.key === 'Enter') setOffset(parseFloat($('offset').value)); });
$('offset-default').addEventListener('click', () => setOffset(defaultCalibration));

// Калибриране по еталон: разликата между еталона и енергийното средно за последните 3 s
$('calibrate').addEventListener('click', () => {
  const ref = parseFloat($('ref-level').value);
  if (!Number.isFinite(ref)) { showError(t('Въведи какво показва еталонният шумомер.')); return; }
  const now = performance.now();
  const recent = history.filter((p) => p.t >= now - 3000).map((p) => p.v);
  if (recent.length < 10) { showError(t('Още няма достатъчно данни. Пусни измерването и изчакай няколко секунди.')); return; }
  const avg = 10 * Math.log10(recent.reduce((s, v) => s + 10 ** (v / 10), 0) / recent.length);
  setOffset(Math.round((calOffset + ref - avg) * 10) / 10);
  $('ref-level').value = '';
});

$('reset').addEventListener('click', resetSession);
$('dose-reset').addEventListener('click', resetSession);
$('snapshot').addEventListener('click', snapshot);
$('big-open').addEventListener('click', openBig);
$('big-close').addEventListener('click', closeBig);

// ---------- аларма ----------

function saveAlarm() {
  return action(() => api('/api/alarm', {
    enabled: $('alarm-enabled').checked,
    threshold: parseFloat($('alarm-threshold').value),
    duration: parseFloat($('alarm-duration').value),
  }));
}
$('alarm-enabled').addEventListener('change', saveAlarm);
$('alarm-save').addEventListener('click', saveAlarm);

$('alarm-sound').checked = store.get('alarmSound', true);
$('alarm-sound').addEventListener('change', (e) => store.set('alarmSound', e.target.checked));

// Известията работят само в „сигурен“ контекст (https или localhost)
if ('Notification' in window && window.isSecureContext && Notification.permission !== 'granted') {
  $('alarm-notify').hidden = false;
  $('alarm-notify').addEventListener('click', async () => {
    if ((await Notification.requestPermission()) === 'granted') $('alarm-notify').hidden = true;
  });
}

// Браузърите позволяват звук само след действие на потребителя, затова
// AudioContext се създава при първото докосване на страницата.
let audioCtx = null;
document.addEventListener('pointerdown', () => {
  if (!audioCtx && window.AudioContext) audioCtx = new AudioContext();
}, { once: true });

let beepTimer = null;
function beep() {
  if (!audioCtx || !$('alarm-sound').checked) return;
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.4);
}

let alarmActive = false;
function onAlarm(a) {
  const was = alarmActive;
  alarmActive = a.active;
  $('alarm-banner').classList.toggle('hidden', !a.active);
  setBadge('alarm', a.active);
  if (a.active) {
    $('alarm-text').textContent = t('Шумът е над {thr} dB от {time}, най-много {max} dB.', {
      thr: a.threshold, time: fmtTime(a.started_at), max: fmtDb(a.max_level),
    });
    if (!beepTimer) { beep(); beepTimer = setInterval(beep, 1000); }
    if (!was && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(t('Шумомер: превишен праг'), { body: t('Нивото е над {thr} dB ({max} dB).', { thr: a.threshold, max: fmtDb(a.max_level) }) });
    }
  } else {
    clearInterval(beepTimer); beepTimer = null;
  }
  if (was !== a.active) loadEvents();
}

async function loadEvents() {
  try {
    const { events } = await api('/api/events?limit=20');
    const ul = $('alarm-events');
    ul.replaceChildren();
    if (!events.length) {
      const li = document.createElement('li');
      li.className = 'py-2 text-ink3';
      li.textContent = t('Още няма събития. Когато шумът мине прага, ще се появят тук.');
      ul.appendChild(li);
      return;
    }
    for (const e of events) {
      const li = document.createElement('li');
      li.className = 'flex flex-wrap justify-between gap-x-4 py-2';
      li.innerHTML = '<span class="text-ink2"></span><span class="tabular-nums"></span>';
      li.children[0].textContent = fmtDateTime(e.started_at);
      const dur = e.ended_at ? fmtDuration(e.ended_at - e.started_at) : t('продължава');
      li.children[1].textContent = t('{max} dB за {time}', { max: fmtDb(e.max_level), time: dur });
      ul.appendChild(li);
    }
  } catch { /* не е критично */ }
}

// ---------- клавиши ----------

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
  const key = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); toggleRunning(); }
  else if (key >= '1' && key <= String(SECTIONS.length)) location.hash = `#${SECTIONS[Number(key) - 1].id}`;
  else if (key === 'f' || key === 'ф') { $('big').hidden ? openBig() : closeBig(); }
  else if (key === 'r' || key === 'р') resetSession();
  else if (key === 's' || key === 'с') snapshot();
  else if (key === 't' || key === 'т') toggleTheme();
  else if (e.key === 'Escape') closeBig();
});

// ---------- WebSocket с автоматично повторно свързване ----------

let retries = 0;
let connState = 'connecting';

function setConn(state) {
  connState = state;
  const map = {
    connecting: [LEVELS[1].color, 'Свързване…'],
    open: [LEVELS[0].color, 'Свързано'],
    closed: [LEVELS[3].color, 'Няма връзка'],
  };
  const [color, text] = map[state];
  document.querySelectorAll('.conn-dot').forEach((el) => { el.style.background = color; });
  document.querySelectorAll('.conn-text').forEach((el) => { el.textContent = t(text); });
}

function connect() {
  setConn('connecting');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { retries = 0; setConn('open'); loadDevices(); loadEvents(); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'data') {
      latest = m;
      dirty = true;
      meterOnData(m);
      analysisOnData(m);
    } else if (m.type === 'status') onStatus(m);
    else if (m.type === 'alarm') onAlarm(m);
    else if (m.type === 'sound') onSound(m);
  };
  ws.onclose = () => {
    setConn('closed');
    setTimeout(connect, Math.min(5000, 500 * 2 ** retries++));
  };
  ws.onerror = () => ws.close();
}

function frame() {
  meterFrame(currentSectionId === 'meter');
  analysisFrame(currentSectionId === 'analysis');
  dirty = false;
  requestAnimationFrame(frame);
}

applyI18n();
buildNav();
renderRefScale();
renderDoseTable();
route();
onMetricChange();
onThemeChange();
$('side-lang').textContent = lang === 'bg' ? 'English' : 'Български';
renderClassifierStatus(classifierStatus);
connect();
requestAnimationFrame(frame);
