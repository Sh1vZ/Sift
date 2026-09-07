/**
 * Ordering test for the preview queue (lib/queue.ts): posters before strips,
 * the hot set before the backlog, newest first within a lane, a poster job
 * standing in for the strip it queues itself, and the failure of each stage
 * meaning what it should. Plus the import burst's arithmetic (lib/burst.ts):
 * how many workers a machine's spare CPU allows. Runs on plain Node (`npm test`).
 */
import type { Clip, ClipPatch } from '@shared/types'
import { MAX_BURST_WORKERS, burstCap, burstWorkers, busyThreads } from '../src/main/lib/burst'
import { MediaQueue, type MediaJob } from '../src/main/lib/queue'

const clip = (id: string, recordedAtMs = 0): Clip => ({
  id,
  path: `D:/Videos/NVIDIA/Valorant/${id}.mp4`,
  name: id,
  title: 'Valorant',
  ext: '.mp4',
  kind: 'video',
  folderId: 'f1',
  game: 'Valorant',
  sourceGame: 'Valorant',
  size: 10,
  mtimeMs: 1,
  recordedAtMs,
  duration: 0,
  width: 0,
  height: 0,
  fps: 0,
  vcodec: '',
  hdr: false,
  hasAudio: false,
  audioTracks: [],
  thumb: '',
  sprite: '',
  spriteFrames: 0,
  render: '',
  probeState: 'pending',
  sourceId: '',
  trimStart: 0,
  trimEnd: 0,
  muted: false,
  createdAtMs: 0,
  youtubeId: '',
  youtubeAccountId: '',
  youtubeStage: '',
  youtubeReason: '',
  youtubeCheckedAtMs: 0,
  youtubeWatchUntilMs: 0,
  favourite: false,
  seenAtMs: 0,
})

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))
async function drain(q: MediaQueue): Promise<void> {
  while (q.pending) await tick()
}

/**
 * A queue of one worker whose first job holds until `release()` is called, so
 * everything queued behind it is ordered by the queue rather than by arrival.
 */
function gated(
  onJob: (job: MediaJob) => Promise<ClipPatch> | ClipPatch = (job) => ({ id: job.clip.id }),
  onDone: (patch: ClipPatch) => void = () => undefined,
): { q: MediaQueue; ran: string[]; release: () => void } {
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => (release = r))
  const ran: string[] = []
  const q = new MediaQueue(
    async (job) => {
      ran.push(`${job.stage}:${job.clip.id}`)
      if (job.clip.id === 'gate') await gate
      return onJob(job)
    },
    onDone,
    1,
  )
  q.enqueue(clip('gate'), 'poster')
  return { q, ran, release }
}

