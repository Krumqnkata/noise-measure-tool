// Общо състояние, което ползват всички раздели

let latest = null;          // последният кадър от сървъра
let dirty = true;           // графиките трябва да се прерисуват
let calOffset = 0;
let defaultCalibration = 120;
let running = false;
let demoMode = false;
let recording = null;
let weighting = store.get('weighting', 'A');
let timeWeighting = store.get('timeWeighting', 'F');

const markDirty = () => { dirty = true; };
const currentLevel = (m) => m.levels[weighting][timeWeighting];
const metricName = () => `L${weighting}${timeWeighting}`;
const unitName = () => (weighting === 'Z' ? 'dB' : `dB(${weighting})`);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
