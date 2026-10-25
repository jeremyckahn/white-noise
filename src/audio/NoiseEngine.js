import { NOISE_TYPES } from './generators.js'
import { generateLoop } from './generateLoop.js'

const FADE_TIME_CONSTANT = 0.05 // seconds; a colour change is complete in ~0.2s
const START_FADE = 0.25
const STOP_FADE = 0.6
const STOP_AFTER_MS = 800

// Maps the 0..1 slider onto a gain that feels even to the ear.
const volumeToGain = (volume) => volume * volume

// Ten seconds of digital silence as a WAV file.
const createSilentWavUrl = (seconds = 10, rate = 8000) => {
  const samples = seconds * rate
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  return URL.createObjectURL(new Blob([view], { type: 'audio/wav' }))
}

/**
 * Noise player.
 *
 * Each colour is procedurally generated (in a worker) as a long, seamlessly
 * loopable stereo buffer, then played by the browser's native audio engine, so
 * no JavaScript has to run in real time and there is nothing to glitch.
 * Colours are cross-faded, so switching is instant.
 *
 * Alongside it a silent <audio> element plays. Mobile browsers only show
 * lock-screen media controls and keep a page alive with the screen off for
 * real media elements, which Web Audio on its own is not.
 */
export class NoiseEngine {
  constructor({ onStateChange } = {}) {
    this.onStateChange = onStateChange ?? (() => {})
    this.ctx = null
    this.master = null
    this.keepAlive = null
    this.buffers = new Map() // colour -> Promise<AudioBuffer>
    this.channels = new Map() // colour -> { source, gain, timer }
    this.color = null
    this.volume = 0.6
    this.playing = false
    this.setupPromise = null
    this.stopTimer = null
  }

  get supported() {
    return typeof (window.AudioContext ?? window.webkitAudioContext) === 'function'
  }

  #startKeepAlive() {
    if (!this.keepAlive) {
      const el = document.createElement('audio')
      el.setAttribute('playsinline', '')
      el.loop = true
      el.src = createSilentWavUrl()
      // The system (lock screen, another app taking focus, a call) can pause
      // the element; mirror that rather than playing on invisibly.
      el.addEventListener('pause', () => {
        if (this.playing && el.paused) this.pause()
      })
      this.keepAlive = el
    }
    // Called synchronously from the user's tap, so the browser allows it.
    return this.keepAlive.play().catch(() => {})
  }

  async #setup() {
    if (this.setupPromise) return this.setupPromise
    this.setupPromise = (async () => {
      // Lets playback continue with the screen locked and the ringer switch on silent.
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback'
      } catch {
        /* unsupported */
      }
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext
      const ctx = new AudioContextClass({ latencyHint: 'playback' })
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(ctx.destination)
      ctx.addEventListener('statechange', () => {
        // iOS "interrupts" the context for calls and alarms; pick back up.
        if (this.playing && ctx.state !== 'running' && ctx.state !== 'closed') {
          ctx.resume().catch(() => {})
        }
      })
    })()
    try {
      await this.setupPromise
    } catch (error) {
      this.setupPromise = null
      throw error
    }
  }

  #buffer(color) {
    let promise = this.buffers.get(color)
    if (!promise) {
      const ctx = this.ctx
      promise = generateLoop(color, ctx.sampleRate).then((channels) => {
        const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate)
        channels.forEach((data, index) => buffer.copyToChannel(data, index))
        return buffer
      })
      this.buffers.set(color, promise)
    }
    return promise
  }

  /** Quietly prepare the other colours so switching to them is instant. */
  #prepareRest() {
    const queue = NOISE_TYPES.filter((type) => !this.buffers.has(type))
    const next = () => {
      const type = queue.shift()
      if (!type || !this.ctx) return
      this.#buffer(type).then(() => setTimeout(next, 100))
    }
    next()
  }

  #fadeTo(channel, target) {
    const { gain } = channel
    const now = this.ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.setTargetAtTime(target, now, FADE_TIME_CONSTANT)
  }

  #startChannel(color, buffer) {
    let channel = this.channels.get(color)
    if (!channel) {
      const source = this.ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(this.master)
      // Start somewhere different each time so repeats never line up.
      source.start(0, Math.random() * buffer.duration)
      channel = { source, gain, timer: null }
      this.channels.set(color, channel)
    }
    clearTimeout(channel.timer)
    this.#fadeTo(channel, 1)
  }

  #stopChannel(color) {
    const channel = this.channels.get(color)
    if (!channel) return
    this.#fadeTo(channel, 0)
    clearTimeout(channel.timer)
    // Once silent, release it so it stops costing battery.
    channel.timer = setTimeout(() => {
      channel.source.stop()
      channel.source.disconnect()
      channel.gain.disconnect()
      this.channels.delete(color)
    }, STOP_AFTER_MS)
  }

  /** Make the audible colour match `this.color`. */
  async #apply() {
    const color = this.color
    const buffer = await this.#buffer(color)
    // Superseded by a newer choice, or paused, while the loop was being made.
    if (!this.playing || color !== this.color) return
    this.#startChannel(color, buffer)
    for (const other of this.channels.keys()) if (other !== color) this.#stopChannel(other)
  }

  #updateMasterGain(fade) {
    const now = this.ctx.currentTime
    const param = this.master.gain
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    param.setTargetAtTime(this.playing ? volumeToGain(this.volume) : 0, now, fade)
  }

  setVolume(volume) {
    this.volume = volume
    if (this.ctx && this.playing) this.#updateMasterGain(0.03)
  }

  setColor(color) {
    this.color = color
    if (this.ctx && this.playing) this.#apply()
  }

  /** Must be called from a user gesture the first time (autoplay policies). */
  async play(color = this.color) {
    this.color = color
    clearTimeout(this.stopTimer)
    this.playing = true
    this.onStateChange(true)
    const keepAlive = this.#startKeepAlive()
    try {
      await this.#setup()
      await this.ctx.resume()
      await keepAlive
      if (!this.playing) return
      await this.#apply()
      if (!this.playing) return
      this.#updateMasterGain(START_FADE / 3)
      this.#prepareRest()
    } catch (error) {
      this.playing = false
      this.onStateChange(false)
      throw error
    }
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    this.onStateChange(false)
    if (!this.ctx) return
    this.#updateMasterGain(STOP_FADE / 3)
    clearTimeout(this.stopTimer)
    // Once faded out, release the audio hardware entirely.
    this.stopTimer = setTimeout(() => {
      if (this.playing) return
      for (const key of [...this.channels.keys()]) this.#stopChannel(key)
      this.keepAlive?.pause()
      this.ctx.suspend().catch(() => {})
    }, STOP_FADE * 1000 + 100)
  }

  /** Re-establish playback if the OS silently suspended it (e.g. after a call). */
  async recover() {
    if (!this.playing || !this.ctx) return
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {})
    if (this.keepAlive?.paused) await this.keepAlive.play().catch(() => {})
  }

  /** Plain-text state for the ?debug readout. */
  diagnostics() {
    const { ctx, keepAlive } = this
    return {
      context: ctx?.state ?? 'none',
      sampleRate: ctx?.sampleRate,
      outputLatencyMs: ctx?.outputLatency != null ? Math.round(ctx.outputLatency * 1000) : undefined,
      keepAlive: keepAlive ? (keepAlive.paused ? 'paused' : 'playing') : 'none',
      loopsReady: this.buffers.size,
      active: [...this.channels.keys()].join(',') || 'none',
    }
  }
}
