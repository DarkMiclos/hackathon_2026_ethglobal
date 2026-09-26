import { onMounted, onUnmounted } from 'vue'

/**
 * A polite poller for a remote API:
 *   - never overlaps runs (a slow request does not queue another)
 *   - pauses while the tab is hidden and catches up once when it becomes visible again
 *   - a visibility flip never triggers more than one extra run per `interval`
 *   - backs off exponentially on errors (up to `maxDelay`) and resets on success
 *   - supports a temporary "burst" interval (e.g. right after the user broadcasts swaps)
 *
 * `task` returns nothing; throw to trigger back-off.
 */
export function usePoller(task, { interval, maxDelay = 120000, enabled = true } = {}) {
  let timer = null
  let running = false
  let stopped = false
  let paused = false
  let failures = 0
  let lastRun = 0
  let burstUntil = 0
  let burstInterval = interval

  function currentDelay() {
    const base = Date.now() < burstUntil ? burstInterval : interval
    if (!failures) return base
    return Math.min(maxDelay, base * 2 ** failures)
  }

  function schedule(delay = currentDelay()) {
    clearTimeout(timer)
    if (stopped || !enabled) return
    timer = setTimeout(run, delay)
  }

  async function run() {
    if (stopped || running) return
    if (document.visibilityState === 'hidden') { paused = true; return }
    running = true
    lastRun = Date.now()
    try {
      await task()
      failures = 0
    } catch {
      failures = Math.min(failures + 1, 6)
    } finally {
      running = false
      schedule()
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') {
      clearTimeout(timer)
      paused = true
      return
    }
    if (!paused) return // spurious "visible" while already running normally
    paused = false
    // Catch up now only if a full interval has passed; otherwise resume the normal cadence.
    const due = lastRun + currentDelay() - Date.now()
    schedule(Math.max(0, due))
  }

  /** Poll faster for a while (e.g. after broadcasting transactions). */
  function burst(fastInterval, durationMs) {
    burstInterval = fastInterval
    burstUntil = Date.now() + durationMs
    schedule(0)
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibility)
    if (enabled) run()
  })
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { burst, runNow: () => run() }
}
