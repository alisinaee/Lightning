import type { TdlLoginEvent, TdlLoginMode } from '@shared/telegram'
import {
  Warning as AlertTriangle,
  CheckCircle as CircleCheck,
  FolderOpen
} from '@phosphor-icons/react'
import { t } from '@shared/i18n/react'
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

const modeHelp = (mode: TdlLoginMode): string =>
  mode === 'qr'
    ? t('Scan the code with Telegram on your phone: Settings → Devices → Link Desktop Device.')
    : mode === 'code'
      ? t('Two steps: your phone number first, then the code Telegram sends to your Telegram app.')
      : t(
          'Reuse the account of Telegram Desktop (the telegram.org app). The Mac App Store version of Telegram cannot be imported: use the QR code instead.'
        )

const PROMPT_TYPES = { phone: 'tel', code: 'text', password: 'password' } as const

type PromptField = keyof typeof PROMPT_TYPES

/** The words of one prompt, looked up when drawn so they follow the language. */
function promptText(field: PromptField): {
  label: string
  hint: string
  help: string
  submit: string
} {
  if (field === 'phone') {
    return {
      label: t('Your phone number'),
      hint: '+98 912 000 0000',
      help: t('Start with + and the country code. Telegram will send a code to your Telegram app.'),
      submit: t('Send code')
    }
  }
  if (field === 'code') {
    return {
      label: t('The code Telegram sent you'),
      hint: '12345',
      help: t(
        'Open the Telegram app on your phone: the code is in the chat named "Telegram" (or comes by SMS).'
      ),
      submit: t('Verify')
    }
  }
  return {
    label: t('Your two-step password'),
    hint: t('Telegram cloud password'),
    help: t('This is the extra password you set in Telegram, not the login code.'),
    submit: t('Sign in')
  }
}

