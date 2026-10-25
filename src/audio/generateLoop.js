import { renderLoop } from './loop.js'

// Loops are rendered in a Web Worker so the UI stays smooth, falling back to
// the main thread if workers are unavailable.
let worker
let nextId = 0
const pending = new Map()

const failAll = () => {
  worker?.terminate()
  worker = null
  for (const { type, sampleRate, resolve } of pending.values()) resolve(renderLoop(type, sampleRate))
  pending.clear()
}

const getWorker = () => {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./loop-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data: { id, channels } }) => {
      pending.get(id)?.resolve(channels)
      pending.delete(id)
    }
    worker.onerror = failAll
  } catch {
    worker = null
  }
  return worker
}

/** Resolves to an array of Float32Array channels. */
export const generateLoop = (type, sampleRate) => {
  const w = getWorker()
  if (!w) return Promise.resolve(renderLoop(type, sampleRate))
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, { type, sampleRate, resolve })
    w.postMessage({ id, type, sampleRate })
  })
}
