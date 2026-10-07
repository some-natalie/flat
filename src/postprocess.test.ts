import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { test } from 'node:test'
import { postprocess } from './postprocess.js'

test('invokes Deno 2 without shell interpolation or obsolete flags', t => {
  const exec = t.mock.method(childProcess, 'execFileSync', () =>
    Buffer.from('processed'),
  )
  const script = 'scripts/post process.ts'
  const filename = 'downloaded data; echo unexpected.json'
  assert.equal(postprocess(script, filename), 'processed')
  assert.equal(exec.mock.callCount(), 1)
  const [command, args, options] = exec.mock.calls[0].arguments as unknown as [
    string,
    string[],
    { env: NodeJS.ProcessEnv },
  ]
  assert.equal(command, 'deno')
  assert.deepEqual(args.slice(-2), [script, filename])
  assert.ok(args.includes('--allow-import'))
  assert.ok(!args.includes('--unstable'))
  assert.equal(options.env.NO_COLOR, 'true')
})

test('propagates Deno failures', t => {
  t.mock.method(childProcess, 'execFileSync', () => {
    throw new Error('Deno failed')
  })
  assert.throws(() => postprocess('script.ts', 'data.json'), /Deno failed/)
})
