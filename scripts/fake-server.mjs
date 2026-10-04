// A local server for trying Plexo without a real download. Every path is a file of zeros:
//   http://<this computer's address>:8099/movie.part1.rar?mb=200
// `mb` is the size in MB (default 100) and `kbps` caps the speed per connection in KB/s
// (default 2000). Supports ranges, so Plexo splits it like a real file. Nothing touches the
// internet. Run: node scripts/fake-server.mjs [port]
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

const port = Number(process.argv[2]) || 8099
const CHUNK = 64 * 1024

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const size = Math.round(Number(url.searchParams.get('mb') ?? 100) * 1024 * 1024)
  const kbps = Number(url.searchParams.get('kbps') ?? 2000)
  const name = decodeURIComponent(url.pathname.split('/').pop() || 'file.bin')
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
    ETag: `"fake-${name}-${size}"`
  }
  let start = 0
  let end = size - 1
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (range) {
    if (range[1] !== '') start = Number(range[1])
    if (range[2] !== '') end = Math.min(Number(range[2]), size - 1)
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2]))
      end = size - 1
    }
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1
    })
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size })
  }
  if (req.method === 'HEAD') return res.end()

  let sent = start
  const perTick = Math.max(1, Math.round((kbps * 1024) / 20))
  const timer = setInterval(() => {
    let budget = perTick
    while (budget > 0 && sent <= end) {
      const n = Math.min(CHUNK, budget, end - sent + 1)
      res.write(Buffer.alloc(n))
      sent += n
      budget -= n
    }
    if (sent > end) {
      clearInterval(timer)
      res.end()
    }
  }, 50)
  res.on('close', () => clearInterval(timer))
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Fake download server on port ${port}. Use one of:`)
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list ?? [])
      if (a.family === 'IPv4' && !a.internal)
        console.log(`  http://${a.address}:${port}/test-file-1.rar?mb=200   (${name})`)
})
