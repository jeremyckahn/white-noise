// Procedural noise generators. Each generator is a closure that returns one
// sample per call, so it can run forever without ever repeating a buffer.
// This module is shared by the AudioWorklet and the unit tests, so it must
// not touch any browser-only globals.

export const NOISE_TYPES = ['white', 'pink', 'brown', 'blue', 'violet', 'grey']

// Every colour is scaled to roughly the same RMS so switching between them
// does not jump in loudness.
export const TARGET_RMS = 0.2

const CEILING = 0.95

const clamp = (x) => (x > CEILING ? CEILING : x < -CEILING ? -CEILING : x)

const uniform = (random) => random() * 2 - 1

// Calibrated against 4M-sample runs (see test/generators.test.js).
const SCALE = {
  white: 0.3464,
  pink: 0.1134,
  brown: 3.45,
  blue: 0.191,
  violet: 0.245,
  grey: 0.191,
}

const white = (random) => () => clamp(uniform(random) * SCALE.white)

// Paul Kellet's refined pink noise filter (-3 dB/octave).
const makePink = (random) => {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  return () => {
    const w = uniform(random)
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
    return out
  }
}

const pink = (random) => {
  const next = makePink(random)
  return () => clamp(next() * SCALE.pink)
}

// Leaky integrator of white noise (-6 dB/octave).
const brown = (random) => {
  let last = 0
  return () => {
    last = (last + 0.02 * uniform(random)) / 1.02
    return clamp(last * SCALE.brown)
  }
}

// Differentiated pink noise (+3 dB/octave).
const blue = (random) => {
  const next = makePink(random)
  let prev = 0
  return () => {
    const p = next()
    const out = p - prev
    prev = p
    return clamp(out * SCALE.blue)
  }
}

// Differentiated white noise (+6 dB/octave).
const violet = (random) => {
  let prev = 0
  return () => {
    const w = uniform(random)
    const out = w - prev
    prev = w
    return clamp(out * SCALE.violet)
  }
}

// RBJ audio-EQ-cookbook biquads (direct form I).
const biquad = (type, sampleRate, freq, gainDb, q) => {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  let b0, b1, b2, a0, a1, a2
  if (type === 'peaking') {
    b0 = 1 + alpha * A
    b1 = -2 * cos
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cos
    a2 = 1 - alpha / A
  } else {
    const k = 2 * Math.sqrt(A) * alpha
    const sign = type === 'lowshelf' ? 1 : -1
    b0 = A * (A + 1 - sign * (A - 1) * cos + k)
    b1 = sign * 2 * A * (A - 1 - sign * (A + 1) * cos)
    b2 = A * (A + 1 - sign * (A - 1) * cos - k)
    a0 = A + 1 + sign * (A - 1) * cos + k
    a1 = -sign * 2 * (A - 1 + sign * (A + 1) * cos)
    a2 = A + 1 + sign * (A - 1) * cos - k
  }
  b0 /= a0
  b1 /= a0
  b2 /= a0
  a1 /= a0
  a2 /= a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    return y
  }
}

// White noise shaped by roughly the inverse of the ear's loudness curve, so
// that every frequency sounds about equally loud: a lift in the deep bass,
// a dip around the ear's sensitive 2-5 kHz region and a lift in the treble.
const grey = (random, sampleRate) => {
  const low = biquad('lowshelf', sampleRate, 150, 12, 0.7)
  const mid = biquad('peaking', sampleRate, 3200, -10, 0.6)
  const high = biquad('highshelf', sampleRate, 9000, 8, 0.7)
  return () => clamp(high(mid(low(uniform(random)))) * SCALE.grey)
}

const FACTORIES = { white, pink, brown, blue, violet, grey }

export const createGenerator = (type, sampleRate = 48000, random = Math.random) => {
  const factory = FACTORIES[type]
  if (!factory) throw new Error(`Unknown noise type: ${type}`)
  return factory(random, sampleRate)
}