/** Persian and Arabic-Indic digits to 0-9. */
function asciiDigits(text: string): string {
  return text
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

/** A reason this answer is probably a mistake, or null when it looks right. */
function answerProblem(field: PromptField, value: string): string | null {
  const text = asciiDigits(value.trim())
  if (field === 'phone') {
    if (!text.startsWith('+')) return t('Start with + and the country code, like +98.')
    if (text.replace(/\D/g, '').length < 8) return t('That number looks too short.')
  }
  if (field === 'code') {
    if (text.startsWith('+') || text.replace(/\D/g, '').length > 8) {
      return t('That looks like a phone number. Enter the short code Telegram just sent you.')
    }
    if (/\D/.test(text.replace(/\s/g, ''))) return t('The code is digits only.')
  }
  return null
}

const stepLabel = (field: PromptField): string =>
  field === 'phone' ? t('Phone number') : field === 'code' ? t('Code') : t('Password')

const STEPS: PromptField[] = ['phone', 'code', 'password']

function Steps({
  current,
  sawPassword
}: {
  current: PromptField
  sawPassword: boolean
}): React.JSX.Element {
  const steps = STEPS.filter((step) => step !== 'password' || sawPassword)
  const index = steps.findIndex((step) => step === current)
  return (
    <ol className="flex items-center gap-2 text-[12px]" aria-label={t('Sign-in steps')}>
      {steps.map((step, position) => {
        const done = position < index
        const active = position === index
        return (
          <li key={step} className="flex items-center gap-2">
            <span
              className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                done || active
                  ? 'bg-[var(--accent,#8b7cf6)] text-white'
                  : 'bg-[var(--surface-2,rgba(255,255,255,0.08))] text-muted-foreground'
              }`}
            >
              {done ? <CircleCheck className="size-3.5" /> : position + 1}
            </span>
            <span className={active ? 'font-medium' : 'text-muted-foreground'}>
              {stepLabel(step)}
            </span>
            {position < steps.length - 1 && <span className="h-px w-5 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}

function LoginForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const status = useTelegramStore((store) => store.status)
  const refresh = useTelegramStore((store) => store.refreshStatus)
  const initialMode = useTelegramStore((store) => store.loginMode)
  const homeDir = useAppStore((store) => store.homeDir)
  const [mode, setMode] = useState<TdlLoginMode>(initialMode)
  const [running, setRunning] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptField | null>(null)
  const [submitted, setSubmitted] = useState<PromptField | null>(null)
  const [sentTo, setSentTo] = useState('')
  const [sawPassword, setSawPassword] = useState(false)
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
          if (event.field === 'password') setSawPassword(true)
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
        t(
          'That is the Telegram app itself. Pick the "Telegram Desktop" data folder, or sign in with the QR code.'
        )
      )
      return
    }
    setError(null)
    setQr(null)
    setSubmitted(null)
    setSentTo('')
    setSawPassword(false)
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
    if (prompt && answerProblem(prompt, value)) return
    if (prompt === 'phone') setSentTo(asciiDigits(value).replace(/\D/g, '').slice(-4))
    setSubmitted(prompt)
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
  const title = account || signedIn ? t('Telegram account') : t('Sign in to Telegram')
  return (
    <div className="flex flex-col">
      <div className="border-b-[0.5px] border-border px-5 py-4">
        <DialogTitle className="text-[16px] font-semibold">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('Sign in to Telegram so Lightning can download from your chats.')}
        </DialogDescription>
      </div>
      <div className="flex flex-col gap-3.5 px-5 py-4">
        {account ? (
          <div className="flex items-center gap-2 text-[13px]">
            <CircleCheck aria-hidden className="size-4 shrink-0 text-[var(--status-done)]" />
            {t('Signed in as {account}', { account })}
          </div>
        ) : signedIn ? (
          <>
            <div className="flex items-center gap-2 text-[13px]">
              <CircleCheck aria-hidden className="size-4 shrink-0 text-[var(--status-done)]" />
              <span className="min-w-0 truncate">
                {t('Signed in as {account}', { account: status?.account ?? t('your account') })}
              </span>
            </div>
            {confirmLogout ? (
              <div className="flex flex-col gap-2 text-[12.5px] text-[var(--text-secondary)]">
                {t(
                  'Signing out deletes the Telegram session Lightning stored on this computer. Files already downloaded stay.'
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" onClick={() => void logout()}>
                    {t('Sign out')}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setConfirmLogout(false)}>
                    {t('Keep me signed in')}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Button type="button" variant="secondary" onClick={() => setConfirmLogout(true)}>
                  {t('Sign out…')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <ToggleGroup
              value={[mode]}
              variant="outline"
              aria-label={t('Sign-in method')}
              onValueChange={(value) => !running && value[0] && setMode(value[0] as TdlLoginMode)}
            >
              <ToggleGroupItem value="qr">{t('QR code')}</ToggleGroupItem>
              <ToggleGroupItem value="code">{t('Phone number')}</ToggleGroupItem>
              <ToggleGroupItem value="desktop">Telegram Desktop</ToggleGroupItem>
            </ToggleGroup>
            <div className="text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
              {modeHelp(mode)}
            </div>
            {mode === 'desktop' && !running && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    value={desktopDir}
                    onChange={(event) => setDesktopDir(event.target.value)}
                    placeholder={t('Telegram Desktop data folder (optional)')}
                    spellCheck={false}
                    aria-label={t('Telegram Desktop data folder')}
                    dir="ltr"
                    className="h-9 min-w-0 flex-1 rounded-[9px] text-[12.5px]"
                  />
                  <Button type="button" variant="secondary" onClick={() => void browse()}>
                    <FolderOpen data-icon="inline-start" />
                    {t('Browse…')}
                  </Button>
                </div>
                <Input
                  type="password"
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  placeholder={t('Local passcode (if you set one)')}
                  aria-label={t('Local passcode')}
                  className="h-9 rounded-[9px] text-[12.5px]"
                />
              </div>
            )}
            {qr && (
              <>
                <TelegramQr ascii={qr} />
                <div className="flex flex-col items-center gap-1.5">
                  <Button type="button" variant="secondary" onClick={() => setEnlarged(true)}>
                    {t('Enlarge for scanning')}
                  </Button>
                  <div className="text-center text-[12px] leading-[1.5] text-[var(--text-secondary)]">
                    {t(
                      'Telegram cannot read it? Press Stop, choose Phone number, and enter the code Telegram sends to your app.'
                    )}
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
            {mode === 'code' && running && !qr && (prompt || submitted) && (
              <Steps current={prompt ?? submitted ?? 'phone'} sawPassword={sawPassword} />
            )}
            {prompt && (
              <form
                className="flex flex-col gap-2 rounded-[10px] border-[0.5px] border-border bg-[var(--surface-2,rgba(255,255,255,0.04))] p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitAnswer()
                }}
              >
                <label className="text-[13px] font-medium" htmlFor="tdl-answer">
                  {promptText(prompt).label}
                </label>
                {prompt === 'code' && sentTo && (
                  <div className="text-[12px] text-muted-foreground">
                    {t('Sent for the number ending in {digits}.', { digits: sentTo })}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input
                    id="tdl-answer"
                    key={prompt}
                    autoFocus
                    type={PROMPT_TYPES[prompt]}
                    inputMode={
                      prompt === 'password' ? undefined : prompt === 'phone' ? 'tel' : 'numeric'
                    }
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={promptText(prompt).hint}
                    dir={prompt === 'password' ? undefined : 'ltr'}
                    autoComplete={prompt === 'code' ? 'one-time-code' : 'off'}
                    spellCheck={false}
                    className={`h-10 min-w-0 flex-1 rounded-[9px] ${
                      prompt === 'code'
                        ? 'text-center font-mono text-[18px] tracking-[0.3em]'
                        : 'text-[13px]'
                    }`}
                  />
                  <Button type="submit" disabled={!answer || !!answerProblem(prompt, answer)}>
                    {promptText(prompt).submit}
                  </Button>
                </div>
                {answer && answerProblem(prompt, answer) ? (
                  <div className="flex items-start gap-1.5 text-[12px] text-[var(--color-danger)]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    {answerProblem(prompt, answer)}
                  </div>
                ) : (
                  <div className="text-[12px] leading-[1.5] text-muted-foreground">
                    {promptText(prompt).help}
                  </div>
                )}
              </form>
            )}
            {running && !qr && !prompt && (
              <div className="text-[12.5px] text-muted-foreground">
                {submitted === 'phone'
                  ? t('Asking Telegram to send you a code…')
                  : submitted === 'code'
                    ? t('Checking the code with Telegram…')
                    : submitted === 'password'
                      ? t('Signing in…')
                      : t('Waiting for Telegram…')}
              </div>
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
          {t(
            'Telegram downloads use the default connection. Your session is stored on this computer.'
          )}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-5 py-3">
        {!account && !signedIn && running && (
          <Button type="button" variant="secondary" onClick={() => void stop()}>
            {t('Stop')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onDone}>
          {account || signedIn ? t('Close') : t('Cancel')}
        </Button>
        {!account && !signedIn && !running && (
          <Button type="button" onClick={() => void start()}>
            {error ? t('Try again') : t('Start')}
          </Button>
        )}
      </div>
    </div>
  )
}
