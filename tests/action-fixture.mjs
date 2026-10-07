import { spawn } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tempDirectory } from '../lib/test-utils.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const gitStub = `
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { PassThrough } from 'node:stream'

const statePath = process.env.FLAT_TEST_GIT_STATE
const callsPath = process.env.FLAT_TEST_GIT_CALLS
const load = () => JSON.parse(fs.readFileSync(statePath, 'utf8'))
const save = state => fs.writeFileSync(statePath, JSON.stringify(state))
const record = args => fs.appendFileSync(callsPath, JSON.stringify(args) + '\\n')
const changed = state => state.outputs.filter(name => {
  if (!fs.existsSync(name)) return false
  return !(name in state.tracked) ||
    fs.readFileSync(name).toString('base64') !== state.tracked[name]
})

// Simulate Git only. Never change identity or execute real staging, commits, or pushes.
childProcess.spawn = (command, args) => {
  if (!/git(?:\\.exe)?$/i.test(command)) {
    throw new Error('Unexpected subprocess: ' + command)
  }
  record(args)
  const state = load()
  let output = ''
  let code = 0
  if (args[0] === 'config' && ['user.name', 'user.email'].includes(args[1])) {
    // Identity configuration is deliberately a no-op.
  } else if (args[0] === 'add' && changed(state).includes(args[1])) {
    if (!state.staged.includes(args[1])) state.staged.push(args[1])
  } else if (args.join(' ') === 'status -s') {
    output = state.staged.map(name =>
      (name in state.tracked ? 'M' : 'A') + ' ' +
      (/\\s|"/.test(name) ? JSON.stringify(name) : name)
    ).join('\\n') + '\\n'
  } else if (args[0] === 'cat-file' && args[1] === '-s') {
    const name = args[2].slice('HEAD:'.length)
    if (!(name in state.tracked)) throw new Error('No baseline for ' + name)
    output = Buffer.from(state.tracked[name], 'base64').length + state.headSizeEOL
  } else if (args[0] === 'commit' && args[1] === '-m' && state.staged.length) {
    if (state.failure === 'commit') {
      code = 1
    } else {
      for (const name of state.staged) {
        state.tracked[name] = fs.readFileSync(name).toString('base64')
      }
      state.staged = []
    }
  } else if (args.length === 1 && args[0] === 'push') {
    if (state.failure === 'push') code = 1
  } else {
    throw new Error('Unexpected Git arguments: ' + JSON.stringify(args))
  }
  save(state)
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  process.nextTick(() => {
    child.stdout.end(output)
    child.stderr.end(code ? 'Simulated Git ' + args[0] + ' failure\\n' : '')
    child.emit('exit', code)
    child.emit('close', code)
  })
  return child
}
childProcess.execSync = command => {
  const state = load()
  if (command === 'git ls-files --others --exclude-standard') {
    record(['ls-files', '--others', '--exclude-standard'])
    return Buffer.from(changed(state).filter(name => !(name in state.tracked)).join('\\n'))
  }
  if (command === 'git ls-files -m') {
    record(['ls-files', '-m'])
    return Buffer.from(changed(state).filter(name => name in state.tracked).join('\\n'))
  }
  throw new Error('Unexpected shell command: ' + command)
}
syncBuiltinESMExports()
`

export function fixture(
  t,
  { outputs = [], tracked = {}, failure, headSizeEOL = '\n' } = {},
) {
  const directory = tempDirectory(t)
  cpSync(dist, path.join(directory, 'dist'), { recursive: true })
  const preload = path.join(directory, 'git stub #1.mjs')
  const state = path.join(directory, 'git-state.json')
  const calls = path.join(directory, 'git-calls.jsonl')
  const baseline = {}
  for (const [name, contents] of Object.entries(tracked)) {
    writeFileSync(path.join(directory, name), contents)
    baseline[name] = Buffer.from(contents).toString('base64')
  }
  writeFileSync(preload, gitStub)
  writeFileSync(
    state,
    JSON.stringify({
      outputs,
      tracked: baseline,
      staged: [],
      failure,
      headSizeEOL,
    }),
  )
  writeFileSync(calls, '')
  writeFileSync(path.join(directory, 'github-env'), '')
  writeFileSync(path.join(directory, 'github-output'), '')
  return { directory, preload, state, calls }
}

export function gitCalls(files) {
  return readFileSync(files.calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

export function exportedVariables(files) {
  const lines = readFileSync(
    path.join(files.directory, 'github-env'),
    'utf8',
  ).split(/\r?\n/)
  const variables = {}
  for (let index = 0; index < lines.length; index++) {
    const delimiter = lines[index].indexOf('<<')
    if (delimiter === -1) continue
    const name = lines[index].slice(0, delimiter)
    const end = lines[index].slice(delimiter + 2)
    const value = []
    while (++index < lines.length && lines[index] !== end)
      value.push(lines[index])
    variables[name] = value.join('\n')
  }
  return variables
}

export async function runAction(
  files,
  inputs,
  entry = 'index.js',
  extraEnv = {},
) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('INPUT_')),
  )
  Object.assign(
    env,
    {
      FILES: '[]',
      HAS_RUN_POST_JOB: '',
      GITHUB_ENV: path.join(files.directory, 'github-env'),
      GITHUB_OUTPUT: path.join(files.directory, 'github-output'),
      DENO_DIR: path.join(files.directory, 'deno-cache'),
      FLAT_TEST_GIT_STATE: files.state,
      FLAT_TEST_GIT_CALLS: files.calls,
    },
    extraEnv,
  )
  for (const [key, value] of Object.entries(inputs)) {
    env[`INPUT_${key.toUpperCase()}`] = value
  }
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(files.preload).href,
      path.join(files.directory, 'dist', entry),
    ],
    { cwd: files.directory, env, timeout: 15000 },
  )
  let output = ''
  child.stdout.on('data', chunk => (output += chunk))
  child.stderr.on('data', chunk => (output += chunk))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code =>
      resolve({ code, output, env: exportedVariables(files) }),
    )
  })
}
