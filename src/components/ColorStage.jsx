import { useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { keyframes } from '@mui/material/styles'
import { displayFont } from '../theme.js'
import PlayButton from './PlayButton.jsx'

const SWIPE_DISTANCE = 56 // px
const SWIPE_VELOCITY = 0.4 // px per ms

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(calc(var(--from) * 1px)); }
  to { opacity: 1; transform: translateX(0); }
`

/**
 * The main area: play/pause plus the current colour's name. Dragging it
 * sideways (or flicking) moves to the next or previous colour.
 */
export default function ColorStage({ color, playing, onToggle, onStep }) {
  const [drag, setDrag] = useState(0)
  const [direction, setDirection] = useState(1)
  const gesture = useRef(null)
  const suppressClick = useRef(false)

  const onPointerDown = (event) => {
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, dragging: false }
  }

  const onPointerMove = (event) => {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    const dx = event.clientX - g.x
    const dy = event.clientY - g.y
    if (!g.dragging) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return
      g.dragging = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setDrag(dx)
  }

  const finish = (event) => {
    const g = gesture.current
    if (!g || g.id !== event.pointerId) return
    gesture.current = null
    if (!g.dragging) return
    // A click may follow the pointerup; swallow it, but don't leave the flag
    // set if the browser doesn't fire one.
    suppressClick.current = true
    setTimeout(() => {
      suppressClick.current = false
    }, 0)
    const dx = event.clientX - g.x
    const velocity = Math.abs(dx) / Math.max(1, event.timeStamp - g.t)
    setDrag(0)
    if (event.type === 'pointercancel') return
    if (Math.abs(dx) > SWIPE_DISTANCE || (Math.abs(dx) > 24 && velocity > SWIPE_VELOCITY)) {
      const delta = dx < 0 ? 1 : -1
      setDirection(delta)
      onStep(delta)
    }
  }

  const onClickCapture = (event) => {
    if (suppressClick.current) {
      suppressClick.current = false
      event.stopPropagation()
      event.preventDefault()
    }
  }

  const dragging = drag !== 0

  return (
    <Box
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onClickCapture={onClickCapture}
      sx={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: { xs: 4, sm: 5 },
        touchAction: 'pan-y',
        userSelect: 'none',
        cursor: dragging ? 'grabbing' : 'default',
      }}
    >
      <Box
        sx={{
          transform: `translateX(${drag * 0.35}px)`,
          transition: dragging ? 'none' : 'transform 0.3s ease',
        }}
      >
        <PlayButton playing={playing} onClick={onToggle} />
      </Box>

      <Box
        sx={{
          textAlign: 'center',
          px: 3,
          maxWidth: 420,
          transform: `translateX(${drag * 0.6}px)`,
          opacity: dragging ? Math.max(0.3, 1 - Math.abs(drag) / 260) : 1,
          transition: dragging ? 'none' : 'transform 0.3s ease, opacity 0.3s ease',
        }}
      >
        <Box
          key={color.id}
          sx={{
            '--from': direction * 36,
            animation: `${slideIn} 0.35s ease-out`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <Typography
            component="h1"
            variant="h1"
            sx={{ fontSize: { xs: '3.2rem', sm: '3.8rem' }, lineHeight: 1.1, color: 'var(--accent)', transition: 'color 1s ease' }}
            style={{ fontFamily: displayFont }}
          >
            {color.name}
          </Typography>
          <Typography
            sx={{ mt: 1.5, fontStyle: 'italic', color: 'text.secondary', fontSize: '1.02rem', lineHeight: 1.6, minHeight: '3.3em' }}
          >
            {color.description}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
