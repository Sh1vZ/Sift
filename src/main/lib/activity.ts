import { randomUUID } from 'node:crypto'
import type { ActivityInput, ActivityRecord } from '@shared/types'
import type { Emit } from './library'
import type { Store } from './store'

/** Several records can land within a frame (a rescan of every folder); one push carries them all. */
const EMIT_MS = 250

/** A folder scanned again inside this window replaces its row instead of stacking a second one. */
const SCAN_COLLAPSE_MS = 5 * 60_000

/**
 * The history behind the Activity panel: what Sift finished, kept after the
 * live job is pruned. Electron-free so `npm test` could drive it; `Library`
 * owns the one instance and the YouTube module writes through it.
 */
export class ActivityLog {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: Store,
    private readonly emit: Emit,
  ) {}

  list(): ActivityRecord[] {
    return this.store.listActivity()
  }

  record(input: ActivityInput): void {
    const record: ActivityRecord = {
      ...input,
      id: randomUUID().slice(0, 8),
      finishedAtMs: Date.now(),
    }
    if (record.kind === 'scan') this.collapseScan(record)
    this.store.addActivity(record)
    this.scheduleEmit()
  }

  /**
   * A folder gets walked again and again — a launch, a watcher settling, a
   * click on Rescan — and each pass only restates where that folder stands.
   * The newer row supersedes the one just above it rather than joining it.
   */
  private collapseScan(next: ActivityRecord): void {
    // Newest first, so this is the last scan of the same folder.
    const previous = this.store
      .listActivity()
      .find((r) => r.kind === 'scan' && r.path === next.path)
    if (previous && next.finishedAtMs - previous.finishedAtMs < SCAN_COLLAPSE_MS) {
      this.store.removeActivity(previous.id)
    }
  }

  remove(id: string): void {
    this.store.removeActivity(id)
    this.scheduleEmit(true)
  }

  clear(): void {
    this.store.clearActivity()
    this.scheduleEmit(true)
  }

  shutdown(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private scheduleEmit(now = false): void {
    const send = (): void => this.emit('activity:changed', this.list())
    if (now) {
      if (this.timer) clearTimeout(this.timer)
      this.timer = null
      send()
      return
    }
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      send()
    }, EMIT_MS)
  }
}
