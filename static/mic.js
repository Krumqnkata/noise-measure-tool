// Микрофонът на това устройство (телефон, таблет) като източник на звука за сървъра,
// плюс инсталиране като приложение (PWA).

const MIC_RATE = 44100;
let browserMic = null;

// Браузърите дават микрофона само в „сигурен“ контекст – https или localhost
const micSupported = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && !!window.AudioWorkletNode;

async function startBrowserMic() {
  // Без автоматично усилване и потискане на шума – иначе измерването няма смисъл
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const ctx = new AudioContext({ sampleRate: MIC_RATE });
  if (ctx.sampleRate !== MIC_RATE) {
    stream.getTracks().forEach((track) => track.stop());
    ctx.close();
    throw new Error(t('Браузърът не поддържа запис при 44.1 kHz.'));
  }
  await ctx.audioWorklet.addModule('/static/mic-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-sender');
  // Възелът трябва да е свързан към изхода, за да работи – но без да се чува
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node).connect(mute).connect(ctx.destination);

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/mic`);
  ws.binaryType = 'arraybuffer';
  const name = stream.getAudioTracks()[0]?.label || t('Микрофон на браузъра');
  ws.onopen = () => ws.send(JSON.stringify({ rate: MIC_RATE, name }));
  node.port.onmessage = (e) => { if (ws.readyState === WebSocket.OPEN) ws.send(e.data); };
  ws.onclose = (e) => {
    if (browserMic?.ws !== ws) return;
    stopBrowserMic();
    if (e.code === 4409) showError(t('Друго устройство вече праща звук.'));
  };
  browserMic = { stream, ctx, ws };
  renderMicState();
}

function stopBrowserMic() {
  if (!browserMic) return;
  const { stream, ctx, ws } = browserMic;
  browserMic = null;
  stream.getTracks().forEach((track) => track.stop());
  ctx.close();
  if (ws.readyState <= WebSocket.OPEN) ws.close();
  renderMicState();
}

function renderMicState() {
  const button = $('mic-toggle');
  button.disabled = !micSupported();
  button.textContent = browserMic ? t('Спри микрофона на това устройство') : t('Използвай микрофона на това устройство');
  button.classList.toggle('btn-primary', !!browserMic);
  $('mic-hint').textContent = !micSupported()
    ? t('Нужна е защитена връзка. Пусни сървъра с „--https“ и отвори адреса с https:// – браузърът ще предупреди веднъж за сертификата.')
    : browserMic
      ? t('Звукът от това устройство се мери на сървъра. Калибрирането се пази отделно за всяко устройство.')
      : t('Подходящо за телефон: мери там, където си, а резултатите и записите остават на сървъра.');
}

$('mic-toggle').addEventListener('click', async () => {
  try {
    if (browserMic) stopBrowserMic();
    else await startBrowserMic();
    showError('');
  } catch (e) {
    stopBrowserMic();
    showError(e.name === 'NotAllowedError' ? t('Достъпът до микрофона е отказан.') : e.message);
  }
});

// ---------- PWA ----------

let installPrompt = null;
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('install-app').hidden = false;
});
$('install-app').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-app').hidden = true;
});

renderMicState();
