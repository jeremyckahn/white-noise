// Standalone diagnostics page: isolates each layer of the audio path so a
// problem seen on a device can be pinned to one of them.
import { NOISE_TYPES } from './audio/generators.js'
import { renderLoop } from './audio/loop.js'
import { encodeWav } from './audio/wav.js'

const select = document.getElementById('color')
for (const type of NOISE_TYPES) select.add(new Option(type, type, false, type === 'pink'))

const out = document.getElementById('out')
const log = []
const note = (message) => log.push(`${((performance.now() - started) / 1000).toFixed(1)}s ${message}`)
const started = performance.now()

const wavUrl = (channels, rate) => URL.createObjectURL(encodeWav(channels, rate))
const silentWavUrl = (seconds = 10, rate = 8000) => wavUrl([new Float32Array(seconds * rate)], rate)

const startElement = async (src) => {
  const el = document.createElement('audio')
  el.loop = true
  el.src = src
  el.addEventListener('error', () => note(`element error ${el.error?.code} ${el.error?.message}`))
  el.addEventListener('pause', () => note('element pause event'))
  // 'waiting' is normal while the element first loads; only later ones are underruns.
  el.addEventListener('waiting', () => {
    if (el.currentTime > 1) note('element waiting (buffer underrun)')
  })
  el.addEventListener('stalled', () => note('element stalled'))
  try {
    await el.play()
  } catch (error) {
    note(`element play() rejected: ${error.name} ${error.message}`)
  }
  return el
}

let ctx = null
let element = null
let silent = null

const newContext = () => {
  const created = new AudioContext({ latencyHint: 'playback' })
  created.addEventListener('statechange', () => note(`context ${created.state}`))
  ctx = created
  return created
}

const bufferSource = (context, color) => {
  const channels = renderLoop(color, context.sampleRate)
  const buffer = context.createBuffer(2, channels[0].length, context.sampleRate)
  channels.forEach((data, i) => buffer.copyToChannel(data, i))
  const source = context.createBufferSource()
  source.buffer = buffer
  source.loop = true
  return source
}

const TESTS = [
  {
    id: 'tone',
    label: '1. Web Audio: pure 220 Hz tone (no noise at all)',
    async start() {
      const c = newContext()
      const osc = c.createOscillator()
      osc.frequency.value = 220
      const gain = c.createGain()
      gain.gain.value = 0.05
      osc.connect(gain).connect(c.destination)
      osc.start()
      await c.resume()
    },
  },
  {
    id: 'buffer',
    label: '2. Web Audio: noise loop from a buffer (the app’s current engine, minus the media element)',
    async start(color) {
      const c = newContext()
      const gain = c.createGain()
      gain.gain.value = 0.36
      const source = bufferSource(c, color)
      source.connect(gain).connect(c.destination)
      source.start()
      await c.resume()
    },
  },
  {
    id: 'element',
    label: '3. Plain <audio> element looping the same noise as a WAV (no Web Audio)',
    async start(color) {
      const rate = 44100
      element = await startElement(wavUrl(renderLoop(color, rate), rate))
      element.volume = 0.36
    },
  },
  {
    id: 'both',
    label: '4. Web Audio noise + silent <audio> element (what the app does now)',
    async start(color) {
      silent = await startElement(silentWavUrl())
      const c = newContext()
      const gain = c.createGain()
      gain.gain.value = 0.36
      const source = bufferSource(c, color)
      source.connect(gain).connect(c.destination)
      source.start()
      await c.resume()
    },
  },
  {
    id: 'silent',
    label: '5. Only a silent <audio> element (do lock-screen controls appear?)',
    async start() {
      silent = await startElement(silentWavUrl())
    },
  },
]

let active = null
const buttons = new Map()

const stop = async () => {
  for (const el of [element, silent]) {
    if (el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
  }
  element = silent = null
  if (ctx) await ctx.close().catch(() => {})
  ctx = null
  active = null
  buttons.forEach((b) => b.classList.remove('on'))
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
}

const run = async (test) => {
  const wasActive = active === test.id
  await stop()
  if (wasActive) return note(`stopped ${test.id}`)
  active = test.id
  buttons.get(test.id).classList.add('on')
  note(`start ${test.id} (${select.value})`)
  try {
    await test.start(select.value)
  } catch (error) {
    note(`start failed: ${error.name} ${error.message}`)
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: `Diag ${test.id}`, artist: 'Lull' })
    navigator.mediaSession.playbackState = 'playing'
    navigator.mediaSession.setActionHandler('pause', () => stop())
    navigator.mediaSession.setActionHandler('play', () => run(test))
  }
}

const testsEl = document.getElementById('tests')
for (const test of TESTS) {
  const button = document.createElement('button')
  button.textContent = test.label
  button.onclick = () => run(test)
  testsEl.append(button)
  buttons.set(test.id, button)
}

const stats = () => {
  const s = ctx?.playoutStats
  return s ? JSON.parse(JSON.stringify(s)) : ctx ? 'playoutStats unsupported' : undefined
}

const render = () => {
  const lines = {
    userAgent: navigator.userAgent,
    active,
    context: ctx && { state: ctx.state, sampleRate: ctx.sampleRate, baseLatencyMs: Math.round(ctx.baseLatency * 1000), outputLatencyMs: Math.round((ctx.outputLatency ?? 0) * 1000) },
    playoutStats: stats(),
    element: element && { paused: element.paused, currentTime: +element.currentTime.toFixed(2), readyState: element.readyState },
    silentElement: silent && { paused: silent.paused, currentTime: +silent.currentTime.toFixed(2) },
    mediaSession: 'mediaSession' in navigator ? navigator.mediaSession.playbackState : 'unsupported',
    standalone: matchMedia('(display-mode: standalone)').matches,
    events: log.slice(-12),
  }
  out.textContent = JSON.stringify(lines, null, 1)
}
setInterval(render, 500)
render()

document.getElementById('copy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(out.textContent)
    note('copied')
  } catch {
    note('copy failed; select the text manually')
  }
}
