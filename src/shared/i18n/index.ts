// i18n core. The English text IS the key; 'en' (or a missing key) returns it unchanged.
// Usable from both main and renderer (no DOM / Node-only APIs).
import type { Dict, Lang, LanguageSetting } from './types'
import fa from './locales/fa'
import ru from './locales/ru'

export type { Dict, Lang, LanguageSetting, PluralEntry } from './types'
export { LANGUAGES } from './types'

const dictionaries: Record<Lang, Dict> = { en: {}, fa, ru }

let current: Lang = 'en'
const listeners = new Set<(lang: Lang) => void>()

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'fa' || v === 'ru'
}

export function resolveLanguage(setting: LanguageSetting, systemLocales: readonly string[]): Lang {
  if (setting !== 'system') return isLang(setting) ? setting : 'en'
  for (const loc of systemLocales) {
    const base = String(loc).toLowerCase().split(/[-_]/)[0]
    if (isLang(base)) return base
  }
  return 'en'
}

export function setLanguage(lang: Lang): void {
  if (lang === current) return
  current = lang
  for (const cb of [...listeners]) cb(lang)
}

export function getLanguage(): Lang {
  return current
}

export function isRtl(lang: Lang = current): boolean {
  return lang === 'fa'
}

export function onLanguageChange(cb: (lang: Lang) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

const TAGS: Record<Lang, string> = { en: 'en-US', fa: 'fa-IR', ru: 'ru-RU' }
export function localeTag(lang: Lang = current): string {
  return TAGS[lang]
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(), opts).format(n)
}

type DateInput = Date | number | string
const toDate = (d: DateInput): Date => (d instanceof Date ? d : new Date(d))

export function formatDate(date: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(localeTag(), opts ?? { dateStyle: 'medium' }).format(toDate(date))
}

export function formatTime(date: DateInput, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(localeTag(), opts ?? { timeStyle: 'short' }).format(toDate(date))
}

export type Vars = Record<string, string | number>

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    if (!(name in vars)) return m
    const v = vars[name]
    return typeof v === 'number' ? formatNumber(v) : v
  })
}

export function t(text: string, vars?: Vars): string {
  const entry = dictionaries[current][text]
  const out = typeof entry === 'string' ? entry : typeof entry === 'object' ? entry.other : text
  return interpolate(out, vars)
}

export function tn(count: number, one: string, other: string, vars?: Vars): string {
  const all: Vars = { count, ...vars }
  const entry = dictionaries[current][other]
  if (entry === undefined) return interpolate(count === 1 ? one : other, all)
  if (typeof entry === 'string') return interpolate(entry, all)
  const cat = new Intl.PluralRules(localeTag()).select(count) as 'one' | 'few' | 'many' | 'other'
  return interpolate(entry[cat] ?? entry.other, all)
}
