import { expect, test } from '@playwright/test'
import { scheduleStatus, type ScheduleSettings } from '../src/shared/schedule'

// Clocks spring forward at 2:00 on 2026-03-08 in New York, so 2:00 to 2:59 never happens that day.
// A window edge in that hour takes effect the moment the clock jumps to 3:00.

const everyDay = [0, 1, 2, 3, 4, 5, 6]

test('a pause that starts in the skipped hour begins at the jump', () => {
  const previous = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const settings: ScheduleSettings = {
      enabled: true,
      rules: [{ id: 'p', days: everyDay, start: '02:30', end: '07:00', action: 'pause' }]
    }
    const before = new Date(2026, 2, 8, 1, 59)
    const jump = new Date(2026, 2, 8, 3, 0).getTime()
    expect(scheduleStatus(settings, before)).toMatchObject({ allow: true, nextChange: jump })
    expect(scheduleStatus(settings, new Date(2026, 2, 8, 3, 0)).allow).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})

test('a pause that ends in the skipped hour lifts at the jump', () => {
  const previous = process.env.TZ
  process.env.TZ = 'America/New_York'
  try {
    const settings: ScheduleSettings = {
      enabled: true,
      rules: [{ id: 'p', days: everyDay, start: '01:00', end: '02:30', action: 'pause' }]
    }
    const during = new Date(2026, 2, 8, 1, 30)
    const jump = new Date(2026, 2, 8, 3, 0).getTime()
    expect(scheduleStatus(settings, during)).toMatchObject({ allow: false, nextChange: jump })
    expect(scheduleStatus(settings, new Date(2026, 2, 8, 3, 0)).allow).toBe(true)
  } finally {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  }
})
