// A local server for trying Lightning without a real download. Every path is a file of zeros:
//   http://<this computer's address>:8099/movie.part1.rar?mb=200
// Query options: mb=<size in MB, default 100>, kbps=<cap per connection, default none>,
// fail=N (answer 500 to the first N requests of that exact link), norange=1 (no range support).
//
// Speed is limited per NETWORK, shared by all of that network's connections. A network is named
// by the request header X-Lightning-Network (sent by the dev fake-network copy of Lightning), else by the
// client's source address (e.g. Wi-Fi 192.168.1.4 vs. tunnel 198.18.0.1 when a VPN is up).
// Open http://127.0.0.1:<port>/ for the control page: live sliders, scenarios, ready-made links.
// Control URLs: /__speed?net=<key>&kbps=<n> (0 unlimited, -1 block), /__state, /__reset,
// /__scenario?name=<name>[&a=<key>&b=<key>]. Nothing touches the internet.
// Run: node scripts/fake-server.mjs [port]
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

const port = Number(process.argv[2]) || 8099
const CHUNK = 64 * 1024
const TICK_MS = 50
const MAX_PER_TICK = 2 * 1024 * 1024
const DEFAULT_KBPS = 4000
const ZERO = Buffer.alloc(CHUNK)

/** key -> { cap (KB/s; 0 unlimited, -1 blocked), carry, conns, sent, sec, bps, seen } */
const nets = new Map()
const order = [] // keys in the order first seen
const failCounts = new Map()
const events = []
let timers = []
let scenario = 'steady'

function note(msg) {
  events.push({ t: new Date().toISOString().slice(11, 19), msg })
  if (events.length > 60) events.shift()
  console.log(`[${events.at(-1).t}] ${msg}`)
}

function net(key) {
  let n = nets.get(key)
  if (!n) {
    n = { cap: DEFAULT_KBPS, carry: 0, conns: new Set(), sent: 0, sec: 0, bps: 0, seen: Date.now() }
    nets.set(key, n)
    order.push(key)
    note(`new network seen: ${key}`)
  }
  return n
}

function setCap(key, kbps) {
  const n = net(key)
  n.cap = kbps
  note(`${key} -> ${kbps < 0 ? 'BLOCKED' : kbps === 0 ? 'unlimited' : kbps + ' KB/s'}`)
  if (kbps < 0) for (const c of [...n.conns]) c.res.destroy()
}

function clearTimers() {
  for (const t of timers) {
    clearTimeout(t)
    clearInterval(t)
  }
  timers = []
}

function reset() {
  clearTimers()
  scenario = 'steady'
  failCounts.clear()
  for (const key of nets.keys()) nets.get(key).cap = DEFAULT_KBPS
  note(`reset: every network back to ${DEFAULT_KBPS} KB/s`)
}

const hint = (re) => order.find((k) => re.test(k))

/** Runs a scenario; returns an error string if it needs networks not seen yet. */
function runScenario(name, q) {
  const a = q.get('a') || order[0]
  const b = q.get('b') || order[1]
  const wifi = q.get('a') || hint(/wi-?fi|^192\.168\./i) || a
  const vpn = q.get('b') || hint(/vpn|^198\.18\./i) || b
  const needs = (...keys) =>
    keys.some((k) => !k)
      ? 'Needs two networks: start a download on each, or pass ?a=<key>&b=<key>. Seen: ' +
        (order.join(', ') || 'none')
      : null
  const later = (s, fn) => timers.push(setTimeout(fn, s * 1000))
  const known = ['steady', 'wifi-collapse', 'wifi-recover', 'swap', 'flap', 'lan-dies', 'vpn-fast']
  if (!known.includes(name)) return `Unknown scenario. One of: ${known.join(', ')}`
  const err = name === 'steady' ? null : name === 'vpn-fast' ? needs(wifi, vpn) : needs(a)
  if (err) return err
  reset()
  scenario = name
  note(`scenario: ${name}`)
  if (b && name !== 'steady' && name !== 'vpn-fast') setCap(b, name === 'swap' ? 500 : 3000)
  if (name === 'wifi-collapse') {
    setCap(a, 6000)
    later(20, () => setCap(a, 300))
  } else if (name === 'wifi-recover') {
    setCap(a, 300)
    later(20, () => setCap(a, 6000))
  } else if (name === 'swap') {
    setCap(a, 6000)
    later(30, () => {
      setCap(a, 500)
      if (b) setCap(b, 6000)
    })
  } else if (name === 'flap') {
    let fast = true
    setCap(a, 6000)
    timers.push(
      setInterval(() => {
        fast = !fast
        setCap(a, fast ? 6000 : 500)
      }, 4000)
    )
  } else if (name === 'lan-dies') {
    setCap(a, 4000)
    later(25, () => setCap(a, -1))
  } else if (name === 'vpn-fast') {
    setCap(vpn, 8000)
    setCap(wifi, 1500)
  }
  return null
}

