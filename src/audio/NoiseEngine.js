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
// With the screen locked the page's timers stop entirely, so the hand-over
// above cannot run and an element just loops natively (with a small gap at
// each wrap). The colour being heard is therefore also rendered as one long
// loop, which wraps only every few minutes.
export const LONG_LOOP_SECONDS = 240
const LONG_LOOP_DELAY_MS = 2000
// A freshly started element reports time 0 for a while before sound comes out.
const START_TIMEOUT_MS = 1500
const RELAY_TIMEOUT_MS = 4000
// A worker ticks while playing; its timestamps show whether the page itself,
// or only the main thread, stops running while the screen is locked.
const HEARTBEAT_MS = 1000
const HEARTBEAT_SOURCE = `setInterval(() => postMessage(Date.now()), ${HEARTBEAT_MS})`

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
  constructor({ onStateChange, loopSeconds = LOOP_SECONDS, longSeconds = LONG_LOOP_SECONDS } = {}) {
    this.onStateChange = onStateChange ?? (() => {})
    this.loopSeconds = loopSeconds
    this.longSeconds = longSeconds // 0 disables the long loop
    this.long = null // { color, url } for the long loop of the colour being heard
    this.longTimer = null
    this.retired = [] // long-loop URLs to revoke once no element is using them
    this.heartbeat = null // { worker, url, last } while playing
    this.relayStarted = 0
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
    this.fading = false
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
      el.hidden = true
      el.src = silent
      // Part of the page, as ordinary media players are, in case that affects
      // whether the browser keeps the page running while locked.
      document.body.append(el)
      const player = { el, color: null, phase: 0, starting: false }
      // The system (lock screen, another app taking focus, a call) can pause
      // playback; mirror that rather than carrying on invisibly.
      el.addEventListener('pause', () => {
        const mine = this.players?.indexOf(player)
        this.#log(`player ${mine} pause event (${player === this.active ? 'active' : 'idle'}, ${this.playing ? 'wanted playing' : 'wanted paused'})`)
        if (this.playing && player === this.active && el.paused) this.pause()
      })
      // Timers are held back while the screen is locked, but media events keep
      // arriving, so they also drive the loop hand-over.
      el.addEventListener('timeupdate', () => {
        this.#step()
        if (player === this.active) this.#checkLoop()
      })
      for (const type of ['waiting', 'stalled', 'error', 'ended', 'seeking']) {
        el.addEventListener(type, () => this.#log(`player ${this.players?.indexOf(player)} ${type}${el.error ? ` ${el.error.code}` : ''} at ${el.currentTime.toFixed(2)}s`))
      }
      return player
    })
    this.watcher = setInterval(() => this.#checkLoop({ sample: true }), WATCH_INTERVAL_MS)
  }

  /** Compact element state for the log: ready/network state, decoded bytes, volume. */
  #describe(player) {
    const { el } = player
    const bytes = el.webkitAudioDecodedByteCount
    return `${player === this.active ? 'A' : 'i'}:${el.paused ? 'paused' : 'playing'} rs${el.readyState} ns${el.networkState} vol${el.volume.toFixed(2)}${el.muted ? ' muted' : ''}${bytes === undefined ? '' : ` ${Math.round(bytes / 1000)}kB`}`
  }

  /** Run a worker heartbeat while playing (debug log only). */
  #startKeepAlive() {
    if (this.heartbeat) return
    try {
      const url = URL.createObjectURL(new Blob([HEARTBEAT_SOURCE], { type: 'text/javascript' }))
      const worker = new Worker(url)
      const beat = { worker, url, last: null }
      worker.onmessage = ({ data: sent }) => {
        const delivered = Date.now()
        if (beat.last !== null && sent - beat.last > HEARTBEAT_MS * 1.5) {
          this.#log(`worker paused for ${sent - beat.last}ms (ticks resumed)`)
        }
        if (delivered - sent > HEARTBEAT_MS * 1.5 && delivered - (beat.reported ?? 0) > 500) {
          beat.reported = delivered
          this.#log(`main thread received a worker tick ${delivered - sent}ms late`)
        }
        beat.last = sent
      }
      this.heartbeat = beat
    } catch {
      /* workers unavailable */
    }
  }

  #stopKeepAlive() {
    if (this.heartbeat) {
      this.heartbeat.worker.terminate()
      URL.revokeObjectURL(this.heartbeat.url)
      this.heartbeat = null
    }
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
  #checkLoop({ sample = false } = {}) {
    const player = this.active
    if (!this.playing || !player?.color || player.el.paused) {
      this.health = null
      return
    }
    if (sample) this.#checkHealth(player)
    if (this.relaying) {
      // A hand-over waiting on events that never came must not block the next.
      if (performance.now() - this.relayStarted < RELAY_TIMEOUT_MS) return
      this.#log('hand-over timed out')
      this.token++
      this.relaying = false
      this.players.forEach((other) => (other.starting = false))
    }
    if (!this.volumeSupported) return
    const { duration, currentTime } = player.el
    if (!Number.isFinite(duration)) return
    // Move onto the long loop as soon as it is ready; otherwise wait for the end.
    const longUrl = this.#longReady(player.color)
    const upgrade = longUrl !== null && player.el.src !== longUrl
    if (!upgrade && duration - currentTime > Math.min(RELAY_LEAD_SECONDS, duration * 0.5)) return
    this.relaying = true
    const started = (this.relayStarted = performance.now())
    const fadeMs = Math.min(RELAY_FADE_MS, duration * 300)
    this.#log(`${upgrade ? 'upgrade to long loop' : 'hand-over'} starts at ${currentTime.toFixed(2)}/${duration.toFixed(2)}s (${document.visibilityState}); ${this.players.map((p) => this.#describe(p)).join('; ')}`)
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

  #longReady(color) {
    return this.long?.color === color ? this.long.url : null
  }

  /** Shortly after the colour settles, render its long loop in the background. */
  #prepareLong(color) {
    clearTimeout(this.longTimer)
    if (!this.longSeconds || !this.volumeSupported || this.long?.color === color) return
    this.longTimer = setTimeout(() => {
      if (!this.playing || this.color !== color) return
      if (this.long?.url) this.retired.push(this.long.url)
      const entry = { color, url: null }
      this.long = entry
      const started = performance.now()
      generateLoopBlob(color, SAMPLE_RATE, this.longSeconds).then((blob) => {
        if (!blob || this.long !== entry) return
        entry.url = URL.createObjectURL(blob)
        this.#log(`${this.longSeconds}s ${color} loop ready after ${Math.round(performance.now() - started)}ms`)
      })
    }, LONG_LOOP_DELAY_MS)
  }

  #revokeRetired() {
    this.retired = this.retired.filter((url) => {
      if (this.players?.some((player) => player.el.src === url)) return true
      URL.revokeObjectURL(url)
      return false
    })
  }

  /** Resolves once the element is really producing sound, not just after play() resolves. */
  #started(el) {
    return new Promise((resolve) => {
      if (el.currentTime > 0) return resolve()
      const done = () => {
        clearTimeout(timer)
        el.removeEventListener('timeupdate', check)
        resolve()
      }
      const check = () => el.currentTime > 0 && done()
      const timer = setTimeout(done, START_TIMEOUT_MS)
      el.addEventListener('timeupdate', check)
    })
  }

  #applyVolume(player) {
    if (this.volumeSupported) player.el.volume = Math.sin((player.phase * Math.PI) / 2) * volumeToGain(this.volume)
  }

  /** Move every player towards audible (the active one) or silent (the rest). */
  #fade() {
    // No volume control (iOS): switch immediately.
    if (!this.volumeSupported) {
      for (const player of this.players) {
        player.phase = this.#target(player)
        if (player.phase === 0 && !player.starting) player.el.pause()
      }
      return
    }
    if (this.fading) return
    this.fading = true
    this.lastTick = performance.now()
    // Timers are held back while the screen is locked, so media events step the
    // fade too (a few times a second: coarse, but far better than an abrupt swap).
    this.ticker = setInterval(() => this.#step(), 20)
  }

  #target(player) {
    return this.playing && player === this.active ? 1 : 0
  }

  #step() {
    if (!this.fading) return
    const now = performance.now()
    const step = (now - this.lastTick) / this.fadeMs
    this.lastTick = now
    let moving = false
    for (const player of this.players) {
      const goal = this.#target(player)
      player.phase = goal > player.phase ? Math.min(goal, player.phase + step) : Math.max(goal, player.phase - step)
      this.#applyVolume(player)
      if (player.phase === goal) {
        if (goal === 0 && !player.starting && !player.el.paused) player.el.pause()
      } else {
        moving = true
      }
    }
    if (!moving) {
      this.fading = false
      clearInterval(this.ticker)
      this.ticker = null
    }
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
    const url = this.#longReady(color) ?? (await this.#url(color))
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
        // Fading before it is audible would leave a dip as the old one goes.
        await this.#started(next.el)
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
    this.#revokeRetired()
  }

  setVolume(volume) {
    this.volume = volume
    this.players?.forEach((player) => this.#applyVolume(player))
  }

  setColor(color) {
    this.#log(`colour -> ${color}`)
    this.color = color
    if (this.players && this.playing) {
      this.#show(color, ++this.token).catch(() => this.pause())
      this.#prepareLong(color)
    }
  }

  /** Must be called from a user gesture the first time (autoplay policies). */
  async play(color = this.color) {
    this.#log(`play(${color}), ${this.loopSeconds}s loops`)
    this.color = color
    this.playing = true
    this.onStateChange(true)
    this.#startKeepAlive()
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
      this.#prepareLong(color)
      // Quietly prepare the other colours so switching to them is instant.
      NOISE_TYPES.forEach((type) => this.#url(type))
    } catch (error) {
      this.playing = false
      this.#stopKeepAlive()
      this.onStateChange(false)
      throw error
    }
  }

  pause() {
    if (!this.playing) return
    this.#log('pause()')
    this.playing = false
    this.token++
    this.#stopKeepAlive()
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
      longSeconds: this.longSeconds,
      long: this.long ? `${this.long.color} ${this.long.url ? 'ready' : 'rendering'}` : null,
      players: this.players?.map((player) => ({
        color: player.color,
        active: player === this.active,
        paused: player.el.paused,
        long: Boolean(this.long?.url) && player.el.src === this.long.url,
        time: +player.el.currentTime.toFixed(1),
        volume: +player.el.volume.toFixed(2),
      })),
    }
  }
}
