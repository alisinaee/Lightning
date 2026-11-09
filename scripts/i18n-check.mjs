#!/usr/bin/env node
// Usage: node scripts/i18n-check.mjs [--quiet]
//   Scans src/**/*.{ts,tsx} for t('…') / tn(n,'…','…') keys, reports keys missing in fa/ru
//   (exit 1), conflicting duplicate keys across locale partials, and (informational)
//   un-wrapped JSX text / label|title|placeholder attributes in renderer .tsx files.
//   Needs Node >= 22.6 (native TypeScript type stripping) to import the locale .ts files.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const _ew = process.emitWarning
process.emitWarning = (w, ...a) => (String(w?.message ?? w).includes('MODULE_TYPELESS') ? undefined : _ew.call(process, w, ...a))

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src')
const localesDir = join(src, 'shared', 'i18n', 'locales')
const quiet = process.argv.includes('--quiet')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'locales') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p)
  }
  return out
}

const unescape = (s, q) =>
  s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === q || c === '\\' || c === '\'' || c === '"' || c === '`' ? c : '\\' + c))

const STR = String.raw`(['"\`])((?:\\.|(?!\1)[^\\])*)\1`
const T_RE = new RegExp(String.raw`(?<![\w.$])t\(\s*${STR}`, 'g')
const TN_RE = new RegExp(String.raw`(?<![\w.$])tn\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*${STR}\s*,\s*(['"\`])((?:\\.|(?!\3)[^\\])*)\3`, 'g')

// --- collect used keys
const used = new Map() // key -> [file:line]
const add = (key, file, text, idx) => {
  const line = text.slice(0, idx).split('\n').length
  if (!used.has(key)) used.set(key, [])
  used.get(key).push(`${relative(root, file)}:${line}`)
}
const files = walk(src)
for (const f of files) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(T_RE)) {
    if (m[1] === '`' && m[2].includes('${')) continue
    add(unescape(m[2], m[1]), f, text, m.index)
  }
  for (const m of text.matchAll(TN_RE)) {
    if (m[3] === '`' && m[4].includes('${')) continue
    add(unescape(m[4], m[3]), f, text, m.index)
  }
}

// --- load dictionaries
const areas = readdirSync(join(localesDir, 'fa'))
  .filter((n) => n.endsWith('.ts') && n !== 'index.ts')
  .map((n) => n.slice(0, -3))
const dicts = {}
const conflicts = []
for (const lang of ['fa', 'ru']) {
  dicts[lang] = {}
  const owner = {}
  for (const area of areas) {
    let mod
    try {
      mod = (await import(pathToFileURL(join(localesDir, lang, area + '.ts')).href)).default
    } catch (e) {
      console.error(`Cannot load locales/${lang}/${area}.ts: ${e.message}`)
      process.exit(2)
    }
    for (const [k, v] of Object.entries(mod)) {
      if (k in dicts[lang] && JSON.stringify(dicts[lang][k]) !== JSON.stringify(v))
        conflicts.push(`[${lang}] "${k}" differs between ${owner[k]} and ${area}`)
      dicts[lang][k] = v
      owner[k] = area
    }
  }
}

// --- report missing
let missingTotal = 0
for (const lang of ['fa', 'ru']) {
  const missing = [...used.keys()].filter((k) => !(k in dicts[lang]))
  missingTotal += missing.length
  console.log(`\n== ${lang}: ${missing.length} missing of ${used.size} used keys`)
  if (!quiet) for (const k of missing) console.log(`  "${k}"  (${used.get(k)[0]})`)
}
const unused = (lang) => Object.keys(dicts[lang]).filter((k) => !used.has(k))
console.log(`\n== unused dictionary entries: fa ${unused('fa').length}, ru ${unused('ru').length} (informational)`)

console.log(`\n== duplicate conflicts: ${conflicts.length}`)
for (const c of conflicts) console.log('  ' + c)

// --- heuristic: unwrapped literals in renderer tsx
const JSX_TEXT = />\s*([^<>{}\n=;()]*[A-Za-z]{2,}[^<>{}\n;]*?)\s*</g
const ATTR = /\b(?:label|title|placeholder|aria-label|alt)="([^"{}]*[A-Za-z]{2,}[^"{}]*)"/g
const perFile = []
for (const f of files) {
  if (!f.endsWith('.tsx') || !f.includes(join('src', 'renderer'))) continue
  const text = readFileSync(f, 'utf8')
  let n = 0
  for (const m of text.matchAll(JSX_TEXT)) {
    const s = m[1].trim()
    if (/^[\w$.]+(\s*[=:]|\s*=>)/.test(s) || /^(import|export|return|const|type)\b/.test(s)) continue
    if (/[=>]\s*$/.test(m[0].slice(0, -1)) && /^[^A-Za-z]*$/.test(s)) continue
    n++
  }
  n += [...text.matchAll(ATTR)].length
  if (n) perFile.push([n, relative(root, f)])
}
perFile.sort((a, b) => b[0] - a[0])
console.log(`\n== possibly untranslated literals (heuristic): ${perFile.reduce((s, [n]) => s + n, 0)} in ${perFile.length} files`)
if (!quiet) for (const [n, f] of perFile) console.log(`  ${String(n).padStart(4)}  ${f}`)

if (missingTotal > 0) {
  console.log(`\nFAIL: ${missingTotal} missing translation(s)`)
  process.exit(1)
}
console.log('\nOK')
