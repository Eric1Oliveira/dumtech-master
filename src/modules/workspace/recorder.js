// Gravação da reunião no navegador. Microfone ("você") e, se pedido, o som da chamada ("outros"):
// pela entrada de som do computador (Mixagem estéreo/VB-Cable) ou pela aba do Meet/Zoom, cada um em PCM 16 kHz para o Whisper, em pedaços de ~30 s enquanto grava.
// Em paralelo, um arquivo .webm (só para baixar, se quiser). Nada vai para o servidor.

const CHUNK_S = 30;
const RATE = 16000;

/** Pedaço silencioso? (evita o Whisper inventar frases) @param {Float32Array} audio */
export function isSilent(audio) {
  let sum = 0;
  for (let i = 0; i < audio.length; i += 4) sum += audio[i] * audio[i];
  return Math.sqrt(sum / Math.max(1, audio.length / 4)) < 0.004;
}

const CALL_DEVICE = /stereo mix|mixagem est[eé]reo|mezcla est[eé]reo|what u hear|loopback|cable output|voicemeeter out/i;

/** O seletor de compartilhamento do Opera GX derruba o navegador inteiro. */
export const isOpera = () => /\bOPR\//.test(navigator.userAgent);

/** Entrada com o som do computador (Mixagem estéreo, VB-Cable…): grava a chamada sem o seletor de aba. */
export async function findCallDevice() {
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  return devices.find((d) => d.kind === 'audioinput' && CALL_DEVICE.test(d.label))?.deviceId ?? null;
}

/**
 * @param {{ call: 'tab' | { deviceId: string } | null, onChunk: (chunk: { audio: Float32Array, offset: number, who: string | null }) => void, onLevel?: (level: number) => void, onCallEnded?: () => void }} options
 */
