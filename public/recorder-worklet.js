// Runs in the browser's real-time audio thread (an "AudioWorklet"). Its only job is to hand the raw microphone
// samples to the page in batches. The page (src/lib/recorder-core.ts) does everything else.
//
// The browser calls process() 128 samples at a time, hundreds of times a second. Posting a message for each would
// be wasteful, so we collect about 4,000 samples first.

const BATCH = 4096;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(BATCH);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]; // first channel of the first input (mono is all Whisper needs)
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === BATCH) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]); // hand over the memory, no copy
          this.buffer = new Float32Array(BATCH);
          this.filled = 0;
        }
      }
    }
    return true; // keep running until the page disconnects us
  }
}

registerProcessor("pcm-capture", PcmCapture);
