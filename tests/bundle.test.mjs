import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { tempDirectory } from '../lib/test-utils.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const gitStub = `
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'

// Never change Git identity, stage files, commit, or push during smoke tests.
childProcess.spawn = (command, args) => {
  if (!/git(?:\\.exe)?$/i.test(command) ||
      args[0] !== 'config' ||
      !['user.name', 'user.email'].includes(args[1])) {
    throw new Error('Unexpected subprocess: ' + command + ' ' + args.join(' '))
  }
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  process.nextTick(() => {
    child.stdout.end()
    child.stderr.end()
    child.emit('exit', 0)
    child.emit('close', 0)
  })
  return child
}
childProcess.execSync = command => {
  if (!['git ls-files --others --exclude-standard', 'git ls-files -m'].includes(command)) {
    throw new Error('Unexpected shell command: ' + command)
  }
  return Buffer.from('')
}
syncBuiltinESMExports()
`

function fixture(t) {
  const directory = tempDirectory(t)
  cpSync(dist, path.join(directory, 'dist'), { recursive: true })
  const preload = path.join(directory, 'git-stub.mjs')
  writeFileSync(preload, gitStub)
  writeFileSync(path.join(directory, 'github-env'), '')
  writeFileSync(path.join(directory, 'github-output'), '')
  return { directory, preload }
}

async function runAction(fixture, inputs, entry = 'index.js') {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('INPUT_')),
  )
  Object.assign(env, {
    FILES: '[]',
    HAS_RUN_POST_JOB: '',
    GITHUB_ENV: path.join(fixture.directory, 'github-env'),
    GITHUB_OUTPUT: path.join(fixture.directory, 'github-output'),
  })
  for (const [key, value] of Object.entries(inputs)) {
    env[`INPUT_${key.toUpperCase()}`] = value
  }
  const child = spawn(
    process.execPath,
    ['--import', fixture.preload, path.join(fixture.directory, 'dist', entry)],
    {
      cwd: fixture.directory,
      env,
      timeout: 15000,
    },
  )
  let output = ''
  child.stdout.on('data', chunk => (output += chunk))
  child.stderr.on('data', chunk => (output += chunk))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => resolve({ code, output }))
  })
}

test('packaged HTTP action runs without node_modules', async t => {
  const server = createServer((_request, response) =>
    response.end('{"bundled":true}'),
  )
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const files = fixture(t)
  const result = await runAction(files, {
    http_url: `http://127.0.0.1:${server.address().port}/data`,
    downloaded_filename: 'downloaded data.json',
  })
  assert.equal(result.code, 0, result.output)
  assert.deepEqual(
    JSON.parse(
      readFileSync(path.join(files.directory, 'downloaded data.json'), 'utf8'),
    ),
    { bundled: true },
  )
})

for (const format of ['json', 'csv']) {
  test(`packaged SQLite action writes ${format} without node_modules`, async t => {
    const files = fixture(t)
    writeFileSync(
      path.join(files.directory, 'query.sql'),
      'SELECT 42 AS answer',
    )
    const result = await runAction(files, {
      sql_connstring: 'sqlite://localhost',
      sql_queryfile: 'query.sql',
      downloaded_filename: `data.${format}`,
    })
    assert.equal(result.code, 0, result.output)
    const data = readFileSync(
      path.join(files.directory, `data.${format}`),
      'utf8',
    )
    assert.equal(data, format === 'csv' ? 'answer\n42\n' : '[{"answer":42}]')
  })
}

for (const protocol of ['postgres', 'mysql', 'mssql']) {
  test(`packaged action includes the ${protocol} driver`, async t => {
    const files = fixture(t)
    writeFileSync(path.join(files.directory, 'query.sql'), 'SELECT 1')
    const result = await runAction(files, {
      sql_connstring: `${protocol}://test:test@127.0.0.1:1/test`,
      sql_queryfile: 'query.sql',
      downloaded_filename: 'data.json',
      typeorm_config: JSON.stringify({
        connectTimeoutMS: 200,
        connectionTimeout: 200,
        extra: { connectionTimeoutMillis: 200 },
      }),
    })
    assert.equal(result.code, 1, result.output)
    assert.doesNotMatch(
      result.output,
      /package has not been found|Cannot find module|ERR_MODULE_NOT_FOUND/,
    )
    assert.match(result.output, /Unable to connect to database/)
    assert.match(
      result.output,
      /ECONNREFUSED|Failed to connect to 127\.0\.0\.1:1/,
    )
  })
}

test('packaged post action loads without pushing when no files changed', async t => {
  const result = await runAction(fixture(t), {}, 'post/index.js')
  assert.equal(result.code, 0, result.output)
})

test('bundle includes production dependency license notices', () => {
  const licenses = readFileSync(path.join(dist, 'LICENSE'), 'utf8')
  for (const dependency of [
    '@actions/core',
    'mysql2',
    'mssql',
    'pg',
    'sql.js',
  ]) {
    assert.ok(licenses.includes(`${dependency}@`), dependency)
  }
})
