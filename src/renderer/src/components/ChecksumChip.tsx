import { t } from '@shared/i18n/react'
import type { ChecksumResult } from '@shared/types'
import {
  CircleNotch as Loader2,
  ShieldWarning as ShieldAlert,
  ShieldCheck
} from '@phosphor-icons/react'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/** How the finished file compared with the hash the download was started with. */
export function ChecksumChip({ result }: { result: ChecksumResult }): React.JSX.Element {
  const name = result.algo.toUpperCase()
  const view = {
    verifying: {
      icon: Loader2,
      text: t('Checking {name}…', { name }),
      tone: 'text-muted-foreground'
    },
    verified: { icon: ShieldCheck, text: t('{name} matches', { name }), tone: 'text-emerald-600' },
    mismatch: {
      icon: ShieldAlert,
      text: t('{name} does not match', { name }),
      tone: 'text-destructive'
    },
    unreadable: {
      icon: ShieldAlert,
      text: t('{name} not checked', { name }),
      tone: 'text-muted-foreground'
    }
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
        <div dir="ltr" className="font-mono text-[11px]">
          <div>expected {result.expected}</div>
          {result.actual && <div>actual&nbsp;&nbsp; {result.actual}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
