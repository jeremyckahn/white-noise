import { renderLoop } from './loop.js'
import { encodeWav } from './wav.js'

self.onmessage = ({ data: { id, type, sampleRate, seconds } }) => {
  self.postMessage({ id, blob: encodeWav(renderLoop(type, sampleRate, { seconds }), sampleRate) })
}
