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

  // Етап 1 – стандарти
  'Импулс – 35 ms нагоре, 1.5 s надолу': 'Impulse – 35 ms rise, 1.5 s decay',
  'Шум на работното място': 'Workplace noise',
  'Директива 2003/10/ЕО и Наредба № 6 от 2005 г. Дневната експозиция LEX,8h пренася средното ниво към 8-часов работен ден.':
    'Directive 2003/10/EC (Bulgarian Ordinance No. 6 of 2005). The daily exposure LEX,8h normalizes the average level to an 8-hour working day.',
  'за измереното време': 'for the measured time',
  'най-високият пик': 'highest peak',
  'LAeq на сесията': 'Session LAeq',
  'Ако така е целият ден': 'If the whole day were like this',
  'Долни стойности за действие': 'Lower exposure action values',
  'Горни стойности за действие': 'Upper exposure action values',
  'Гранични стойности': 'Exposure limit values',
  'Работодателят осигурява антифони, информация и обучение; аудиометрия при поискване.':
    'The employer provides hearing protection, information and training; audiometric testing on request.',
  'Антифоните са задължителни; програма от мерки срещу шума; зоната се обозначава.':
    'Hearing protection is mandatory; a noise-reduction programme is required; the area is marked.',
  'Не бива да се превишават дори с антифоните – нужни са незабавни мерки.':
    'Must not be exceeded even with hearing protection – immediate action is required.',
  'достигнати': 'reached',
  'Шум в околната среда': 'Environmental noise',
  'Наредба № 6 от 2006 г. Границата зависи от мястото и от частта на денонощието: ден 7–19 ч, вечер 19–23 ч, нощ 23–7 ч.':
    'Bulgarian Ordinance No. 6 of 2006 (Directive 2002/49/EC). The limit depends on the place and the time of day: day 7–19 h, evening 19–23 h, night 23–7 h.',
  'Място': 'Place',
  'Тонален или импулсен шум (−5 dB в помещения)': 'Tonal or impulsive noise (−5 dB indoors)',
  'Сравнението тук е със средното ниво на текущата сесия. За официална оценка запиши целия период – отчетът показва Lден, Lвечер, Lнощ и Lden.':
    'This compares the average level of the current session. For an official assessment record the whole period – the report shows Lday, Levening, Lnight and Lden.',
  'Територии': 'Territories',
  'Помещения (проникващ шум)': 'Rooms (noise coming from outside)',
  'Жилищни зони и територии': 'Residential areas',
  'Смесени централни градски части': 'Mixed central city areas',
  'Територии с интензивен автомобилен трафик': 'Areas with heavy road traffic',
  'Територии с релсов железопътен и трамваен транспорт': 'Areas exposed to rail and tram traffic',
  'Територии с авиационен шум': 'Areas exposed to aircraft noise',
  'Производствено-складови територии и зони': 'Industrial and warehouse areas',
  'Зони за обществен и индивидуален отдих': 'Public and private recreation areas',
  'Зони за лечебни заведения': 'Hospital and healthcare areas',
  'Зони за научноизследователска и учебна дейност': 'Research and education areas',
  'Тихи зони извън урбанизираните територии': 'Quiet areas outside urban territories',
  'Стаи и операционни зали в лечебни заведения': 'Hospital wards and operating rooms',
  'Жилищни стаи, спални, хотелски стаи': 'Living rooms, bedrooms, hotel rooms',
  'Лекарски кабинети, конферентни и зрителни зали': 'Doctors’ offices, conference rooms, auditoriums',
  'Класни стаи, аудитории, читални': 'Classrooms, lecture halls, reading rooms',
  'Работни помещения в административни сгради': 'Offices in administrative buildings',
  'Заведения за хранене, фоайета, салони': 'Restaurants, foyers, salons',
  'Търговски зали, зали за пътници в гари': 'Shops, station waiting halls',
  'Ден': 'Day',
  'Вечер': 'Evening',
  'Нощ': 'Night',
  '7–19 ч': '7–19 h',
  '19–23 ч': '19–23 h',
  '23–7 ч': '23–7 h',
  'гранична стойност': 'limit value',
  'Сега: {laeq} dB(A) – с {diff} dB над границата': 'Now: {laeq} dB(A) – {diff} dB above the limit',
  'Сега: {laeq} dB(A) – в границата': 'Now: {laeq} dB(A) – within the limit',
  'Фонов шум в помещение: NR и NC': 'Room background noise: NR and NC',
  'Оценка на постоянния шум (вентилация, климатици, хладилници) по октави, осреднено за ~3 s. По-ниското е по-тихо.':
    'Rating of steady noise (ventilation, air conditioners, fridges) by octave band, averaged over ~3 s. Lower is quieter.',
  'Ориентири: спалня NR 25–30, жилище NR 30–35, офис NR 35–40, ресторант NR 40–45, цех NR 50–60.':
    'Typical targets: bedroom NR 25–30, home NR 30–35, office NR 35–40, restaurant NR 40–45, workshop NR 50–60.',
  'октава': 'octave',
  'Статистически нива:': 'Statistical levels:',
  'LAeq по интервали': 'LAeq by interval',
  'Работно място': 'Workplace',
  'Директива 2003/10/ЕО; LEX,8h за времето на излагане.': 'Directive 2003/10/EC; LEX,8h for the exposure time.',
  'Време на излагане, ч': 'Exposure time, h',
  'Околна среда': 'Environment',
  'Наредба № 6 от 2006 г. – сравнение с избраното място.': 'Ordinance No. 6 of 2006 – compared with the selected place.',
  'Период': 'Period',
  'Граница': 'Limit',
  'Покритие': 'Coverage',
  'Максимум с времево претегляне Impulse': 'Maximum with Impulse time weighting',
  'Най-високият пик с C-претегляне – за работното място': 'Highest C-weighted peak – for the workplace',
  'Звукова експозиция: цялата енергия на записа, сведена до 1 s (LAE)': 'Sound exposure level: all the energy of the record condensed into 1 s (LAE)',
  'Под долните стойности за действие (80 dB(A) и 135 dB(C)).': 'Below the lower exposure action values (80 dB(A) and 135 dB(C)).',
  'Lden изисква данни и за трите периода – направи запис за цяло денонощие.': 'Lden needs data for all three periods – record a full 24 hours.',

  // График и сън
  'Записи по график': 'Scheduled recordings',
  'Записът започва и спира сам в избраните часове – напр. всяка нощ, за отчет за съня. Сървърът трябва да е пуснат.':
    'Recording starts and stops by itself at the chosen times – e.g. every night, for a sleep report. The server has to be running.',
  '+ Всяка нощ 23:00–07:00': '+ Every night 23:00–07:00',
  'Име': 'Name',
  'напр. Спалня': 'e.g. Bedroom',
  'Дни': 'Days',
  'От': 'From',
  'До': 'To',
  'Добави': 'Add',
  'Пн': 'Mon', 'Вт': 'Tue', 'Ср': 'Wed', 'Чт': 'Thu', 'Пт': 'Fri', 'Сб': 'Sat', 'Нд': 'Sun',
  'всеки ден': 'every day',
  'делнични дни': 'weekdays',
  'събота и неделя': 'weekends',
  'Няма график.': 'No schedules.',
  'Да изтрия ли графика „{name}“?': 'Delete the schedule “{name}”?',
  'Избери поне един ден.': 'Pick at least one day.',
  'Отчетът е готов': 'The report is ready',
  'Записът „{name}“ приключи.': 'The recording “{name}” has finished.',
  'Началото и краят на графика не може да съвпадат.': 'The schedule start and end can’t be the same.',
  'Сън': 'Sleep',
  'По насоките на СЗО: в спалнята LAFmax до 45 dB(A) – не повече от 10–15 пъти на нощ; средното ниво навън Lnight – до 40 dB.':
    'Following WHO guidance: in the bedroom LAFmax up to 45 dB(A) – no more than 10–15 times a night; the average outdoor level Lnight up to 40 dB.',
  'Тиха нощ – нито едно събитие над {thr} dB(A).': 'A quiet night – no events above {thr} dB(A).',
  '{n} шумни събития над {thr} dB(A) – в препоръката на СЗО (до 10–15).': '{n} noise events above {thr} dB(A) – within the WHO guidance (up to 10–15).',
  '{n} шумни събития над {thr} dB(A) – повече от препоръчаните 10–15; сънят може да е нарушен.':
    '{n} noise events above {thr} dB(A) – more than the recommended 10–15; sleep may be disturbed.',
  'неразпознат източник': 'unrecognized source',

  // Микрофон на устройството и PWA
  'Браузърът не поддържа запис при 44.1 kHz.': 'This browser can’t record at 44.1 kHz.',
  'Микрофон на браузъра': 'Browser microphone',
  'Друго устройство вече праща звук.': 'Another device is already sending audio.',
  'Спри микрофона на това устройство': 'Stop this device’s microphone',
  'Използвай микрофона на това устройство': 'Use this device’s microphone',
  'Нужна е защитена връзка. Пусни сървъра с „--https“ и отвори адреса с https:// – браузърът ще предупреди веднъж за сертификата.':
    'A secure connection is needed. Start the server with “--https” and open the https:// address – the browser will warn about the certificate once.',
  'Звукът от това устройство се мери на сървъра. Калибрирането се пази отделно за всяко устройство.':
    'Sound from this device is measured on the server. Calibration is stored separately for each device.',
  'Подходящо за телефон: мери там, където си, а резултатите и записите остават на сървъра.':
    'Handy on a phone: measure wherever you are, while results and recordings stay on the server.',
  'Достъпът до микрофона е отказан.': 'Microphone access was denied.',
  'Звукът идва от микрофона на свързано устройство: {name}.': 'Sound comes from the microphone of a connected device: {name}.',
  'Приложение': 'App',
  'Шумомерът може да се инсталира и да се отваря като отделно приложение – с икона и на цял екран. На iPhone: Сподели → „Добави към началния екран“.':
    'The noise meter can be installed and opened as a separate app – with an icon and full screen. On iPhone: Share → “Add to Home Screen”.',
  'Инсталирай': 'Install',

  // Табло
  'Табло': 'Dashboard',
  '7 дни': '7 days',
  '30 дни': '30 days',
  '90 дни': '90 days',
  'Кога е шумно': 'When it gets loud',
  'LAeq за всеки час от всеки ден. По-наситеното е по-шумно; празното – без запис.':
    'LAeq for every hour of every day. Stronger color is louder; empty means no recording.',
  'Прогноза за следващите 24 часа': 'Forecast for the next 24 hours',
  'Типичното ниво за този час и ден от седмицата – медиана и обхват 10–90%.':
    'The typical level for that hour and day of the week – median and 10–90% range.',
  'Какво се чува по часове': 'What is heard by hour',
  'Най-често разпознатият източник за всеки час от денонощието.': 'The most often recognized source for each hour of the day.',
  'Сравнение на два записа': 'Compare two records',
  'По хоризонтала – минути от началото на всеки запис.': 'Horizontal axis – minutes from the start of each record.',
  'Данни от {n} дни с записи за последните {days} дни.': 'Data from {n} days with recordings in the last {days} days.',
  'LAeq за {m} мин': 'LAeq over {m} min',
  'Още няма записи в този период.': 'No recordings in this period yet.',
  'типично': 'typical',
  'обхват 10–90%': '10–90% range',
  'Прогнозата се появява след поне 7 дни със записи (сега: {n}). Записите по график са най-лесният начин.':
    'The forecast appears after at least 7 days with recordings (now: {n}). Scheduled recordings are the easiest way.',
  'Няма разпознати източници в този период.': 'No recognized sources in this period.',
  'няма данни': 'no data',
  '{m} мин от началото': '{m} min from the start',

  // Протокол (PDF)
  'Протокол (PDF)': 'Report (PDF)',
  'Протокол от измерване на шум': 'Noise measurement report',
  '← Обратно към записа': '← Back to the record',
  'Запази като PDF / Печат': 'Save as PDF / Print',
  '1. Данни за измерването': '1. Measurement details',
  'Измерването е направено с ориентировъчен софтуерен шумомер, а не със сертифициран уред клас 1 или 2 по IEC 61672. Стойностите са подходящи за сравнение и като допълнение към жалба, но не заместват официално измерване от акредитирана лаборатория или РЗИ.':
    'The measurement was made with an indicative software sound level meter, not a certified IEC 61672 class 1 or 2 instrument. The values are suitable for comparison and as supporting material for a complaint, but do not replace an official measurement by an accredited laboratory or the health authority.',
  '2. Резултати': '2. Results',
  '3. Ниво във времето': '3. Level over time',
  '4. Сравнение с Наредба № 6 от 2006 г.': '4. Comparison with Ordinance No. 6 of 2006',
  'Гранична стойност': 'Limit value',
  'Разлика': 'Difference',
  '5. Шум през нощта (насоки на СЗО)': '5. Night-time noise (WHO guidance)',
  'Час': 'Time',
  'Източник': 'Source',
  '6. Шум на работното място (Директива 2003/10/ЕО)': '6. Workplace noise (Directive 2003/10/EC)',
  '7. Разпознати източници': '7. Recognized sources',
  '8. Събития над прага на алармата': '8. Events above the alarm threshold',
  '9. Подпис': '9. Signature',
  'Измерил (име)': 'Measured by (name)',
  'Подпис': 'Signature',
  'Дата': 'Date',
  'Край': 'End',
  'Място и бележки': 'Place and notes',
  'Калибрационен офсет': 'Calibration offset',
  'Еквивалентно A-претеглено ниво за целия запис': 'Equivalent A-weighted level for the whole record',
  'Максимум и минимум (Fast)': 'Maximum and minimum (Fast)',
  'Максимум (Impulse)': 'Maximum (Impulse)',
  'Най-висок пик (C / без претегляне)': 'Highest peak (C / unweighted)',
  'Статистически нива': 'Statistical levels',
  'Звукова експозиция': 'Sound exposure level',
  'Място:': 'Place:',
  'тонален или импулсен шум': 'tonal or impulsive noise',
  'Събития с LAFmax ≥ {thr} dB(A): {n} (препоръка на СЗО – до 10–15 на нощ в спалнята). LAeq за записа: {laeq} dB(A).':
    'Events with LAFmax ≥ {thr} dB(A): {n} (WHO guidance – up to 10–15 a night in the bedroom). LAeq of the record: {laeq} dB(A).',
  'LEX,8h за времето на записа: {lex} dB(A); LCpeak: {peak} dB(C). {status}': 'LEX,8h for the recording time: {lex} dB(A); LCpeak: {peak} dB(C). {status}',

  // Помещение
  'Помещение': 'Room',
  'Акустика на помещението': 'Room acoustics',
  'Време на реверберация RT60 – колко секунди трябват на звука да затихне с 60 dB. Мери се с плясък или спукан балон (ISO 3382-2).':
    'Reverberation time RT60 – how many seconds it takes the sound to decay by 60 dB. Measured with a clap or a popping balloon (ISO 3382-2).',
  'Как се мери': 'How to measure',
  'Затвори вратите и прозорците и пази тишина.': 'Close the doors and windows and keep quiet.',
  'Застани в средата на стаята, далеч от стените.': 'Stand in the middle of the room, away from the walls.',
  'Натисни „Измери“ и до 15 секунди пляскай силно веднъж (или спукай балон).': 'Press “Measure” and within 15 seconds clap loudly once (or pop a balloon).',
  'Не говори още 3 секунди, докато звукът затихне.': 'Stay silent for 3 more seconds while the sound decays.',
  'Измери': 'Measure',
  'Време на реверберация (500 Hz – 1 kHz)': 'Reverberation time (500 Hz – 1 kHz)',
  'Затихване по октави': 'Decay by octave band',
  'Кривата на Шрьодер; T20 се смята между −5 и −25 dB, T30 – между −5 и −35 dB.':
    'Schroeder decay curve; T20 is evaluated between −5 and −25 dB, T30 between −5 and −35 dB.',
  'Октава': 'Octave',
  'Обхват над шума': 'Range above noise',
  'Звукозапис, домашно студио': 'Recording, home studio',
  'Спалня': 'Bedroom',
  'Хол, класна стая': 'Living room, classroom',
  'Офис': 'Office',
  'Ресторант': 'Restaurant',
  'Концертна зала': 'Concert hall',
  'Плясъкът беше твърде слаб спрямо шума в стаята. Опитай по-силно или в по-тиха обстановка.':
    'The clap was too weak compared with the room noise. Try louder or somewhere quieter.',
  'Подходящо за: {list}.': 'Suitable for: {list}.',
  'Много „сухо“ – като на открито или в силно заглушена стая.': 'Very “dry” – like outdoors or a heavily damped room.',
  'Много „ехтящо“ – помагат килими, завеси, мека мебел, панели.': 'Very “echoey” – rugs, curtains, soft furniture and panels help.',
  'Демо: симулирам плясък…': 'Demo: simulating a clap…',
  'Пляскай сега – чакам до 15 s…': 'Clap now – waiting up to 15 s…',
  'Готово.': 'Done.',
  'Първо пусни измерването (бутона Старт).': 'Start measuring first (the Start button).',
  'Вече тече измерване – изчакай го.': 'A measurement is already running – wait for it.',
  'Не долових плясък. Пляскай по-силно и по-близо до микрофона.': 'No clap detected. Clap louder and closer to the microphone.',
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
