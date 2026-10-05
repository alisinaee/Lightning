import { create } from 'zustand'

/** Whether the Logs window is open (see components/LogsDialog). */
interface LogsStore {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useLogsStore = create<LogsStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
