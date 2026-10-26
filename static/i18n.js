// Преводи. Ключът е българският текст: в HTML елементите с data-i18n се превеждат
// по съдържанието си, а в JavaScript – с t('текст', {параметри}).
// Ако преводът липсва, остава българският (и ключът се пази в MISSING за проверка).

let lang = store.get('lang', 'bg');
const MISSING = new Set();
const locale = () => (lang === 'en' ? 'en-GB' : 'bg-BG');

function t(text, params) {
  let out = text;
  if (lang === 'en') {
    if (text in EN) out = EN[text];
    else MISSING.add(text);
  }
  return params ? out.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? '')) : out;
}

// Оригиналният (български) текст се пази в data-атрибут, за да може езикът да се сменя многократно
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    if (el.dataset.i18nSrc === undefined) el.dataset.i18nSrc = el.textContent.trim();
    el.textContent = t(el.dataset.i18nSrc);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    for (const attr of el.dataset.i18nAttr.split(',')) {
      const key = `i18n_${attr.replace(/-/g, '_')}`;
      if (el.dataset[key] === undefined) el.dataset[key] = el.getAttribute(attr) || '';
      el.setAttribute(attr, t(el.dataset[key]));
    }
  });
  if (root === document) document.documentElement.lang = lang;
}

const EN = {
  // обвивка и навигация
  'Шумомер': 'Noise Meter',
  'Раздели': 'Sections',
  'Ниво': 'Level',
  'Анализ': 'Analysis',
  'Доза': 'Dose',
  'Записи': 'Records',
  'Аларма': 'Alarm',
  'Настройки': 'Settings',
  'Записва': 'Recording',
  'Норми': 'Norms',
  'Още': 'More',
  'Още раздели': 'More sections',
  'Норми за шум': 'Noise norms',
  'Колко шум си получил и дали са спазени нормите за работно място и околна среда.':
    'How much noise you have received and whether the workplace and environmental norms are met.',
  'Аларма, външен вид, микрофон, калибриране и клавиши.': 'Alarm, appearance, microphone, calibration and keyboard shortcuts.',
  'Общи': 'General',
  'Смени темата': 'Toggle theme',
  'Смени езика': 'Switch language',
  'Старт': 'Start',
  'Стоп': 'Stop',
  'Свързване…': 'Connecting…',
  'Свързано': 'Connected',
  'Няма връзка': 'Disconnected',
  'Светла': 'Light',
  'Тъмна': 'Dark',

  // Ниво
  'Ниво на шума': 'Noise level',
  'Колко е шумно сега и на какво прилича.': 'How loud it is right now and what it sounds like.',
  'Честотно претегляне': 'Frequency weighting',
  'A – както чува човешкото ухо': 'A – how the human ear hears',
  'C – включва и ниските честоти': 'C – includes the low frequencies',
  'Z – без претегляне': 'Z – no weighting',
  'Времево претегляне': 'Time weighting',
  'Бързо – 125 ms': 'Fast – 125 ms',
  'Бавно – 1 s': 'Slow – 1 s',
  'Снимка': 'Snapshot',
  'Запази картинка (S)': 'Save an image (S)',
  'Цял екран': 'Full screen',
  'Цял екран (F)': 'Full screen (F)',
  'Няма данни': 'No data',
  'Прилича на': 'Sounds like',
  'Подробно в „Анализ“': 'Details in Analysis',
  'Чува се': 'Hearing',
  'Мин': 'Min',
  'Средно': 'Average',
  'Макс': 'Max',
  'Пик': 'Peak',
  'Честота': 'Frequency',
  'Надвишено 10% от времето – шумните моменти': 'Exceeded 10% of the time – the loud moments',
  'Медиана': 'Median',
  'Надвишено 90% от времето – фонът': 'Exceeded 90% of the time – the background',
  'Сесия': 'Session',
  'Нулиране (R)': 'Reset (R)',
  'Нулирай статистиката': 'Reset statistics',
  'за последната минута': 'over the last minute',
  'Скала на шума': 'Noise scale',
  'Маркерът показва къде е текущото ниво.': 'The marker shows where the current level is.',
  'около {db} dB': 'about {db} dB',
  'преди {s} s': '{s} s ago',
  'сега': 'now',
  'Още няма измерване.': 'No measurement yet.',
  'последната минута': 'last minute',

  // нива и познати звуци
  'Тихо': 'Quiet',
  'Умерено шумно': 'Moderately loud',
  'Шумно': 'Loud',
  'Много шумно': 'Very loud',
  'Праг на чуваемост': 'Threshold of hearing',
  'Дишане': 'Breathing',
  'Шумолене на листа': 'Rustling leaves',
  'Шепот': 'Whisper',
  'Тиха библиотека': 'Quiet library',
  'Умерен дъжд, хладилник': 'Moderate rain, fridge',
  'Нормален разговор': 'Normal conversation',
  'Прахосмукачка': 'Vacuum cleaner',
  'Натоварен трафик': 'Heavy traffic',
  'Метро, косачка': 'Subway, lawn mower',
  'Мотоциклет, бормашина': 'Motorcycle, power drill',
  'Рок концерт, клаксон': 'Rock concert, car horn',
  'Сирена, гръмотевица': 'Siren, thunder',
  'Къртач – праг на болка': 'Jackhammer – pain threshold',
  'Реактивен двигател': 'Jet engine',

  // разпознаване
  'Хора и гласове': 'People and voices',
  'Музика': 'Music',
  'Куче': 'Dog',
  'Животни': 'Animals',
  'Трафик': 'Traffic',
  'Ремонт и инструменти': 'Construction and tools',
  'Сирена или аларма': 'Siren or alarm',
  'Природа': 'Nature',
  'Домакинство': 'Household',
  'Удари и трясъци': 'Bangs and crashes',
  'Шум и бучене': 'Noise and hum',
  'Тишина': 'Silence',
  'Не е ясно': 'Unclear',
  'Разпознаване на звука': 'Sound recognition',
  'Модел YAMNet (Google, 521 вида звуци) слуша последната секунда и казва какво чува.':
    'The YAMNet model (Google, 521 sound types) listens to the last second and says what it hears.',
  'Сега се чува': 'Now hearing',
  'сигурност {pct}': '{pct} confidence',
  'Модел:': 'Model:',
  'Моделът се зарежда…': 'Loading the model…',
  'Свалям модела за разпознаване (~4 MB)…': 'Downloading the recognition model (~4 MB)…',
  'Работи. Моделът е YAMNet на Google (AudioSet, 521 вида звуци, лиценз Apache 2.0).':
    'Running. The model is Google’s YAMNet (AudioSet, 521 sound types, Apache 2.0 license).',
  'Изключено – липсва библиотеката. Инсталирай я с „pip install -r requirements-ml.txt“ и рестартирай сървъра.':
    'Off – the library is missing. Install it with “pip install -r requirements-ml.txt” and restart the server.',
  'Изключено с флага --no-classifier.': 'Turned off with the --no-classifier flag.',
  'Грешка: {error}': 'Error: {error}',
  'Няма разпознаване': 'No recognition',
  'моделът се сваля…': 'downloading the model…',

  // Анализ
  'Анализ на звука': 'Sound analysis',
  'Какво се чува, как е разпределен звукът по честоти и как се мени във времето.':
    'What can be heard, how the sound is spread across frequencies and how it changes over time.',
  'Спектър': 'Spectrum',
  'Задръж максимума': 'Hold maximum',
  'Сега': 'Now',
  'Максимум': 'Maximum',
  'максимум': 'maximum',
  'Форма на вълната': 'Waveform',
  'усилено ×{n}': 'amplified ×{n}',
  'Третинооктавни ленти': 'Third-octave bands',
  'Непретеглено ниво във всяка от 31 честотни ленти.': 'Unweighted level in each of 31 frequency bands.',
  'Графика': 'Chart',
  'Таблица': 'Table',
  'ниво': 'level',
  'Спектрограма': 'Spectrogram',
  'Последните ~30 секунди: честота отдолу нагоре, време отляво надясно.':
    'The last ~30 seconds: frequency from bottom to top, time from left to right.',

  // Доза
  'Шумова доза': 'Noise dose',
  'Каква част от допустимия шум за 8-часов ден си получил от началото на сесията. Смята се по LAS – A-претегляне, бавен отклик.':
    'How much of the allowed noise for an 8-hour day you have received since the session started. Based on LAS – A-weighting, slow response.',
  '85 dB за 8 часа; всеки 3 dB отгоре намаляват времето наполовина.': '85 dB for 8 hours; every 3 dB more halves the time.',
  '90 dB за 8 часа; всеки 5 dB отгоре намаляват времето наполовина.': '90 dB for 8 hours; every 5 dB more halves the time.',
  'Средно за 8 ч (TWA)': '8-hour average (TWA)',
  'Прогноза за 8 ч': '8-hour projection',
  'Измерено време': 'Measured time',
  'Нулирай сесията': 'Reset session',
  'Колко време е безопасно': 'How long is safe',
  'Допустимо време на ден при постоянно ниво. Редът с текущото ниво е отбелязан.':
    'Allowed time per day at a constant level. The row for the current level is highlighted.',
  'Пример': 'Example',
  'Дневната доза по NIOSH е надвишена – ползвай защита за слуха или намали шума.':
    'The daily NIOSH dose is exceeded – use hearing protection or reduce the noise.',
  'При {L} dB(A) няма ограничение във времето – под {thr} dB не се брои.':
    'At {L} dB(A) there is no time limit – levels below {thr} dB are not counted.',
  'При {L} dB(A) остават около {time}, докато стигнеш дневния лимит по NIOSH.':
    'At {L} dB(A) you have about {time} left before reaching the daily NIOSH limit.',
  '{s} s': '{s} s',
  '{h} ч {m} мин': '{h} h {m} min',
  '{m} мин': '{m} min',

  // Записи
  'Запази измерване и виж отчет за него: средни нива, източници, доза, време над праг.':
    'Save a measurement and see a report for it: average levels, sources, dose, time above threshold.',
  'Име на записа, напр. „Спалня, нощ“': 'Recording name, e.g. “Bedroom, night”',
  '● Започни запис': '● Start recording',
  '■ Спри записа': '■ Stop recording',
  'Всяка секунда се пазят LAeq, LAFmax и LAFmin, LCeq, LZeq, пикът и разпознатият източник.':
    'Every second the app saves LAeq, LAFmax and LAFmin, LCeq, LZeq, the peak and the recognized source.',
  'Всички записи': 'All records',
  'Преименувай': 'Rename',
  'Бележка': 'Note',
  'Печат': 'Print',
  'Изтрий': 'Delete',
  'Още няма измервания в този запис.': 'No measurements in this record yet.',
  'Средното ниво прилича на': 'The average level sounds like',
  'Ниво във времето': 'Level over time',
  'LAeq за секунда': 'LAeq per second',
  'Време над праг': 'Time above threshold',
  'Разпределение на нивата': 'Level distribution',
  'Процент от времето във всеки интервал от 2 dB.': 'Percent of the time in each 2 dB interval.',
  'Какво се е чувало': 'What was heard',
  'Дял от времето по разпознат източник.': 'Share of the time by recognized source.',
  'От едносекундните LAeq; нивата под 80 dB не се броят.': 'From the 1-second LAeq values; levels below 80 dB are not counted.',
  'Събития от алармата': 'Alarm events',
  'Начало': 'Start',
  'Продължение': 'Duration',
  'Продължителност': 'Duration',
  'Праг': 'Threshold',
  'Макс.': 'Max',
  'Офсет': 'Offset',
  'Микрофон': 'Microphone',
  'Демо сигнал': 'Demo signal',
  'Запис {date}': 'Recording {date}',
  'Още няма записи. Въведи име горе и натисни „Започни запис“.': 'No records yet. Enter a name above and press “Start recording”.',
  'записва, {time}': 'recording, {time}',
  'Избери запис от списъка, за да видиш отчета.': 'Pick a record from the list to see its report.',
  '{time}, записва се': '{time}, recording',
  'Средно A-претеглено ниво за целия запис': 'Average A-weighted level for the whole record',
  'Най-високият моментен пик, без претегляне': 'The highest instantaneous peak, unweighted',
  '{name}, около {db} dB': '{name}, about {db} dB',
  'Най-шумно в {time}: {db} dB': 'Loudest at {time}: {db} dB',
  'Голямата разлика показва много нискочестотен шум – бучене, вентилация, бас.':
    'The large difference indicates a lot of low-frequency noise – hum, ventilation, bass.',
  'Няма изразен нискочестотен шум.': 'No pronounced low-frequency noise.',
  'Над {thr} dB': 'Above {thr} dB',
  'Няма данни – разпознаването не е било включено по време на записа.': 'No data – recognition was not running during this recording.',
  '{label}: {crit} dB за 8 ч, през {ex} dB': '{label}: {crit} dB for 8 h, {ex} dB exchange rate',
  'TWA {twa}, прогноза за 8 ч {proj}%': 'TWA {twa}, 8-hour projection {proj}%',
  'Няма събития в този запис.': 'No events in this record.',
  'продължава': 'ongoing',
  'Ново име на записа:': 'New record name:',
  'Бележка към записа – място, източник на шума…': 'Note for the record – place, noise source…',
  'Да изтрия ли „{name}“? Това не може да се върне.': 'Delete “{name}”? This cannot be undone.',

  // Аларма
  'Сигнал, когато шумът остане над прага. Всяко превишаване се записва.':
    'A signal when the noise stays above the threshold. Every exceedance is logged.',
  'Следи LAF – A-претегляне, бърз отклик.': 'Watches LAF – A-weighting, fast response.',
  'Праг, dB': 'Threshold, dB',
  'Поне, секунди': 'For at least, seconds',
  'Запази': 'Save',
  'Звуков сигнал в браузъра': 'Sound signal in the browser',
  'Разреши известия': 'Allow notifications',
  'Звукът започва след първото докосване на страницата – така работят браузърите. Известията действат само на localhost.':
    'The sound starts after you first tap the page – that is how browsers work. Notifications only work on localhost.',
  'Последни събития': 'Recent events',
  'Шумът е над {thr} dB от {time}, най-много {max} dB.': 'Noise has been above {thr} dB since {time}, peaking at {max} dB.',
  'Шумомер: превишен праг': 'Noise Meter: threshold exceeded',
  'Нивото е над {thr} dB ({max} dB).': 'The level is above {thr} dB ({max} dB).',
  'Още няма събития. Когато шумът мине прага, ще се появят тук.': 'No events yet. They will appear here when the noise crosses the threshold.',
  '{max} dB за {time}': '{max} dB for {time}',

  // Настройки
  'Външен вид, микрофон, калибриране и клавиши.': 'Appearance, microphone, calibration and keyboard shortcuts.',
  'Външен вид': 'Appearance',
  'Тема': 'Theme',
  'Системна': 'System',
  'Език': 'Language',
  'Входно устройство': 'Input device',
  'Калибриране': 'Calibration',
  'Звуковата карта мери спрямо своя максимум (dBFS), затова към стойностите се добавя офсет. Типичният е за микрофоните в телефони и лаптопи.':
    'The sound card measures relative to its own maximum (dBFS), so an offset is added to the values. The typical one fits the microphones in phones and laptops.',
  'Офсет, dB': 'Offset, dB',
  'Приложи': 'Apply',
  'Типичен ({n})': 'Typical ({n})',
  'По еталонен шумомер': 'Using a reference meter',
  'Сложи го до микрофона, пусни постоянен шум и въведи какво показва (в избраното претегляне). Офсетът се смята от последните 3 секунди.':
    'Put it next to the microphone, play a steady noise and enter its reading (in the selected weighting). The offset is calculated from the last 3 seconds.',
  'напр. 72.5': 'e.g. 72.5',
  'Калибрирай': 'Calibrate',
  'Клавиши': 'Keyboard shortcuts',
  'Интервал': 'Space',
  'старт и стоп': 'start and stop',
  'смяна на раздела': 'switch section',
  'цял екран': 'full screen',
  'нулиране на сесията': 'reset the session',
  'снимка': 'snapshot',
  'смяна на темата': 'toggle theme',
  'За приложението': 'About',
  'Ориентировъчен шумомер – полезен е за сравнение и наблюдение, но не замества сертифициран уред.':
    'An indicative sound level meter – useful for comparing and monitoring, but not a replacement for a certified instrument.',
  'Код:': 'Code:',
  'Затвори': 'Close',
  'Демо режим: сигналът е симулиран, микрофонът не се ползва.': 'Demo mode: the signal is simulated and the microphone is not used.',
  'Звукът се записва от микрофона на компютъра, на който върви сървърът.': 'Sound is captured from the microphone of the computer running the server.',
  'По подразбиране (системният)': 'Default (system)',
  'Демо сигнал (симулация)': 'Demo signal (simulated)',
  'системен': 'system default',
  'Няма намерени микрофони': 'No microphones found',
  'Списъкът с микрофони не се зареди: {error}': 'Could not load the microphone list: {error}',
  'Въведи число за офсета.': 'Enter a number for the offset.',
  'Въведи какво показва еталонният шумомер.': 'Enter the reading of the reference meter.',
  'Още няма достатъчно данни. Пусни измерването и изчакай няколко секунди.': 'Not enough data yet. Start measuring and wait a few seconds.',

  // грешки от сървъра
  'Невалидна стойност.': 'Invalid value.',
  'В демо режим микрофонът не може да се сменя.': 'The microphone can’t be changed in demo mode.',
  'Микрофонът не може да се отвори: {error}': 'The microphone can’t be opened: {error}',
  'Офсетът трябва да е между −200 и 200 dB.': 'The offset must be between −200 and 200 dB.',
  'Измерването не може да започне: {error}': 'Measuring can’t start: {error}',
  'Няма такъв запис.': 'No such record.',
  'Името не може да е празно.': 'The name can’t be empty.',
  'Първо спри записа.': 'Stop the recording first.',
};
