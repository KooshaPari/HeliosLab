import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
Deno.test('vitepress config exists', () => { assert.ok(existsSync('.vitepress/config.ts') || existsSync('.vitepress/config.mts')) })
