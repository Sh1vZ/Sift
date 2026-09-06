/**
 * Worker thread that decodes one HDR screenshot and tone maps it. A decode is
 * a third of a second of CPU over a 75 MB float buffer; on the main thread
 * that would hold up every IPC reply and the render of the window. The result
 * goes back as packed RGB with its buffer transferred, not copied, and the
 * worker exits, taking the WebAssembly heap with it.
 *
 * Input arrives as `workerData` `{ path, tuning }`; the reply is one message:
 * `{ width, height, rgb }` or `{ error }`.
 */
import { readFile } from 'node:fs/promises'
import { parentPort, workerData } from 'node:worker_threads'
import jpegxr from 'jpegxr'
import { toneMapToRgb, type DecodedJxr, type JxrTuning } from './jxr'

const { path, tuning } = workerData as { path: string; tuning: JxrTuning }

async function render(): Promise<void> {
  const [codec, file] = await Promise.all([jpegxr(), readFile(path)])
  const image = codec.decode(file) as DecodedJxr
  const rgb = toneMapToRgb(image, tuning)
  // A fresh Uint8Array owns a plain ArrayBuffer, so it can move rather than copy.
  const buffer = rgb.buffer as ArrayBuffer
  parentPort?.postMessage({ width: image.width, height: image.height, rgb }, [buffer])
}

render().catch((err: unknown) => {
  parentPort?.postMessage({ error: err instanceof Error ? err.message : String(err) })
})
