// Downmixes to mono, resamples to 16 kHz (box average) and emits PCM16 chunks of 100 ms.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.phase = 0;
    this.acc = 0;
    this.n = 0;
    this.buf = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    this.sumSq = 0;
    this.sumN = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let mono = 0;
      for (let c = 0; c < input.length; c++) mono += input[c][i];
      mono /= input.length;

      this.sumSq += mono * mono;
      this.sumN++;
      this.acc += mono;
      this.n++;
      this.phase += TARGET_RATE;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const s = Math.max(-1, Math.min(1, this.acc / this.n));
        this.buf[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.acc = 0;
        this.n = 0;
        if (this.filled === CHUNK_SAMPLES) {
          const level = Math.min(1, Math.sqrt(this.sumSq / this.sumN) * 4);
          this.port.postMessage({ pcm: this.buf.buffer, level }, [this.buf.buffer]);
          this.buf = new Int16Array(CHUNK_SAMPLES);
          this.filled = 0;
          this.sumSq = 0;
          this.sumN = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
