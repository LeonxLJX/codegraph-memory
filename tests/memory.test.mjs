import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMemory, resetStore, queryTerms } from '../lib/index.js'

const STORE = 'tests/.tmp-store/memory.json'

test('remember rejects bad kind and short summary', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  assert.equal(mem.remember({ kind: 'vibe', summary: 'anything goes here ok' }).ok, false)
  assert.equal(mem.remember({ kind: 'decision', summary: 'short' }).ok, false)
  assert.equal(mem.remember({ kind: 'decision', summary: 'x'.repeat(201) }).ok, false)
})

test('remember stores and dedupes', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  const a = mem.remember({ kind: 'decision', summary: 'auth tokens live in httpOnly cookies', file: 'src/auth' })
  assert.equal(a.ok, true)
  const b = mem.remember({ kind: 'decision', summary: 'auth tokens live in httpOnly cookies', dedupe: true, detail: 'updated why' })
  assert.equal(b.ok, true)
  assert.equal(b.fact.id, a.fact.id)
  assert.equal(b.fact.detail, 'updated why')
  assert.equal(mem.stats().facts, 1)
})

test('recall ranks keyword matches', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  mem.remember({ kind: 'decision', summary: 'auth tokens live in httpOnly cookies', file: 'src/auth/session.ts' })
  mem.remember({ kind: 'pattern', summary: 'all API routes use zod schemas for validation', tags: ['api'] })
  mem.remember({ kind: 'bug', summary: 'rate limiter double-counts on retry', file: 'src/middleware/rate-limit.ts' })
  const hits = mem.recall('auth session cookies')
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].fact.kind, 'decision')
  assert.ok(hits[0].score > 0)
  assert.ok(hits[0].matched.includes('auth'))
})

test('recall returns empty for unrelated query', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  mem.remember({ kind: 'decision', summary: 'auth tokens live in httpOnly cookies' })
  assert.deepEqual(mem.recall('kubernetes helm charts deployment'), [])
})

test('related matches file, directory prefix, and symbol', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  mem.remember({ kind: 'constraint', summary: 'login must never render server-side', file: 'src/auth/login.tsx' })
  mem.remember({ kind: 'api', summary: 'useSession hook returns null during SSR', symbol: 'useSession' })
  const byFile = mem.related('src/auth/login.tsx')
  assert.equal(byFile[0].fact.kind, 'constraint')
  const bySymbol = mem.related('src/hooks/useSession.ts')
  assert.ok(bySymbol.some((h) => h.fact.symbol === 'useSession'))
})

test('touch bumps hits and lastSeen', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  const r = mem.remember({ kind: 'todo', summary: 'migrate build to tsup for dual ESM/CJS' })
  mem.recall('migrate build tsup') // recall triggers touch
  const after = mem.all()[0]
  assert.equal(after.id, r.fact.id)
  assert.ok(after.hits >= 1)
  assert.ok(after.lastSeen)
})

test('forget removes and returns the fact', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  const r = mem.remember({ kind: 'bug', summary: 'dark mode toggle leaks event listener on unmount' })
  assert.equal(mem.forget(r.fact.id).id, r.fact.id)
  assert.equal(mem.forget(r.fact.id), null)
  assert.equal(mem.stats().facts, 0)
})

test('store survives reload', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  mem.remember({ kind: 'decision', summary: 'prices are stored in integer cents, never floats' })
  const mem2 = createMemory({ storePath: STORE })
  assert.equal(mem2.stats().facts, 1)
  assert.ok(mem2.recall('integer cents prices').length >= 1)
})

test('queryTerms strips stopwords and dedupes', () => {
  assert.deepEqual(queryTerms('the The auth of tokens'), ['auth', 'tokens'])
})

test('recall with empty query returns recent facts', () => {
  resetStore(STORE)
  const mem = createMemory({ storePath: STORE })
  mem.remember({ kind: 'decision', summary: 'one fact about the database here' })
  mem.remember({ kind: 'api', summary: 'another fact about the cache layer' })
  assert.equal(mem.recall('').length, 2)
})
