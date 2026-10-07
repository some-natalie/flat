import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import {
  exportedVariables,
  fixture,
  gitCalls,
  runAction,
} from './action-fixture.mjs'

async function serve(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  return `http://127.0.0.1:${server.address().port}/data`
}

function filesChanged(result) {
  assert.equal(result.code, 0, result.output)
  return JSON.parse(result.env.FILES)
}

function publishingCalls(files) {
  return gitCalls(files).filter(args => ['commit', 'push'].includes(args[0]))
}

test('HTTP download exports byte counts and the post action publishes once', async t => {
  const bytes = Buffer.from([0, 1, 127, 128, 255])
  const url = await serve(t, (request, response) => {
    assert.equal(request.method, 'GET')
    assert.equal(request.headers.authorization, 'Bearer acceptance-test')
    response.end(bytes)
  })
  const files = fixture(t, { outputs: ['data.bin'] })
  const main = await runAction(files, {
    http_url: url,
    authorization: 'Bearer acceptance-test',
    downloaded_filename: 'data.bin',
  })
  assert.deepEqual(readFileSync(path.join(files.directory, 'data.bin')), bytes)
  const changes = filesChanged(main)
  assert.deepEqual(changes, [
    { name: 'data.bin', deltaBytes: bytes.length, source: url },
  ])
  assert.equal(publishingCalls(files).length, 0)
  assert.ok(
    gitCalls(files).some(args => args[0] === 'add' && args[1] === 'data.bin'),
  )

  const post = await runAction(files, {}, 'post/index.js', main.env)
  assert.equal(post.code, 0, post.output)
  const calls = publishingCalls(files)
  assert.deepEqual(
    calls.map(args => args[0]),
    ['commit', 'push'],
  )
  assert.match(calls[0][2], /^Flat: latest data \(/)
  const metadata = JSON.parse(calls[0][2].slice(calls[0][2].indexOf('\n') + 1))
  assert.deepEqual(metadata.files, changes)
  assert.ok(Number.isFinite(Date.parse(metadata.date)))
  assert.equal(post.env.HAS_RUN_POST_JOB, 'true')

  const repeat = await runAction(files, {}, 'post/index.js', post.env)
  assert.equal(repeat.code, 0, repeat.output)
  assert.equal(publishingCalls(files).length, 2)
})

test('identical fetched data does not stage, commit, or push', async t => {
  const data = '{"unchanged":true}'
  const url = await serve(t, (_request, response) => response.end(data))
  const files = fixture(t, {
    outputs: ['data.json'],
    tracked: { 'data.json': data },
  })
  const main = await runAction(files, {
    http_url: url,
    downloaded_filename: 'data.json',
  })
  assert.deepEqual(filesChanged(main), [])
  const post = await runAction(files, {}, 'post/index.js', main.env)
  assert.equal(post.code, 0, post.output)
  assert.equal(publishingCalls(files).length, 0)
  assert.equal(gitCalls(files).filter(args => args[0] === 'add').length, 0)
})

for (const [label, headSizeEOL] of [
  ['LF', '\n'],
  ['CRLF', '\r\n'],
  ['no newline', ''],
]) {
  test(`changed tracked data exports its size delta with ${label} Git output`, async t => {
    const before = '{"old":true}'
    const after = '{"updated":"longer value"}'
    const url = await serve(t, (_request, response) => response.end(after))
    const files = fixture(t, {
      outputs: ['data.json'],
      tracked: { 'data.json': before },
      headSizeEOL,
    })
    const previous = [{ name: 'earlier.csv', deltaBytes: 4 }]
    const main = await runAction(
      files,
      {
        http_url: url,
        downloaded_filename: 'data.json',
      },
      'index.js',
      { FILES: JSON.stringify(previous) },
    )
    assert.deepEqual(filesChanged(main), [
      ...previous,
      {
        name: 'data.json',
        deltaBytes: Buffer.byteLength(after) - Buffer.byteLength(before),
        source: url,
      },
    ])
  })
}

for (const [mask, expectedSource] of [
  ['true', undefined],
  ['["testsecret"]', '***'],
]) {
  test(`mask=${mask} keeps the source secret out of commit metadata`, async t => {
    const base = await serve(t, (_request, response) => response.end('data'))
    const url = `${base}?key=testsecret`
    const files = fixture(t, { outputs: ['data.txt'] })
    const main = await runAction(files, {
      http_url: url,
      downloaded_filename: 'data.txt',
      mask,
    })
    const changes = filesChanged(main)
    assert.equal(changes.length, 1)
    assert.equal(
      changes[0].source,
      expectedSource === undefined
        ? undefined
        : `${base}?key=${expectedSource}`,
    )
    const post = await runAction(files, {}, 'post/index.js', main.env)
    assert.equal(post.code, 0, post.output)
    assert.doesNotMatch(publishingCalls(files)[0][2], /testsecret/)
  })
}

for (const format of ['json', 'csv']) {
  test(`SQLite ${format} download exports change metadata and publishes`, async t => {
    const filename = `data.${format}`
    const files = fixture(t, { outputs: [filename] })
    writeFileSync(
      path.join(files.directory, 'query.sql'),
      'SELECT 42 AS answer',
    )
    const main = await runAction(files, {
      sql_connstring: 'sqlite://localhost',
      sql_queryfile: 'query.sql',
      downloaded_filename: filename,
    })
    const contents = readFileSync(path.join(files.directory, filename), 'utf8')
    assert.equal(
      contents,
      format === 'csv' ? 'answer\n42\n' : '[{"answer":42}]',
    )
    assert.deepEqual(filesChanged(main), [
      { name: filename, deltaBytes: Buffer.byteLength(contents), source: '' },
    ])
    const post = await runAction(files, {}, 'post/index.js', main.env)
    assert.equal(post.code, 0, post.output)
    assert.deepEqual(
      publishingCalls(files).map(args => args[0]),
      ['commit', 'push'],
    )
  })
}

test('Deno 2 transforms fetched data before change metadata is exported', async t => {
  assert.match(
    execFileSync('deno', ['--version'], { encoding: 'utf8' }),
    /^deno 2\./,
  )
  const url = await serve(t, (_request, response) =>
    response.end('{"answer":42}'),
  )
  const files = fixture(t, { outputs: ['data.json'] })
  const script = 'normalize data #1.ts'
  writeFileSync(
    path.join(files.directory, script),
    `
const filename = Deno.args[0]
const data = JSON.parse(await Deno.readTextFile(filename))
await Deno.writeTextFile(filename, JSON.stringify({ answer: data.answer + 1 }))
`,
  )
  const main = await runAction(files, {
    http_url: url,
    downloaded_filename: 'data.json',
    postprocess: script,
  })
  const contents = readFileSync(path.join(files.directory, 'data.json'), 'utf8')
  assert.equal(contents, '{"answer":43}')
  assert.deepEqual(filesChanged(main), [
    { name: 'data.json', deltaBytes: Buffer.byteLength(contents), source: url },
  ])
})

test('postprocessing errors fail the action rather than silently succeeding', async t => {
  const url = await serve(t, (_request, response) => response.end('data'))
  const files = fixture(t, { outputs: ['data.txt'] })
  writeFileSync(
    path.join(files.directory, 'fail.ts'),
    'throw new Error("acceptance postprocess failure")',
  )
  const main = await runAction(files, {
    http_url: url,
    downloaded_filename: 'data.txt',
    postprocess: 'fail.ts',
  })
  assert.equal(main.code, 1, main.output)
  assert.match(main.output, /acceptance postprocess failure/)
  assert.equal(publishingCalls(files).length, 0)
})

test('HTTP errors fail before staging data or exporting changes', async t => {
  const url = await serve(t, (_request, response) =>
    response.writeHead(503).end('unavailable'),
  )
  const files = fixture(t, { outputs: ['data.json'] })
  const main = await runAction(files, {
    http_url: url,
    downloaded_filename: 'data.json',
  })
  assert.equal(main.code, 1, main.output)
  assert.match(main.output, /503/)
  assert.equal(main.env.FILES, undefined)
  assert.equal(gitCalls(files).filter(args => args[0] === 'add').length, 0)
})

for (const [inputs, message] of [
  [{ downloaded_filename: 'data.json' }, /http_url.*sql_connstring/],
  [{ http_url: 'http://127.0.0.1:1/data' }, /Invalid configuration/],
  [
    {
      http_url: 'http://127.0.0.1:1/data',
      downloaded_filename: 'data.json',
      axios_config: 'missing.json',
    },
    /axios_config input is no longer supported/,
  ],
  [
    {
      sql_connstring: 'sqlite://localhost',
      sql_queryfile: 'missing.sql',
      downloaded_filename: 'data.json',
    },
    /Unable to read queryfile/,
  ],
]) {
  test(`invalid input fails without publishing: ${Object.keys(inputs).join(', ')}`, async t => {
    const files = fixture(t, { outputs: ['data.json'] })
    const main = await runAction(files, inputs)
    assert.equal(main.code, 1, main.output)
    assert.match(main.output, message)
    assert.equal(main.env.FILES, undefined)
    assert.equal(publishingCalls(files).length, 0)
  })
}

for (const failure of ['commit', 'push']) {
  test(`post action reports Git ${failure} failures without marking completion`, async t => {
    const url = await serve(t, (_request, response) => response.end('data'))
    const files = fixture(t, { outputs: ['data.txt'], failure })
    const main = await runAction(files, {
      http_url: url,
      downloaded_filename: 'data.txt',
    })
    filesChanged(main)
    const post = await runAction(files, {}, 'post/index.js', main.env)
    assert.equal(post.code, 1, post.output)
    assert.match(post.output, /Post script failed/)
    assert.deepEqual(
      publishingCalls(files).map(args => args[0]),
      failure === 'commit' ? ['commit'] : ['commit', 'push'],
    )
    assert.equal(exportedVariables(files).HAS_RUN_POST_JOB, undefined)
  })
}
