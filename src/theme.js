import { createTheme } from '@mui/material/styles'

const display = '"Cormorant Garamond", "Iowan Old Style", "Palatino Linotype", Georgia, serif'
const text = '"Lora", "Iowan Old Style", "Palatino Linotype", Georgia, serif'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: { default: '#0d0f12', paper: '#16181d' },
    text: { primary: '#ece7dc', secondary: 'rgba(236, 231, 220, 0.62)' },
  },
  typography: {
    fontFamily: text,
    h1: { fontFamily: display, fontWeight: 400, letterSpacing: '0.02em' },
    h2: { fontFamily: display, fontWeight: 400, letterSpacing: '0.02em' },
    button: { fontFamily: text, textTransform: 'none' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitTapHighlightColor: 'transparent', overscrollBehavior: 'none' },
        body: { overscrollBehavior: 'none', overflow: 'hidden' },
      },
    },
  },
})

export const displayFont = display
