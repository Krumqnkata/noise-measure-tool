// Раздел „Звуци“: собствени звуци, откриване на аномалии и аудио клипове

let customSounds = [];
let anomaly = { profiles: [], anomaly_profile: null, learning: null };
let mlReady = false;
let recordingExample = null;   // id на звука, за който се записва пример

async function loadCustomSounds() {
  try {
    customSounds = (await api('/api/custom-sounds')).sounds;
    CUSTOM_SOUNDS = Object.fromEntries(customSounds.map((s) => [String(s.id), s]));
    renderCustomSounds();
  } catch { /* не е критично */ }
}

function renderCustomSounds() {
  const ul = $('cs-list');
  ul.replaceChildren();
  if (!customSounds.length) {
    const li = document.createElement('li');
    li.className = 'py-2 text-sm text-ink3';
    li.textContent = t('Още няма собствени звуци.');
    ul.appendChild(li);
  }
  for (const s of customSounds) {
    const li = document.createElement('li');
    li.className = 'flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5';
    li.innerHTML = `
      <span class="text-2xl leading-none" aria-hidden="true"></span>
      <span class="min-w-[9rem] flex-1"><span class="block break-words font-medium"></span><span class="text-xs text-ink3"></span></span>
      <div class="ml-auto flex items-center gap-2">
        <label class="mr-1 flex items-center gap-1.5 text-sm text-ink2"><input type="checkbox" class="h-4 w-4 accent-accent"><span></span></label>
        <button data-a="example" class="btn px-2.5 py-1 text-sm"></button>
        <button data-a="delete" class="btn px-2.5 py-1 text-sm text-crit-ink"></button>
      </div>`;
    const spans = li.querySelectorAll(':scope > span');
    spans[0].textContent = s.icon;
    spans[1].children[0].textContent = s.name;
    spans[1].children[1].textContent = s.recordings
      ? t('{n} записа', { n: s.recordings })
      : t('няма примери – запиши поне 2');
    const alert = li.querySelector('input');
    alert.checked = !!s.alert;
    li.querySelector('label span').textContent = t('извести ме');
    alert.addEventListener('change', () => updateCustomSound(s.id, { alert: alert.checked }));
    const example = li.querySelector('[data-a=example]');
    example.disabled = !mlReady || recordingExample !== null;
    example.textContent = recordingExample === s.id ? t('Записвам…') : t('+ Пример (4 s)');
    example.addEventListener('click', () => recordExample(s.id));
    const del = li.querySelector('[data-a=delete]');
    del.textContent = t('Изтрий');
    del.addEventListener('click', async () => {
      if (!confirm(t('Да изтрия ли „{name}“ и примерите му?', { name: s.name }))) return;
      await updateCustomSound(s.id, null);
    });
    ul.appendChild(li);
  }
}

async function updateCustomSound(id, patch) {
  try {
    const res = patch === null
      ? await api(`/api/custom-sounds/${id}`, undefined, 'DELETE')
      : await api(`/api/custom-sounds/${id}`, patch, 'PATCH');
    customSounds = res.sounds;
    CUSTOM_SOUNDS = Object.fromEntries(customSounds.map((s) => [String(s.id), s]));
    renderCustomSounds();
  } catch (e) {
    showError(e.message);
  }
}

async function recordExample(id) {
  recordingExample = id;
  renderCustomSounds();
  try {
    const res = await api(`/api/custom-sounds/${id}/examples`, { seconds: 4 });
    customSounds = res.sounds;
    CUSTOM_SOUNDS = Object.fromEntries(customSounds.map((s) => [String(s.id), s]));
    showError('');
  } catch (e) {
    showError(e.message);
  } finally {
    recordingExample = null;
    renderCustomSounds();
  }
}

$('cs-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/api/custom-sounds', { name: $('cs-name').value.trim(), icon: $('cs-icon').value.trim() || '🔔', alert: false });
    customSounds = res.sounds;
    CUSTOM_SOUNDS = Object.fromEntries(customSounds.map((s) => [String(s.id), s]));
    $('cs-name').value = '';
    renderCustomSounds();
  } catch (err) {
    showError(err.message);
  }
});

// ---------- аномалии ----------

async function loadAnomaly() {
  try {
    anomaly = await api('/api/anomaly');
    renderAnomaly();
  } catch { /* не е критично */ }
}

function renderAnomaly() {
  const ul = $('an-list');
  ul.replaceChildren();
  const option = (id, title, subtitle) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-3 py-2';
    li.innerHTML = '<input type="radio" name="an-active" class="h-4 w-4 accent-accent"><span class="min-w-0 flex-1"><span class="block truncate"></span><span class="text-xs text-ink3"></span></span>';
    const radio = li.querySelector('input');
    radio.checked = anomaly.anomaly_profile === id;
    radio.addEventListener('change', () => setAnomalyProfile(id));
    li.querySelector('span span').textContent = title;
    li.querySelectorAll('span span')[1].textContent = subtitle;
    return li;
  };
  ul.appendChild(option(null, t('Изключено'), ''));
  for (const p of anomaly.profiles) {
    const li = option(p.id, p.name, t('научен за {time}, {date}', { time: fmtLongDuration(p.seconds), date: fmtDateTime(p.created_at) }));
    const del = document.createElement('button');
    del.className = 'btn px-2 py-0.5 text-xs text-crit-ink';
    del.textContent = t('Изтрий');
    del.addEventListener('click', async () => {
      if (!confirm(t('Да изтрия ли профила „{name}“?', { name: p.name }))) return;
      try { anomaly = await api(`/api/anomaly/${p.id}`, undefined, 'DELETE'); renderAnomaly(); } catch (e) { showError(e.message); }
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
  renderLearning(anomaly.learning);
}

function renderLearning(learning) {
  $('an-learning').hidden = !learning;
  if (!learning) return;
  $('an-learning-name').textContent = t('Учи „{name}“…', { name: learning.name });
  $('an-learning-pct').textContent = `${Math.round(learning.progress * 100)}%`;
  $('an-learning-bar').style.width = `${learning.progress * 100}%`;
}

async function setAnomalyProfile(id) {
  try { anomaly = await api('/api/anomaly/active', { id }); renderAnomaly(); } catch (e) { showError(e.message); }
}

$('an-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    anomaly = await api('/api/anomaly/learn', { name: $('an-name').value.trim(), minutes: Number($('an-minutes').value) });
    $('an-name').value = '';
    renderAnomaly();
    showError('');
  } catch (err) {
    showError(err.message);
  }
});

