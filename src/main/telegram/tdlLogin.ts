import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { TdlLoginEvent, TdlLoginMode } from '../../shared/telegram'
import { log } from '../logger'
import { baseArgs, exclusive, failureReason, spawnTdl, writeAccount } from './tdlBinary'
import { stripAnsi } from './tdlProgress'

/** How tdl login is run. Plain pipes are the default and work: tdl's prompts (the survey library)
 * ask the terminal where the cursor is (ESC[6n) and wait for the reply, which writeReplies gives.
 * A pseudo-terminal (node-pty) could replace this by implementing the same shape. */
export interface LoginTransport {
  start(args: string[]): LoginProcess
}

export interface LoginProcess {
  write(text: string): void
  onData(listener: (text: string) => void): void
  onExit(listener: (code: number | null) => void): void
  kill(): void
}

export const pipeTransport: LoginTransport = {
  start(args) {
    const child: ChildProcess = spawnTdl(args)
    const dataListeners: ((text: string) => void)[] = []
    // utf8 streams keep a multi-byte block character whole when a chunk ends inside it.
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    const feed = (text: string): void => {
      // Terminal queries: where is the cursor? Answered with a plausible position.
      if (text.includes('\x1b[6n'))
        child.stdin?.write('\x1b[24;80R'.repeat(text.split('\x1b[6n').length - 1))
      for (const listener of dataListeners) listener(text)
    }
    child.stdout?.on('data', feed)
    child.stderr?.on('data', feed)
    child.stdin?.on('error', () => {})
    return {
      write: (text) => void child.stdin?.write(text),
      onData: (listener) => void dataListeners.push(listener),
      onExit: (listener) => {
        child.on('close', listener)
        child.on('error', () => listener(null))
      },
      kill: () => void child.kill()
    }
  }
}

const BLOCKS = /[▀-▟]/

interface Session {
  process: LoginProcess
  mode: TdlLoginMode
  emit: (event: TdlLoginEvent) => void
  /** Text since the last prompt was answered. */
  buffer: string
  prompted: boolean
  phone: string
  qr: string[]
  /** A QR row that arrived cut off by the end of a chunk. */
  qrTail: string
  /** What the last prompt asked for, so the answer can be tidied before tdl sees it. */
  field: 'phone' | 'code' | 'password' | null
  /** tdl prints a question again with its answer after it is answered; that echo is not a new question. */
  answered: 'phone' | 'code' | 'password' | null
  qrTimer?: NodeJS.Timeout
  finished: boolean
  release: () => void
}

/** Persian and Arabic-Indic digits to 0-9, which is all Telegram accepts. */
function asciiDigits(text: string): string {
  return text
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

/** A code is digits only; a phone number keeps its leading + and loses spaces and dashes. */
function tidyAnswer(field: Session['field'], value: string): string {
  if (field === 'code') return asciiDigits(value).replace(/\D/g, '')
  if (field === 'phone') return asciiDigits(value).replace(/[^\d+]/g, '')
  return value
}

function mask(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.length > 4 ? `+${'•'.repeat(digits.length - 4)}${digits.slice(-4)}` : ''
}

export class TdlLogin {
  private sessions = new Map<string, Session>()

  constructor(
    private readonly proxy: () => Promise<string | undefined>,
    private readonly transport: LoginTransport = pipeTransport
  ) {}

  /** Starts a sign-in and returns its id; events arrive through emit. */
  async start(
    mode: TdlLoginMode,
    options: { desktopDir?: string; passcode?: string } | undefined,
    emit: (sessionId: string, event: TdlLoginEvent) => void
  ): Promise<string> {
    const sessionId = randomUUID()
    const args = [...baseArgs(await this.proxy()), 'login', '-T', mode]
    if (mode === 'desktop') {
      if (options?.desktopDir) args.push('-d', options.desktopDir)
      if (options?.passcode) args.push('-p', options.passcode)
    }
    // Waits for any other tdl command; the window sees prompts only once it is this one's turn.
    let release: () => void = () => {}
    const turn = new Promise<void>((resolve) => (release = resolve))
    void exclusive(() => turn)
    const send = (event: TdlLoginEvent): void => emit(sessionId, event)
    const session: Session = {
      process: this.transport.start(args),
      mode,
      emit: send,
      buffer: '',
      prompted: false,
      phone: '',
      qr: [],
      qrTail: '',
      field: null,
      answered: null,
      finished: false,
      release
    }
    this.sessions.set(sessionId, session)
    session.process.onData((text) => this.read(session, text))
    session.process.onExit((code) => this.exited(sessionId, session, code))
    log.info('telegram', `login started (${mode})`)
    return sessionId
  }

  answer(sessionId: string, value: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.finished) return
    if (
      /phone/i.test(
        session.buffer
          .split('\n')
          .filter((l) => l.includes('?'))
          .pop() ?? ''
      )
    ) {
      session.phone = value
    }
    session.buffer = ''
    session.prompted = false
    const tidy = tidyAnswer(session.field, value)
    session.answered = session.field
    // The text itself is never logged: it is a phone number, a code or a password.
    log.info('telegram', `login answer sent (${session.field ?? 'unknown'}, ${tidy.length} chars)`)
    session.process.write(`${tidy}\r`)
  }

  cancel(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.finished = true
    session.process.kill()
    this.sessions.delete(sessionId)
    session.release()
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.cancel(id)
  }

  private read(session: Session, raw: string): void {
    const lines = (session.qrTail + stripAnsi(raw)).split(/\r?\n/)
    // A row cut off at the end of this chunk is finished by the next one.
    session.qrTail = BLOCKS.test(lines[lines.length - 1]) ? lines[lines.length - 1] : ''
    const complete = session.qrTail ? lines.slice(0, -1) : lines
    const text = complete.join('\n')
    // QR code: rows of block characters; one picture is complete when no more rows follow.
    const rows = complete.filter((line) => BLOCKS.test(line))
    if (rows.length > 0) {
      session.qr.push(...rows)
      clearTimeout(session.qrTimer)
      session.qrTimer = setTimeout(() => {
        const ascii = session.qr.join('\n')
        session.qr = []
        if (ascii && !session.finished) session.emit({ type: 'qr', ascii })
      }, 200)
      return
    }
    session.buffer += text
    if (session.prompted) return
    const prompt = session.buffer
      .split(/\r?\n|\r/)
      .reverse()
      .find((line) => /^\s*\?\s/.test(line))
    if (!prompt) return
    if (/\(y\/N\)|\(Y\/n\)/.test(prompt)) {
      // The only yes/no tdl asks while signing in is whether to replace an old session.
      session.prompted = true
      session.process.write('y\r')
      return
    }
    const field = /pass/i.test(prompt)
      ? 'password'
      : /code/i.test(prompt)
        ? 'code'
        : /phone|number/i.test(prompt)
          ? 'phone'
          : null
    if (!field || field === session.answered) return
    session.prompted = true
    session.field = field
    session.emit({ type: 'prompt', field })
  }

  private exited(sessionId: string, session: Session, code: number | null): void {
    clearTimeout(session.qrTimer)
    const known = this.sessions.get(sessionId) === session
    this.sessions.delete(sessionId)
    session.release()
    if (session.finished || !known) return
    session.finished = true
    if (code === 0) {
      const account = session.phone ? mask(session.phone) || 'Telegram account' : 'Telegram account'
      void writeAccount(account).then(() => session.emit({ type: 'done', account }))
      log.info('telegram', 'login finished')
    } else {
      session.emit({ type: 'error', message: failureReason(session.buffer) })
      log.warn('telegram', `login failed (exit ${code})`)
    }
  }
}
