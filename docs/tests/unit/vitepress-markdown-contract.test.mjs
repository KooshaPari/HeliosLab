import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import test from 'node:test'

const boundaryDirectory = join('docs', 'boundary')
const rawPlaceholder = /<[^>]+>/g

test('boundary table placeholders are escaped for VitePress', async () => {
  const markdownFiles = (await readdir(boundaryDirectory)).filter((file) => file.endsWith('.md'))
  const violations = []

  for (const file of markdownFiles) {
    const path = join(boundaryDirectory, file)
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/)

    for (const [index, line] of lines.entries()) {
      if (line.startsWith('|') && rawPlaceholder.test(line)) {
        violations.push(`${basename(path)}:${index + 1}: ${line}`)
      }
      rawPlaceholder.lastIndex = 0
    }
  }

  assert.deepEqual(violations, [], `raw angle-bracket placeholders compile as Vue tags:\n${violations.join('\n')}`)
})
