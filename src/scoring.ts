import type { CodeFact, FactKind } from './types.js'

/**
 * BM25-lite relevance scoring — no vector DB, no embeddings, no network.
 *
 * Why not embeddings? For code facts, exact vocabulary dominates: an agent
 * asking "why is auth stateful" needs the fact that says "auth token is
 * stored in httpOnly cookie", and keyword overlap gets you there. Embeddings
 * add a model dependency, an index file, and drift — for marginal gain on
 * short, dense text. If you need semantic recall, export the store and embed
 * it yourself; the format is plain JSON on purpose.
 */

/** Kind weight — decisions and constraints matter more than todos. */
const KIND_WEIGHT: Record<FactKind, number> = {
  decision: 1.3,
  constraint: 1.25,
  api: 1.0,
  bug: 1.2,
  pattern: 1.0,
  todo: 0.7,
}

/** Tokenize: lowercase, split on non-word, drop stop tokens, keep code-ish parts. */
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'this', 'that', 'with', 'be', 'as', 'at', 'by'])

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_$-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
}

/** All searchable text of a fact, with per-field emphasis. */
export function factText(f: CodeFact): { summary: string[]; body: string[] } {
  return {
    summary: tokenize([f.summary, f.file ?? '', f.symbol ?? '', f.kind].join(' ')),
    body: tokenize([...f.tags, f.detail ?? ''].join(' ')),
  }
}

export interface ScoreContext {
  terms: string[]
  now: number
}

/**
 * Score one fact against the query terms.
 * - summary matches count double (title is the agent-facing line)
 * - kind weight multiplies
 * - recency bonus decays over ~30 days (half-life 14d), capped
 * - hit count gives a small authority bonus (log scale)
 */
export function scoreFact(f: CodeFact, ctx: ScoreContext): { score: number; matched: string[] } {
  const { summary, body } = factText(f)
  const summarySet = new Set(summary)
  const bodySet = new Set(body)

  let hits = 0
  const matched: string[] = []
  for (const term of ctx.terms) {
    if (summarySet.has(term)) {
      hits += 2
      matched.push(term)
    } else if (bodySet.has(term)) {
      hits += 1
      matched.push(term)
    }
  }
  if (hits === 0) return { score: 0, matched }

  // Coverage: reward facts that match more of the query, not just one term hard.
  const coverage = matched.length / Math.max(1, ctx.terms.length)

  const kindW = KIND_WEIGHT[f.kind] ?? 1

  // Recency bonus: 0..0.35, half-life 14 days, based on lastSeen or created.
  const stamp = f.lastSeen ?? f.created
  const ageDays = Math.max(0, (ctx.now - Date.parse(stamp)) / 86_400_000)
  const recency = 0.35 * Math.pow(0.5, ageDays / 14)

  // Authority bonus: log2(1+hits), capped at 0.2.
  const authority = Math.min(0.2, Math.log2(1 + (f.hits ?? 0)) * 0.1)

  const score = (1 + hits) * coverage * kindW + recency + authority
  return { score, matched }
}

/** Tokenize a natural-language query (reuse the same pipeline). */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))]
}
