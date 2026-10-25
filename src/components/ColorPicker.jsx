import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import { NOISE_COLORS } from '../noiseColors.js'

/** Always-visible row so any colour is one tap away. */
export default function ColorPicker({ selectedIndex, onSelect }) {
  return (
    <Box
      role="radiogroup"
      aria-label="Noise colour"
      sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${NOISE_COLORS.length}, 1fr)`,
        gap: 0.5,
        width: '100%',
        maxWidth: 440,
      }}
    >
      {NOISE_COLORS.map((color, index) => {
        const selected = index === selectedIndex
        return (
          <ButtonBase
            key={color.id}
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(index)}
            sx={{
              flexDirection: 'column',
              gap: 0.75,
              py: 1,
              borderRadius: 2,
              color: selected ? 'text.primary' : 'text.secondary',
              fontFamily: 'inherit',
              fontSize: '0.88rem',
              fontStyle: selected ? 'normal' : 'italic',
              transition: 'color 0.3s ease, background-color 0.3s ease',
              backgroundColor: selected ? 'rgba(255,255,255,0.06)' : 'transparent',
              '&.Mui-focusVisible': { outline: '2px solid var(--accent)' },
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: color.accent,
                opacity: selected ? 1 : 0.4,
                boxShadow: selected ? `0 0 14px ${color.accent}` : 'none',
                transform: selected ? 'scale(1.15)' : 'scale(1)',
                transition: 'opacity 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease',
              }}
            />
            {color.name}
          </ButtonBase>
        )
      })}
    </Box>
  )
}
