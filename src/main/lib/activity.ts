import { randomUUID } from 'node:crypto'
import type { ActivityInput, ActivityRecord } from '@shared/types'
import type { Emit } from './library'
import type { Store } from './store'

/** Several records can land within a frame (a rescan of every folder); one push carries them all. */
const EMIT_MS = 250

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
    this.store.addActivity(record)
    this.scheduleEmit()
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
