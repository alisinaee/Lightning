// tdl prints its login QR as terminal block characters, where █ is light and a space is dark
// (the reverse of what black-on-white text shows). Decode the blocks into modules and draw them
// as a real image, which a phone camera can read.
const BLOCKS: Record<string, [boolean, boolean]> = {
  '█': [false, false],
  ' ': [true, true],
  '▀': [false, true],
  '▄': [true, false]
}

const QUIET_ZONE = 4

function qrModules(ascii: string): boolean[][] {
  const lines = ascii.split('\n').filter((line) => line.length > 0)
  // The last line is a half-height padding row that is not part of the code.
  if (lines.length > 1 && /^▀+$/.test(lines[lines.length - 1])) lines.pop()
  const rows: boolean[][] = []
  for (const line of lines) {
    const top: boolean[] = []
    const bottom: boolean[] = []
    for (const char of line) {
      const [upper, lower] = BLOCKS[char] ?? [false, false]
      top.push(upper)
      bottom.push(lower)
    }
    rows.push(top, bottom)
  }
  let minRow = Infinity
  let maxRow = -1
  let minCol = Infinity
  let maxCol = -1
  rows.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return
      minRow = Math.min(minRow, y)
      maxRow = Math.max(maxRow, y)
      minCol = Math.min(minCol, x)
      maxCol = Math.max(maxCol, x)
    })
  )
  if (maxRow < 0) return []
  return rows.slice(minRow, maxRow + 1).map((row) => row.slice(minCol, maxCol + 1))
}

export function TelegramQr({
  ascii,
  fit
}: {
  ascii: string
  /** Fill most of the window instead of the normal size. */
  fit?: boolean
}): React.JSX.Element | null {
  const modules = qrModules(ascii)
  if (modules.length === 0) return null
  const size = modules.length + QUIET_ZONE * 2
  const width = (modules[0]?.length ?? 0) + QUIET_ZONE * 2
  const modulePx = fit
    ? Math.max(8, Math.floor((Math.min(window.innerWidth, window.innerHeight) * 0.85) / size))
    : 8
  let path = ''
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`
    })
  )
  return (
    <svg
      role="img"
      aria-label="Login QR code"
      viewBox={`0 0 ${width} ${size}`}
      shapeRendering="crispEdges"
      // A whole number of pixels per module keeps every square the same width for a phone camera.
      width={width * modulePx}
      height={size * modulePx}
      className="max-w-full self-center rounded-[9px] bg-white"
    >
      <rect width={width} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}
