import { Layers, Send } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useYoutubeStore, type YoutubeJobFilter } from '../../store/useYoutubeStore'
import { Item, labelClass } from '../downloads/Sidebar'
import { statusStyle, type StatusKey } from '../../utils/status'
import { YoutubeIcon } from './YoutubeIcon'

// The same status look as the Downloads side panel, so the two screens read as one app.
const FILTERS: {
  value: YoutubeJobFilter
  label: string
  icon: typeof Layers
  status?: StatusKey
}[] = [
  { value: 'all', label: 'All downloads', icon: Layers },
  { value: 'active', label: 'Downloading', icon: Layers, status: 'downloading' },
  { value: 'finished', label: 'Completed', icon: Layers, status: 'completed' },
  { value: 'failed', label: 'Failed', icon: Layers, status: 'failed' }
]

/** The YouTube side panel. Same layout, sections and rows as the Downloads panel. */
export function YoutubeSidebar({
  counts
}: {
  counts: Record<YoutubeJobFilter, number>
}): React.JSX.Element {
  const setView = useAppStore((store) => store.setView)
  const jobFilter = useYoutubeStore((store) => store.jobFilter)
  const setJobFilter = useYoutubeStore((store) => store.setJobFilter)

  return (
    <nav
      aria-label="YouTube categories"
      className="flex w-[184px] shrink-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto border-r-[0.5px] border-border p-2"
    >
      <div className={labelClass}>Status</div>
      {FILTERS.map((filter) => {
        const style = filter.status ? statusStyle(filter.status) : null
        const Icon = style?.icon ?? filter.icon
        return (
          <Item
            key={filter.value}
            label={filter.label}
            collapsed={false}
            active={jobFilter === filter.value}
            count={counts[filter.value]}
            onClick={() => setJobFilter(filter.value)}
          >
            <Icon
              aria-hidden
              className="size-4 shrink-0"
              style={{ color: style?.color ?? 'var(--text-secondary)' }}
            />
            <span className="min-w-0 flex-1 truncate">{filter.label}</span>
          </Item>
        )
      })}

      <div className={labelClass}>Services</div>
      <Item
        label="Downloads"
        collapsed={false}
        active={false}
        title="Back to Downloads"
        onClick={() => setView({ name: 'list' })}
      >
        <Layers aria-hidden className="size-4 shrink-0 text-[var(--text-secondary)]" />
        <span className="min-w-0 flex-1 truncate">Downloads</span>
      </Item>
      <Item
        label="Telegram"
        collapsed={false}
        active={false}
        title="Downloads from Telegram chats and links"
        onClick={() => setView({ name: 'telegram', kind: null })}
      >
        <Send aria-hidden className="size-4 shrink-0 text-[var(--text-secondary)]" />
        <span className="min-w-0 flex-1 truncate">Telegram</span>
      </Item>
      <Item label="YouTube" collapsed={false} active title="YouTube downloads" onClick={() => {}}>
        <YoutubeIcon className="size-4 shrink-0 text-[#ff0033]" />
        <span className="min-w-0 flex-1 truncate">YouTube</span>
      </Item>
    </nav>
  )
}
