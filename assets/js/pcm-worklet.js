// @ts-nocheck — roda no AudioWorkletGlobalScope.
// Captura do áudio da reunião em PCM (o AudioContext já roda a 16 kHz). Manda 1 s por vez.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate);
    this.buf = new Float32Array(this.size);
    this.n = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const first = channels[0];
      for (let i = 0; i < first.length; i += 1) {
        let v = 0;
        for (let c = 0; c < channels.length; c += 1) v += channels[c][i];
        this.buf[this.n++] = v / channels.length;
        if (this.n === this.size) {
          this.port.postMessage(this.buf.slice(0));
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
