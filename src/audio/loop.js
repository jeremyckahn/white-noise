import { createGenerator } from './generators.js'

export const LOOP_SECONDS = 20
export const SEAM_SECONDS = 1.5

// Filters start from silence, so skip the first few thousand samples.
const WARM_UP = 8192
const CEILING = 0.99

/**
 * Renders one seamlessly loopable channel of noise.
 *
 * `fade` extra samples are generated past the end of the loop, and are
 * cross-faded (equal power, since the two stretches are uncorrelated) into the
 * start. The loop's last sample is then followed by the sample that naturally
 * came next in the stream, so there is no click or level dip at the seam.
 */
export const renderLoopChannel = (type, sampleRate, { seconds = LOOP_SECONDS, seam = SEAM_SECONDS, random } = {}) => {
  const length = Math.round(seconds * sampleRate)
  const fade = Math.min(Math.round(seam * sampleRate), length >> 1)
  const generate = createGenerator(type, sampleRate, random)
  for (let i = 0; i < WARM_UP; i++) generate()

  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) data[i] = generate()
  for (let i = 0; i < fade; i++) {
    const angle = ((i + 0.5) / fade) * (Math.PI / 2)
    const mixed = data[i] * Math.sin(angle) + generate() * Math.cos(angle)
    data[i] = mixed > CEILING ? CEILING : mixed < -CEILING ? -CEILING : mixed
  }
  return data
}

/** Stereo, with an independent stream per channel for a wider, calmer sound. */
export const renderLoop = (type, sampleRate, options) => [
  renderLoopChannel(type, sampleRate, options),
  renderLoopChannel(type, sampleRate, options),
]
