import childProcess from 'child_process'

export function postprocess(script: string, filename: string): string {
  return childProcess
    .execFileSync(
      'deno',
      [
        'run',
        '-q',
        '--allow-read',
        '--allow-write',
        '--allow-run',
        '--allow-net',
        '--allow-env',
        '--allow-import',
        script,
        filename,
      ],
      { env: { ...process.env, NO_COLOR: 'true' } },
    )
    .toString()
}
