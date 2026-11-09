import { t } from '@shared/i18n/react'
import { parseChecksum } from '@shared/checksum'
import { parseNetscapeCookies } from '@shared/requestHeaders'
import { useRef } from 'react'
import { type RequestDraft } from '../utils/requestDraft'
import { Button } from './ui/button'
import { Input } from './ui/input'

const labelClass = 'w-24 shrink-0 text-[12px] text-muted-foreground'

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-3">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

/** The sign-in, cookie, Referer, User-Agent and header fields of a download: shut by default, as
 * most links need none of them. `link` is only used to pick the cookies for it out of a cookies.txt. */
export function RequestOptions({
  value,
  onChange,
  link,
  withChecksum = false
}: {
  value: RequestDraft
  onChange: (next: RequestDraft) => void
  link: string
  /** One hash is for one file: not offered for several links. */
  withChecksum?: boolean
}): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<RequestDraft>): void => onChange({ ...value, ...patch })

  const importCookies = async (file: File | undefined): Promise<void> => {
    if (!file) return
    const cookie = parseNetscapeCookies(await file.text(), link.trim())
    set({ cookie })
  }

  return (
    <details className="group text-[13px]" open={Object.values(value).some((text) => text !== '')}>
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        {t('Advanced: checksum, sign-in, cookies, headers')}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {withChecksum && (
          <Field label={t('Checksum')}>
            <Input
              value={value.checksum}
              dir="ltr"
              placeholder={t('SHA-256, SHA-1 or MD5 — e.g. sha256:9f86d0…')}
              spellCheck={false}
              aria-invalid={value.checksum.trim() !== '' && !parseChecksum(value.checksum)}
              onChange={(event) => set({ checksum: event.target.value })}
            />
          </Field>
        )}
        <Field label={t('User name')}>
          <Input
            value={value.user}
            autoComplete="off"
            onChange={(event) => set({ user: event.target.value })}
          />
        </Field>
        <Field label={t('Password')}>
          <Input
            type="password"
            value={value.pass}
            autoComplete="off"
            onChange={(event) => set({ pass: event.target.value })}
          />
        </Field>
        <Field label={t('Referer')}>
          <Input
            value={value.referer}
            dir="ltr"
            placeholder={t('https://page-the-link-came-from')}
            onChange={(event) => set({ referer: event.target.value })}
          />
        </Field>
        <Field label={t('Cookie')}>
          <Input
            value={value.cookie}
            dir="ltr"
            placeholder="name=value; other=value"
            onChange={(event) => set({ cookie: event.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            cookies.txt…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(event) => {
              void importCookies(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </Field>
        <Field label="User-Agent">
          <Input
            value={value.userAgent}
            dir="ltr"
            placeholder="Lightning/1.0"
            onChange={(event) => set({ userAgent: event.target.value })}
          />
        </Field>
        <label className="flex items-start gap-3">
          <span className={`${labelClass} pt-1.5`}>{t('Headers')}</span>
          <textarea
            value={value.headersText}
            rows={3}
            dir="ltr"
            placeholder={'X-Token: abc\nAccept-Language: en'}
            onChange={(event) => set({ headersText: event.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-[12px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        </label>
      </div>
    </details>
  )
}
