// Renders public/icon.svg to the PNG icons the manifest needs.
// Uses Playwright's Chromium (not a project dependency): run with
// `NODE_PATH=$(npm root -g) npm run icons` or wherever Playwright is installed.
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svg = await readFile(path.join(root, 'public/icon.svg'), 'utf8')
const outDir = path.join(root, 'public/icons')
await mkdir(outDir, { recursive: true })

// `inset` shrinks the artwork so it survives the circular mask of maskable icons.
const targets = [
  { file: 'icon-192.png', size: 192, inset: 0 },
  { file: 'icon-512.png', size: 512, inset: 0 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.2 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0 },
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const { file, size, inset } of targets) {
  await page.setViewportSize({ width: size, height: size })
  const art = Math.round(size * (1 - inset * 2))
  const offset = Math.round((size - art) / 2)
  await page.setContent(
    `<body style="margin:0;background:#0d0f12;overflow:hidden">
       <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 35%,#23262e,#0d0f12 75%)"></div>
       <div style="position:absolute;left:${offset}px;top:${offset}px;width:${art}px;height:${art}px">${svg
         .replace('<rect width="512" height="512" fill="url(#bg)"/>', '')
         .replace('<svg ', `<svg width="${art}" height="${art}" `)}</div>
     </body>`,
  )
  await page.screenshot({ path: path.join(outDir, file) })
  console.log('wrote', file)
}
await browser.close()
