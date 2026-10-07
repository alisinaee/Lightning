import type { DnsTestEntry, DnsTestResult } from '@shared/dnsRecommend'
import { describeDns } from '@shared/dnsPresets'
import { SYSTEM_NAME } from '@shared/dnsRecommend'
import { AlertTriangle, Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { describeError, formatBytes } from '../utils/format'
import { useDns } from '../hooks/useDns'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'

/** Tries every DNS on one link's site and shows what each led to: how fast it answered, which
 * server it gave, how that server connected and how fast it sent a sample. It suggests one, and the
 * winner is remembered for the Auto choice. */
export function DnsTestDialog({
  open,
  onOpenChange,
  ...rest
}: {
  url: string
  currentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The id of the DNS chosen: a saved one, 'system' or 'auto'. */
  onUse: (id: string) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[680px] max-w-[calc(100%-2rem)] flex-col gap-3 sm:max-w-[680px]">
        {open && <DnsTestBody {...rest} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function DnsTestBody({
  url,
  currentId,
  onUse,
  onClose
}: {
  url: string
  currentId: string | null
  onUse: (id: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { profiles } = useDns()
  const [result, setResult] = useState<DnsTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.lightning
      .testDns(url, currentId)
      .then((found) => !cancelled && setResult(found))
      .catch((failure: unknown) => !cancelled && setError(describeError(failure)))
    return () => {
      cancelled = true
    }
  }, [url, currentId])

  const recommendation = result?.recommendation
  const choose = async (entry: { name: string; servers: string[] }): Promise<void> => {
    if (entry.servers.length === 0) return onUse('system')
    const saved = profiles.find((profile) => profile.servers.join() === entry.servers.join())
    if (saved) return onUse(saved.id)
    try {
      onUse((await window.lightning.saveDns({ name: entry.name, servers: entry.servers })).id)
    } catch (failure) {
      setError(describeError(failure))
    }
  }

  return (
    <>
      <DialogTitle className="text-[16px] font-semibold">Test DNS for this site</DialogTitle>
      <DialogDescription>
        {result
          ? `Every DNS was tried for ${result.host}. Each server it leads to got one small download of about 1 MB.`
          : 'Trying every DNS for this site. This takes a few seconds and downloads about 1 MB from each server.'}
      </DialogDescription>

      {error && (
        <div role="alert" className="flex items-center gap-2 text-[12.5px] text-destructive">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          {error}
        </div>
      )}
      {!result && !error && (
        <div role="status" className="py-6 text-center text-[13px] text-muted-foreground">
          Testing…
        </div>
      )}
      {result && (
        <>
          <div role="table" aria-label="DNS test results" className="text-[12.5px]">
            <div
              role="row"
              className="grid grid-cols-[1.3fr_0.8fr_1.2fr_0.8fr_0.9fr] gap-2 border-b-[0.5px] border-border pb-1.5 text-[11px] font-medium text-muted-foreground"
            >
              <span role="columnheader">DNS</span>
              <span role="columnheader" className="text-right">
                Answered in
              </span>
              <span role="columnheader">Server</span>
              <span role="columnheader" className="text-right">
                Connected in
              </span>
              <span role="columnheader" className="text-right">
                Speed
              </span>
            </div>
            <div className="max-h-[300px] overflow-y-auto pr-3">
              {rank(result).map((entry) => (
                <Row
                  key={entry.name}
                  entry={entry}
                  best={recommendation?.kind === 'better' && recommendation.name === entry.name}
                />
              ))}
            </div>
          </div>
          {recommendation && (
            <div
              role="status"
              className="rounded-[9px] border-[0.5px] border-border bg-secondary/50 px-3 py-2 text-[13px]"
            >
              {recommendation.text}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
        {result && (
          <Button type="button" variant="secondary" onClick={() => onUse('auto')}>
            Use Auto for every site
          </Button>
        )}
        {recommendation?.kind === 'better' && recommendation.name && (
          <Button
            type="button"
            onClick={() =>
              void choose({ name: recommendation.name!, servers: recommendation.servers })
            }
          >
            Use {recommendation.name}
          </Button>
        )}
      </div>
    </>
  )
}

/** Best first: by speed when it was measured, else by how quickly the server connected. */
function rank(result: DnsTestResult): DnsTestEntry[] {
  const score = (entry: DnsTestEntry): number =>
    entry.error || entry.ip === null
      ? -1
      : (entry.bytesPerSec ?? 0) > 0
        ? entry.bytesPerSec!
        : entry.connectMs !== null
          ? 1000 / Math.max(1, entry.connectMs)
          : 0
  return [...result.entries].sort((a, b) => score(b) - score(a))
}

function Row({ entry, best }: { entry: DnsTestEntry; best: boolean }): React.JSX.Element {
  const failed = entry.ip === null || !!entry.error
  const about = describeDns(entry.name === SYSTEM_NAME ? SYSTEM_NAME : entry.servers)
  return (
    <div
      role="row"
      className="grid grid-cols-[1.3fr_0.8fr_1.2fr_0.8fr_0.9fr] items-center gap-2 border-b-[0.5px] border-border/60 py-1.5 last:border-b-0"
    >
      <span role="cell" className="flex min-w-0 items-center gap-1.5 font-medium">
        <span className="size-4 shrink-0">
          {best && <Check aria-label="Best" className="size-4 text-primary" />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{entry.name === SYSTEM_NAME ? 'System DNS' : entry.name}</span>
          {about && (
            <span
              title={about}
              className="line-clamp-2 text-[11px] leading-tight font-normal text-muted-foreground"
            >
              {about}
            </span>
          )}
        </span>
      </span>
      {failed ? (
        <span role="cell" className="col-span-4 truncate text-muted-foreground">
          {entry.error ?? 'No answer'}
        </span>
      ) : (
        <>
          <span role="cell" className="text-right font-mono text-[12px]">
            {entry.lookupMs === null ? '–' : `${entry.lookupMs} ms`}
          </span>
          <span role="cell" className="truncate font-mono text-[12px]">
            {entry.ip}
          </span>
          <span role="cell" className="text-right font-mono text-[12px]">
            {entry.connectMs === null ? '–' : `${entry.connectMs} ms`}
          </span>
          <span role="cell" className="text-right font-mono text-[12px]">
            {entry.bytesPerSec === null ? '–' : `${formatBytes(entry.bytesPerSec)}/s`}
          </span>
        </>
      )}
    </div>
  )
}
