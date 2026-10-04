import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { Button } from '../ui/button'

/** Keeps a failure inside the downloads table from blanking the window: says so, and offers the
 * saved layout (the usual cause) forgotten. */
export class TableBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The downloads table failed:', error, info.componentStack)
  }

  private reset = (): void => {
    useAppStore.getState().resetTableLayout()
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-5 py-16 text-center">
        <p className="text-[16px] font-semibold">Something went wrong</p>
        <Button type="button" variant="secondary" onClick={this.reset}>
          Reset layout
        </Button>
      </div>
    )
  }
}
