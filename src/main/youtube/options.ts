import { join } from 'node:path'
import { DEFAULT_YOUTUBE_OPTIONS, type YoutubeOptions } from '../../shared/youtube'
import { readJson, updateJson } from '../jsonFile'
import { youtubeDataDir } from './binary'

const FILE = (): string => join(youtubeDataDir(), 'options.json')

const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360', 'audio'] as const

const SIZE = /^\d+(\.\d+)?[KMG]?$/i
const DATE = /^\d{8}$/
const SORT = /^[\w:.,+-]{0,200}$/
const ITEMS = /^[\d,:\- ]{0,100}$/
const FORMAT = /^[^\n\r\0]{0,300}$/

/** Keeps only known, in-range values, so a damaged or old file falls back to the defaults. A text
 * setting that does not match its pattern is dropped to its default, never passed to yt-dlp. */
function clean(raw: unknown): YoutubeOptions {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_YOUTUBE_OPTIONS
  const text = (value: unknown, fallback: string, max = 4096): string =>
    typeof value === 'string' && value.length <= max ? value.trim() : fallback
  const matching = (value: unknown, pattern: RegExp, fallback: string): string => {
    const cleaned = text(value, fallback, 400)
    return cleaned === '' || pattern.test(cleaned) ? cleaned : fallback
  }
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  const flag = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback
  const int = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback

  // A template is relative to the folder: no absolute paths, no "..", no empty name.
  const template = text(input.outputTemplate, d.outputTemplate, 200)
  const safeTemplate =
    template.length > 0 &&
    !template.startsWith('/') &&
    !template.split(/[\\/]/).includes('..') &&
    !template.includes('\0')
      ? template
      : d.outputTemplate

  return {
    quality: pick(input.quality, QUALITIES, d.quality),
    folder: text(input.folder, d.folder),
    autoStartDefault: flag(input.autoStartDefault, d.autoStartDefault),
    cookieMode: pick(input.cookieMode, ['none', 'saved', 'manual'] as const, d.cookieMode),
    manualCookiesFile: text(input.manualCookiesFile, d.manualCookiesFile),
    playlist: pick(input.playlist, ['single', 'full'] as const, d.playlist),
    subtitles: flag(input.subtitles, d.subtitles),
    subtitleLangs:
      matching(input.subtitleLangs, /^[\w.*,\- ]{1,200}$/, d.subtitleLangs) || d.subtitleLangs,
    metadata: flag(input.metadata, d.metadata),
    embedThumbnail: flag(input.embedThumbnail, d.embedThumbnail),
    mergeFormat: pick(input.mergeFormat, ['mp4', 'mkv', 'webm'] as const, d.mergeFormat),
    audioFormat: pick(
      input.audioFormat,
      ['m4a', 'mp3', 'opus', 'flac', 'wav'] as const,
      d.audioFormat
    ),
    embedChapters: flag(input.embedChapters, d.embedChapters),
    sponsorBlock: pick(input.sponsorBlock, ['off', 'mark', 'remove'] as const, d.sponsorBlock),

    formatOverride: matching(input.formatOverride, FORMAT, d.formatOverride),
    formatSort: matching(input.formatSort, SORT, d.formatSort),
    outputTemplate: safeTemplate,
    restrictFilenames: flag(input.restrictFilenames, d.restrictFilenames),
    windowsFilenames: flag(input.windowsFilenames, d.windowsFilenames),
    limitRate: matching(input.limitRate, SIZE, d.limitRate),
    concurrentFragments: int(input.concurrentFragments, 1, 16, d.concurrentFragments),
    retries: int(input.retries, 0, 50, d.retries),
    sleepInterval: int(input.sleepInterval, 0, 60, d.sleepInterval),
    socketTimeout: int(input.socketTimeout, 5, 300, d.socketTimeout),
    dateAfter: matching(input.dateAfter, DATE, d.dateAfter),
    dateBefore: matching(input.dateBefore, DATE, d.dateBefore),
    maxDownloads: int(input.maxDownloads, 0, 100000, d.maxDownloads),
    playlistItems: matching(input.playlistItems, ITEMS, d.playlistItems),
    skipDownloaded: flag(input.skipDownloaded, d.skipDownloaded),
    impersonate: pick(
      input.impersonate,
      ['', 'chrome', 'safari', 'firefox'] as const,
      d.impersonate
    ),
    writeInfoJson: flag(input.writeInfoJson, d.writeInfoJson),
    writeDescription: flag(input.writeDescription, d.writeDescription),
    writeThumbnail: flag(input.writeThumbnail, d.writeThumbnail),
    useRemoteTime: flag(input.useRemoteTime, d.useRemoteTime),
    noOverwrites: flag(input.noOverwrites, d.noOverwrites)
  }
}

export async function loadYoutubeOptions(): Promise<YoutubeOptions> {
  return clean(await readJson(FILE()))
}

/** Applies a partial change and returns the full saved options. */
export async function saveYoutubeOptions(change: Partial<YoutubeOptions>): Promise<YoutubeOptions> {
  let saved = DEFAULT_YOUTUBE_OPTIONS
  await updateJson(FILE(), (current) => {
    saved = clean({ ...clean(current), ...change })
    return saved
  })
  return saved
}
