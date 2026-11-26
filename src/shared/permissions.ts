/** The macOS privacy permissions Lightning can ask for. */
export type PermissionKind = 'fullDisk' | 'folder' | 'notifications'

/** What Lightning holds; null where macOS doesn't say. */
export interface PermissionStatus {
  /** Full Disk Access: needed only to borrow Safari's YouTube sign-in. */
  fullDisk: boolean | null
  /** The download folder can be read and written. */
  folder: boolean | null
  notifications: boolean | null
}

/** What the drag panel over System Settings shows. */
export interface GrantPanelState {
  kind: PermissionKind
  status: 'waiting' | 'allowed'
  /** Whether the app can be dragged into the list (Full Disk Access takes a dropped app). */
  draggable: boolean
  appName: string
  /** The app's icon as a data URL, or '' when there is none to show. */
  icon: string
  language: string
}
