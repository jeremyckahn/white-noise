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
