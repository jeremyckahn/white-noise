import { NOISE_TYPES } from './generators.js'
import { generateLoopBlob } from './generateLoop.js'
import { LOOP_SECONDS } from './loop.js'
import { encodeWav } from './wav.js'

const SAMPLE_RATE = 44100
const FADE_MS = 250
// Looping an <audio> element natively leaves a gap of ~100ms at the wrap point,
// so shortly before the end the idle element takes over the same colour and
// the two cross-fade instead. Both scale down for very short (debug) loops.
const RELAY_LEAD_SECONDS = 3
const RELAY_FADE_MS = 1500
const WATCH_INTERVAL_MS = 100
const LOG_LIMIT = 200

// Maps the 0..1 slider onto a gain that feels even to the ear.
const volumeToGain = (volume) => volume * volume

const createSilentUrl = () => URL.createObjectURL(encodeWav([new Float32Array(8000 * 10)], 8000))

/**
 * Noise player.
 *
 * Each colour is procedurally generated (in a worker) as a seamless stereo
 * loop, wrapped as a WAV and played by an ordinary looping <audio> element.
 * Real media elements are what mobile browsers give lock-screen controls and
 * background playback to, and they are the glitch-free path on Android.
 *
 * Two elements take turns so colours can be cross-faded: the new colour
 * starts on the idle element while the old one keeps playing, then they swap
 * volume over a quarter of a second.
 */
export class NoiseEngine {
  constructor({ onStateChange, loopSeconds = LOOP_SECONDS } = {}) {
    this.onStateChange = onStateChange ?? (() => {})
    this.loopSeconds = loopSeconds
    this.startedAt = performance.now()
    this.events = [] // rolling log, shown with ?debug
    this.health = null // last watcher sample, for spotting stalls
    this.players = null // two { el, color, phase, starting }; phase 0..1 is the fade position
    this.active = null // the player that should be audible
    this.urls = new Map() // colour -> Promise<string>
    this.color = null
    this.volume = 0.6
    this.playing = false
    this.token = 0 // incremented whenever playback intent changes, to drop stale work
    this.ticker = null
    this.lastTick = 0
    this.fadeMs = FADE_MS
    this.relaying = false
    this.watcher = null
    this.volumeProbe = undefined
    document.addEventListener('visibilitychange', () => this.#log(`page ${document.visibilityState}`))
  }

  #log(message) {
    const seconds = ((performance.now() - this.startedAt) / 1000).toFixed(1)
    this.events.push(`${seconds}s ${message}`)
    if (this.events.length > LOG_LIMIT) this.events.shift()
  }

  get supported() {
    return typeof Audio === 'function'
  }

  /** iOS ignores element.volume, so there is no in-app volume or cross-fade there. */
  get volumeSupported() {
    if (this.volumeProbe === undefined) {
      const probe = document.createElement('audio')
      probe.volume = 0.5
      this.volumeProbe = probe.volume === 0.5
    }
    return this.volumeProbe
  }

  #createPlayers() {
    const silent = createSilentUrl()
    this.players = [0, 1].map(() => {
      const el = document.createElement('audio')
      el.loop = true
      el.preload = 'auto'
      el.setAttribute('playsinline', '')
      el.src = silent
      const player = { el, color: null, phase: 0, starting: false }
      // The system (lock screen, another app taking focus, a call) can pause
      // playback; mirror that rather than carrying on invisibly.
      el.addEventListener('pause', () => {
        const mine = this.players?.indexOf(player)
        this.#log(`player ${mine} pause event (${player === this.active ? 'active' : 'idle'}, ${this.playing ? 'wanted playing' : 'wanted paused'})`)
        if (this.playing && player === this.active && el.paused) this.pause()
      })
      for (const type of ['waiting', 'stalled', 'error', 'ended']) {
        el.addEventListener(type, () => this.#log(`player ${this.players?.indexOf(player)} ${type}${el.error ? ` ${el.error.code}` : ''} at ${el.currentTime.toFixed(2)}s`))
      }
      return player
    })
    this.watcher = setInterval(() => this.#checkLoop(), WATCH_INTERVAL_MS)
  }

  /** Log timer lateness and stretches where the audio clock fell behind real time. */
  #checkHealth(player) {
    const now = performance.now()
    const sample = { now, time: player.el.currentTime, player }
    const last = this.health
    this.health = sample
    if (!last || last.player !== player) return
    const elapsed = now - last.now
    const advanced = sample.time - last.time
    if (elapsed > 1000) this.#log(`timer ran ${Math.round(elapsed)}ms late (${document.visibilityState})`)
    // Negative means the loop wrapped; skip those samples.
    else if (advanced >= 0 && advanced * 1000 < elapsed * 0.7) {
      this.#log(`stall: audio advanced ${Math.round(advanced * 1000)}ms in ${Math.round(elapsed)}ms (${document.visibilityState})`)
    }
  }

  /** Hand over to the idle element before the active one reaches the end of its loop. */
  #checkLoop() {
    const player = this.active
    if (!this.playing || !player?.color || player.el.paused) {
      this.health = null
      return
    }
    this.#checkHealth(player)
    if (this.relaying || !this.volumeSupported) return
    const { duration, currentTime } = player.el
    if (!Number.isFinite(duration)) return
    if (duration - currentTime > Math.min(RELAY_LEAD_SECONDS, duration * 0.5)) return
    this.relaying = true
    const started = performance.now()
    const fadeMs = Math.min(RELAY_FADE_MS, duration * 300)
    this.#log(`hand-over starts at ${currentTime.toFixed(2)}/${duration.toFixed(2)}s (${document.visibilityState})`)
    this.#show(player.color, ++this.token, { relay: true, fadeMs })
      .then(() => this.#log(`hand-over took ${Math.round(performance.now() - started)}ms`))
      .catch((error) => this.#log(`hand-over failed: ${error?.name}`))
      .finally(() => {
        this.relaying = false
      })
  }

  #url(color) {
    let url = this.urls.get(color)
    if (!url) {
      url = generateLoopBlob(color, SAMPLE_RATE, this.loopSeconds).then((blob) => URL.createObjectURL(blob))
      this.urls.set(color, url)
    }
    return url
  }

