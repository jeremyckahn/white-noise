/** Encodes Float32 channels (-1..1) as a 16-bit PCM WAV Blob. */
export const encodeWav = (channels, sampleRate) => {
  const frames = channels[0].length
  const bytes = frames * channels.length * 2
  const view = new DataView(new ArrayBuffer(44 + bytes))
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels.length * 2, true)
  view.setUint16(32, channels.length * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, bytes, true)
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (const data of channels) {
      const sample = data[i] > 1 ? 1 : data[i] < -1 ? -1 : data[i]
      view.setInt16(offset, Math.round(sample * 32767), true)
      offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
