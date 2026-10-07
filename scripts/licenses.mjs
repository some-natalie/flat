import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const lock = JSON.parse(
  readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
)
const notices = [readFileSync(path.join(root, 'LICENSE'), 'utf8')]

// ncc can overwrite the main license list when it emits additional chunks.
// Collect notices from every installed production dependency instead.
for (const [directory, metadata] of Object.entries(lock.packages).sort()) {
  if (!directory || metadata.dev) continue
  const absolute = path.join(root, directory)
  let files
  try {
    files = readdirSync(absolute, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT' && metadata.optional) continue
    throw error
  }
  const manifest = JSON.parse(
    readFileSync(path.join(absolute, 'package.json'), 'utf8'),
  )
  const licenses = files
    .filter(
      file =>
        file.isFile() &&
        /^(?:licen[cs]e|copying|copyright)(?:[._-].*)?$/i.test(file.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(file => readFileSync(path.join(absolute, file.name), 'utf8'))
  notices.push(
    `${manifest.name}@${manifest.version}\nLicense: ${manifest.license ?? metadata.license ?? 'See upstream package'}\n\n${licenses.join('\n\n')}`,
  )
}

writeFileSync(path.join(root, 'dist', 'LICENSE'), notices.join('\n\n---\n\n'))
