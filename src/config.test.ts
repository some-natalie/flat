import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getConfig, isHTTPConfig, isSQLConfig } from './config.js'
import { setInputs } from './test-utils.js'

test('returns an HTTP config and ignores SQL inputs', t => {
  setInputs(t, {
    http_url: 'https://example.com/data',
    downloaded_filename: 'data.json',
    sql_queryfile: 'query.sql',
  })
  assert.deepEqual(getConfig(), {
    http_url: 'https://example.com/data',
    downloaded_filename: 'data.json',
  })
})

test('returns a SQL config', t => {
  const config = {
    sql_connstring: 'postgres://localhost/test',
    downloaded_filename: 'data.csv',
    sql_queryfile: 'query.sql',
    typeorm_config: '{"ssl":true}',
  }
  setInputs(t, config)
  assert.deepEqual(getConfig(), config)
})

test('requires a downloaded filename in HTTP mode', t => {
  setInputs(t, { http_url: 'https://example.com/data' })
  assert.throws(getConfig, /^Error: Invalid configuration!/)
})

test('requires a query file in SQL mode', t => {
  setInputs(t, {
    sql_connstring: 'postgres://localhost/test',
    downloaded_filename: 'data.csv',
  })
  assert.throws(getConfig, /^Error: Invalid configuration!/)
})

test('requires an HTTP URL or SQL connection string', t => {
  setInputs(t, { downloaded_filename: 'data.json' })
  assert.throws(
    getConfig,
    /One of `http_url` or `sql_connstring` inputs are required/,
  )
})

test('prefers HTTP configs when both modes are supplied', t => {
  setInputs(t, {
    http_url: 'https://example.com/data',
    sql_connstring: 'postgres://localhost/test',
    downloaded_filename: 'data.json',
    sql_queryfile: 'query.sql',
  })
  assert.deepEqual(getConfig(), {
    http_url: 'https://example.com/data',
    downloaded_filename: 'data.json',
  })
})

test('preserves optional HTTP inputs', t => {
  const config = {
    http_url: 'https://example.com/data',
    downloaded_filename: 'data.json',
    postprocess: 'path/to/script.ts',
    authorization: 'Bearer test',
    mask: 'true',
  }
  setInputs(t, config)
  assert.deepEqual(getConfig(), config)
})

test('rejects the removed Axios file input with migration guidance', t => {
  setInputs(t, {
    http_url: 'https://example.com/data',
    downloaded_filename: 'data.json',
    axios_config: 'request.json',
  })
  assert.throws(getConfig, /axios_config input is no longer supported/)
})

test('identifies HTTP and SQL configs', () => {
  const http = {
    http_url: 'https://example.com/data',
    downloaded_filename: 'data.json',
  }
  const sql = {
    sql_connstring: 'postgres://localhost/test',
    downloaded_filename: 'data.csv',
    sql_queryfile: 'query.sql',
  }
  assert.equal(isHTTPConfig(http), true)
  assert.equal(isHTTPConfig(sql), false)
  assert.equal(isSQLConfig(sql), true)
  assert.equal(isSQLConfig(http), false)
})
