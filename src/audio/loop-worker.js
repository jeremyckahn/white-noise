import { renderLoop } from './loop.js'

self.onmessage = ({ data: { id, type, sampleRate } }) => {
  const channels = renderLoop(type, sampleRate)
  self.postMessage({ id, channels }, channels.map((channel) => channel.buffer))
}