  #applyVolume(player) {
    if (this.volumeSupported) player.el.volume = Math.sin((player.phase * Math.PI) / 2) * volumeToGain(this.volume)
  }

  /** Move every player towards audible (the active one) or silent (the rest). */
  #fade() {
    const target = (player) => (this.playing && player === this.active ? 1 : 0)
    // No volume control (iOS), or the page is hidden where timers are throttled
    // and an instant change matters more: switch immediately.
    if (!this.volumeSupported || document.hidden) {
      for (const player of this.players) {
        player.phase = target(player)
        this.#applyVolume(player)
        if (player.phase === 0 && !player.starting) player.el.pause()
      }
      return
    }
    if (this.ticker) return
    this.lastTick = performance.now()
    this.ticker = setInterval(() => {
      const now = performance.now()
      const step = (now - this.lastTick) / this.fadeMs
      this.lastTick = now
      let moving = false
      for (const player of this.players) {
        const goal = target(player)
        player.phase = goal > player.phase ? Math.min(goal, player.phase + step) : Math.max(goal, player.phase - step)
        this.#applyVolume(player)
        if (player.phase === goal) {
          if (goal === 0 && !player.starting && !player.el.paused) player.el.pause()
        } else {
          moving = true
        }
      }
      if (!moving) {
        clearInterval(this.ticker)
        this.ticker = null
      }
    }, 20)
  }

  /** Report an endless stream so lock screens don't draw a progress bar for the loop. */
  #hideScrubber() {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.setPositionState({ duration: Infinity, position: 0, playbackRate: 1 })
    } catch {
      try {
        navigator.mediaSession.setPositionState()
      } catch {
        /* unsupported */
      }
    }
  }

  /** Make `color` the audible one. Stale calls (superseded or paused) bail out. */
  async #show(color, token, { relay = false, fadeMs = FADE_MS } = {}) {
    const url = await this.#url(color)
    if (token !== this.token || !this.playing) return
    const current = this.active
    if (current.color === color && !relay) {
      if (current.el.paused) await current.el.play().catch(() => {})
    } else {
      const next = this.players.find((player) => player !== current)
      next.color = color
      next.phase = 0
      this.#applyVolume(next)
      // While it spins up, the fade timer must not pause it as an idle player.
      next.starting = true
      try {
        next.el.src = url
        await next.el.play()
      } catch (error) {
        // A newer colour replacing the source aborts this one quietly; anything
        // else (blocked by the browser) is a real failure.
        this.#log(`play() rejected for ${color}: ${error?.name}`)
        if (token === this.token && this.playing) throw error
        return
      } finally {
        if (token === this.token || !this.playing) next.starting = false
      }
      // If a newer call took over, it owns this element now.
      if (token !== this.token || !this.playing) return
      this.active = next
    }
    this.#hideScrubber()
    this.fadeMs = relay ? fadeMs : FADE_MS
    this.#fade()
  }

  setVolume(volume) {
    this.volume = volume
    this.players?.forEach((player) => this.#applyVolume(player))
  }

  setColor(color) {
    this.#log(`colour -> ${color}`)
    this.color = color
    if (this.players && this.playing) this.#show(color, ++this.token).catch(() => this.pause())
  }

  /** Must be called from a user gesture the first time (autoplay policies). */
  async play(color = this.color) {
    this.#log(`play(${color}), ${this.loopSeconds}s loops`)
    this.color = color
    this.playing = true
    this.onStateChange(true)
    const token = ++this.token
    try {
      // Lets playback continue with the screen locked and the ringer switch on silent.
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback'
      } catch {
        /* unsupported */
      }
      if (!this.players) {
        this.#createPlayers()
        // Start both on a silent clip inside the user's tap. That permits later
        // programmatic playback on strict browsers (iOS), and keeps the page
        // counted as playing media while the first loop is being made.
        await Promise.all(this.players.map((player) => player.el.play().catch(() => {})))
        this.players[1].el.pause()
        this.active = this.players[0]
      }
      await this.#show(color, token)
      // Quietly prepare the other colours so switching to them is instant.
      NOISE_TYPES.forEach((type) => this.#url(type))
    } catch (error) {
      this.playing = false
      this.onStateChange(false)
      throw error
    }
  }

  pause() {
    if (!this.playing) return
    this.#log('pause()')
    this.playing = false
    this.token++
    this.onStateChange(false)
    this.fadeMs = FADE_MS
    if (this.players) this.#fade()
  }

  /** Re-establish playback if the OS silently stopped it (e.g. after a call). */
  async recover() {
    if (this.playing && this.active?.el.paused) await this.active.el.play().catch(() => {})
  }

  logLines(count = this.events.length) {
    return this.events.slice(-count)
  }

  /** Plain-text state for the ?debug readout. */
  diagnostics() {
    return {
      playing: this.playing,
      loopSeconds: this.loopSeconds,
      volumeSupported: this.volumeSupported,
      loopsReady: this.urls.size,
      players: this.players?.map((player) => ({
        color: player.color,
        active: player === this.active,
        paused: player.el.paused,
        time: +player.el.currentTime.toFixed(1),
        volume: +player.el.volume.toFixed(2),
      })),
    }
  }
}
