import { renderLoop } from './loop.js'
import { encodeWav } from './wav.js'

// Loops are rendered in a Web Worker so the UI stays smooth, falling back to
// the main thread if workers are unavailable.
let worker
let nextId = 0
const pending = new Map()

const renderInline = (type, sampleRate) => encodeWav(renderLoop(type, sampleRate), sampleRate)

const failAll = () => {
  worker?.terminate()
  worker = null
  for (const { type, sampleRate, resolve } of pending.values()) resolve(renderInline(type, sampleRate))
  pending.clear()
}

const getWorker = () => {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./loop-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data: { id, blob } }) => {
      pending.get(id)?.resolve(blob)
      pending.delete(id)
    }
    worker.onerror = failAll
  } catch {
    worker = null
  }
  return worker
}

/** Resolves to a WAV Blob containing a seamless stereo loop of the given colour. */
export const generateLoopBlob = (type, sampleRate) => {
  const w = getWorker()
  if (!w) return Promise.resolve(renderInline(type, sampleRate))
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, { type, sampleRate, resolve })
    w.postMessage({ id, type, sampleRate })
  })
}
