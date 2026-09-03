#!/usr/bin/env node
/**
 * codegraph-memory CLI
 *   remember  <kind> <summary> [--file p] [--symbol s] [--tag t]... [--detail d]
 *   recall    <query> [--limit n]
 *   related   <file-or-symbol> [--limit n]
 *   forget    <id>
 *   list      [--kind k]
 *   stats
 *   doctor
 */
import { createMemory } from '../lib/index.js'
import fs from 'node:fs'

const args = process.argv.slice(2)
const cmd = args[0]

function parseFlags(rest) {
  const flags = { _: [] }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--file') flags.file = rest[++i]
    else if (a === '--symbol') flags.symbol = rest[++i]
    else if (a === '--detail') flags.detail = rest[++i]
    else if (a === '--tag') (flags.tags ??= []).push(rest[++i])
    else if (a === '--kind') flags.kind = rest[++i]
    else if (a === '--limit') flags.limit = parseInt(rest[++i], 10)
    else if (a === '--store') flags.store = rest[++i]
    else flags._.push(a)
  }
  return flags
}

const mem = createMemory({ storePath: parseFlags(args.slice(1)).store ?? '.codegraph/memory.json' })

function show(f, score) {
  const s = score != null ? ` [${score.toFixed(2)}]` : ''
  const anchor = [f.file, f.symbol].filter(Boolean).join(' · ')
  console.log(`${f.id}  ${f.kind}${s}`)
  console.log(`  ${f.summary}`)
  if (anchor) console.log(`  @ ${anchor}`)
  if (f.tags?.length) console.log(`  #${f.tags.join(' #')}`)
  if (f.detail) console.log(`  ${f.detail.slice(0, 200)}`)
  console.log('')
}

try {
  switch (cmd) {
    case 'remember': {
      const f = parseFlags(args.slice(2))
      const r = mem.remember({
        kind: args[1],
        summary: f._.join(' '),
        detail: f.detail,
        file: f.file,
        symbol: f.symbol,
        tags: f.tags,
        dedupe: true,
      })
      if (!r.ok) { console.error(`✗ ${r.error}`); process.exit(1) }
      console.log(`✓ remembered ${r.fact.id}`)
      break
    }
    case 'recall': {
      const f = parseFlags(args.slice(2))
      const hits = mem.recall(f._.join(' ') || '', f.limit ?? 5)
      if (!hits.length) { console.log('(no matching facts)'); break }
      console.log(`top ${hits.length} facts:\n`)
      for (const h of hits) show(h.fact, h.score)
      break
    }
    case 'related': {
      const f = parseFlags(args.slice(2))
      const hits = mem.related(args[1], f.limit ?? 10)
      if (!hits.length) { console.log('(no facts anchored here)'); break }
      for (const h of hits) show(h.fact, h.score)
      break
    }
    case 'forget': {
      const removed = mem.forget(args[1])
      console.log(removed ? `✓ forgot ${removed.id}` : `✗ no fact ${args[1]}`)
      break
    }
    case 'list': {
      const f = parseFlags(args.slice(1))
      const all = mem.all().filter((x) => !f.kind || x.kind === f.kind)
      console.log(`${all.length} facts\n`)
      for (const fact of all) show(fact)
      break
    }
    case 'stats': {
      console.log(JSON.stringify(mem.stats(), null, 2))
      break
    }
    case 'doctor': {
      const s = mem.stats()
      const empty = s.facts === 0
      console.log(empty ? '⚠ store is empty — remember() some facts first' : `✓ store OK — ${s.facts} facts, store file exists`)
      if (!empty && !fs.existsSync('.codegraph/memory.json')) console.log('⚠ custom store path in use')
      break
    }
    default:
      console.log('usage: codegraph <remember|recall|related|forget|list|stats|doctor> ...')
      process.exit(cmd ? 1 : 0)
  }
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}
