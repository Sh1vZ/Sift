/**
 * Puts a file on the Windows clipboard as a file (a FileDropList, CF_HDROP):
 * the same thing Explorer's Copy does, so a paste into Discord, a browser
 * upload box or a folder lands the file itself. Electron's clipboard module
 * only writes text, HTML, images and custom formats, so the write goes through
 * Windows PowerShell 5.1's `Set-Clipboard -LiteralPath`. pwsh 7 dropped that
 * parameter, hence the fixed System32 path rather than whatever is on PATH.
 *
 * Electron-free so `npm test` can cover the exe and argument builders.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'

/** The path travels in the environment, so it never meets PowerShell's quoting rules. */
export const COPY_PATH_ENV = 'SIFT_COPY_PATH'
/** PowerShell 5.1 cold-starts in well under a second; anything past this is stuck. */
export const CLIPBOARD_TIMEOUT_MS = 10_000

export function powershellExe(systemRoot = process.env.SystemRoot || 'C:\\Windows'): string {
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function powershellArgs(): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-Command',
    `Set-Clipboard -LiteralPath $env:${COPY_PATH_ENV}`,
  ]
}

/** Resolves once the file is on the clipboard; rejects with a message fit for a toast. */
export function copyFileToClipboard(
  path: string,
  opts: { signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(powershellExe(), powershellArgs(), {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, [COPY_PATH_ENV]: path },
    })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, CLIPBOARD_TIMEOUT_MS)
    const onAbort = (): void => {
      child.kill()
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const done = (): void => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-1024)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      done()
      reject(
        new Error(
          err.code === 'ENOENT'
            ? 'Windows PowerShell was not found.'
            : `PowerShell failed: ${err.message}`,
        ),
      )
    })
    child.on('close', (code) => {
      done()
      if (opts.signal?.aborted) return reject(new Error('Cancelled.'))
      if (timedOut)
        return reject(
          new Error(`PowerShell did not answer within ${CLIPBOARD_TIMEOUT_MS / 1000} s.`),
        )
      if (code !== 0) {
        const line = stderr
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find(Boolean)
        return reject(
          new Error(line ? `PowerShell refused: ${line}` : `PowerShell exited with ${code}.`),
        )
      }
      resolve()
    })
  })
}
