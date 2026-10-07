import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, RequestListener } from 'node:http'
import { AddressInfo } from 'node:net'
import path from 'node:path'
import { test, TestContext } from 'node:test'
import fetchHTTP from './http.js'
import { tempDirectory } from '../test-utils.js'

async function serve(
  t: TestContext,
  handler: RequestListener,
): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close(error => (error ? reject(error) : resolve()))
      }),
  )
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/data`
}

test('downloads binary data with an authorization header', async t => {
  const bytes = Buffer.from([0, 1, 127, 128, 255])
  const http_url = await serve(t, (request, response) => {
    assert.equal(request.method, 'GET')
    assert.equal(request.headers.authorization, 'Bearer test')
    response.end(bytes)
  })
  const downloaded_filename = path.join(tempDirectory(t), 'downloaded data.bin')
  assert.equal(
    await fetchHTTP({
      http_url,
      downloaded_filename,
      authorization: 'Bearer test',
    }),
    downloaded_filename,
  )
  assert.deepEqual(readFileSync(downloaded_filename), bytes)
})

test('merges Axios options but keeps the action URL and authorization', async t => {
  const http_url = await serve(t, (request, response) => {
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.authorization, 'Bearer test')
    assert.equal(request.headers['x-test'], 'custom')
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      assert.deepEqual(JSON.parse(body), { query: 'test' })
      response.end('result')
    })
  })
  const directory = tempDirectory(t)
  const axios_config = path.join(directory, 'request.json')
  const downloaded_filename = path.join(directory, 'data.txt')
  writeFileSync(
    axios_config,
    JSON.stringify({
      method: 'post',
      url: 'http://invalid.example',
      baseURL: 'http://invalid.example',
      headers: { authorization: 'ignored', 'x-test': 'custom' },
      data: { query: 'test' },
      responseType: 'json',
    }),
  )
  await fetchHTTP({
    http_url,
    downloaded_filename,
    axios_config,
    authorization: 'Bearer test',
  })
  assert.equal(readFileSync(downloaded_filename, 'utf8'), 'result')
})

test('rejects unsuccessful HTTP responses', async t => {
  const http_url = await serve(t, (_request, response) => {
    response.writeHead(503).end('unavailable')
  })
  await assert.rejects(
    fetchHTTP({
      http_url,
      downloaded_filename: path.join(tempDirectory(t), 'data.txt'),
    }),
    /503/,
  )
})

test('rejects interrupted response streams', async t => {
  const http_url = await serve(t, (_request, response) => {
    response.writeHead(200, { 'Content-Length': '1000' })
    response.write('partial')
    setTimeout(() => response.destroy(), 20)
  })
  await assert.rejects(
    fetchHTTP({
      http_url,
      downloaded_filename: path.join(tempDirectory(t), 'data.txt'),
    }),
  )
})

test('rejects invalid Axios JSON', async t => {
  const directory = tempDirectory(t)
  const axios_config = path.join(directory, 'request.json')
  writeFileSync(axios_config, '{invalid')
  await assert.rejects(
    fetchHTTP({
      http_url: 'http://127.0.0.1',
      downloaded_filename: path.join(directory, 'data.txt'),
      axios_config,
    }),
    SyntaxError,
  )
})
