import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { fixture, runAction } from './action-fixture.mjs'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
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

test('packaged action rejects the removed Axios file input before fetching', async t => {
  const files = fixture(t)
  const result = await runAction(files, {
    http_url: 'http://127.0.0.1:1/data',
    downloaded_filename: 'data.json',
    axios_config: 'missing-request.json',
  })
  assert.equal(result.code, 1, result.output)
  assert.match(result.output, /axios_config input is no longer supported/)
  assert.doesNotMatch(result.output, /ENOENT|ECONNREFUSED/)
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
      /ECONNREFUSED|Failed to connect to 127\.0\.0\.1:1|Connection terminated due to connection timeout/,
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
    '@flat/tedious-formatter',
    'mysql2',
    'mssql',
    'pg',
    'sql.js',
  ]) {
    assert.ok(licenses.includes(`${dependency}@`), dependency)
  }
})

test('bundle excludes the vulnerable sprintf-js implementation', () => {
  const bundle = readFileSync(path.join(dist, 'index.js'), 'utf8')
  assert.match(bundle, /Only Tedious's fixed diagnostic formats are supported/)
  assert.doesNotMatch(bundle, /function sprintf_parse|function sprintf_format/)
})
