import type { GrantPanelState } from '@shared/permissions'
import { isLang } from '@shared/i18n'
import { isRtl, setLanguage, t, useLanguage } from '@shared/i18n/react'
import { ArrowSquareOut, CheckCircle, CircleNotch, HandGrabbing, X } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import appIcon from '../../../../resources/icon-mac.png'

/** The panel that floats over System Settings while Lightning asks for a permission. Full Disk
 * Access takes the app dropped onto its list, so the icon here can be dragged there. */
export function GrantPanel(): React.JSX.Element | null {
  const [state, setState] = useState<GrantPanelState | null>(null)
  const language = useLanguage()

  useEffect(
    () =>
      window.grantPanel.onState((next) => {
        if (isLang(next.language)) setLanguage(next.language)
        setState(next)
      }),
    []
  )

  if (!state) return null
  const allowed = state.status === 'allowed'
  const title = allowed
    ? t('Allowed')
    : state.kind === 'fullDisk'
      ? t('Drag {app} into the list', { app: state.appName })
      : t('Turn on {app} in the list', { app: state.appName })
  const body = allowed
    ? t('{app} has the permission now. This closes by itself.', { app: state.appName })
    : state.kind === 'fullDisk'
      ? t(
          'Drop the icon onto the Full Disk Access list in System Settings, then switch {app} on.',
          { app: state.appName }
        )
      : t('Under Files and Folders, open {app} and switch on the folder it saves to.', {
          app: state.appName
        })

  return (
    <div
      dir={isRtl(language) ? 'rtl' : 'ltr'}
      className="relative flex h-screen items-center gap-4 overflow-hidden rounded-[18px] bg-popover px-5 text-popover-foreground ring-1 ring-foreground/10"
    >
      <button
        type="button"
        aria-label={t('Close')}
        onClick={() => window.grantPanel.close()}
        className="absolute end-2.5 top-2.5 grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X size={13} weight="bold" />
      </button>

      <div
        draggable={state.draggable && !allowed}
        onDragStart={(event) => {
          // The app bundle itself is dragged, by main, so System Settings gets a real file.
          event.preventDefault()
          window.grantPanel.drag()
        }}
        title={state.draggable ? t('Drag me') : undefined}
        className={`group relative grid size-[92px] shrink-0 place-items-center rounded-[22px] transition-colors ${
          allowed
            ? 'bg-emerald-500/15'
            : state.draggable
              ? 'cursor-grab border-[1.5px] border-dashed border-primary/60 bg-primary/10 hover:bg-primary/15 active:cursor-grabbing'
              : 'bg-foreground/5'
        }`}
      >
        <img
          src={appIcon}
          alt=""
          draggable={false}
          className={`size-16 transition-transform ${state.draggable && !allowed ? 'group-hover:scale-105' : ''}`}
        />
        {allowed ? (
          <CheckCircle
            size={26}
            weight="fill"
            className="absolute -end-1.5 -bottom-1.5 rounded-full bg-background text-emerald-500"
          />
        ) : (
          state.draggable && (
            <span className="absolute -end-1.5 -bottom-1.5 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-md motion-safe:animate-bounce">
              <HandGrabbing size={15} weight="fill" />
            </span>
          )
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pe-5">
        <div className="text-[15px] leading-tight font-semibold text-balance">{title}</div>
        <div className="text-[12.5px] leading-snug text-pretty text-muted-foreground">{body}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {allowed ? (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-500">
              <CheckCircle size={14} weight="fill" />
              {t("You're all set")}
            </span>
          ) : (
            <>
              <span
                className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
                role="status"
              >
                <CircleNotch size={13} className="motion-safe:animate-spin" />
                {t('Waiting for the permission…')}
              </span>
              <button
                type="button"
                onClick={() => window.grantPanel.reopen()}
                className="flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
              >
                {t('Open System Settings')}
                <ArrowSquareOut size={12} weight="bold" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
