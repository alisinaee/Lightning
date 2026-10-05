import { cn } from 'cn'

/** The bottom bar every screen ends on — border, background and padding are fixed, `className`
 * only tunes per-screen gap/alignment. */
export function ScreenFooter({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cn(
        // A fixed height: it was set by whatever the screen put in it (a switch, a text), so it
        // jumped when moving between screens or when a part of it came and went.
        'flex h-10 shrink-0 items-center gap-3 overflow-hidden border-t-[0.5px] border-t-[var(--footer-border)] bg-secondary px-5',
        className
      )}
    >
      {children}
    </div>
  )
}
