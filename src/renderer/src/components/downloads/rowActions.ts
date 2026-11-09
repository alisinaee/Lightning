import { t } from '@shared/i18n/react'
import {
  Copy,
  DownloadSimple as Download,
  ArrowSquareOut as ExternalLink,
  FileText,
  FolderSimple as FolderInput,
  FolderOpen,
  Info,
  LinkSimple as Link2,
  Pause,
  Play,
  ArrowClockwise as RotateCw,
  Trash as Trash2,
  X
} from '@phosphor-icons/react'
import { isFinished, type Item, type RowInfo } from '../../utils/status'
import { revealLabel, type RowHandlers } from './rowHelpers'
import type { RowAction } from './rowMenu'

/** The action a row's main button does: Pause, Resume, Retry or Download again. */
export interface PrimaryAction {
  label: string
  /** Which verb, for the short menu label; the button label carries the file name. */
  kind?: 'pause' | 'resume' | 'retry'
  icon?: RowAction['icon']
  run: () => void
}

/** The main action of a download, as its row shows it. */
export function primaryActionOf(
  item: Item,
  info: RowInfo,
  handlers: RowHandlers
): PrimaryAction | null {
  const name = item.fileName
  const pause = (): void => void window.lightning.pauseDownload(item.id)
  const resume = (): void => void window.lightning.resumeDownload(item.id)
  let primary: PrimaryAction | null = null
  if (!isFinished(item)) {
    if (item.status === 'downloading' || item.status === 'queued') {
      primary = { label: t('Pause {name}', { name }), kind: 'pause', icon: Pause, run: pause }
    } else if (item.status === 'paused') {
      primary = { label: t('Resume {name}', { name }), kind: 'resume', icon: Play, run: resume }
    } else if (item.status === 'error') {
      // Retry always tries the saved link first; Fix link is for when that link is refused.
      if (item.resumable !== false) {
        primary = { label: t('Retry {name}', { name }), kind: 'retry', icon: RotateCw, run: resume }
      } else
        primary = { label: t('Download again'), icon: Download, run: () => handlers.again(item) }
    }
  }
  if (info.status === 'completed' && info.missing) {
    primary = { label: t('Download again'), icon: Download, run: () => handlers.again(item) }
  }
  return primary
}

/** Whether the row offers Fix link: a stopped download whose link is refused. */
export function fixLinkOf(item: Item, info: RowInfo): boolean {
  return !isFinished(item) && item.status === 'error' && info.status === 'attention'
}

/**
 * The right-click (and ⋯) actions of a download. `remove` replaces the list's own remove entry for
 * a finished file, for a file that is in a group (it leaves the group the way its X button does).
 */
export function buildDownloadActions({
  item,
  info,
  handlers,
  primary,
  fixLink,
  remove
}: {
  item: Item
  info: RowInfo
  handlers: RowHandlers
  primary: PrimaryAction | null
  fixLink: boolean
  remove?: { label: string; run: () => void }
}): RowAction[] {
  const name = item.fileName
  const finished = info.status === 'completed'
  const menu: RowAction[] = []
  if (finished) {
    menu.push({
      id: 'open-file',
      label: t('Open file'),
      icon: ExternalLink,
      disabled: info.missing,
      run: () => void window.lightning.openDownloadedFile(item.id)
    })
  }
  menu.push({
    id: 'reveal',
    label: revealLabel(),
    icon: FolderOpen,
    run: () => void window.lightning.revealDownload(item.id),
    disabled: info.missing
  })
  menu.push({ id: 'details', label: t('Details'), icon: Info, run: () => handlers.open(item.id) })
  if (primary && (!isFinished(item) || info.missing)) {
    menu.push({
      id: 'primary',
      label:
        primary.kind === 'pause'
          ? t('Pause')
          : primary.kind === 'resume'
            ? t('Resume')
            : primary.kind === 'retry'
              ? t('Retry')
              : primary.label,
      icon: primary.icon ?? Link2,
      run: primary.run,
      divider: true
    })
  }
  if (fixLink) {
    menu.push({ id: 'fix', label: t('Fix link'), icon: Link2, run: () => handlers.fix(item) })
  }
  menu.push({
    id: 'copy',
    label: t('Copy link'),
    icon: Copy,
    run: () => void navigator.clipboard.writeText(item.url).catch(() => {}),
    divider: !primary
  })
  menu.push({
    id: 'copy-name',
    label: t('Copy file name'),
    icon: FileText,
    run: () => void navigator.clipboard.writeText(name).catch(() => {})
  })
  if ('destinationPath' in item && item.destinationPath) {
    const path = item.destinationPath
    menu.push({
      id: 'copy-path',
      label: t('Copy file location'),
      icon: FolderInput,
      run: () => void navigator.clipboard.writeText(path).catch(() => {})
    })
  }
  if (primary?.label !== t('Download again')) {
    menu.push({
      id: 'again',
      label: t('Download again…'),
      icon: RotateCw,
      run: () => handlers.again(item),
      divider: true
    })
  }
  if (finished) {
    menu.push({
      id: 'remove',
      label: remove?.label ?? t('Remove from list…'),
      icon: X,
      run: remove?.run ?? (() => handlers.removeFromList(item)),
      divider: true
    })
    if (!info.missing) {
      menu.push({
        id: 'trash',
        label: t('Delete file…'),
        icon: Trash2,
        danger: true,
        run: () => handlers.trash(item)
      })
    }
  } else {
    menu.push({
      id: 'cancel',
      label: t('Cancel and delete partial data…'),
      icon: Trash2,
      danger: true,
      run: () => handlers.cancel(item),
      divider: true
    })
  }
  return menu
}
