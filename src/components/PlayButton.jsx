import ButtonBase from '@mui/material/ButtonBase'
import Box from '@mui/material/Box'
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded'
import PauseRounded from '@mui/icons-material/PauseRounded'
import { keyframes } from '@mui/material/styles'

const breathe = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.35; }
  50% { transform: scale(1.14); opacity: 0.08; }
`

const reduceMotion = '@media (prefers-reduced-motion: reduce)'

export default function PlayButton({ playing, onClick }) {
  const Icon = playing ? PauseRounded : PlayArrowRounded
  return (
    <Box sx={{ position: 'relative', width: 176, height: 176 }}>
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: '1px solid var(--accent)',
          opacity: 0,
          transition: 'opacity 1s ease',
          ...(playing && {
            animation: `${breathe} 8s ease-in-out infinite`,
            [reduceMotion]: { animation: 'none', opacity: 0.2 },
          }),
        }}
      />
      <ButtonBase
        onClick={onClick}
        aria-label={playing ? 'Pause noise' : 'Play noise'}
        sx={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          color: 'var(--accent)',
          border: '1px solid',
          borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
          background:
            'radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 4%, transparent) 70%)',
          boxShadow: '0 0 60px color-mix(in srgb, var(--accent) 12%, transparent)',
          transition: 'color 1s ease, border-color 1s ease, background 1s ease, transform 0.2s ease',
          '&:active': { transform: 'scale(0.97)' },
          '&.Mui-focusVisible': { outline: '2px solid var(--accent)', outlineOffset: 6 },
        }}
      >
        <Icon sx={{ fontSize: 76 }} />
      </ButtonBase>
    </Box>
  )
}