export async function startRecording({ call, onChunk, onLevel, onCallEnded }) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não grava áudio.');
  /** @type {MediaStream | null} */
  let display = null;
  // A aba vem antes do microfone: o Chrome só abre o seletor logo depois do clique.
  if (call === 'tab') {
    if (!navigator.mediaDevices.getDisplayMedia) throw new Error('Este navegador não grava o som da chamada. Use o Chrome ou o Edge no computador.');
    const controller = 'CaptureController' in window ? new window.CaptureController() : undefined;
    try {
      display = await navigator.mediaDevices.getDisplayMedia(/** @type {any} */ ({
        video: { frameRate: 1 },
        audio: true,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        controller,
      }));
    } catch {
      throw new Error('Gravação da aba cancelada.');
    }
    // Sem isto o Chrome pula para a aba compartilhada e o DUM some da frente.
    try {
      controller?.setFocusBehavior('no-focus-change');
    } catch {
      /* tela inteira não troca de foco */
    }
    if (!display.getAudioTracks().length) {
      display.getTracks().forEach((t) => t.stop());
      throw new Error('O compartilhamento veio sem som. Escolha a aba da reunião com "Compartilhar áudio da guia" ligado, ou, se a reunião estiver no app do Zoom/Teams, escolha "Tela inteira" com "Compartilhar áudio do sistema".');
    }
  }
  /** @type {MediaStream[]} */
  const streams = [];
  try {
    streams.push(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }));
  } catch {
    display?.getTracks().forEach((t) => t.stop());
    throw new Error('Sem acesso ao microfone. Libere o microfone para este site e tente de novo.');
  }
  if (display) streams.push(new MediaStream(display.getAudioTracks()));
  if (call && call !== 'tab') {
    try {
      streams.push(await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: call.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }));
    } catch {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      throw new Error('Não consegui abrir a entrada com o som do computador (Mixagem estéreo). Confira se ela está ativada no Windows.');
    }
  }

  const ctx = new AudioContext({ sampleRate: RATE });
  await ctx.audioWorklet.addModule(new URL('../../../assets/js/pcm-worklet.js', import.meta.url));
  const silent = ctx.createGain();
  silent.gain.value = 0;
  silent.connect(ctx.destination);
  const mix = ctx.createMediaStreamDestination();
  const startedAt = performance.now();

  const sources = streams.map((stream, i) => {
    const who = streams.length > 1 ? (i === 0 ? 'me' : 'others') : null;
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-capture');
    src.connect(node);
    node.connect(silent);
    src.connect(mix);
    /** @type {Float32Array[]} */
    let parts = [];
    let partSamples = 0;
    let sent = 0;
    const flush = () => {
      if (!partSamples) return;
      const audio = new Float32Array(partSamples);
      let at = 0;
      for (const p of parts) {
        audio.set(p, at);
        at += p.length;
      }
      const offset = sent / RATE;
      sent += partSamples;
      parts = [];
      partSamples = 0;
      if (!isSilent(audio)) onChunk({ audio, offset, who });
    };
    node.port.onmessage = ({ data }) => {
      parts.push(data);
      partSamples += data.length;
      if (partSamples >= CHUNK_S * RATE) flush();
    };
    return { stream, node, flush };
  });

  // "Parar de compartilhar" ou fechar a aba da chamada: o microfone segue gravando.
  streams[1]?.getAudioTracks()[0]?.addEventListener('ended', () => {
    sources[1].flush();
    display?.getTracks().forEach((t) => t.stop());
    onCallEnded?.();
  });

  // Medidor de volume: você e a chamada
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  streams.forEach((s) => ctx.createMediaStreamSource(s).connect(analyser));
  const levels = new Uint8Array(analyser.fftSize);
  const meter = setInterval(() => {
    analyser.getByteTimeDomainData(levels);
    let peak = 0;
    for (const v of levels) peak = Math.max(peak, Math.abs(v - 128));
    onLevel?.(Math.min(1, peak / 64));
  }, 120);

  /** @type {Blob[]} */
  const blobs = [];
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const recorder = new MediaRecorder(mix.stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  recorder.ondataavailable = (e) => e.data.size && blobs.push(e.data);
  recorder.start(10_000);

  let stopped = false;
  return {
    elapsed: () => (performance.now() - startedAt) / 1000,
    /** Para tudo; manda o último pedaço e devolve o arquivo de áudio (fica só no navegador). */
    async stop() {
      if (stopped) return { blob: null, durationS: 0 };
      stopped = true;
      clearInterval(meter);
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      // Deixa o worklet mandar o resto do buffer antes de cortar.
      await new Promise((r) => setTimeout(r, 300));
      sources.forEach((s) => s.flush());
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      display?.getTracks().forEach((t) => t.stop());
      await ctx.close();
      return { blob: blobs.length ? new Blob(blobs, { type: type || 'audio/webm' }) : null, durationS: Math.round((performance.now() - startedAt) / 1000) };
    },
  };
}

/**
 * Arquivo de áudio enviado (mp3, m4a, wav, ogg, webm) → pedaços de 30 s em 16 kHz mono.
 * @param {File} file
 * @returns {Promise<{ chunks: { audio: Float32Array, offset: number }[], durationS: number }>}
 */
export async function decodeAudioFile(file) {
  if (file.size > 300 * 1024 * 1024) throw new Error('Áudio maior que 300 MB. Divida em partes.');
  const ctx = new OfflineAudioContext(1, RATE, RATE);
  let buffer;
  try {
    buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('Não consegui ler este áudio. Use mp3, m4a, wav, ogg ou webm.');
  }
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < buffer.numberOfChannels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
  }
  const size = CHUNK_S * RATE;
  const chunks = [];
  for (let at = 0; at < length; at += size) {
    const audio = mono.slice(at, Math.min(length, at + size));
    if (!isSilent(audio)) chunks.push({ audio, offset: at / RATE });
  }
  return { chunks, durationS: Math.round(length / RATE) };
}
