const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const { sprintf } = require('./index.cjs')

const requireTedious = createRequire(require.resolve('tedious'))
const tediousRoot = path.dirname(require.resolve('tedious'))

test('Tedious resolves the scoped formatter replacement', () => {
  assert.equal(requireTedious('sprintf-js').sprintf, sprintf)
  assert.equal(
    requireTedious('sprintf-js/package.json').name,
    '@flat/tedious-formatter',
  )
})

test('preserves Tedious string, decimal, and hexadecimal formatting', () => {
  assert.equal(sprintf('%s %d', undefined, -60), 'undefined -60')
  assert.equal(
    sprintf('%02X %04X %08X', 10, 65535, 0xffffffff),
    '0A FFFF FFFFFFFF',
  )
  assert.equal(sprintf('%02X', -1), 'FFFFFFFF')
  assert.equal(sprintf('%04X', 0x10000), '10000')
  assert.equal(sprintf('%04d %% %s', -7, '%.1000000f'), '-007 % %.1000000f')
})

test('hostile precision and width specifiers do not throw or allocate padding', () => {
  for (const format of [
    '%.101f',
    '%.101e',
    '%.101g',
    '%.1000000000f',
    '%.1000000000e',
    '%.1000000000g',
    '%1000000000X',
    '%0999999999999999999999999999X',
    '%33s',
  ]) {
    assert.equal(sprintf(format, 1.25), format)
  }
})

test('renders Tedious packet headers and hex dumps', () => {
  const { Packet, TYPE } = requireTedious('./packet')
  const packet = new Packet(TYPE.SQL_BATCH)
  packet.addData(Buffer.from([0, 0xab, 0xff, 0x41]))
  assert.equal(
    packet.headerToString(),
    'type:0x01(SQL_BATCH), status:0x00(), length:0x000C, spid:0x0000, packetId:0x01, window:0x00',
  )
  assert.equal(packet.dataToString(), '0000  00ABFF41   ...A')
})

test('renders Tedious prelogin and login diagnostic strings', () => {
  const PreloginPayload = requireTedious('./prelogin-payload')
  const prelogin = new PreloginPayload({
    encrypt: true,
    version: { major: 1, minor: 2, build: 3, subbuild: 4 },
  })
  assert.match(prelogin.toString(), /version:1\.2\.3\.4, encryption:0x01\(ON\)/)
  const Login7Payload = requireTedious('./login7-payload')
  const login = new Login7Payload({
    tdsVersion: 0x74000004,
    packetSize: 4096,
    clientProgVer: 1,
    clientPid: 42,
    connectionId: 0,
    clientTimeZone: -60,
    clientLcid: 1033,
  })
  assert.match(login.toString(), /TDS:0x74000004, PacketSize:0x00001000/)
  assert.match(login.toString(), /ClientTimezone:-60, ClientLCID:0x00000409/)
})

test('preserves invalid SQL Server metadata errors', () => {
  const { readMetadata } = requireTedious('./metadata-parser')
  assert.throws(
    () =>
      readMetadata(Buffer.from([0, 0, 0, 0, 0, 0, 0xff]), 0, {
        tdsVersion: '7_4',
      }),
    /Unrecognised data type 0xFF/,
  )
})

test('all installed Tedious format strings stay within the supported subset', () => {
  let count = 0
  for (const name of fs.readdirSync(tediousRoot, { recursive: true })) {
    if (!name.endsWith('.js')) continue
    const source = fs.readFileSync(path.join(tediousRoot, name), 'utf8')
    let inspected = 0
    for (const match of source.matchAll(
      /_sprintfJs\.sprintf\)\(\s*(['"])(.*?)\1/g,
    )) {
      const format = match[2]
      assert.match(
        format,
        /^(?:[^%]|%%|%(?:0?\d+)?[sdxX])*$/,
        `${name}: ${format}`,
      )
      for (const placeholder of format.matchAll(/%(?:0)?(\d+)[sdxX]/g)) {
        assert.ok(Number(placeholder[1]) <= 32, `${name}: ${format}`)
      }
      count++
      inspected++
    }
    assert.equal(
      inspected,
      (source.match(/_sprintfJs\.sprintf/g) ?? []).length,
      `${name}: every formatter call must use a checked static format`,
    )
  }
  assert.ok(count >= 12, `Only found ${count} Tedious format strings`)
})
