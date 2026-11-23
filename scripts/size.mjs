// Reports what a phone downloads and stores to install the app: `npm run size` (after build).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const dist = new URL('../dist/', import.meta.url).pathname
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const files = walk(dist)
const kb = (n) => (n / 1024).toFixed(1)
let raw = 0, gz = 0, br = 0
const rows = files.map((f) => {
  const b = readFileSync(f)
  const g = gzipSync(b, { level: 9 }).length
  const r = brotliCompressSync(b).length
  raw += b.length; gz += g; br += r
  return [relative(dist, f), b.length, g, r]
}).sort((a, b) => b[1] - a[1])
console.log('file'.padEnd(40), 'raw KB', 'gzip KB', 'brotli KB')
for (const [f, a, g, r] of rows) console.log(f.padEnd(40), kb(a).padStart(6), kb(g).padStart(7), kb(r).padStart(9))
console.log('TOTAL'.padEnd(40), kb(raw).padStart(6), kb(gz).padStart(7), kb(br).padStart(9))
const code = rows.filter(([f]) => /\.(js|css|html)$/.test(f))
console.log('code only (js+css+html) gzip KB:', kb(code.reduce((n, r) => n + r[2], 0)))
const deps = Object.keys(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).dependencies)
console.log('runtime dependencies:', deps.length, deps.join(', '))