// ---------- клипове ----------

async function loadClips() {
  try {
    const { clips } = await api('/api/clips?limit=50');
    const ul = $('clip-list');
    ul.replaceChildren();
    if (!clips.length) {
      const li = document.createElement('li');
      li.className = 'py-2 text-ink3';
      li.textContent = t('Още няма клипове.');
      ul.appendChild(li);
    }
    for (const c of clips) {
      const li = document.createElement('li');
      li.className = 'flex flex-wrap items-center gap-3 py-2';
      li.innerHTML = '<span class="min-w-0 flex-1"><span class="block"></span><span class="text-xs tabular-nums text-ink3"></span></span>';
      li.querySelector('span span').textContent = eventLabel({ kind: c.reason, label: c.label });
      li.querySelectorAll('span span')[1].textContent = `${fmtDateTime(c.t)}, ${c.seconds.toFixed(0)} s`;
      const del = document.createElement('button');
      del.className = 'btn px-2 py-0.5 text-xs text-crit-ink';
      del.textContent = t('Изтрий');
      del.addEventListener('click', async () => {
        try { await api(`/api/clips/${c.id}`, undefined, 'DELETE'); loadClips(); } catch (e) { showError(e.message); }
      });
      li.append(clipButton(c.id), del);
      ul.appendChild(li);
    }
  } catch { /* не е критично */ }
}

function renderClipSettings(s) {
  $('clip-enabled').checked = s.clips_enabled;
  $('clip-speech').checked = s.clips_skip_speech;
  if (document.activeElement !== $('clip-mb')) $('clip-mb').value = s.clips_max_mb;
  document.querySelectorAll('#clip-form [data-on]').forEach((el) => { el.checked = s.clips_on.includes(el.dataset.on); });
}

$('clip-form').addEventListener('submit', (e) => {
  e.preventDefault();
  action(() => api('/api/clips/settings', {
    enabled: $('clip-enabled').checked,
    skip_speech: $('clip-speech').checked,
    max_mb: Number($('clip-mb').value) || 200,
    on: [...document.querySelectorAll('#clip-form [data-on]:checked')].map((el) => el.dataset.on),
  }));
});

// ---------- на живо ----------

function soundsOnStatus(s) {
  mlReady = s.classifier.state === 'ready';
  const unavailable = $('ml-unavailable');
  unavailable.hidden = mlReady;
  if (!mlReady) unavailable.textContent = $('cls-status').textContent;
  renderClipSettings(s.clips);
  anomaly.anomaly_profile = s.ml.anomaly_profile;
  renderLearning(s.ml.learning);
  renderCustomSounds();
}

function soundsOnSound(m) {
  const live = $('cs-live');
  live.textContent = m.custom
    ? t('Сега: {icon} {name} – сходство {pct}%', { icon: m.custom.icon, name: m.custom.name, pct: Math.round(m.custom.similarity * 100) })
    : customSounds.length ? t('Сега не се чува нито един от твоите звуци.') : t('Добави звук и запиши примери, за да го разпознава.');
  if (m.ml) {
    renderLearning(m.ml.learning);
    if (!m.ml.learning && anomaly.learning) { anomaly.learning = null; loadAnomaly(); }
    anomaly.learning = m.ml.learning;
  }
  const score = m.anomaly?.score;
  $('an-score').textContent = score === undefined ? '--' : score.toFixed(2);
  $('an-bar').style.width = score === undefined ? '0' : `${Math.min(100, (score / 3) * 100)}%`;
  $('an-bar').style.background = score >= 1 ? LEVELS[3].color : COLORS.accent;
  $('an-status').textContent = score === undefined
    ? t('Избери или научи профил, за да следи за необичаен звук.')
    : score >= 1 ? t('Необичайно спрямо „{name}“.', { name: anomaly.profiles.find((p) => p.id === anomaly.anomaly_profile)?.name || '' })
      : t('Нормално – под 1.0 е както при обучението.');
}

// Събития от ML: банер, известие и червена точка по раздела
const mlActive = {};
function onMlEvent(m) {
  const key = `${m.kind}:${m.label}`;
  if (m.active) mlActive[key] = m; else delete mlActive[key];
  const active = Object.values(mlActive);
  const banner = $('ml-banner');
  banner.classList.toggle('hidden', !active.length);
  banner.textContent = active.map((e) => eventLabel(e)).join(' · ');
  setBadge('sounds', active.length > 0);
  if (m.active && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(t('Шумомер'), { body: eventLabel(m) });
  }
  if (!m.active) { loadEvents(); }
}

function soundsOnShow() {
  loadCustomSounds();
  loadAnomaly();
  loadClips();
}

loadCustomSounds();
