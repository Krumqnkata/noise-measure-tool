// AudioWorklet: събира семплите от микрофона на блокове от 2048 и ги праща към основната нишка
class PcmSender extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0][0];
    if (input) {
      let offset = 0;
      while (offset < input.length) {
        const n = Math.min(input.length - offset, this.buffer.length - this.filled);
        this.buffer.set(input.subarray(offset, offset + n), this.filled);
        this.filled += n;
        offset += n;
        if (this.filled === this.buffer.length) {
          this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(2048);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-sender', PcmSender);
