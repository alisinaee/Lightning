import type { DownloadState, GroupInfo, PendingGroupItem } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { connectionsOf } from './format'

/** What a file of a group is, for the one connection chooser all its views share. */
export type GroupFile =
  { kind: 'download'; download: DownloadState } | { kind: 'waiting'; item: PendingGroupItem }

export const fileIdOf = (file: GroupFile): string =>
  file.kind === 'download' ? file.download.id : file.item.id

/** The networks the file uses now, or (waiting) the ones chosen for it or planned. */
export function networksOf(group: GroupInfo, file: GroupFile): string[] {
  if (file.kind === 'download') {
    return connectionsOf(file.download.networks)
      .filter((network) => network.enabled)
      .map((network) => network.id)
  }
  const real = (ids: string[]): string[] =>
    ids.filter((id) => !useAppStore.getState().vpnInterfaces.some((tunnel) => tunnel.id === id))
  if (group.pinned.includes(file.item.id)) return real(file.item.request.interfaceIds)
  const planned = group.plannedNetworks[file.item.id]
  return planned ? [planned] : real(group.interfaceIds)
}

/** Switches a running file's networks to exactly `next`: the new ones first, so it is never left
 * with none (which would pause it). An errored file is resumed first, so it can be switched. */
async function switchNetworks(download: DownloadState, next: string[]): Promise<void> {
  if (download.status === 'error') await window.plexo.resumeDownload(download.id)
  const current = connectionsOf(download.networks)
    .filter((network) => network.enabled)
    .map((n) => n.id)
  for (const id of next) {
    if (!current.includes(id)) await window.plexo.setDownloadNetwork(download.id, id, true)
  }
  for (const id of current) {
    if (!next.includes(id)) await window.plexo.setDownloadNetwork(download.id, id, false)
  }
}

/** The user's choice of networks for one file; `null` gives it back to Auto. In an Auto group a
 * choice pins the file: the planner leaves it as chosen. */
export async function chooseConnection(
  group: GroupInfo,
  file: GroupFile,
  next: string[] | null
): Promise<void> {
  const auto = group.mode === 'auto'
  if (next === null) {
    await window.plexo.setGroupFileChoice(group.id, fileIdOf(file), null)
    return
  }
  if (file.kind === 'download') await switchNetworks(file.download, next)
  // Also for a manual group's waiting file; a manual running one needs no record.
  if (auto || file.kind === 'waiting') {
    await window.plexo.setGroupFileChoice(group.id, fileIdOf(file), next)
  }
}