// One shared clock hands out each network's byte budget to its connections, round-robin.
setInterval(() => {
  for (const n of nets.values()) {
    if (n.cap < 0) continue
    const perTick = n.cap === 0 ? Infinity : (n.cap * 1024 * TICK_MS) / 1000
    let budget = n.carry + perTick
    const live = [...n.conns].filter((c) => c.sent <= c.end && !c.res.writableNeedDrain)
    for (const c of live) {
      const own = c.kbps > 0 ? (c.kbps * 1024 * TICK_MS) / 1000 : Infinity
      c.allow = Math.min(MAX_PER_TICK, c.carry + own)
    }
    let progress = true
    while (budget > 0 && progress) {
      progress = false
      for (const c of live) {
        const k = Math.min(CHUNK, budget, c.allow, c.end - c.sent + 1)
        if (k <= 0) continue
        c.res.write(ZERO.subarray(0, k))
        c.sent += k
        c.allow -= k
        budget -= k
        n.sent += k
        n.sec += k
        progress = true
      }
    }
    n.carry = live.length ? Math.min(budget, perTick) : 0
    for (const c of live) {
      c.carry = c.kbps > 0 ? Math.min(c.allow, (c.kbps * 1024 * TICK_MS) / 1000) : 0
      if (c.sent > c.end) {
        n.conns.delete(c)
        c.res.end()
      }
    }
  }
}, TICK_MS)
setInterval(() => {
  for (const n of nets.values()) {
    n.bps = n.sec
    n.sec = 0
  }
}, 1000)

const hosts = () => [
  '127.0.0.1',
  ...Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address)
]

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}

