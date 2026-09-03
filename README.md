# codegraph-memory 🧠

**Long-term memory for coding agents. Local-first, zero-dep, no vector DB.**

Every coding agent forgets everything between sessions. `codegraph-memory` is the missing long-term memory layer: facts about your codebase — decisions, constraints, APIs, known bugs, patterns, intent — stored as plain JSON in your repo, recalled by relevance with BM25-lite scoring.

Agents already have context windows (short-term) and code search (what *is*). What neither gives them is *why it is that way and what must not break*. That's what this remembers.

```
$ codegraph remember decision "auth tokens live in httpOnly cookies" --file src/auth
$ codegraph recall "session auth handling"

f_0018xk2a9p  decision [3.41]
  auth tokens live in httpOnly cookies
  @ src/auth
```

## Why not embeddings / a vector DB?

For code facts, **exact vocabulary dominates**. An agent asking "why is auth stateful" needs the fact that says "auth token is stored in httpOnly cookie" — keyword overlap gets you there. Embeddings add a model dependency, an index binary, drift, and cost for marginal gain on short, dense text.

| | Vector-DB memory platforms | codegraph-memory |
|---|---|---|
| Install | server + client + embedding model | `npm i codegraph-memory` (zero runtime deps) |
| Storage | remote / managed DB | one JSON file, **committable to git** |
| Recall | cosine over embeddings | BM25-lite: term match × coverage × kind weight × recency |
| Debuggability | opaque similarity | `matched: ["auth", "session"]` on every hit |
| Team sharing | vendor-dependent | it's a JSON file in git — PRs review memory changes |

Need semantic recall anyway? `memory.all()` gives you the facts; embed them yourself.

## Install

```bash
npm install codegraph-memory       # library
npx codegraph list                 # CLI
```

## Library

```ts
import { createMemory } from 'codegraph-memory'

const mem = createMemory({ storePath: '.codegraph/memory.json' })

// an agent (or a hook) records what it learned
mem.remember({
  kind: 'decision',            // decision | constraint | api | bug | pattern | todo
  summary: 'auth tokens live in httpOnly cookies',
  detail: 'localStorage was rejected in the security review — XSS would leak sessions',
  file: 'src/auth/session.ts',
  symbol: 'useSession',
  tags: ['security'],
  dedupe: true,                // re-remembering the same fact updates it instead of duplicating
})

// the next session asks
const hits = mem.recall('session auth handling')
for (const h of hits) {
  console.log(h.fact.summary, h.score.toFixed(2), h.matched) // [ 'auth', 'session' ]
}

// or asks about a file before touching it
mem.related('src/auth/session.ts')   // facts anchored to this file / its directories / its symbols
```

**Scoring, in one formula:**

```
score = (1 + term_hits) × coverage × kind_weight + recency + authority
  term_hits   summary matches ×2, detail/tag matches ×1
  coverage    matched terms / query terms   (rewards multi-term hits)
  kind_weight decision 1.3 · constraint 1.25 · bug 1.2 · api/pattern 1.0 · todo 0.7
  recency     +0.35 max, 14-day half-life (lastSeen / created)
  authority   +0.2 max, log-scaled hit count
```

Recall that actually hits a fact calls `touch()` — bumping `hits` and `lastSeen`, so facts the agent keeps needing surface faster.

## Fact kinds

| kind | means | example |
|---|---|---|
| `decision` | why the code is shaped this way | "prices are integer cents, never floats" |
| `constraint` | hard rule that must not break | "login must never render server-side" |
| `api` | how a module is meant to be used | "useSession returns null during SSR" |
| `bug` | known sharp edge | "rate limiter double-counts on retry" |
| `pattern` | established repo convention | "all API routes validate with zod" |
| `todo` | planned work with intent | "migrate build to tsup for dual ESM/CJS" |

## CLI

```bash
codegraph remember decision "auth tokens live in httpOnly cookies" --file src/auth --tag security
codegraph recall "rate limiting" --limit 3
codegraph related src/middleware/rate-limit.ts
codegraph list --kind bug
codegraph stats
```

## Wire it into your agent

The store is one JSON file, so any agent loop can use it in two lines — save a fact when a session ends, inject the top-K recalls as system context when one starts:

```ts
// session start
const memory = createMemory()
const context = memory.recall(taskDescription, 5)
  .map((h) => `- [${h.fact.kind}] ${h.fact.summary}`)
  .join('\n')
systemPrompt += `\nFacts about this repo:\n${context}`
```

## Development

```bash
npm install
npm test     # build + 10 tests, zero deps
```

Runtime deps: **zero**. Node ≥ 20.

## Layout

```
src/
  types.ts      # CodeFact / FactKind / ScoredFact
  store.ts      # JSON store — atomic writes, sortable ids
  scoring.ts    # BM25-lite: tokenize, term match, kind weight, recency
  memory.ts     # facade: remember / recall / related / forget / touch
cli/index.mjs   # remember / recall / related / forget / list / stats
tests/          # 10 node:test cases
```

## License

MIT
