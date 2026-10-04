import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'

/** Copies `text` to the clipboard; false when the window refuses. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function CopyReportButton({
  report,
  label = 'Copy report'
}: {
  report: string | undefined
  label?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!report}
      onClick={() => {
        if (!report) return
        void copy(report).then((ok) => {
          setCopied(ok)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

/** A report as plain text, the way it is copied and written to the log file. */
export function ReportView({ report }: { report: string }): React.JSX.Element {
  return (
    <ScrollArea className="h-56 rounded-lg border bg-muted/40">
      <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{report}</pre>
    </ScrollArea>
  )
}
