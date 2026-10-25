import { renderLoop } from './loop.js'
import { encodeWav } from './wav.js'

self.onmessage = ({ data: { id, type, sampleRate } }) => {
  self.postMessage({ id, blob: encodeWav(renderLoop(type, sampleRate), sampleRate) })
}
