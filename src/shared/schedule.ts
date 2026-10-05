/** One weekly window: on these days, between these times, downloads run (or are held), optionally
 * at a lower speed. A window that ends before it starts (22:00 to 06:00) runs overnight, into the
 * next day. */
export interface ScheduleRule {
  id: string
  /** 0 is Sunday, as Date.getDay() has it. */
  days: number[]
  /** 24-hour "HH:MM". */
  start: string
  end: string
  /** run: downloads may go in this window. pause: they are held. */
  action: 'run' | 'pause'
  /** Bytes a second all downloads together may use in a run window; unset: no cap. */
  speedCap?: number
}

export interface ScheduleSettings {
  enabled: boolean
  rules: ScheduleRule[]
}

/** What the schedule asks of the downloads right now. */
export interface ScheduleStatus {
  /** False: downloads are held until the next run window. */
  allow: boolean
  /** A cap, in bytes a second, on the speed of all downloads together; null for none. */
  cap: number | null
  /** When it next changes (ms since epoch); null when it never does. */
  nextChange: number | null
}

export const DEFAULT_SCHEDULE: ScheduleSettings = { enabled: false, rules: [] }
export const ALWAYS_ALLOWED: ScheduleStatus = { allow: true, cap: null, nextChange: null }

/** "HH:MM" as minutes into the day, or null when it isn't a time. */
export function minutesOf(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Whether `rule` covers the minute `minute` (0..1439) of the weekday `day`. */
function covers(rule: ScheduleRule, day: number, minute: number): boolean {
  const start = minutesOf(rule.start)
  const end = minutesOf(rule.end)
  if (start === null || end === null || start === end) return false
  if (start < end) return rule.days.includes(day) && minute >= start && minute < end
  // Overnight: the evening part belongs to the day it starts on, the morning part to the day after.
  if (minute >= start) return rule.days.includes(day)
  return minute < end && rule.days.includes((day + 6) % 7)
}

/** The rules in force at `at`. */
export function activeRules(rules: ScheduleRule[], at: Date): ScheduleRule[] {
  const minute = at.getHours() * 60 + at.getMinutes()
  return rules.filter((rule) => covers(rule, at.getDay(), minute))
}

/** When the set of active rules next changes after `at`: the nearest start or end of a window. */
export function nextBoundary(rules: ScheduleRule[], at: Date): number | null {
  let best: number | null = null
  for (let offset = 0; offset <= 8; offset++) {
    for (const rule of rules) {
      for (const time of [rule.start, rule.end]) {
        const minutes = minutesOf(time)
        if (minutes === null) continue
        const when = new Date(at)
        when.setDate(when.getDate() + offset)
        when.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
        if (when.getTime() > at.getTime() && (best === null || when.getTime() < best)) {
          best = when.getTime()
        }
      }
    }
  }
  return best
}

/** What the schedule asks at `at`. A pause window holds downloads. Where there are run windows,
 * downloads go only inside one (at the lowest cap of those that cover the moment); where there are
 * only pause windows, they go whenever none is on. */
export function scheduleStatus(settings: ScheduleSettings, at: Date): ScheduleStatus {
  const rules = settings.rules.filter((rule) => rule.days.length > 0)
  if (!settings.enabled || rules.length === 0) return ALWAYS_ALLOWED
  const active = activeRules(rules, at)
  const nextChange = nextBoundary(rules, at)
  if (active.some((rule) => rule.action === 'pause')) return { allow: false, cap: null, nextChange }
  const running = active.filter((rule) => rule.action === 'run')
  const hasRunRules = rules.some((rule) => rule.action === 'run')
  if (hasRunRules && running.length === 0) return { allow: false, cap: null, nextChange }
  const caps = running.map((rule) => rule.speedCap).filter((cap): cap is number => !!cap && cap > 0)
  return { allow: true, cap: caps.length > 0 ? Math.min(...caps) : null, nextChange }
}

/** A saved schedule read back: only well-formed rules kept. */
export function sanitizeSchedule(input: unknown): ScheduleSettings {
  if (typeof input !== 'object' || input === null) return { ...DEFAULT_SCHEDULE }
  const raw = input as Record<string, unknown>
  const rules: ScheduleRule[] = []
  if (Array.isArray(raw.rules)) {
    for (const item of raw.rules.slice(0, 50)) {
      if (typeof item !== 'object' || item === null) continue
      const rule = item as Record<string, unknown>
      if (typeof rule.start !== 'string' || typeof rule.end !== 'string') continue
      if (minutesOf(rule.start) === null || minutesOf(rule.end) === null) continue
      if (!Array.isArray(rule.days)) continue
      const days = [
        ...new Set(rule.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))
      ] as number[]
      if (rule.action !== 'run' && rule.action !== 'pause') continue
      const cap = rule.speedCap
      rules.push({
        id: typeof rule.id === 'string' && rule.id ? rule.id.slice(0, 64) : `r${rules.length}`,
        days: days.sort(),
        start: rule.start,
        end: rule.end,
        action: rule.action,
        ...(typeof cap === 'number' && Number.isFinite(cap) && cap > 0
          ? { speedCap: Math.round(cap) }
          : {})
      })
    }
  }
  return { enabled: raw.enabled === true, rules }
}
