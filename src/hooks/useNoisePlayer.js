import { useCallback, useEffect, useRef, useState } from 'react'
import { NoiseEngine } from '../audio/NoiseEngine.js'
import { NOISE_COLORS } from '../noiseColors.js'

const STORAGE_KEY = 'white-noise:settings'

const readSettings = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

const writeSettings = (settings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* storage unavailable */
  }
}

const wrap = (index) => (index + NOISE_COLORS.length) % NOISE_COLORS.length

export function useNoisePlayer() {
  const [initial] = useState(readSettings)
  const [colorIndex, setColorIndex] = useState(() => {
    const index = NOISE_COLORS.findIndex((c) => c.id === initial.color)
    return index === -1 ? 0 : index
  })
  const [volume, setVolumeState] = useState(
    typeof initial.volume === 'number' ? Math.min(1, Math.max(0, initial.volume)) : 0.6,
  )
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(null)
  const [hasSwitched, setHasSwitched] = useState(Boolean(initial.hasSwitched))

  const engineRef = useRef(null)
  if (!engineRef.current) engineRef.current = new NoiseEngine({ onStateChange: setPlaying })
  const engine = engineRef.current

  const colorIndexRef = useRef(colorIndex)
  colorIndexRef.current = colorIndex

  useEffect(() => {
    writeSettings({ color: NOISE_COLORS[colorIndex].id, volume, hasSwitched })
  }, [colorIndex, volume, hasSwitched])

  useEffect(() => {
    engine.setVolume(volume)
  }, [engine, volume])

  const play = useCallback(async () => {
    setError(null)
    try {
      await engine.play(NOISE_COLORS[colorIndexRef.current].id)
    } catch {
      setError('Sound could not be started on this device.')
    }
  }, [engine])

  const pause = useCallback(() => engine.pause(), [engine])

  const toggle = useCallback(() => {
    if (engine.playing) pause()
    else play()
  }, [engine, play, pause])

  const selectIndex = useCallback(
    (index) => {
      const next = wrap(index)
      colorIndexRef.current = next
      setColorIndex(next)
      setHasSwitched(true)
      engine.setColor(NOISE_COLORS[next].id)
    },
    [engine],
  )

  const step = useCallback((delta) => selectIndex(colorIndexRef.current + delta), [selectIndex])

  // Lock-screen / notification controls, and metadata for them.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const color = NOISE_COLORS[colorIndex]
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${color.name} noise`,
      artist: 'Lull',
      album: 'White Noise',
      artwork: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    })
  }, [colorIndex])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const handlers = {
      play,
      pause,
      previoustrack: () => step(-1),
      nexttrack: () => step(1),
    }
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        /* action unsupported */
      }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action, null)
        } catch {
          /* action unsupported */
        }
      }
    }
  }, [play, pause, step])

  // Come back from interruptions (calls, alarms, the OS reclaiming audio).
  useEffect(() => {
    const recover = () => {
      if (document.visibilityState === 'visible') engine.recover()
    }
    document.addEventListener('visibilitychange', recover)
    window.addEventListener('pageshow', recover)
    return () => {
      document.removeEventListener('visibilitychange', recover)
      window.removeEventListener('pageshow', recover)
    }
  }, [engine])

  return {
    colorIndex,
    color: NOISE_COLORS[colorIndex],
    playing,
    volume,
    error,
    hasSwitched,
    supported: engine.supported,
    toggle,
    step,
    selectIndex,
    setVolume: setVolumeState,
  }
}
