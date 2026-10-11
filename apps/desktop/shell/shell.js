// Trusted shell renderer. Plain JS (no bundler) under a strict CSP.
'use strict';

const api = window.frontier;
const log = document.getElementById('log');
const logList = document.getElementById('log-list');
const alerts = document.getElementById('alerts');
const form = document.getElementById('command-form');
const input = document.getElementById('command');
const talk = document.getElementById('talk');

let profile = 'voice';
let rate = 1;
const history = [];
let historyIndex = -1;

// ---- Transcript ---------------------------------------------------------------

const SOURCE_LABEL = { browser: 'Frontier', page: 'Page', ai: 'AI' };

function addEntry(a) {
  const li = document.createElement('li');
  li.className = `${a.source} ${a.kind}`;
  if (a.lang) li.lang = a.lang;
  const src = document.createElement('span');
  src.className = 'src';
  // The source label is rendered by the browser, outside any page's reach (AR-1).
  src.textContent = a.kind === 'confirm' && a.source === 'browser' ? 'Frontier asks:' : `${SOURCE_LABEL[a.source] || 'Frontier'}:`;
  const body = a.source === 'page' && typeof a.display === 'string' && a.display.startsWith('The page says: ') ? a.display : a.text;
  li.append(src, document.createTextNode(body));
  logList.append(li);
  while (logList.children.length > 500) logList.firstElementChild.remove();
  li.scrollIntoView({ block: 'end' });
  if (profile !== 'voice' && (a.kind === 'alert' || a.kind === 'confirm' || a.kind === 'error')) {
    alerts.textContent = '';
    alerts.textContent = `${src.textContent} ${a.text}`;
  }
}

function addUser(text) {
  const li = document.createElement('li');
  li.className = 'user';
  li.textContent = `You: ${text}`;
  logList.append(li);
}

function applyProfile() {
  // Voice users: we speak, so the log must not ALSO be announced (double speech).
  // Screen-reader/braille users: the log is a polite live region; we stay silent.
  log.setAttribute('aria-live', profile === 'voice' ? 'off' : 'polite');
}

// ---- Earcons (browser messages only; pages can't trigger them) -------------------

let audioCtx = null;
function earcon(kind) {
  if (profile === 'braille') return Promise.resolve();
  audioCtx = audioCtx || new AudioContext();
  const tones = { confirm: [660, 880], alert: [440, 330], listen: [520], done: [780] }[kind];
  if (!tones) return Promise.resolve();
  let t = audioCtx.currentTime;
  for (const f of tones) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + 0.13);
    t += 0.14;
  }
  return new Promise((r) => setTimeout(r, tones.length * 140));
}

// ---- Speech output with priority and barge-in ------------------------------------

const PRIORITY = { alert: 0, confirm: 0, error: 1, info: 2, list: 2, hint: 3, content: 4 };
const queue = [];
let speaking = false;

function voiceFor(lang) {
  const voices = speechSynthesis.getVoices();
  if (!lang) return undefined;
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) || voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
}

function spokenText(a) {
  // Framing is computed in the main process (page impersonation reframed).
  return typeof a.spoken === 'string' ? a.spoken : a.text;
}

async function pump() {
  if (speaking) return;
  speaking = true;
  while (queue.length) {
    const item = queue.shift();
    if (item.a.source === 'browser' && (item.a.kind === 'confirm' || item.a.kind === 'alert')) await earcon(item.a.kind);
    const result = await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(spokenText(item.a));
      u.rate = rate;
      // Page content in a slightly different voice than Frontier's own words.
      if (item.a.source === 'page') u.pitch = 0.85;
      const v = voiceFor(item.a.lang);
      if (v) u.voice = v;
      if (item.a.lang) u.lang = item.a.lang;
      u.onend = () => resolve('done');
      u.onerror = () => resolve('interrupted');
      item.cancel = () => resolve('interrupted');
      speechSynthesis.speak(u);
    });
    api.delivered(item.id, result);
  }
  speaking = false;
}

function interruptSpeech() {
  speechSynthesis.cancel();
  for (const q of queue.splice(0)) api.delivered(q.id, 'interrupted');
}

api.onAnnounce((id, a) => {
  addEntry(a);
  if (profile !== 'voice') {
    // The screen reader or braille display delivers it; the log is the channel.
    api.delivered(id, 'done');
    return;
  }
  const p = PRIORITY[a.kind] ?? 2;
  const idx = queue.findIndex((q) => (PRIORITY[q.a.kind] ?? 2) > p);
  if (idx === -1) queue.push({ id, a });
  else queue.splice(idx, 0, { id, a });
  pump();
});
api.onInterrupt(interruptSpeech);
api.onRate((d) => {
  rate = d === 'reset' ? 1 : Math.min(3, Math.max(0.5, rate + d));
});
api.onFocusCommand(() => input.focus());

// ---- Commands ----------------------------------------------------------------------

