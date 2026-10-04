import type { LabState } from '@shared/lab'
import { create } from 'zustand'

// The Test lab as the window shows it. The main process owns every run (main/debug/lab.ts); this
// only keeps the last state it pushed, and whether the lab's side panel is open.

const WIDTH_KEY = 'plexo.labWidth'
const DEFAULT_WIDTH = 480

function loadWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    return saved >= 420 ? saved : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

interface LabStore {
  state: LabState | null
  open: boolean
  width: number
  /** What the last attempt to start something said, when it was refused. */
  error: string | null
  setOpen: (open: boolean) => void
  setWidth: (width: number) => void
  receive: (state: LabState) => void
  load: () => Promise<void>
  run: (planId: string) => void
  runAll: () => void
  verify: (planId: string) => void
  stop: () => void
}

export const useLabStore = create<LabStore>((set, get) => {
  const attempt = (work: Promise<unknown>): void => {
    set({ error: null })
    void work.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      // Electron wraps a main-process error in "Error invoking remote method ...: Error: ...".
      set({ error: message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') })
    })
  }
  return {
    state: null,
    open: false,
    width: loadWidth(),
    error: null,
    setOpen: (open) => set({ open }),
    setWidth: (width) => {
      set({ width })
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
      } catch {
        // Not remembered; the panel still works.
      }
    },
    receive: (state) => set({ state }),
    load: async () => {
      try {
        get().receive(await window.plexo.labGetState())
      } catch {
        // The next push brings it.
      }
    },
    run: (planId) => attempt(window.plexo.labRun(planId)),
    runAll: () => attempt(window.plexo.labRunAll()),
    verify: (planId) => attempt(window.plexo.labVerify(planId)),
    stop: () => attempt(window.plexo.labStop())
  }
})
