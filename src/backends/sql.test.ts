import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { DataSource } from 'typeorm'
import fetchSQL from './sql.js'
import { tempDirectory } from '../test-utils.js'

const require = createRequire(import.meta.url)

for (const format of ['json', 'csv']) {
  test(`serializes SQLite query results as ${format}`, async t => {
    const directory = tempDirectory(t)
    const sql_queryfile = path.join(directory, 'query.sql')
    writeFileSync(sql_queryfile, "SELECT 1 AS id, 'hello, world' AS name")
    const downloaded_filename = path.join(directory, `data.${format}`)
    assert.equal(
      await fetchSQL({
        sql_connstring: 'sqlite://localhost',
        sql_queryfile,
        downloaded_filename,
      }),
      downloaded_filename,
    )
    const content = readFileSync(downloaded_filename, 'utf8')
    if (format === 'json') {
      assert.deepEqual(JSON.parse(content), [{ id: 1, name: 'hello, world' }])
    } else {
      assert.equal(content, 'id,name\n1,"hello, world"\n')
    }
  })
}

test('reads an existing SQLite database through legacy TypeORM options', async t => {
  const directory = tempDirectory(t)
  const database = path.join(directory, 'database.sqlite')
  const connection = new DataSource({
    type: 'sqljs',
    location: database,
    autoSave: true,
    sqlJsConfig: {
      locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
    },
  })
  await connection.initialize()
  try {
    await connection.query('CREATE TABLE example (id INTEGER)')
    await connection.query('INSERT INTO example VALUES (42)')
  } finally {
    await connection.destroy()
  }
  const sql_queryfile = path.join(directory, 'query.sql')
  writeFileSync(sql_queryfile, 'SELECT id FROM example')
  const downloaded_filename = path.join(directory, 'data.json')
  await fetchSQL({
    sql_connstring: 'sqlite://localhost',
    sql_queryfile,
    downloaded_filename,
    typeorm_config: JSON.stringify({ type: 'sqlite', database }),
  })
  assert.deepEqual(JSON.parse(readFileSync(downloaded_filename, 'utf8')), [
    { id: 42 },
  ])
})

test('rejects invalid TypeORM configuration instead of continuing', async t => {
  const directory = tempDirectory(t)
  const sql_queryfile = path.join(directory, 'query.sql')
  writeFileSync(sql_queryfile, 'SELECT 1')
  for (const typeorm_config of ['{invalid', 'null', '[]']) {
    await assert.rejects(
      fetchSQL({
        sql_connstring: 'sqlite://localhost',
        sql_queryfile,
        downloaded_filename: path.join(directory, 'data.json'),
        typeorm_config,
      }),
      /Failed to parse JSON/,
    )
  }
})

test('rejects unsupported database protocols', async t => {
  const directory = tempDirectory(t)
  const sql_queryfile = path.join(directory, 'query.sql')
  writeFileSync(sql_queryfile, 'SELECT 1')
  await assert.rejects(
    fetchSQL({
      sql_connstring: 'invalid://localhost',
      sql_queryfile,
      downloaded_filename: path.join(directory, 'data.json'),
    }),
    /protocol is not supported/,
  )
})

test('closes the connection when a query fails', async t => {
  const directory = tempDirectory(t)
  const destroy = t.mock.method(DataSource.prototype, 'destroy')
  const sql_queryfile = path.join(directory, 'query.sql')
  writeFileSync(sql_queryfile, 'SELECT * FROM missing_table')
  await assert.rejects(
    fetchSQL({
      sql_connstring: 'sqlite://localhost',
      sql_queryfile,
      downloaded_filename: path.join(directory, 'data.json'),
    }),
    /missing_table/,
  )
  assert.equal(destroy.mock.callCount(), 1)
})
