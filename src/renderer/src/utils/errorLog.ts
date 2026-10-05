// Errors nothing caught, written to the console as errors with their stack: the main process
// copies console errors into the log file (see main/index.ts), so a bug report has them.
window.addEventListener('error', (event) => {
  const error = event.error as Error | undefined
  console.error(
    `Uncaught error: ${event.message}\n${error?.stack ?? `${event.filename}:${event.lineno}:${event.colno}`}`
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as unknown
  console.error(
    `Unhandled promise rejection: ${
      reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)
    }`
  )
})
