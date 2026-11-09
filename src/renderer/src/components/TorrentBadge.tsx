import { t } from '@shared/i18n/react'
import { Badge } from './ui/badge'

/** Next to a torrent's name, wherever it's listed: the name alone doesn't say where it comes from.
 * Neutral, so it never competes with a status badge. */
export function TorrentBadge(): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className="h-4 rounded-[3.5px] px-[6px] font-mono text-[9.5px] leading-none font-semibold tracking-[0.08em] rtl:tracking-normal text-muted-foreground"
    >
      {t('TORRENT')}
    </Badge>
  )
}
