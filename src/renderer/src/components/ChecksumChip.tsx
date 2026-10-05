import type { ChecksumResult } from '@shared/types'
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** How the finished file compared with the hash the download was started with. */
export function ChecksumChip({ result }: { result: ChecksumResult }): React.JSX.Element {
  const name = result.algo.toUpperCase()
  const view = {
    verifying: { icon: Loader2, text: `Checking ${name}…`, tone: 'text-muted-foreground' },
    verified: { icon: ShieldCheck, text: `${name} matches`, tone: 'text-emerald-600' },
    mismatch: { icon: ShieldAlert, text: `${name} does not match`, tone: 'text-destructive' },
    unreadable: { icon: ShieldAlert, text: `${name} not checked`, tone: 'text-muted-foreground' }
  }[result.status]
  const Icon = view.icon
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={`flex items-center gap-1 text-[12.5px] font-medium ${view.tone}`}>
            <Icon className={`size-4 ${result.status === 'verifying' ? 'animate-spin' : ''}`} />
            {view.text}
          </span>
        }
      />
      <TooltipContent>
        <div className="font-mono text-[11px]">
          <div>expected {result.expected}</div>
          {result.actual && <div>actual&nbsp;&nbsp; {result.actual}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
