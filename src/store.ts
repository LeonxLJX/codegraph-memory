import fs from 'node:fs'
import path from 'node:path'
import type { CodeFact } from './types.js'

/**
 * JSON-file store. Local-first: one file, atomic writes, git-friendly.
 * The whole store fits in memory (thousands of facts ≈ a few MB).
 */

export interface StoreData {
  version: 1
  facts: CodeFact[]
}

const EMPTY: StoreData = { version: 1, facts: [] }

export function loadStore(storePath: string): StoreData {
  try {
    const raw = fs.readFileSync(storePath, 'utf8')
    const data = JSON.parse(raw) as StoreData
    if (data?.version !== 1 || !Array.isArray(data.facts)) return { ...EMPTY }
    return data
  } catch {
    return { ...EMPTY }
  }
}

/** Atomic write: write tmp file, then rename over the target. */
export function saveStore(storePath: string, data: StoreData): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
  const tmp = storePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, storePath)
}

export function emptyStore(): StoreData {
  return { ...EMPTY, facts: [] }
}

/**
 * Sortable unique id: timestamp (base36, ms) + 4 random chars.
 * Simpler than a full ULID and keeps chronological ordering.
 */
export function newId(now = Date.now()): string {
  const t = now.toString(36).padStart(9, '0')
  let r = ''
  for (let i = 0; i < 4; i++) r += Math.floor(Math.random() * 36).toString(36)
  return `f_${t}${r}`
}

export function sortByCreatedDesc(facts: CodeFact[]): CodeFact[] {
  return [...facts].sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
}
