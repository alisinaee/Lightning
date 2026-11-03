import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TdlChat, TdlItem, TdlRangeType } from '../../shared/telegram'
import { mediaKindOf } from '../../shared/telegram'
import { baseArgs, exclusive, failureReason, runTdl, tdlExportsDir } from './tdlBinary'

/** The chats of the signed-in account (tdl chat ls -o json). */
export function listChats(proxy?: string): Promise<TdlChat[]> {
  return exclusive(async () => {
    const run = await runTdl([...baseArgs(proxy), 'chat', 'ls', '-o', 'json'], 120_000)
    if (run.code !== 0) throw new Error(failureReason(run.stderr + run.stdout))
    return parseChats(run.stdout)
  })
}

export function parseChats(text: string): TdlChat[] {
  const start = text.indexOf('[')
  if (start < 0) return []
  let list: unknown
  try {
    list = JSON.parse(text.slice(start))
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  const chats: TdlChat[] = []
  for (const entry of list as Record<string, unknown>[]) {
    if (!entry || typeof entry !== 'object') continue
    const id = entry.id ?? entry.ID
    if (id === undefined || id === null) continue
    const username =
      typeof entry.username === 'string' && entry.username ? `@${entry.username}` : ''
    const title = String(entry.visible_name ?? entry.title ?? entry.name ?? username ?? id)
    chats.push({
      id: String(id),
      title: title || username || String(id),
      type: String(entry.type ?? '')
    })
  }
  return chats
}

interface ExportFile {
  id?: number | string
  messages?: { id?: number; file?: string; [key: string]: unknown }[]
  [key: string]: unknown
}

/** The files a tdl export holds, one item per message with a file. */
export function itemsOfExport(data: ExportFile): TdlItem[] {
  const chat = String(data.id ?? '')
  const items: TdlItem[] = []
  for (const message of data.messages ?? []) {
    if (typeof message.id !== 'number' || typeof message.file !== 'string' || !message.file)
      continue
    const mime = typeof message.mime_type === 'string' ? message.mime_type : undefined
    items.push({
      key: `${chat}/${message.id}`,
      fileName: message.file,
      media: mediaKindOf(message.file, mime),
      received: 0,
      total: typeof message.size === 'number' ? message.size : 0,
      speed: 0,
      status: 'waiting'
    })
  }
  return items
}

export async function readExport(file: string): Promise<{ chat: string; items: TdlItem[] }> {
  const data = JSON.parse(await readFile(file, 'utf-8')) as ExportFile
  return { chat: String(data.id ?? ''), items: itemsOfExport(data) }
}

/** Exports a chat range to a JSON file in Lightning's folder and lists what holds files. */
export function exportPreview(
  input: { chat: string; rangeType: TdlRangeType; range: string; filter?: string },
  proxy?: string
): Promise<{ file: string; items: TdlItem[] }> {
  return exclusive(async () => {
    await mkdir(tdlExportsDir(), { recursive: true })
    const file = join(tdlExportsDir(), `${randomUUID()}.json`)
    const args = [
      ...baseArgs(proxy),
      'chat',
      'export',
      '-c',
      input.chat,
      '-T',
      input.rangeType,
      '-o',
      file
    ]
    if (input.range.trim()) args.push('-i', input.range.trim())
    if (input.filter?.trim()) args.push('-f', input.filter.trim())
    const run = await runTdl(args, 10 * 60_000)
    if (run.code !== 0) throw new Error(failureReason(run.stderr + run.stdout))
    return { file, items: (await readExport(file)).items }
  })
}

/** A copy of an export with only the chosen messages, for tdl dl -f. */
export async function filteredExport(file: string, keys: string[]): Promise<string> {
  const data = JSON.parse(await readFile(file, 'utf-8')) as ExportFile
  const wanted = new Set(keys)
  const chat = String(data.id ?? '')
  data.messages = (data.messages ?? []).filter((message) => wanted.has(`${chat}/${message.id}`))
  const out = join(tdlExportsDir(), `${randomUUID()}.json`)
  await mkdir(tdlExportsDir(), { recursive: true })
  await writeFile(out, JSON.stringify(data), 'utf-8')
  return out
}
