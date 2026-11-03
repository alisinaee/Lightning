import type { TdlLoginEvent, TdlLoginMode } from '@shared/telegram'
import { AlertTriangle, CircleCheck, FolderOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store/useAppStore'
import { useTelegramStore } from '../../store/useTelegramStore'
import { describeError } from '../../utils/format'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { TelegramQr } from './TelegramQr'

export function TelegramLoginDialog(): React.JSX.Element {
  const open = useTelegramStore((store) => store.loginOpen)
  const close = useTelegramStore((store) => store.closeLogin)
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex w-[460px] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[calc(100%-2rem)]">
        {open && <LoginForm onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

const MODE_HELP: Record<TdlLoginMode, string> = {
  qr: 'Scan the code with Telegram on your phone: Settings → Devices → Link Desktop Device.',
  code: 'Enter your phone number, then the code Telegram sends you.',
  desktop:
    'Reuse the account of Telegram Desktop (the telegram.org app). The Mac App Store version of Telegram cannot be imported: use the QR code instead.'
}

const PROMPTS = {
  phone: { label: 'Phone number', hint: 'With the country code, like +1 555 0100', type: 'tel' },
  code: { label: 'Login code', hint: 'The code Telegram sent you', type: 'text' },
  password: { label: 'Two-step password', hint: 'Your Telegram cloud password', type: 'password' }
} as const

function LoginForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const status = useTelegramStore((store) => store.status)
  const refresh = useTelegramStore((store) => store.refreshStatus)
  const initialMode = useTelegramStore((store) => store.loginMode)
  const homeDir = useAppStore((store) => store.homeDir)
  const [mode, setMode] = useState<TdlLoginMode>(initialMode)
  const [running, setRunning] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<keyof typeof PROMPTS | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)
  const [desktopDir, setDesktopDir] = useState('')
  const [passcode, setPasscode] = useState('')
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const session = useRef<string | null>(null)
  const starting = useRef(false)

  useEffect(() => {
    const unsubscribe = window.lightning.onTdlLoginEvent(
      (sessionId: string, event: TdlLoginEvent) => {
        // A sign-in can speak before start() has heard its own id.
        if (session.current ? sessionId !== session.current : !starting.current) return
        if (event.type === 'qr') setQr(event.ascii)
        else if (event.type === 'prompt') {
          setPrompt(event.field)
          setAnswer('')
        } else if (event.type === 'done') {
          setRunning(false)
          setPrompt(null)
          setQr(null)
          setAccount(event.account)
          session.current = null
          void refresh()
        } else {
          setRunning(false)
          setPrompt(null)
          setQr(null)
          setError(event.message)
          session.current = null
        }
      }
    )
    return () => {
      unsubscribe()
      if (session.current) void window.lightning.tdlLoginCancel(session.current).catch(() => {})
    }
  }, [refresh])

  const start = async (): Promise<void> => {
    if (mode === 'desktop' && /\.app\/?$/i.test(desktopDir.trim())) {
      setError(
        'That is the Telegram app itself. Pick the "Telegram Desktop" data folder, or sign in with the QR code.'
      )
      return
    }
    setError(null)
    setQr(null)
    setPrompt(null)
    setRunning(true)
    starting.current = true
    try {
      session.current = await window.lightning.tdlLoginStart(
        mode,
        mode === 'desktop'
          ? { desktopDir: desktopDir || undefined, passcode: passcode || undefined }
          : undefined
      )
    } catch (reason) {
      setRunning(false)
      setError(describeError(reason))
    } finally {
      starting.current = false
    }
  }

  const stop = async (): Promise<void> => {
    const id = session.current
    session.current = null
    setRunning(false)
    setQr(null)
    setPrompt(null)
    if (id) await window.lightning.tdlLoginCancel(id).catch(() => {})
  }

  const submitAnswer = async (): Promise<void> => {
    if (!session.current || !answer) return
    const value = answer
    setAnswer('')
    setPrompt(null)
    try {
      await window.lightning.tdlLoginAnswer(session.current, value)
    } catch (reason) {
      setError(describeError(reason))
    }
  }

  const logout = async (): Promise<void> => {
    try {
      await window.lightning.tdlLogout()
    } catch (reason) {
      setError(describeError(reason))
    }
    setConfirmLogout(false)
    void refresh()
  }

  const browse = async (): Promise<void> => {
    const picked = await window.lightning.chooseDestinationFolder(desktopDir || homeDir)
    if (picked) setDesktopDir(picked)
  }

  const signedIn = status?.loggedIn && !running
  const title = account || signedIn ? 'Telegram account' : 'Sign in to Telegram'
  return (
    <div className="flex flex-col">
      <div className="border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Sign in to Telegram so Lightning can download from your chats.
        </DialogDescription>
      </div>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {account ? (
          <div className="flex items-center gap-2 text-[13px]">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-[var(--status-done)]" />
            Signed in as {account}
          </div>
        ) : signedIn ? (
          <>
            <div className="flex items-center gap-2 text-[13px]">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-[var(--status-done)]" />
              <span className="min-w-0 truncate">
                Signed in as {status?.account ?? 'your account'}
              </span>
            </div>
            {confirmLogout ? (
              <div className="flex flex-col gap-2 text-[12.5px] text-[var(--text-secondary)]">
                Signing out deletes the Telegram session Lightning stored on this computer. Files
                already downloaded stay.
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" onClick={() => void logout()}>
                    Sign out
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setConfirmLogout(false)}>
                    Keep me signed in
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button type="button" variant="secondary" onClick={() => setConfirmLogout(true)}>
                  Sign out…
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <ToggleGroup
              value={[mode]}
              variant="outline"
              aria-label="Sign-in method"
              onValueChange={(value) => !running && value[0] && setMode(value[0] as TdlLoginMode)}
            >
              <ToggleGroupItem value="qr">QR code</ToggleGroupItem>
              <ToggleGroupItem value="code">Phone number</ToggleGroupItem>
              <ToggleGroupItem value="desktop">Telegram Desktop</ToggleGroupItem>
            </ToggleGroup>
            <div className="text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
              {MODE_HELP[mode]}
            </div>
            {mode === 'desktop' && !running && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    value={desktopDir}
                    onChange={(event) => setDesktopDir(event.target.value)}
                    placeholder="Telegram Desktop data folder (optional)"
                    spellCheck={false}
                    aria-label="Telegram Desktop data folder"
                    className="h-9 min-w-0 flex-1 rounded-[9px] text-[12.5px]"
                  />
                  <Button type="button" variant="secondary" onClick={() => void browse()}>
                    <FolderOpen data-icon="inline-start" />
                    Browse…
                  </Button>
                </div>
                <Input
                  type="password"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  placeholder="Local passcode (if you set one)"
                  aria-label="Local passcode"
                  className="h-9 rounded-[9px] text-[12.5px]"
                />
              </div>
            )}
            {qr && (
              <>
                <TelegramQr ascii={qr} />
                <div className="flex flex-col items-center gap-1.5">
                  <Button type="button" variant="secondary" onClick={() => setEnlarged(true)}>
                    Enlarge for scanning
                  </Button>
                  <div className="text-center text-[12px] leading-[1.5] text-[var(--text-secondary)]">
                    Telegram cannot read it? Press Stop, choose Phone number, and enter the code
                    Telegram sends to your app.
                  </div>
                </div>
              </>
            )}
            {qr &&
              enlarged &&
              createPortal(
                <div
                  role="presentation"
                  className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-white"
                  onClick={() => setEnlarged(false)}
                >
                  <TelegramQr ascii={qr} fit />
                </div>,
                document.body
              )}
            {prompt && (
              <form
                className="flex flex-col gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitAnswer()
                }}
              >
                <label className="text-[12.5px] font-medium" htmlFor="tdl-answer">
                  {PROMPTS[prompt].label}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="tdl-answer"
                    autoFocus
                    type={PROMPTS[prompt].type}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={PROMPTS[prompt].hint}
                    autoComplete="off"
                    className="h-9 min-w-0 flex-1 rounded-[9px] text-[13px]"
                  />
                  <Button type="submit" disabled={!answer}>
                    Next
                  </Button>
                </div>
              </form>
            )}
            {running && !qr && !prompt && (
              <div className="text-[12.5px] text-muted-foreground">Waiting for Telegram…</div>
            )}
          </>
        )}
        {error && (
          <div className="flex items-start gap-2 text-[12.5px] text-[var(--color-danger)]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="text-[11.5px] text-muted-foreground">
          Telegram downloads use the default connection. Your session is stored on this computer.
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
        {!account && !signedIn && running && (
          <Button type="button" variant="secondary" onClick={() => void stop()}>
            Stop
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          {account || signedIn ? 'Close' : 'Cancel'}
        </Button>
        {!account && !signedIn && !running && (
          <Button type="button" onClick={() => void start()}>
            {error ? 'Try again' : 'Start'}
          </Button>
        )}
      </div>
    </div>
  )
}
