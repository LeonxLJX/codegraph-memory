/**
 * Core types for codegraph-memory.
 *
 * A coding agent forgets everything between sessions. This library is the
 * missing long-term memory: facts about the codebase (decisions, constraints,
 * APIs, bugs, patterns) stored locally as JSON, recalled by relevance —
 * no vector database, no server, no lock-in.
 */

/** What kind of code fact this is. Drives recall weighting and display. */
export type FactKind =
  | 'decision'    // why the code is shaped this way
  | 'constraint'  // hard rule the code must obey
  | 'api'         // how a module/function is meant to be used
  | 'bug'         // known bug or sharp edge
  | 'pattern'     // established convention in this repo
  | 'todo'        // planned work with intent attached

/** One remembered fact about the codebase. */
export interface CodeFact {
  /** Unique id — ULID-style, sortable by creation time. */
  id: string
  kind: FactKind
  /** Short imperative summary — what an agent needs in one line. */
  summary: string
  /** Optional longer explanation: the why, the failure mode, the trade-off. */
  detail?: string
  /** File path or glob the fact is anchored to (relative to repo root). */
  file?: string
  /** Symbol the fact is anchored to (function/class/component name). */
  symbol?: string
  tags: string[]
  /** ISO timestamp of creation. */
  created: string
  /** ISO timestamp of last recall hit — recency feeds scoring. */
  lastSeen?: string
  /** Times this fact has been recalled as relevant. */
  hits: number
}

/** A fact plus its relevance score for a given query. */
export interface ScoredFact {
  fact: CodeFact
  score: number
  /** Which query terms matched — for debuggability. */
  matched: string[]
}

/** Options for the memory facade. */
export interface MemoryOptions {
  /** Where the JSON store lives. Default: `.codegraph/memory.json` under cwd. */
  storePath?: string
  /** Repo root used to normalize file paths. Default: process.cwd(). */
  root?: string
}

/** Result of a write operation. */
export interface WriteResult {
  ok: boolean
  fact?: CodeFact
  error?: string
}
