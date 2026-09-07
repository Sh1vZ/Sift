import { cpus } from 'node:os'

/**
 * How many preview workers an import the user is waiting on may run: the
 * CPU the machine has spare, measured, rather than a number picked in
 * advance. Half the logical threads at most — the strip and poster jobs are
 * one thread each, and past half the hyperthreads they only take turns —
 * scaled by the share of the machine nothing else is using, so a game or an
 * export in the background pulls the count down and an idle machine gets the
 * lot. Sampled every second while the import runs.
 *
 * Electron-free on purpose: `npm test` runs it on plain Node.
 */

/** Never more than this however many threads there are: past it the disk, not the CPU, is what waits. */
export const MAX_BURST_WORKERS = 8

export interface CpuSample {
  /** Sum over every logical thread of the ticks it sat idle. */
  idle: number
  /** Sum over every logical thread of every tick. */
  total: number
  threads: number
}

export function sampleCpu(): CpuSample {
  let idle = 0
  let total = 0
  const list = cpus()
  for (const cpu of list) {
    const t = cpu.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total, threads: list.length }
}

/** Logical threads kept busy, on average, between two samples: 0 for an idle machine, `threads` for a pegged one. */
export function busyThreads(prev: CpuSample, next: CpuSample): number {
  const total = next.total - prev.total
  if (total <= 0) return 0
  const idle = Math.max(0, next.idle - prev.idle)
  return Math.max(0, 1 - idle / total) * next.threads
}

/** The most an import may run on a machine with this many threads. */
export function burstCap(threads: number): number {
  return Math.max(1, Math.min(MAX_BURST_WORKERS, Math.floor(threads / 2)))
}

/**
 * Workers for the next second. `busy` is the whole machine's load and
 * `running` how many of our own jobs were in it (one thread each), so what is
 * left is somebody else's: the cap shrinks by that share. Never below `floor`
 * — one worker at below-normal priority is what the queue runs at anyway.
 */
export function burstWorkers(opts: {
  threads: number
  busy: number
  running: number
  floor: number
}): number {
  const cap = burstCap(opts.threads)
  const foreign = Math.max(0, opts.busy - opts.running)
  const spare = Math.max(0, 1 - foreign / Math.max(1, opts.threads))
  return Math.max(opts.floor, Math.min(cap, Math.round(cap * spare)))
}
