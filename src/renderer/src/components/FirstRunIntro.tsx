import {
  CellSignalFull,
  Network,
  ShieldCheck,
  Usb,
  WifiHigh,
  type Icon
} from '@phosphor-icons/react'
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'lightning.intro'
const DURATION_MS = 5000

const NAME = 'Lightning'
const BOLT = 'M98 2 L44 100 L78 108 L34 236 L136 90 L96 82 L126 14 Z'
const MERGE_X = 300
const MERGE_Y = 190

/** The connections that become one: x on the 600-wide scene, glyph and colour (the app's own
 * network colours, lifted for a dark ground). */
const SOURCES: { x: number; icon: Icon; color: string }[] = [
  { x: 60, icon: WifiHigh, color: '#2dd4bf' },
  { x: 180, icon: Network, color: '#818cf8' },
  { x: 300, icon: Usb, color: '#fbbf24' },
  { x: 420, icon: ShieldCheck, color: '#a78bfa' },
  { x: 540, icon: CellSignalFull, color: '#38bdf8' }
]

const lineFrom = (x: number): string => `M${x} 62 C${x} 120 ${MERGE_X} 110 ${MERGE_X} ${MERGE_Y}`

/** Shown once, the first time the app opens, for five seconds: Wi-Fi, Ethernet, USB and the rest
 * run down as separate lines, join into one, and that one becomes a bolt of lightning with the
 * name under it. It cannot be skipped, and it is not shown at all for people who ask for reduced
 * motion. */
export function FirstRunIntro(): React.JSX.Element | null {
  const [run, setRun] = useState(0)
  const [visible, setVisible] = useState(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) !== null) return false
    } catch {
      return false
    }
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (!visible) return
    try {
      localStorage.setItem(STORAGE_KEY, 'seen')
    } catch {
      // Storage unavailable: it may show again next time.
    }
    const timer = window.setTimeout(() => {
      setVisible(false)
      window.dispatchEvent(new Event('lightning:intro-done'))
    }, DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [visible, run])

  // Settings → Interface can play it again.
  useEffect(() => {
    const replay = (): void => {
      setRun((now) => now + 1)
      setVisible(true)
    }
    window.addEventListener('lightning:start-intro', replay)
    return () => window.removeEventListener('lightning:start-intro', replay)
  }, [])

  if (!visible) return null
  return (
    <div
      key={run}
      role="presentation"
      className="lightning-intro fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-[#070a1f]"
    >
      <div className="lightning-intro-glow absolute inset-0" />
      <div className="lightning-intro-flash absolute inset-0 bg-white" />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <svg
          viewBox="0 0 600 400"
          aria-hidden
          className="h-auto w-[min(86vw,600px)] overflow-visible"
        >
          {/* Before the strike: the connections, their lines, and the one line they make. */}
          <g className="lightning-intro-before">
            {SOURCES.map((source, index) => (
              <g key={source.x}>
                <path
                  d={lineFrom(source.x)}
                  pathLength={1}
                  fill="none"
                  stroke={source.color}
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="lightning-intro-line"
                  style={{
                    animationDelay: `${650 + index * 140}ms`,
                    filter: `drop-shadow(0 0 5px ${source.color})`
                  }}
                />
                <circle
                  r="4"
                  fill="#fff"
                  className="lightning-intro-dot"
                  style={{
                    offsetPath: `path('${lineFrom(source.x)}')`,
                    animationDelay: `${900 + index * 140}ms`,
                    filter: `drop-shadow(0 0 6px ${source.color})`
                  }}
                />
                <g
                  className="lightning-intro-badge"
                  style={{ animationDelay: `${200 + index * 110}ms` }}
                >
                  <circle
                    cx={source.x}
                    cy="36"
                    r="26"
                    fill="rgba(255,255,255,0.05)"
                    stroke={source.color}
                    strokeWidth="1.5"
                  />
                  <source.icon
                    x={source.x - 14}
                    y={22}
                    size={28}
                    weight="bold"
                    color={source.color}
                  />
                </g>
              </g>
            ))}
            <path
              d={`M${MERGE_X} ${MERGE_Y} L${MERGE_X} 300`}
              pathLength={1}
              fill="none"
              stroke="#e0f2fe"
              strokeWidth="9"
              strokeLinecap="round"
              className="lightning-intro-stem"
            />
          </g>

          {/* The strike: the one line turns into lightning. */}
          <g transform="translate(186 34) scale(1.35)" className="lightning-intro-bolt">
            <path d={BOLT} className="lightning-intro-fill" fill="#fde68a" />
            <path
              d={BOLT}
              pathLength={1}
              className="lightning-intro-draw"
              fill="none"
              stroke="#fffbeb"
              strokeWidth="3.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {['M66 106 L40 126 L54 140 L20 170', 'M100 84 L130 104 L118 116 L150 142'].map((d) => (
              <path
                key={d}
                d={d}
                pathLength={1}
                className="lightning-intro-branch"
                fill="none"
                stroke="#fde047"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </g>
        </svg>

        <div
          aria-label={NAME}
          className="flex font-sans text-[54px] leading-none font-extrabold tracking-[0.04em] text-white"
        >
          {NAME.split('').map((letter, index) => (
            <span
              key={index}
              aria-hidden
              className="lightning-intro-letter inline-block"
              style={{ animationDelay: `${3500 + index * 60}ms` }}
            >
              {letter}
            </span>
          ))}
        </div>
        <div className="lightning-intro-tagline text-[14px] tracking-[0.3em] text-sky-200/90 uppercase">
          Every connection. One speed.
        </div>
      </div>
    </div>
  )
}
