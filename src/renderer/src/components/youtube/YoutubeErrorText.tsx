import { explainYoutubeError } from './youtubeErrors'

/** A plain sentence about what went wrong, with the raw message one click away. */
export function YoutubeErrorText({
  error,
  className,
  role
}: {
  error: string | null | undefined
  className?: string
  role?: 'alert'
}): React.JSX.Element {
  const { summary, detail } = explainYoutubeError(error)
  return (
    <span role={role} className={className}>
      <span className="block">{summary}</span>
      {detail && (
        <details className="mt-0.5 text-[11.5px] opacity-80">
          <summary className="cursor-pointer select-none">Details</summary>
          <span className="mt-1 block font-mono break-words whitespace-pre-wrap">{detail}</span>
        </details>
      )}
    </span>
  )
}