function state() {
  return {
    port,
    scenario,
    defaultKbps: DEFAULT_KBPS,
    hosts: hosts(),
    networks: order.map((key) => {
      const n = nets.get(key)
      return {
        key,
        capKBps: n.cap,
        bytesPerSec: n.bps,
        activeConnections: n.conns.size,
        bytesSent: n.sent
      }
    }),
    events: events.slice(-25)
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const q = url.searchParams
  const p = url.pathname
  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(PAGE)
  }
  if (p === '/__state') return json(res, 200, state())
  if (p === '/__reset') {
    reset()
    return json(res, 200, state())
  }
  if (p === '/__speed') {
    const key = q.get('net')
    const kbps = Number(q.get('kbps'))
    if (!key || !Number.isFinite(kbps)) return json(res, 400, { error: 'need net=<key>&kbps=<n>' })
    setCap(key, kbps)
    return json(res, 200, state())
  }
  if (p === '/__scenario') {
    const error = runScenario(q.get('name') ?? '', q)
    return json(res, error ? 409 : 200, error ? { error } : state())
  }

  const key =
    req.headers['x-lightning-network'] || (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '')
  const n = net(String(key))
  const size = Math.round(Number(q.get('mb') ?? 100) * 1024 * 1024)
  const kbps = Number(q.get('kbps') ?? 0)
  const name = decodeURIComponent(p.split('/').pop() || 'file.bin')
  if (n.cap < 0) {
    res.writeHead(503, { 'Retry-After': '5' })
    return res.end()
  }
  const failFor = Number(q.get('fail') ?? 0)
  if (failFor > 0) {
    const seen = failCounts.get(req.url) ?? 0
    failCounts.set(req.url, seen + 1)
    if (seen < failFor) {
      note(`fail ${seen + 1}/${failFor}: 500 for ${req.url} (${key})`)
      res.writeHead(500)
      return res.end()
    }
  }
  const ranged = q.get('norange') !== '1'
  const headers = {
    ...(ranged ? { 'Accept-Ranges': 'bytes' } : {}),
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
    ETag: `"fake-${name}-${size}"`
  }
  let start = 0
  let end = size - 1
  const range = ranged ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '') : null
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

  const conn = { res, sent: start, end, kbps, carry: 0, allow: 0 }
  n.conns.add(conn)
  res.on('close', () => n.conns.delete(conn))
})

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Lightning fake server</title>
<style>
:root{color-scheme:light dark;font:15px system-ui,sans-serif}
body{max-width:760px;margin:20px auto;padding:0 14px}
.card{border:1px solid #8885;border-radius:10px;padding:12px;margin:10px 0}
button{font:inherit;padding:6px 11px;margin:3px;border-radius:7px;border:1px solid #8886;background:#8882;color:inherit;cursor:pointer}
input[type=range]{width:100%}textarea{width:100%;height:150px;font:12px monospace;box-sizing:border-box}
.row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}small,.m{opacity:.7}
</style>
<h2>Lightning fake server <small id=sc></small></h2>
<div class=card><b>Scenarios</b> <small>(need the networks to have been seen: start a download on each)</small><br>
<span id=scs></span><button onclick="go('/__reset')">reset</button><div id=err style="color:#e55"></div></div>
<div id=nets></div>
<div class=card><b>Links</b> host <select id=host onchange=links()></select>
count <input id=cnt type=number value=8 min=1 max=50 style="width:55px" onchange=links()>
<button onclick="navigator.clipboard.writeText(ta.value)">copy all</button>
<textarea id=ta readonly></textarea>
<div class=m>Mixed sizes. Add <code>?kbps=</code> per-connection cap, <code>&fail=2</code> (first 2 requests 500), <code>&norange=1</code>.</div></div>
<div class=card><b>Events</b><pre id=ev class=m style="white-space:pre-wrap;margin:6px 0 0"></pre></div>
<script>
const $=id=>document.getElementById(id);let S=null
const names=['steady','wifi-collapse','wifi-recover','swap','flap','lan-dies','vpn-fast']
$('scs').innerHTML=names.map(n=>'<button onclick="go(\\'/__scenario?name='+n+'\\')">'+n+'</button>').join('')
async function go(u){const r=await fetch(u);const j=await r.json();$('err').textContent=j.error||'';if(!j.error)render(j)}
const fmt=k=>k<0?'BLOCKED':k===0?'unlimited':k+' KB/s'
function render(s){S=s;$('sc').textContent='scenario: '+s.scenario
 for(const n of s.networks){let c=document.getElementById('n_'+n.key);if(!c){c=document.createElement('div');c.className='card';c.id='n_'+n.key
  c.innerHTML='<div class=row><b></b><span class=m></span></div><input type=range min=50 max=12000 step=50><div><button>unlimited</button><button>block</button></div>'
  const r=c.querySelector('input');r.oninput=()=>go('/__speed?net='+encodeURIComponent(n.key)+'&kbps='+r.value)
  const[bu,bb]=c.querySelectorAll('button');bu.onclick=()=>go('/__speed?net='+encodeURIComponent(n.key)+'&kbps=0');bb.onclick=()=>go('/__speed?net='+encodeURIComponent(n.key)+'&kbps=-1')
  $('nets').appendChild(c)}
  c.querySelector('b').textContent=n.key+'  cap '+fmt(n.capKBps)
  c.querySelector('.m').textContent=(n.bytesPerSec/1048576).toFixed(2)+' MB/s now, '+n.activeConnections+' connections'
  const r=c.querySelector('input');if(document.activeElement!==r)r.value=n.capKBps>0?n.capKBps:12000}
 if(!$('nets').children.length)$('nets').innerHTML='<div class="card m">No network seen yet. Start a download from one of the links.</div>'
 else $('nets').querySelectorAll('.m:only-child').forEach(e=>e.remove())
 const h=$('host');if(!h.options.length){s.hosts.forEach(x=>h.add(new Option(x)));h.value=location.hostname;if(!h.value)h.selectedIndex=0;links()}
 $('ev').textContent=s.events.map(e=>e.t+'  '+e.msg).reverse().join('\\n')}
function links(){const sizes=[900,300,120,60,25,500,40,200,15,700],n=+$('cnt').value
 $('ta').value=Array.from({length:n},(_,i)=>'http://'+$('host').value+':'+S.port+'/file-'+(i+1)+'.bin?mb='+sizes[i%sizes.length]).join('\\n')}
async function tick(){try{render(await(await fetch('/__state')).json())}catch{}setTimeout(tick,1000)}tick()
</script>`

server.listen(port, '0.0.0.0', () => {
  console.log(`Fake download server on port ${port} (new networks start at ${DEFAULT_KBPS} KB/s).`)
  for (const h of hosts()) {
    console.log(`  control page: http://${h}:${port}/`)
    console.log(`  sample link:  http://${h}:${port}/test-file-1.rar?mb=200`)
  }
})
