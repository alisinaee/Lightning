import {
  Disc as Disc3,
  File,
  FileZip as FileArchive,
  FileText,
  FilmStrip as Film,
  Image,
  Magnet,
  MusicNote as Music,
  Package,
  type Icon
} from '@phosphor-icons/react'
import { cn } from 'cn'
import { fileKind, type FileKind } from '../../utils/fileKind'
import { fileExtensionBadge } from '../../utils/format'

const ICONS: Record<FileKind, Icon> = {
  video: Film,
  audio: Music,
  archive: FileArchive,
  document: FileText,
  program: Package,
  image: Image,
  torrent: Magnet,
  disk: Disc3,
  other: File
}

/** A file's kind as a rounded square: its glyph in the kind's colour on a soft tint of it. */
export function FileKindIcon({
  kind,
  size = 'md',
  className,
  icon
}: {
  kind: FileKind
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Another glyph on the same tint (a group's folder). */
  icon?: Icon
}): React.JSX.Element {
  const Icon = icon ?? ICONS[kind]
  return (
    <span
      aria-hidden
      data-kind={kind}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md',
        size === 'sm' && 'size-6 [&>svg]:size-3.5',
        size === 'md' && 'size-8 [&>svg]:size-4',
        size === 'lg' && 'size-11 rounded-[10px] [&>svg]:size-5',
        className
      )}
      style={{
        background: `var(--kind-${kind}-bg)`,
        color: `var(--kind-${kind})`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--kind-${kind}) 28%, transparent)`
      }}
    >
      <Icon />
    </span>
  )
}

/** The file's extension on that kind's tint: video, audio, archive, and the rest each keep their colour. */
export function FormatBadge({
  name,
  size = 'md',
  kind,
  className,
  children
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  /** Defaults to the kind of `name`'s extension. */
  kind?: FileKind
  className?: string
  children?: React.ReactNode
}): React.JSX.Element {
  const resolved = kind ?? fileKind(name)
  return (
    <span
      aria-hidden
      data-kind={resolved}
      className={cn(
        'flex shrink-0 items-center justify-center font-mono leading-none font-bold tracking-[0.04em]',
        size === 'sm' && 'size-6 rounded-md text-[8px]',
        size === 'md' && 'size-8 rounded-md text-[9px]',
        size === 'lg' && 'size-11 rounded-[10px] text-[10.5px]',
        className
      )}
      style={{
        background: `var(--kind-${resolved}-bg)`,
        color: `var(--kind-${resolved})`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--kind-${resolved}) 28%, transparent)`
      }}
    >
      {children ?? fileExtensionBadge(name)}
    </span>
  )
}
