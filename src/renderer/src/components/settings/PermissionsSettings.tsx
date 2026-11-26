import { useEffect, useState } from 'react'
import { CheckCircle, WarningCircle } from '@phosphor-icons/react'
import type { PermissionKind, PermissionStatus } from '@shared/permissions'
import { t } from '@shared/i18n/react'
import { Button } from '../ui/button'

const ROWS: { kind: PermissionKind; label: string; hint: string }[] = [
  {
    kind: 'folder',
    label: 'Download folder',
    hint: 'Lets Lightning save into the folder you picked.'
  },
  {
    kind: 'fullDisk',
    label: 'Full Disk Access',
    hint: "Optional. Lets YouTube downloads use Safari's sign-in."
  },
  {
    kind: 'notifications',
    label: 'Notifications',
    hint: 'Tells you when a download finishes or needs you.'
  }
]

/** Settings → Permissions: what macOS lets Lightning do, with a guided way to allow the rest. */
export function PermissionsSettings(): React.JSX.Element {
  const [status, setStatus] = useState<PermissionStatus | null>(null)

  useEffect(() => {
    const read = (): void => void window.lightning.permissionStatus().then(setStatus, () => {})
    read()
    // Picks up a permission given in System Settings while this page is open.
    const timer = setInterval(read, 2000)
    window.addEventListener('focus', read)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [])

  return (
    <>
      <div>
        <div className="ios-note">
          {t(
            'What macOS lets Lightning do. Allow opens System Settings with a small guide; for Full Disk Access, drag the Lightning icon from the guide into the list.'
          )}
        </div>
      </div>
      <div>
        {ROWS.map(({ kind, label, hint }) => {
          const value = status?.[kind]
          return (
            <div key={kind} className="ios-row" data-setting={label}>
              <span className="ios-label">
                {t(label)}
                <span className="ios-hint">{t(hint)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {status === null ? (
                  <span className="text-[12px] text-muted-foreground">{t('Checking…')}</span>
                ) : value === true ? (
                  <span className="flex items-center gap-1 text-[12px] font-medium text-emerald-500">
                    <CheckCircle size={15} weight="fill" />
                    {t('Allowed')}
                  </span>
                ) : (
                  <>
                    {value === false && (
                      <span className="flex items-center gap-1 text-[12px] text-amber-500">
                        <WarningCircle size={15} weight="fill" />
                        {t('Not allowed')}
                      </span>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant={value === false ? 'default' : 'secondary'}
                      className="rounded-full"
                      onClick={() => void window.lightning.guidePermission(kind)}
                    >
                      {value === null ? t('Open settings') : t('Allow…')}
                    </Button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
