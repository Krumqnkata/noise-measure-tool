// Раздел „Норми“ (втора част): шум на работното място по Директива 2003/10/ЕО и
// шум в околната среда по Наредба № 6/2006. Дозата по NIOSH/OSHA е в meter.js.

// LAeq на сесията се смята като енергийно средно на LAF от кадрите (~20 в секунда)
const workplace = { energy: 0, n: 0, peak: -Infinity };

function normsOnData(m) {
  workplace.energy += 10 ** (m.levels.A.F / 10);
  workplace.n++;
  workplace.peak = Math.max(workplace.peak, m.c_peak);
}

function resetWorkplace() {
  Object.assign(workplace, { energy: 0, n: 0, peak: -Infinity });
  updateNorms();
}

const sessionLaeqA = () => (workplace.n ? 10 * Math.log10(workplace.energy / workplace.n) : NaN);
const LIMIT_COLORS = { lower: LEVELS[1].color, upper: LEVELS[2].color, limit: LEVELS[3].color };

// Най-високият минат праг: по LEX,8h или по пика (както в backend/norms.py)
function workplaceReached(lex, peak) {
  let reached = null;
  for (const limit of NORMS?.workplace || []) {
    if (lex >= limit.lex || peak >= limit.peak) reached = limit.id;
  }
  return reached;
}

function renderWorkplaceLimits(reached) {
  const ol = $('wp-limits');
  ol.replaceChildren();
  const order = (NORMS?.workplace || []).map((l) => l.id);
  for (const limit of NORMS?.workplace || []) {
    const info = WORKPLACE_INFO[limit.id];
    const on = reached !== null && order.indexOf(limit.id) <= order.indexOf(reached);
    const li = document.createElement('li');
    li.className = 'rounded-2xl bg-panel p-4 ring-1 ring-line';
    if (on) li.style.boxShadow = `inset 4px 0 0 ${LIMIT_COLORS[limit.id]}`;
    li.innerHTML = `
      <div class="flex flex-wrap items-baseline justify-between gap-x-4">
        <span class="flex items-center gap-2 font-medium"><span class="h-2.5 w-2.5 rounded-full"></span><span></span></span>
        <span class="tabular-nums text-sm text-ink2"></span>
      </div>
      <p class="mt-1 text-sm text-ink3"></p>`;
    const dot = li.querySelector('.rounded-full');
    dot.style.background = on ? LIMIT_COLORS[limit.id] : COLORS.track;
    li.querySelectorAll('span')[2].textContent = t(info.label) + (on ? ` – ${t('достигнати')}` : '');
    li.querySelectorAll('span')[3].textContent = `${limit.lex} dB(A) / ${limit.peak} dB(C)`;
    li.querySelector('p').textContent = t(info.action);
    ol.appendChild(li);
  }
}

function renderEnvPeriods(laeq) {
  const limits = envLimitsFor();
  const box = $('env-periods');
  box.replaceChildren();
  if (!limits) return;
  const now = envPeriodOf(new Date().getHours());
  for (const period of ['day', 'evening', 'night']) {
    const card = document.createElement('div');
    card.className = 'rounded-2xl bg-panel p-4 ring-1 ' + (period === now ? 'ring-accent' : 'ring-line');
    card.innerHTML = `
      <div class="flex items-baseline justify-between gap-2"><span class="font-medium"></span><span class="text-sm text-ink3"></span></div>
      <div class="mt-2 text-3xl font-semibold"></div>
      <div class="text-xs text-ink3"></div>
      <p class="mt-2 text-sm"></p>`;
    const spans = card.querySelectorAll('span');
    spans[0].textContent = t(ENV_PERIOD_NAMES[period]) + (period === now ? ` (${t('сега')})` : '');
    spans[1].textContent = t(ENV_PERIOD_HOURS[period]);
    card.children[1].textContent = `${limits[period]} dB(A)`;
    card.children[2].textContent = t('гранична стойност');
    if (period === now && Number.isFinite(laeq)) {
      const diff = laeq - limits[period];
      const p = card.querySelector('p');
      p.textContent = diff > 0
        ? t('Сега: {laeq} dB(A) – с {diff} dB над границата', { laeq: laeq.toFixed(1), diff: diff.toFixed(1) })
        : t('Сега: {laeq} dB(A) – в границата', { laeq: laeq.toFixed(1) });
      p.className = 'mt-2 text-sm ' + (diff > 0 ? 'text-crit-ink' : 'text-ink2');
    }
    box.appendChild(card);
  }
}

function updateNorms() {
  if (!NORMS) return;
  const laeq = sessionLaeqA();
  const seconds = Math.max(1, dose.elapsed);
  const lex = Number.isFinite(laeq) ? lex8h(laeq, seconds) : NaN;
  const peak = Number.isFinite(workplace.peak) ? workplace.peak : NaN;
  $('wp-lex').textContent = fmtDb(lex);
  $('wp-peak').textContent = fmtDb(peak);
  $('wp-laeq').textContent = Number.isFinite(laeq) ? `${laeq.toFixed(1)} dB(A)` : '--';
  // Ако цял 8-часов ден е при това ниво, LEX,8h е равно на LAeq
  $('wp-full').textContent = Number.isFinite(laeq) ? `LEX,8h = ${laeq.toFixed(1)} dB(A)` : '--';
  renderWorkplaceLimits(Number.isFinite(lex) ? workplaceReached(lex, peak) : null);
  renderEnvPeriods(laeq);
}
setInterval(() => { if (currentSectionId === 'norms') updateNorms(); }, 1000);

// Изборът на място е общ за „Норми“ и отчетите
function setEnvSelection(value, tonal = envSelection.tonal) {
  const [kind, id] = value.split(':');
  envSelection = { kind, id, tonal };
  store.set('envZone', envSelection);
  $('env-tonal').disabled = kind !== 'room';
  updateNorms();
  if (report) renderReport();
}
$('env-zone').addEventListener('change', (e) => setEnvSelection(e.target.value));
$('env-tonal').addEventListener('change', (e) => setEnvSelection(`${envSelection.kind}:${envSelection.id}`, e.target.checked));

function renderNormsStatic() {
  fillEnvSelect($('env-zone'));
  $('env-tonal').checked = envSelection.tonal;
  $('env-tonal').disabled = envSelection.kind !== 'room';
  updateNorms();
}

loadNorms().then(renderNormsStatic).catch(() => {});
