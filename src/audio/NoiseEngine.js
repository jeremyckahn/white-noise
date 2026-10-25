import workletUrl from './noise-processor.js?worker&url'
import { createGenerator } from './generators.js'

const FADE_TIME_CONSTANT = 0.05 // seconds; a colour change is complete in ~0.2s
const START_FADE = 0.25
const STOP_FADE = 0.6
const DISCONNECT_AFTER_MS = 800

// Maps the 0..1 slider onto a gain that feels even to the ear.
const volumeToGain = (volume) => volume * volume

/**
 * Procedural noise player.
 *
 * One AudioWorklet node per colour is created lazily and cross-faded, so
 * changing colour is instant and the noise itself never loops. The graph is
 * routed through a MediaStream into a real <audio> element: mobile browsers
 * treat that as media playback, which is what keeps sound going once the
 * screen is off or the app is in the background.
 */
export class NoiseEngine {
  constructor({ onStateChange } = {}) {
    this.onStateChange = onStateChange ?? (() => {})
    this.ctx = null
    this.master = null
    this.audioEl = null
    this.channels = new Map() // colour -> { node, gain, timer }
    this.color = null
    this.volume = 0.6
    this.playing = false
    this.setupPromise = null
    this.stopTimer = null
  }

  get supported() {
    return typeof (window.AudioContext ?? window.webkitAudioContext) === 'function'
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

      if (ctx.audioWorklet) await ctx.audioWorklet.addModule(workletUrl)

      let routedToElement = false
      if (typeof ctx.createMediaStreamDestination === 'function') {
        const dest = ctx.createMediaStreamDestination()
        this.master.connect(dest)
        const el = document.createElement('audio')
        el.setAttribute('playsinline', '')
        el.srcObject = dest.stream
        this.audioEl = el
        routedToElement = true
      }
      if (!routedToElement) this.master.connect(ctx.destination)

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

  #createSource(color) {
    const ctx = this.ctx
    let node
    if (ctx.audioWorklet) {
      node = new AudioWorkletNode(ctx, 'noise-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { type: color },
      })
    } else {
      // Older browsers: same generators, on the main thread.
      node = ctx.createScriptProcessor(4096, 0, 2)
      const generators = [createGenerator(color, ctx.sampleRate), createGenerator(color, ctx.sampleRate)]
      node.onaudioprocess = (event) => {
        for (let ch = 0; ch < 2; ch++) {
          const out = event.outputBuffer.getChannelData(ch)
          const generate = generators[ch]
          for (let i = 0; i < out.length; i++) out[i] = generate()
        }
      }
    }
    const gain = ctx.createGain()
    gain.gain.value = 0
    node.connect(gain)
    return { node, gain, timer: null, connected: false }
  }

  #fadeTo(channel, target) {
    const { gain } = channel
    const now = this.ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(gain.gain.value, now)
    gain.gain.setTargetAtTime(target, now, FADE_TIME_CONSTANT)
  }

  #activate(color) {
    let channel = this.channels.get(color)
    if (!channel) {
      channel = this.#createSource(color)
      this.channels.set(color, channel)
    }
    clearTimeout(channel.timer)
    if (!channel.connected) {
      channel.gain.connect(this.master)
      channel.connected = true
    }
    this.#fadeTo(channel, 1)
  }

  #deactivate(color) {
    const channel = this.channels.get(color)
    if (!channel || !channel.connected) return
    this.#fadeTo(channel, 0)
    clearTimeout(channel.timer)
    // Disconnecting stops the worklet being rendered, which saves battery.
    channel.timer = setTimeout(() => {
      channel.gain.disconnect()
      channel.connected = false
    }, DISCONNECT_AFTER_MS)
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
    const previous = this.color
    this.color = color
    if (!this.ctx || !this.playing || previous === color) return
    if (previous) this.#deactivate(previous)
    this.#activate(color)
  }

  /** Must be called from a user gesture the first time (autoplay policies). */
  async play(color = this.color) {
    this.color = color
    clearTimeout(this.stopTimer)
    this.playing = true
    this.onStateChange(true)
    try {
      await this.#setup()
      if (!this.playing) return
      await this.ctx.resume()
      if (this.audioEl) {
        try {
          await this.audioEl.play()
        } catch {
          // Element playback was refused; fall back to direct output.
          this.master.disconnect()
          this.master.connect(this.ctx.destination)
          this.audioEl = null
        }
      }
      for (const key of this.channels.keys()) if (key !== color) this.#deactivate(key)
      this.#activate(color)
      this.#updateMasterGain(START_FADE / 3)
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
      for (const key of this.channels.keys()) this.#deactivate(key)
      this.audioEl?.pause()
      this.ctx.suspend().catch(() => {})
    }, STOP_FADE * 1000 + 100)
  }

  /** Re-establish playback if the OS silently suspended it (e.g. after a call). */
  async recover() {
    if (!this.playing || !this.ctx) return
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {})
    if (this.audioEl?.paused) await this.audioEl.play().catch(() => {})
  }
}
