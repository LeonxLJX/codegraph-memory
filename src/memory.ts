import path from 'node:path'
import type { CodeFact, FactKind, MemoryOptions, ScoredFact, WriteResult } from './types.js'
import { emptyStore, loadStore, newId, saveStore, sortByCreatedDesc, type StoreData } from './store.js'
import { queryTerms, scoreFact } from './scoring.js'

/**
 * The memory facade. One instance per repo working session.
 *
 *   const mem = createMemory({ storePath: '.codegraph/memory.json' })
 *   mem.remember({ kind: 'decision', summary: 'auth tokens live in httpOnly cookies', file: 'src/auth' })
 *   mem.recall('session auth handling')   // → ScoredFact[]
 *   mem.related('src/auth/login.ts')      // facts anchored to a file or its ancestors
 */

export interface RememberInput {
  kind: FactKind
  summary: string
  detail?: string
  file?: string
  symbol?: string
  tags?: string[]
  /** Bump an existing fact with the same (kind, summary) instead of duplicating. */
  dedupe?: boolean
}

export interface Memory {
  /** Store a fact. Validates kind + summary. With dedupe, re-remembering bumps the original. */
  remember(input: RememberInput): WriteResult
  /** Score-ranked recall. Empty query returns the most recently touched facts. */
  recall(query: string, limit?: number): ScoredFact[]
  /** Facts anchored to a file, a directory prefix, or a symbol. */
  related(fileOrSymbol: string, limit?: number): ScoredFact[]
  /** Delete by id. Returns the removed fact, or null. */
  forget(id: string): CodeFact | null
  /** Mark facts as seen (recency boost for the next recall). */
  touch(ids: string[]): void
  /** All facts, newest first. */
  all(): CodeFact[]
  /** Persist pending changes (auto-called by every mutating call). */
  flush(): void
  stats(): { facts: number; byKind: Record<FactKind, number> }
}

const KINDS: FactKind[] = ['decision', 'constraint', 'api', 'bug', 'pattern', 'todo']

export function createMemory(options: MemoryOptions = {}): Memory {
  const storePath = path.resolve(options.storePath ?? '.codegraph/memory.json')
  let data: StoreData = loadStore(storePath)
  let dirty = false

  const persist = () => {
    if (dirty) {
      saveStore(storePath, data)
      dirty = false
    }
  }

  const findDuplicate = (input: RememberInput): CodeFact | undefined =>
    data.facts.find((f) => f.kind === input.kind && f.summary.trim().toLowerCase() === input.summary.trim().toLowerCase())

  return {
    remember(input): WriteResult {
      if (!KINDS.includes(input.kind)) return { ok: false, error: `unknown kind "${String(input.kind)}" — expected one of ${KINDS.join(', ')}` }
      const summary = (input.summary ?? '').trim()
      if (summary.length < 8) return { ok: false, error: 'summary too short — an agent needs at least a full clause to recall it' }
      if (summary.length > 200) return { ok: false, error: 'summary too long (max 200) — put the why in `detail`' }

      if (input.dedupe) {
        const dup = findDuplicate(input)
        if (dup) {
          if (input.detail) dup.detail = input.detail
          if (input.file) dup.file = input.file
          if (input.symbol) dup.symbol = input.symbol
          dup.tags = [...new Set([...(dup.tags ?? []), ...(input.tags ?? [])])]
          dup.lastSeen = new Date().toISOString()
          dirty = true
          persist()
          return { ok: true, fact: dup }
        }
      }

      const fact: CodeFact = {
        id: newId(),
        kind: input.kind,
        summary,
        detail: input.detail,
        file: input.file,
        symbol: input.symbol,
        tags: input.tags ?? [],
        created: new Date().toISOString(),
        hits: 0,
      }
      data.facts.push(fact)
      dirty = true
      persist()
      return { ok: true, fact }
    },

    recall(query, limit = 5): ScoredFact[] {
      const terms = queryTerms(query)
      const now = Date.now()
      const scored = data.facts
        .map((fact) => {
          const { score, matched } = terms.length ? scoreFact(fact, { terms, now }) : { score: 1, matched: [] }
          return { fact, score, matched }
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      if (terms.length && scored.length) {
        this.touch(scored.map((s) => s.fact.id))
      }
      return scored
    },

    related(fileOrSymbol, limit = 10): ScoredFact[] {
      const needle = fileOrSymbol.replace(/\\/g, '/')
      const hits = data.facts
        .map((fact) => {
          let score = 0
          if (fact.file) {
            const f = fact.file.replace(/\\/g, '/')
            if (f === needle) score = 3
            else if (needle.startsWith(f.replace(/\/\*$/, '') + '/') || f.startsWith(needle + '/')) score = 2
            else if (needle.includes(path.basename(f).replace(/\*/g, '')) && path.basename(f).length > 3) score = 1
          }
          if (fact.symbol && fact.symbol === path.basename(fileOrSymbol).replace(/\.[jt]sx?$/, '')) score = Math.max(score, 3)
          if (fact.symbol && fileOrSymbol.endsWith(fact.symbol)) score = Math.max(score, 2)
          return { fact, score, matched: score ? ['path/symbol'] : [] }
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.fact.created.localeCompare(b.fact.created))
        .slice(0, limit)
      if (hits.length) this.touch(hits.map((h) => h.fact.id))
      return hits
    },

    forget(id): CodeFact | null {
      const idx = data.facts.findIndex((f) => f.id === id)
      if (idx === -1) return null
      const [removed] = data.facts.splice(idx, 1)
      dirty = true
      persist()
      return removed ?? null
    },

    touch(ids): void {
      const set = new Set(ids)
      const now = new Date().toISOString()
      let touched = false
      for (const f of data.facts) {
        if (set.has(f.id)) {
          f.lastSeen = now
          f.hits = (f.hits ?? 0) + 1
          touched = true
        }
      }
      if (touched) dirty = true
    },

    all(): CodeFact[] {
      return sortByCreatedDesc(data.facts)
    },

    flush(): void {
      persist()
    },

    stats() {
      const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<FactKind, number>
      for (const f of data.facts) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
      return { facts: data.facts.length, byKind }
    },
  }
}

/** Wipe the store (used by tests; be careful). */
export function resetStore(storePath: string): void {
  saveStore(storePath, emptyStore())
}
