import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TestContext } from 'node:test'

export function tempDirectory(t: TestContext): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'flat-test-'))
  const exitCode = process.exitCode
  t.after(() => {
    rmSync(directory, { recursive: true, force: true })
    process.exitCode = exitCode
  })
  return directory
}

export function setInputs(
  t: TestContext,
  inputs: Record<string, string>,
): void {
  const original = { ...process.env }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) delete process.env[key]
  }
  for (const [key, value] of Object.entries(inputs)) {
    process.env[`INPUT_${key.toUpperCase()}`] = value
  }
  t.after(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('INPUT_')) delete process.env[key]
    }
    Object.assign(process.env, original)
  })
}
