import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

describe('VitePress build output', () => {
  it('vitepress config exists', () => {
    // Test runs from project root, config is in docs/.vitepress/
    const configExistsMts = existsSync(resolve('docs', '.vitepress', 'config.mts'))
    const configExistsTs = existsSync(resolve('docs', '.vitepress', 'config.ts'))
    expect(configExistsMts || configExistsTs).toBe(true)
  })
})