async function main(): Promise<void> {
  // Hot posters, hot strips, then the backlog: posters newest first, strips last.
  {
    const { q, ran, release } = gated()
    q.enqueue(clip('old', 1), 'sprite', { rank: 1 })
    q.enqueue(clip('a', 10), 'poster', { rank: 10 })
    q.enqueue(clip('b', 20), 'poster', { rank: 20 })
    q.enqueue(clip('c', 30), 'poster', { rank: 30 })
    q.enqueue(clip('hot-strip', 5), 'sprite', { rank: 5 })
    q.setHot(['a', 'hot-strip'])
    check(q.pending === 6, 'five jobs wait behind the running one')
    release()
    await drain(q)
    check(
      ran.join(' ') === 'poster:gate poster:a sprite:hot-strip poster:c poster:b sprite:old',
      `hot first, posters before strips, newest first: ${ran.join(' ')}`,
    )
  }

  // One lane per clip: a waiting poster covers the strip, a poster replaces a waiting strip.
  {
    const { q, ran, release } = gated()
    const x = clip('x')
    q.enqueue(x, 'poster')
    q.enqueue(x, 'sprite')
    check(q.pending === 2, 'a strip behind a waiting poster is not queued twice')
    const y = clip('y')
    q.enqueue(y, 'sprite')
    q.enqueue(y, 'poster')
    check(q.pending === 3 && q.has('y'), 'a poster takes the place of a waiting strip')
    q.enqueue(y, 'poster')
    check(q.pending === 3, 'the same job twice is one job')
    release()
    await drain(q)
    check(ran.join(' ') === 'poster:gate poster:x poster:y', `each clip ran once: ${ran.join(' ')}`)
  }

  // bump() and front go ahead of every rank, in the order they were asked.
  {
    const { q, ran, release } = gated()
    q.enqueue(clip('a', 10), 'poster', { rank: 10 })
    q.enqueue(clip('b', 20), 'poster', { rank: 20 })
    q.enqueue(clip('c', 30), 'poster', { rank: 30 })
    q.bump('a')
    q.enqueue(clip('d', 0), 'poster', { front: true })
    q.enqueue(clip('e', 99), 'poster', { rank: 99 })
    release()
    await drain(q)
    check(
      ran.join(' ') === 'poster:gate poster:a poster:d poster:e poster:c poster:b',
      `bumped, then front, then by rank: ${ran.join(' ')}`,
    )
  }

  // remove() drops a waiting job; stop() drops the backlog and discards in-flight results.
  {
    const done: ClipPatch[] = []
    const { q, ran, release } = gated(undefined, (p) => done.push(p))
    q.enqueue(clip('a'), 'poster')
    q.enqueue(clip('b'), 'poster')
    q.remove('a')
    check(!q.has('a') && q.pending === 2, 'a removed job is gone')
    q.stop()
    check(q.pending === 1, 'stop keeps only the job already running')
    release()
    await drain(q)
    check(ran.join(' ') === 'poster:gate' && done.length === 0, 'nothing ran or landed after stop')
  }

  // A poster job that throws fails the clip; a strip that throws fails nothing.
  {
    const done: ClipPatch[] = []
    const { q, release } = gated(
      (job) => {
        if (job.clip.id !== 'gate') throw new Error('ffmpeg exited with 1')
        return { id: job.clip.id }
      },
      (p) => done.push(p),
    )
    q.enqueue(clip('p'), 'poster')
    q.enqueue(clip('s'), 'sprite')
    release()
    await drain(q)
    const byId = Object.fromEntries(done.map((p) => [p.id, p]))
    check(byId.p?.probeState === 'failed', 'a failed poster job marks the probe failed')
    check(
      byId.s !== undefined && !('probeState' in byId.s),
      'a failed strip leaves the clip as it was',
    )
  }

  // Raising concurrency mid-run starts more jobs at once; nothing running is touched.
  {
    let active = 0
    let peak = 0
    const q = new MediaQueue(
      async (job) => {
        active++
        peak = Math.max(peak, active)
        await tick()
        await tick()
        active--
        return { id: job.clip.id }
      },
      () => undefined,
      1,
    )
    for (let i = 0; i < 6; i++) q.enqueue(clip(`c${i}`), 'poster')
    q.setConcurrency(3)
    await drain(q)
    check(
      peak === 3 && q.concurrency === 3,
      `setConcurrency(3) mid-run ran three at once (${peak})`,
    )
  }

  // The import burst: half the threads at most, scaled by what nobody else is using.
  {
    check(
      burstCap(16) === 8 && burstCap(4) === 2 && burstCap(1) === 1,
      'cap is half the threads, one at least',
    )
    check(burstCap(64) === MAX_BURST_WORKERS, 'cap never passes the ceiling')
    const idle = { idle: 1000, total: 1000, threads: 16 }
    const later = { idle: 1800, total: 2600, threads: 16 }
    check(
      Math.round(busyThreads(idle, later)) === 8,
      'a half-busy machine reads as half its threads',
    )
    check(busyThreads(idle, idle) === 0, 'no time passed reads as idle')
    check(
      burstWorkers({ threads: 16, busy: 0, running: 0, floor: 1 }) === 8,
      'an idle machine gets the cap',
    )
    check(
      burstWorkers({ threads: 16, busy: 8, running: 8, floor: 1 }) === 8,
      "our own jobs do not count as somebody else's load",
    )
    check(
      burstWorkers({ threads: 16, busy: 8, running: 0, floor: 1 }) === 4,
      'a game on half the machine halves the burst',
    )
    check(
      burstWorkers({ threads: 16, busy: 16, running: 2, floor: 1 }) === 1,
      'a pegged machine gets the floor',
    )
    check(
      burstWorkers({ threads: 8, busy: 2, running: 2, floor: 2 }) === 4,
      'eight idle threads: four workers',
    )
  }

  console.log(failed ? `\n${failed} check(s) failed` : '\nall queue checks passed')
  process.exit(failed ? 1 : 0)
}

void main()
