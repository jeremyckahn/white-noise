import { describe, expect, it } from 'vitest'
import { NOISE_TYPES, TARGET_RMS } from '../src/audio/generators.js'
import { renderLoop, renderLoopChannel } from '../src/audio/loop.js'

const RATE = 48000
const SEAM = 1.5

const rms = (data, from, to) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (to - from))
}

describe('seamless loops', () => {
  it('renders independent stereo channels of the requested length', () => {
    const [left, right] = renderLoop('white', RATE, { seconds: 4, seam: 0.5 })
    expect(left.length).toBe(4 * RATE)
    expect(right.length).toBe(4 * RATE)
    expect(Array.from(left.slice(0, 100))).not.toEqual(Array.from(right.slice(0, 100)))
  })

  it.each(NOISE_TYPES)('%s keeps a steady level across the whole loop, seam included', (type) => {
    const data = renderLoopChannel(type, RATE, { seconds: 12, seam: SEAM })
    const seam = Math.round(SEAM * RATE)
    // Slow colours (pink, brown) wander in level, so compare against a loose band
    // around the target rather than against each other.
    const seamLevel = rms(data, 0, seam)
    const bodyLevel = rms(data, seam, data.length)
    expect(seamLevel).toBeGreaterThan(TARGET_RMS * 0.6)
    expect(seamLevel).toBeLessThan(TARGET_RMS * 1.4)
    expect(bodyLevel).toBeGreaterThan(TARGET_RMS * 0.8)
    expect(bodyLevel).toBeLessThan(TARGET_RMS * 1.2)
  })

  it('has no step at the wrap-around point', () => {
    // The jump from the last sample back to the first should look like any other
    // adjacent pair of samples, not like a splice.
    for (const type of ['white', 'pink', 'brown']) {
      const data = renderLoopChannel(type, RATE, { seconds: 12, seam: SEAM })
      let typical = 0
      for (let i = 1; i < 20000; i++) typical = Math.max(typical, Math.abs(data[i + 30000] - data[i + 29999]))
      const wrap = Math.abs(data[0] - data[data.length - 1])
      expect(wrap).toBeLessThanOrEqual(typical * 1.5)
    }
  })

  it('never exceeds full scale', () => {
    const data = renderLoopChannel('brown', RATE, { seconds: 6, seam: 1 })
    let peak = 0
    for (const x of data) peak = Math.max(peak, Math.abs(x))
    expect(peak).toBeLessThanOrEqual(0.99)
  })
})

describe('wav encoding', () => {
  it('writes a valid 16-bit PCM header and clamps samples', async () => {
    const { encodeWav } = await import('../src/audio/wav.js')
    const blob = encodeWav([new Float32Array([0, 1, -1, 2]), new Float32Array([0.5, 0, 0, -3])], 44100)
    const view = new DataView(await blob.arrayBuffer())
    const tag = (offset) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)))
    expect([tag(0), tag(8), tag(36)]).toEqual(['RIFF', 'WAVE', 'data'])
    expect(view.getUint16(22, true)).toBe(2) // channels
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2)
    expect(blob.size).toBe(44 + 16)
    // Interleaved: L0 R0 L1 R1 ... with 2 and -3 clamped to full scale.
    expect(view.getInt16(44 + 4, true)).toBe(32767)
    expect(view.getInt16(44 + 14, true)).toBe(-32767)
  })
})

describe('short loops', () => {
  it('renders a one-second loop with a seam that fits inside it', () => {
    const [left] = renderLoop('pink', RATE, { seconds: 1 })
    expect(left.length).toBe(RATE)
    let peak = 0
    for (const x of left) peak = Math.max(peak, Math.abs(x))
    expect(peak).toBeLessThanOrEqual(0.99)
  })
})
