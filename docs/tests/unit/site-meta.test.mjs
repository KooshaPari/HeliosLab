import { describe, it, expect } from 'bun:test'
import { createSiteMeta } from '../../.vitepress/site-meta.mjs'

describe('createSiteMeta', () => {
  it('createSiteMeta is a function', () => {
    expect(typeof createSiteMeta).toBe('function')
  })

  it('createSiteMeta returns an object', () => {
    const m = createSiteMeta({ base: '/' })
    expect(typeof m).toBe('object')
  })
})
