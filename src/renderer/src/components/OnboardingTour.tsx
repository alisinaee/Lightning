import {
  Gauge,
  Gear,
  Link,
  ClipboardText,
  Moon,
  Plus,
  ShieldCheck,
  SidebarSimple,
  SquaresFour,
  X,
  type Icon
} from '@phosphor-icons/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { setFirstRunBusy } from '../utils/firstRun'
import { Button } from './ui/button'
import { t } from '@shared/i18n/react'

// Versioned: raising it shows the walkthrough once more to everyone, after it has changed a lot.
const STORAGE_KEY = 'lightning.tour.v2'
const CARD_WIDTH = 320
const GAP = 14

interface Step {
  icon: Icon
  title: string
  body: string
  /** The element to point at, looked up afresh (menus and dialogs appear and go). */
  find: () => HTMLElement | null
  /** Clicking the target moves the tour on by itself, after this many ms. */
  advanceOnClick?: number
  /** For advanceWhen: how long to wait before moving on (the dialog closes meanwhile). */
  advanceDelay?: number
  /** Which clicks count (default: any click inside the target). */
  advanceWhen?: (target: Element) => boolean
  /** Runs when leaving the step, with the way it is left (closing the dialog it opened, say). */
  leave?: (direction: 'next' | 'back') => void | Promise<void>
  /** Brings the target on screen when it is not there yet (opens the menu or dialog). */
  ensure?: () => void
}

const q = (selector: string) => (): HTMLElement | null => document.querySelector(selector)

const parentOf = (selector: string) => (): HTMLElement | null =>
  document.querySelector<HTMLElement>(selector)?.parentElement ?? null

const menuItem = (text: string) => (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) =>
    node.textContent?.trim().startsWith(text)
  ) ?? null

/** A real press, as a person's: menus and dialogs here open on pointer events, not on click alone. */
const press = (el: HTMLElement | null | undefined): void => {
  if (!el) return
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
  }
}

const plusButton = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`button[aria-label="${t('New download')}"]`)

/** Open the + menu, if it is not open. */
const openMenu = (): void => {
  if (!menuItem(t('One link'))()) press(plusButton())
}

const wait = (ms: number): Promise<void> => new Promise((done) => window.setTimeout(done, ms))

const addDialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[role="dialog"]:not([aria-label="${t('Quick tour')}"])`)

/** Close the + menu: Escape on it, then a press outside it; either closes it. */
const closeMenu = (): void => {
  const menu = document.querySelector<HTMLElement>('[role="menu"]')
  if (!menu) return
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  window.setTimeout(() => {
    if (document.querySelector('[role="menu"]')) press(document.body)
  }, 80)
}

/** Open the New download dialog the way a person does: + then One link. */
const openDialog = (): void => {
  if (addDialog()) return
  openMenu()
  window.setTimeout(() => press(menuItem(t('One link'))()), 250)
}

/** Close the dialog smoothly: it and its backdrop fade out together, the dialog easing down and
 * shrinking a little, and only then is it dismissed (already invisible, so no jump), then a beat
 * passes, so a person sees what happened before the tour moves on. Only opacity and transform are
 * animated, which the GPU does without redrawing the page, so it stays fluid. */
const closeDialogGently = async (): Promise<void> => {
  const dialog = addDialog()
  if (!dialog) return
  const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
  const ease = 'cubic-bezier(0.4, 0, 0.2, 1)'
  dialog.style.willChange = 'opacity, scale'
  dialog.style.transition = `opacity 380ms ${ease}, scale 380ms ${ease}`
  if (backdrop) {
    backdrop.style.willChange = 'opacity'
    backdrop.style.transition = `opacity 380ms ${ease}`
  }
  // Two frames, so the browser has the start state before the change.
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  dialog.style.opacity = '0'
  dialog.style.scale = '0.97'
  if (backdrop) backdrop.style.opacity = '0'
  await wait(400)
  const buttons = [...dialog.querySelectorAll<HTMLElement>('button')]
  const named = (text: string): HTMLElement | undefined =>
    buttons.find(
      (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === text
    )
  press(named(t('Close')) ?? named(t('Cancel')))
  await wait(250)
}

const buildSteps = (): Step[] => [
  {
    icon: Plus,
    title: t('Start with the + button'),
    body: t('Click + to add a download. It is the quickest way to begin.'),
    find: plusButton,
    advanceOnClick: 250
  },
  {
    icon: Link,
    title: t('One link or several'),
    body: t(
      'One link adds a single file. Several links lets you paste a whole list at once. You can also press ⌘V anywhere in the app to paste a link.'
    ),
    find: q('[role="menu"]'),
    ensure: openMenu,
    advanceWhen: (target) => target.closest('[role="menuitem"]') !== null,
    advanceDelay: 450,
    leave: (direction) => {
      if (direction === 'back') closeMenu()
    }
  },
  {
    icon: ClipboardText,
    title: t('Paste the link, then Download'),
    body: t(
      'Paste a web or magnet link in the top field, then press Download at the bottom right to start it. Download later keeps it waiting instead.'
    ),
    find: addDialog,
    ensure: openDialog,
    advanceWhen: (target) => target.closest('button')?.textContent?.trim() === t('Download'),
    advanceDelay: 900,
    leave: closeDialogGently
  },
  {
    icon: SidebarSimple,
    title: t('The side panel'),
    body: t(
      'Your downloads are sorted here: downloading, queued, paused, completed and failed, plus file types.'
    ),
    find: q(`nav[aria-label="${t('Download categories')}"]`)
  },
  {
    icon: SquaresFour,
    title: t('Downloads, Telegram, YouTube'),
    body: t(
      'These three icons are the only sections. Telegram saves files from chats and links, and YouTube saves videos and audio.'
    ),
    find: q(`[role="tablist"][aria-label="${t('Section')}"]`)
  },
  {
    icon: ShieldCheck,
    title: t('VPN'),
    body: t(
      'Turn this on to send downloads through your VPN. Connections that bypass it are marked, so you always know which path a file takes.'
    ),
    find: parentOf(`[role="switch"][aria-label="${t('Use VPN for downloads')}"]`)
  },
  {
    icon: Gauge,
    title: t('Slow mode'),
    body: t(
      'Cap the speed to leave room for browsing and calls. Switch it on, and click the speed to change the limit.'
    ),
    find: parentOf(`[role="switch"][aria-label="${t('Slow mode')}"]`)
  },
  {
    icon: Moon,
    title: t('Dark or light'),
    body: t('Switch between the dark and the light theme here, any time.'),
    find: q('[data-tour="theme"]')
  },
  {
    icon: Gear,
    title: t('Settings'),
    body: t('Downloads folder, connections, limits, schedule, theme accent and more live here.'),
    find: q(`button[aria-label="${t('Settings')}"]`)
  }
]

type Rect = { top: number; left: number; width: number; height: number }

function place(rect: Rect | null, cardHeight: number): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value))
  if (!rect) return { top: vh / 2 - cardHeight / 2, left: vw / 2 - CARD_WIDTH / 2 }
  const centeredLeft = clamp(rect.left + rect.width / 2 - CARD_WIDTH / 2, 12, vw - CARD_WIDTH - 12)
  const centeredTop = clamp(rect.top + rect.height / 2 - cardHeight / 2, 12, vh - cardHeight - 12)
  if (rect.top + rect.height + GAP + cardHeight < vh - 12) {
    return { top: rect.top + rect.height + GAP, left: centeredLeft }
  }
  if (rect.top - GAP - cardHeight > 12)
    return { top: rect.top - GAP - cardHeight, left: centeredLeft }
  if (rect.left + rect.width + GAP + CARD_WIDTH < vw - 12) {
    return { top: centeredTop, left: rect.left + rect.width + GAP }
  }
  return { top: centeredTop, left: clamp(rect.left - GAP - CARD_WIDTH, 12, vw - CARD_WIDTH - 12) }
}

/** A short first-run walkthrough: points at one thing at a time, in order. It never blocks the
 * app: what it points at stays clickable, and clicking it carries the tour on. Every step has Close,
 * Back and Next; Escape closes it too. It starts after the intro, once, and is not shown again. */
export function OnboardingTour(): React.JSX.Element | null {
  const [active, setActive] = useState(false)
  // Waiting to start (after the intro) counts as busy too, so nothing pops up in between.
  const [pending, setPending] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === null
    } catch {
      return false
    }
  })
  useEffect(() => {
    setFirstRunBusy('tour', active || pending)
    return () => setFirstRunBusy('tour', false)
  }, [active, pending])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardHeight, setCardHeight] = useState(170)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const card = useRef<HTMLDivElement>(null)

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'done')
    } catch {
      // Storage unavailable: it may show again next time.
    }
    setActive(false)
  }, [])

  // Start once, after the intro if there is one.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== null) return
    } catch {
      return
    }
    let timer = 0
    const begin = (): void => {
      timer = window.setTimeout(() => {
        setPending(false)
        setActive(true)
      }, 500)
    }
    const waitFor = window.setTimeout(() => {
      if (document.querySelector('.lightning-intro')) {
        window.addEventListener('lightning:intro-done', begin, { once: true })
      } else begin()
    }, 50)
    return () => {
      window.clearTimeout(waitFor)
      window.clearTimeout(timer)
      window.removeEventListener('lightning:intro-done', begin)
    }
  }, [])

  // Settings → Interface can show the tour again, from the first step.
  useEffect(() => {
    const start = (): void => {
      setIndex(0)
      setActive(true)
    }
    window.addEventListener('lightning:start-tour', start)
    return () => window.removeEventListener('lightning:start-tour', start)
  }, [])

  const steps = useMemo(() => buildSteps(), [])
  const step = steps[index]

  const go = useCallback(
    async (to: number) => {
      if (busy) return
      const leaving = steps[index]?.leave?.(to > index ? 'next' : 'back')
      if (leaving) {
        busyRef.current = true
        setBusy(true)
        await leaving
        busyRef.current = false
        setBusy(false)
      }
      if (to >= steps.length) return finish()
      setIndex(Math.max(0, to))
    },
    [busy, finish, index, steps]
  )

  // Follow the target: it moves, resizes, or only appears later (a menu, a dialog).
  useEffect(() => {
    if (!active) return
    const measure = (): void => {
      // While the dialog closes the target is going away: keep the card and ring where they are.
      if (busyRef.current) return
      const el = step.find()
      if (!el) return setRect((prev) => (prev === null ? prev : null))
      const box = el.getBoundingClientRect()
      const next = { top: box.top, left: box.left, width: box.width, height: box.height }
      setRect((prev) =>
        prev &&
        Math.abs(prev.top - next.top) < 0.5 &&
        Math.abs(prev.left - next.left) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
          ? prev
          : next
      )
    }
    measure()
    const timer = window.setInterval(measure, 120)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
    }
  }, [active, step])

  // A step whose target is not there yet (the menu or dialog it points into) opens it.
  useEffect(() => {
    if (!active || !step.ensure) return
    const timer = window.setTimeout(() => {
      if (!step.find()) step.ensure?.()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [active, step])

  // Clicking, or typing into, the thing pointed at is the step done.
  useEffect(() => {
    if (!active) return
    const onClick = (event: MouseEvent): void => {
      if (step.advanceOnClick === undefined && !step.advanceWhen) return
      const target = event.target
      if (!(target instanceof Element)) return
      const el = step.find()
      const hit = step.advanceWhen ? step.advanceWhen(target) : Boolean(el?.contains(target))
      if (el && hit) {
        window.setTimeout(
          () => setIndex((now) => (now === index ? index + 1 : now)),
          step.advanceDelay ?? step.advanceOnClick ?? 300
        )
      }
    }
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('click', onClick, true)
    }
  }, [active, step, index])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent): void => {
      // Escape closes a menu or dialog first; the tour closes when nothing else is open.
      if (event.key === 'Escape' && !addDialog() && !document.querySelector('[role="menu"]')) {
        finish()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, finish])

  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight)
  }, [index, rect, active])

  if (!active) return null
  const pos = place(rect, cardHeight)
  const last = index === steps.length - 1
  const StepIcon = step.icon
  return (
    <div className="pointer-events-none fixed inset-0 z-[400]" aria-live="polite">
      {rect ? (
        <div
          aria-hidden
          className="lightning-tour-ring absolute rounded-xl transition-[top,left,width,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{
            opacity: busy ? 0 : 1,
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow:
              '0 0 0 9999px rgba(7, 10, 31, 0.5), 0 0 0 2px var(--color-accent), 0 0 24px 2px color-mix(in srgb, var(--color-accent) 45%, transparent)'
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[rgba(7,10,31,0.5)]" />
      )}
      <div
        key={index}
        ref={card}
        role="dialog"
        aria-label={t('Quick tour')}
        className="lightning-tour-card pointer-events-auto absolute flex flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-[0_16px_48px_-8px_rgba(0,0,0,0.4)] ring-1 ring-foreground/[0.08]"
        style={{ width: CARD_WIDTH, top: pos.top, left: pos.left }}
      >
        <div className="h-1 w-full bg-linear-to-r from-primary via-[#818cf8] to-[#38bdf8]" />
        <div className="flex flex-col gap-2.5 p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/20">
              <StepIcon className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase rtl:tracking-normal">
                {t('Step {n} of {total}', { n: index + 1, total: steps.length })}
              </div>
              <div className="text-[14.5px] leading-tight font-semibold">{step.title}</div>
            </div>
            <button
              type="button"
              aria-label={t('Close the tour')}
              onClick={finish}
              className="-mt-1 -me-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <p className="text-[12.5px] leading-[1.6] text-[var(--text-secondary)]">{step.body}</p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={index + 1}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${((index + 1) / steps.length) * 100}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              {index > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void go(index - 1)}
                >
                  {t('Back')}
                </Button>
              )}
              <Button type="button" size="sm" disabled={busy} onClick={() => void go(index + 1)}>
                {last ? t('Done') : t('Next')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
