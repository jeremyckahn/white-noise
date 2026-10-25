import { describe, expect, it } from 'vitest'
import { createGenerator, NOISE_TYPES, TARGET_RMS } from '../src/audio/generators.js'

const SAMPLE_RATE = 48000
const N = 1 << 18

const render = (type, n = N) => {
  const gen = createGenerator(type, SAMPLE_RATE)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = gen()
  return out
}

// In-place radix-2 FFT.
const fft = (re, im) => {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = i + k + len / 2
        const tr = re[b] * cr - im[b] * ci
        const ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

// Average power spectrum over several windows, to cut estimator variance.
const powerSpectrum = (samples, size = 4096) => {
  const power = new Float64Array(size / 2)
  const windows = Math.floor(samples.length / size)
  for (let w = 0; w < windows; w++) {
    const re = new Float64Array(size)
    const im = new Float64Array(size)
    for (let i = 0; i < size; i++) {
      const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
      re[i] = samples[w * size + i] * hann
    }
    fft(re, im)
    for (let i = 0; i < size / 2; i++) power[i] += (re[i] * re[i] + im[i] * im[i]) / windows
  }
  return power
}

const bandDb = (power, size, lo, hi) => {
  const binHz = SAMPLE_RATE / size
  let sum = 0
  let count = 0
  for (let i = Math.ceil(lo / binHz); i < Math.floor(hi / binHz); i++) {
    sum += power[i]
    count++
  }
  return 10 * Math.log10(sum / count)
}

// dB per octave of power spectral density, fit between two octave-spaced
// bands in the middle of the spectrum.
const slopePerOctave = (type) => {
  const size = 4096
  const power = powerSpectrum(render(type), size)
  const octaves = [
    [500, 1000],
    [1000, 2000],
    [2000, 4000],
    [4000, 8000],
  ].map(([lo, hi]) => bandDb(power, size, lo, hi))
  return (octaves[3] - octaves[0]) / 3
}

describe('noise generators', () => {
  it.each(NOISE_TYPES)('%s is loudness-matched and bounded', (type) => {
    const samples = render(type)
    let sum = 0
    let peak = 0
    for (const x of samples) {
      sum += x * x
      peak = Math.max(peak, Math.abs(x))
    }
    const rms = Math.sqrt(sum / samples.length)
    expect(rms).toBeGreaterThan(TARGET_RMS * 0.85)
    expect(rms).toBeLessThan(TARGET_RMS * 1.15)
    expect(peak).toBeLessThanOrEqual(0.95)
  })

  // Pink and brown carry so much slow energy that their sample mean wanders
  // naturally, so only the flatter colours are checked for DC offset.
  it.each(['white', 'blue', 'violet', 'grey'])('%s has no DC offset', (type) => {
    const samples = render(type)
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    expect(Math.abs(mean)).toBeLessThan(0.01)
  })

  it.each([
    ['white', 0],
    ['pink', -3],
    ['brown', -6],
    ['blue', 3],
    ['violet', 6],
  ])('%s has a %i dB/octave slope', (type, expected) => {
    expect(Math.abs(slopePerOctave(type) - expected)).toBeLessThan(1)
  })

  it('grey dips in the mid range relative to bass and treble', () => {
    const size = 4096
    const power = powerSpectrum(render('grey'), size)
    const bass = bandDb(power, size, 40, 100)
    const mid = bandDb(power, size, 2500, 4000)
    const treble = bandDb(power, size, 12000, 16000)
    expect(bass - mid).toBeGreaterThan(6)
    expect(treble - mid).toBeGreaterThan(6)
  })

  it('produces a different stream for each generator instance', () => {
    const a = render('pink', 1000)
    const b = render('pink', 1000)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('rejects unknown noise types', () => {
    expect(() => createGenerator('plaid')).toThrow()
  })
})
