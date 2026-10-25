import { createGenerator } from './generators.js'

// Runs on the audio rendering thread and synthesises one colour of noise,
// sample by sample, with an independent stream for each channel.
class NoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { type } = options.processorOptions
    this.generators = [createGenerator(type, sampleRate), createGenerator(type, sampleRate)]
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    for (let ch = 0; ch < output.length; ch++) {
      const generate = this.generators[ch % this.generators.length]
      const samples = output[ch]
      for (let i = 0; i < samples.length; i++) samples[i] = generate()
    }
    return true
  }
}

registerProcessor('noise-processor', NoiseProcessor)
