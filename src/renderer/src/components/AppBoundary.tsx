import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TitleBar } from './TitleBar'
import { useLogsStore } from '../store/useLogsStore'
import { Button } from './ui/button'
import { t } from '@shared/i18n/react'

interface State {
  error: Error | null
  componentStack: string
  copied: boolean
}

/** The last line of defence: a failure anywhere in the app shows this page, with the title bar
 * still there, instead of a blank window. The full error goes to the log through the console. */
export class AppBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, componentStack: '', copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? ''
    this.setState({ componentStack })
    console.error(
      `The app failed: ${error.message}\n${error.stack ?? ''}\nComponent stack:${componentStack}`
    )
  }

  private report = (): string => {
    const { error, componentStack } = this.state
    return `${error?.message ?? 'Unknown error'}\n${error?.stack ?? ''}\nComponent stack:${componentStack}`
  }

  private copy = (): void => {
    void navigator.clipboard
      .writeText(this.report())
      .then(() => this.setState({ copied: true }))
      .catch(() => undefined)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full flex-col">
        <TitleBar />
        <div
          role="alert"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        >
          <p className="text-[18px] font-semibold">{t('Something went wrong')}</p>
          <p className="max-w-[460px] text-[13px] text-muted-foreground">
            {t(
              '{message}. Your downloads keep going. Reload the view, or copy the error for a bug report.',
              { message: this.state.error.message }
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => this.setState({ error: null, componentStack: '', copied: false })}
            >
              {t('Reload view')}
            </Button>
            <Button type="button" variant="secondary" onClick={this.copy}>
              {this.state.copied ? t('Copied') : t('Copy error')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => useLogsStore.getState().setOpen(true)}
            >
              {t('View logs')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
