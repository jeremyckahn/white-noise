import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Slider from '@mui/material/Slider'
import Typography from '@mui/material/Typography'
import VolumeDownRounded from '@mui/icons-material/VolumeDownRounded'
import VolumeUpRounded from '@mui/icons-material/VolumeUpRounded'
import { NOISE_COLORS } from './noiseColors.js'
import { useNoisePlayer } from './hooks/useNoisePlayer.js'
import ColorStage from './components/ColorStage.jsx'
import ColorPicker from './components/ColorPicker.jsx'

const debug = new URLSearchParams(window.location.search).has('debug')

// Plain-text engine state and event log, shown with ?debug to help diagnose
// problems on a device (for example what happened while the screen was locked).
function DebugInfo({ engine }) {
  const [info, setInfo] = useState('')
  const [copied, setCopied] = useState(false)
  const report = () => `build ${__BUILD_ID__}\n${JSON.stringify(engine.diagnostics())}\n${engine.logLines().join('\n')}`
  useEffect(() => {
    const update = () => setInfo(`build ${__BUILD_ID__} \u00b7 ${JSON.stringify(engine.diagnostics())}\n${engine.logLines(8).join('\n')}`)
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [engine])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report())
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <Box sx={{ width: '100%' }}>
      <Typography sx={{ fontFamily: 'monospace', fontSize: '0.62rem', color: 'text.secondary', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
        {info}
      </Typography>
      <Button size="small" onClick={copy} sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
        {copied ? 'Copied' : 'Copy full log'}
      </Button>
    </Box>
  )
}

export default function App() {
  const player = useNoisePlayer()
  const { color, colorIndex, playing, volume, step } = player

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement && event.target.closest('[role="slider"]')) return
      if (event.key === 'ArrowRight') step(1)
      else if (event.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step])

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', color.bgBottom)
  }, [color])

  return (
    <Box
      sx={{
        '--accent': color.accent,
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pt: 'max(20px, env(safe-area-inset-top))',
        pb: 'max(20px, env(safe-area-inset-bottom))',
        px: 2.5,
        overflow: 'hidden',
      }}
    >
      {/* One backdrop per colour, cross-faded for a slow, gentle change. */}
      {NOISE_COLORS.map((c) => (
        <Box
          key={c.id}
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: -1,
            background: `radial-gradient(ellipse at 50% 30%, ${c.bgTop}, ${c.bgBottom} 75%)`,
            opacity: c.id === color.id ? 1 : 0,
            transition: 'opacity 1.2s ease',
          }}
        />
      ))}

      <Typography
        component="p"
        sx={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.25rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'text.secondary' }}
      >
        Lull
      </Typography>

      <ColorStage color={color} playing={playing} onToggle={player.toggle} onStep={step} />

      <Box sx={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2.5 }}>
        <Typography
          role="status"
          sx={{ minHeight: '1.5em', fontSize: '0.85rem', fontStyle: 'italic', color: 'text.secondary', textAlign: 'center' }}
        >
          {player.error ??
            (!player.supported
              ? 'Audio is not supported in this browser.'
              : !player.hasSwitched
                ? 'Swipe sideways, or tap a colour'
                : '')}
        </Typography>

        {debug && <DebugInfo engine={player.engine} />}

        <ColorPicker selectedIndex={colorIndex} onSelect={player.selectIndex} />

        {/* Phones without per-app volume (iOS) use the hardware buttons instead. */}
        {player.volumeSupported && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', px: 1, color: 'text.secondary' }}>
            <VolumeDownRounded fontSize="small" />
            <Slider
              aria-label="Volume"
              value={volume}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, value) => player.setVolume(value)}
              sx={{
                color: 'var(--accent)',
                transition: 'color 1s ease',
                '& .MuiSlider-rail': { opacity: 0.25 },
                '& .MuiSlider-thumb': { width: 18, height: 18 },
              }}
            />
            <VolumeUpRounded fontSize="small" />
          </Box>
        )}
      </Box>
    </Box>
  )
}