async function send(text) {
  const t = text.trim();
  if (!t) return;
  addUser(t);
  history.unshift(t);
  historyIndex = -1;
  await api.command(t);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = input.value;
  input.value = '';
  interruptSpeech();
  send(t);
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && history.length) {
    historyIndex = Math.min(history.length - 1, historyIndex + 1);
    input.value = history[historyIndex];
    e.preventDefault();
  } else if (e.key === 'ArrowDown') {
    historyIndex = Math.max(-1, historyIndex - 1);
    input.value = historyIndex >= 0 ? history[historyIndex] : '';
    e.preventDefault();
  } else if (e.key === 'Escape') {
    interruptSpeech();
    api.command('stop');
  }
});

// ---- Push-to-talk (hold F2 or the button) --------------------------------------------

let recorder = null;
let chunks = [];

async function startTalking() {
  if (recorder) return;
  // Barge-in, and never record our own voice from the speakers (AR-3).
  interruptSpeech();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      recorder = null;
      talk.setAttribute('aria-pressed', 'false');
      if (blob.size < 2000) return; // a tap, not speech
      const text = await api.audio(new Uint8Array(await blob.arrayBuffer()));
      if (text) send(text);
    };
    recorder.start();
    talk.setAttribute('aria-pressed', 'true');
    earcon('listen');
  } catch {
    addEntry({ source: 'browser', kind: 'error', text: 'I could not use the microphone. You can type your command instead.' });
  }
}

function stopTalking() {
  if (recorder && recorder.state === 'recording') {
    recorder.stop();
    earcon('done');
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'F2' && !e.repeat) {
    e.preventDefault();
    startTalking();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'F2') {
    e.preventDefault();
    stopTalking();
  }
});
talk.addEventListener('pointerdown', startTalking);
talk.addEventListener('pointerup', stopTalking);
talk.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
    e.preventDefault();
    startTalking();
  }
});
talk.addEventListener('keyup', (e) => {
  if (e.key === ' ' || e.key === 'Enter') stopTalking();
});

// ---- Settings ------------------------------------------------------------------------

const dialog = document.getElementById('settings');
const sform = document.getElementById('settings-form');
const preset = document.getElementById('preset');
const status = document.getElementById('settings-status');
let presets = {};

async function openSettings() {
  const s = await api.getSettings();
  presets = s.presets || {};
  preset.length = 1;
  for (const [id, p] of Object.entries(presets)) preset.add(new Option(p.label || id, id));
  sform.elements.profile.value = s.settings.profile;
  sform.elements.verbosity.value = s.settings.verbosity;
  sform.elements.autoRead.value = s.settings.autoRead;
  document.getElementById('ai-baseUrl').value = (s.ai && s.ai.baseUrl) || '';
  document.getElementById('ai-model').value = (s.ai && s.ai.model) || '';
  document.getElementById('stt-baseUrl').value = (s.speechToText && s.speechToText.baseUrl) || '';
  document.getElementById('ai-key').value = '';
  document.getElementById('key-note').textContent = s.keyStorageProblem
    ? s.keyStorageProblem
    : s.hasKey.ai
      ? 'A key is saved securely. Leave this empty to keep it.'
      : 'Keys are stored in your system keychain and never shown again.';
  status.textContent = '';
  dialog.showModal();
}

preset.addEventListener('change', () => {
  const p = presets[preset.value];
  document.getElementById('preset-note').textContent = p ? p.note : '';
  if (p) {
    document.getElementById('ai-baseUrl').value = p.baseUrl || '';
    document.getElementById('ai-model').value = p.model || '';
  }
});

sform.addEventListener('submit', async (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  e.preventDefault();
  const kind = preset.value && presets[preset.value] ? presets[preset.value].kind : document.getElementById('ai-baseUrl').value ? 'openai-compatible' : null;
  const baseUrl = document.getElementById('ai-baseUrl').value.trim();
  const model = document.getElementById('ai-model').value.trim();
  const apiKey = document.getElementById('ai-key').value;
  const sttUrl = document.getElementById('stt-baseUrl').value.trim();
  const sttKey = document.getElementById('stt-key').value;
  profile = sform.elements.profile.value;
  applyProfile();
  const res = await api.saveSettings({
    settings: { profile, verbosity: sform.elements.verbosity.value, autoRead: sform.elements.autoRead.value },
    ai: kind === 'anthropic' ? { kind, model: model || undefined, apiKey: apiKey || undefined } : kind ? { kind, baseUrl, model, apiKey: apiKey || undefined } : null,
    speechToText: sttUrl ? { baseUrl: sttUrl, apiKey: sttKey || undefined } : null,
  });
  status.textContent = res.ok ? 'Saved.' : `Not saved: ${res.message}`;
  if (res.ok) setTimeout(() => dialog.close(), 600);
});

document.getElementById('settings-button').addEventListener('click', openSettings);
dialog.addEventListener('close', () => input.focus());

api.getSettings().then((s) => {
  profile = (s && s.settings.profile) || 'voice';
  applyProfile();
});
