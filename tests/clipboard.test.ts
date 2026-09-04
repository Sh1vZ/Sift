/**
 * The PowerShell invocation behind "Copy file": the exe and the arguments that
 * put a file on the clipboard as a file. Runs on plain Node (`npm test`);
 * nothing here spawns a process.
 */
import {
  CLIPBOARD_TIMEOUT_MS,
  COPY_PATH_ENV,
  powershellArgs,
  powershellExe,
} from '../src/main/lib/clipboard'

let failed = 0
const check = (cond: unknown, msg: string): void => {
  if (!cond) failed++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`)
}

function clipboardCases(): void {
  check(
    powershellExe('C:\\Win').endsWith('\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'),
    'powershellExe points at Windows PowerShell 5.1 under the given root',
  )
  check(
    powershellExe('C:\\Win').startsWith('C:\\Win\\'),
    'powershellExe honours the system root it is given',
  )
  check(powershellExe().endsWith('powershell.exe'), 'powershellExe defaults to a real exe path')

  const args = powershellArgs()
  for (const flag of ['-NoProfile', '-NonInteractive', '-STA'])
    check(args.includes(flag), `powershellArgs carries ${flag}`)
  const cmd = args[args.indexOf('-Command') + 1] ?? ''
  check(cmd.includes(`$env:${COPY_PATH_ENV}`), 'the command reads the path from the environment')
  check(cmd.includes('-LiteralPath'), 'the command uses -LiteralPath so wildcards stay literal')
  check(!/[A-Z]:\\/.test(cmd), 'no file path is ever inlined into the command')
  check(CLIPBOARD_TIMEOUT_MS >= 5_000, 'the clipboard timeout leaves room for a cold start')
}

clipboardCases()
console.log(failed ? `${failed} check(s) failed` : 'ALL OK')
process.exit(failed ? 1 : 0)
