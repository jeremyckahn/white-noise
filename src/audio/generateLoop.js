import { renderLoop } from './loop.js'
import { encodeWav } from './wav.js'

// Loops are rendered in Web Workers so the UI stays smooth, falling back to
// the main thread if workers are unavailable. Long renders get a worker of
// their own so they never hold up the short loops needed for instant switching.
const LONG_SECONDS = 60
const workers = [undefined, undefined]
let nextId = 0
const pending = new Map()

const renderInline = (type, sampleRate, seconds) => encodeWav(renderLoop(type, sampleRate, { seconds }), sampleRate)

const failAll = (slot) => {
  workers[slot]?.terminate()
  workers[slot] = null
  for (const [id, { slot: owner, type, sampleRate, seconds, resolve }] of pending) {
    if (owner !== slot) continue
    resolve(slot === 1 ? null : renderInline(type, sampleRate, seconds))
    pending.delete(id)
  }
}

const getWorker = (slot) => {
  if (workers[slot] !== undefined) return workers[slot]
  try {
    const worker = new Worker(new URL('./loop-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data: { id, blob } }) => {
      pending.get(id)?.resolve(blob)
      pending.delete(id)
    }
    worker.onerror = () => failAll(slot)
    workers[slot] = worker
  } catch {
    workers[slot] = null
  }
  return workers[slot]
}

/** Resolves to a WAV Blob containing a seamless stereo loop of the given colour (null if a long one can't be made off-thread). */
export const generateLoopBlob = (type, sampleRate, seconds) => {
  const slot = seconds > LONG_SECONDS ? 1 : 0
  const worker = getWorker(slot)
  // Rendering a long loop on the main thread would freeze the page; skip it.
  if (!worker) return Promise.resolve(slot === 1 ? null : renderInline(type, sampleRate, seconds))
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, { slot, type, sampleRate, seconds, resolve })
    worker.postMessage({ id, type, sampleRate, seconds })
  })
}
