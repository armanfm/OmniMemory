# OmniMemory

**Local-first deterministic memory and recall for AI agents.**

OmniMemory is a lightweight memory layer that captures conversations and files, stores them locally, retrieves only the most relevant context, and exposes that context to AI agents through MCP.

Its central idea is simple:

> **Keep memory local, search deterministically, and send only relevant context to the model.**

OmniMemory is not an LLM. It does not replace reasoning. The memory layer retrieves context; the agent interprets, combines and reasons over that context.

---

## Purpose

Large conversation histories and project archives create a practical problem:

```text
large history
    ↓
too much context
    ↓
more noise and cost
    ↓
harder retrieval
```

OmniMemory changes the flow:

```text
large local memory
    ↓
deterministic recall
    ↓
small relevant context
    ↓
LLM / Agent
```

The model does not need to receive the whole history. It receives only the pieces likely to matter for the current request.

---

## Local-first and privacy-first

OmniMemory is designed to run locally.

Conversation history and captured files remain in infrastructure controlled by the user, and retrieval is performed locally.

```text
local conversations / files
          ↓
      OmniMemory
          ↓
 local deterministic search
          ↓
 selected context only
          ↓
      AI agent / LLM
```

The full memory corpus does not need to be sent to an external memory service simply to perform retrieval.

The final privacy boundary still depends on the consuming agent or LLM. If a retrieved fragment is sent to an external model, that fragment has left the local memory layer.

---

## Memory and reasoning are separate

OmniMemory has one responsibility:

> **find useful context.**

The LLM has another:

> **understand, combine and reason over that context.**

Expected flow:

```text
User question
     ↓
OmniMemory searches
     ↓
returns relevant fragments
     ↓
LLM combines the fragments
     ↓
final answer
```

A retrieved fragment does not need to contain the complete final answer by itself.

---

## Current architecture

```text
ChatGPT / Agent
      │
      │ search_memory(query)
      ▼
┌─────────────────────────────┐
│         OmniMemory          │
│                             │
│  normalize                  │
│  tokenize                   │
│  remove stopwords           │
│  inverted index             │
│  exact token matching       │
│  prefix similarity          │
│  bigram Jaccard fallback    │
│  deterministic ranking      │
│  neighborhood expansion     │
└──────────────┬──────────────┘
               │
               ▼
       relevant fragments
               │
               ▼
          LLM / Agent
```

The current engine does **not** depend on embeddings.

---

## Current recall engine

The implementation currently uses:

- text normalization;
- stopword removal;
- inverted index;
- exact token matching first;
- fuzzy fallback using prefix similarity;
- character-bigram Jaccard similarity;
- deterministic scoring;
- Top-K retrieval;
- contextual neighborhood expansion;
- merging of overlapping or adjacent ranges.

Current defaults:

```js
chunkSize: 800
topK: 8
neighborsBefore: 1
neighborsAfter: 2
maxExpandedChars: 24000
```

This approach is especially useful for technical identifiers such as contract addresses, hashes, IDs, variable names, rare names, project names and exact technical terms.

---

## Conversation-aware memory

Each captured message keeps its `conversation_id`.

The `search_memory` tool accepts an optional `conversation_id`, allowing recall to be restricted to a specific conversation.

```text
Chat A
├── messages
└── files

Chat B
├── messages
└── files
```

Recommended strategy:

```text
current conversation
        ↓
selected project / collection
        ↓
global memory if necessary
```

> **Scope first, global when necessary.**

---

## Selective knowledge

OmniMemory can also be used with intentionally selected knowledge sources.

Examples:

```text
Solidity Study
├── Solidity documentation
├── Foundry notes
├── security checklist
└── personal notes

ExploreChem
├── technical documentation
├── architecture notes
├── contracts
└── project decisions
```

Useful sources include:

- study manuals;
- technical documentation;
- project files;
- source code;
- research material;
- personal notes;
- selected conversations.

The system does not need to mix every source into every query.

---

## Automatic ChatGPT capture

The project currently contains two main components.

### Chrome extension

Captures ChatGPT messages currently present in the page and sends them to the local OmniMemory server.

### Local server

The server:

- persists messages;
- persists captured files;
- rebuilds the deterministic index;
- serves status information;
- exposes `search_memory` through MCP.

---

## Persistence

Conversation memory:

```text
data/messages.jsonl
```

Captured file metadata:

```text
data/files.jsonl
```

Captured files:

```text
data/files/
```

The same memory corpus can remain available across different ChatGPT conversations as long as the same OmniMemory server and data directory are used.

---

## MCP

Default MCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

Current tool:

```text
search_memory
```

Example:

```json
{
  "query": "What did we decide about the mass balance?",
  "top_k": 8,
  "conversation_id": "optional-conversation-id"
}
```

Without `conversation_id`, OmniMemory can search the full indexed corpus.

With it, candidate selection is restricted to the selected conversation.

---

## Failure containment

OmniMemory is a supporting memory layer, not a mandatory reasoning dependency.

If recall fails, returns weak context, or is temporarily unavailable, the agent can still continue using:

- the active conversation;
- information already present in context;
- other available sources;
- its normal reasoning process.

```text
question
   ↓
try recall
   ↓
useful result?
├── yes → use it
└── no  → continue without blocking
```

A memory failure does not necessarily need to become an answer failure.

---

## What OmniMemory knows

OmniMemory does **not create knowledge**.

It can only retrieve information from sources that were actually made available to it.

```text
Zep
→ only knows what was ingested into Zep

Mem0
→ only knows what was sent to Mem0

OmniMemory
→ only knows chats, files and sources that were captured or added
```

No retrieval algorithm can recover information that never entered the indexed corpus.

Therefore:

> **Retrieval quality is bounded by both search quality and corpus coverage.**

A useful mental model is:

```text
memory quality
=
retrieval quality
+
quality and coverage of available data
```

If the original information about a project was never captured, OmniMemory cannot retrieve it later.

An LLM may still know or infer something from another source, but that is different from memory recall.

---

## Recommended usage

### Normal conversation

Use automatic conversation capture and prefer recall from the current conversation when the question is local to that context.

### Long-running projects

Keep project conversations and files available so the agent can retrieve context from previous sessions.

### Study

Add manuals, technical documentation and personal notes as a selected knowledge corpus.

### Global recall

Use global search when the user remembers that something exists but does not know where it was discussed.

---

## Browser capture limitation

The Chrome extension can only capture messages currently loaded in the ChatGPT page.

If a very long conversation has older messages no longer present in the DOM, the extension cannot capture content that the page itself has not loaded.

The extension currently relies primarily on:

```text
data-message-author-role
```

Because the ChatGPT interface can change, this selector may require maintenance over time.

---

## Installation

Install dependencies:

```powershell
npm install
```

Start the server:

```powershell
npm start
```

Default endpoints:

```text
Local server:
http://127.0.0.1:8787

MCP:
http://127.0.0.1:8787/mcp

Automatic capture:
http://127.0.0.1:8787/capture/batch

Status:
http://127.0.0.1:8787/status
```

---


## Roadmap

The current OmniMemory baseline is intentionally simple: local, deterministic, explainable and independent of embeddings.

Future work should improve scale, organization and maintenance without changing that core philosophy.

### Priority 1 — Ingestion deduplication and compaction

Browser capture can observe the same message more than once, especially while responses are still being streamed or when the DOM is updated repeatedly.

The ingestion layer should therefore treat deduplication as a base requirement, not only as a later optimization.

Planned direction:

```text
incoming message
      ↓
stable identity / deterministic hash
      ↓
already stored?
├── yes → ignore or update existing record
└── no  → persist and index
```

A possible deterministic identity may include:

```text
conversation_id
message_id
role
text/version
```

In addition to preventing duplicate active records, the persistence layer should support compaction so that obsolete intermediate versions do not grow indefinitely.

Goals:

- avoid repeated messages in the active corpus;
- avoid duplicate neighbor expansion;
- keep the persistent store compact;
- preserve the latest valid version of captured content;
- rebuild only affected index entries after updates.

---

### Priority 2 — Stronger separation by screen / conversation

Each ChatGPT screen or conversation should be treated as a first-class memory scope.

The current implementation already stores `conversation_id`. The roadmap is to make that isolation stronger during both capture and retrieval.

```text
Chat / Screen A
├── messages
└── files

Chat / Screen B
├── messages
└── files

Project / Collection
├── selected chats
└── selected files
```

Recommended retrieval order:

```text
current screen / conversation
        ↓
selected project / collection
        ↓
global memory only if necessary
```

This reduces unrelated memories competing in the same search and keeps recall more context-aware.

---

### Priority 3 — Persistent storage and persistent text index

The current baseline persists raw data in `.jsonl` files and rebuilds in-memory indexes when the server starts.

This is simple and transparent, but the startup cost and RAM usage can grow as the corpus becomes much larger.

A natural future direction is an embedded database with persistent indexing, with **SQLite + FTS5** as the primary candidate.

Potential benefits:

- persistent structured storage;
- persistent full-text index;
- faster startup;
- less need to rebuild every structure from scratch;
- incremental inserts and updates;
- real pagination;
- easier deletion and compaction;
- lower memory pressure as the corpus grows.

This is a roadmap direction, not a current implementation claim.

The exact performance benefit must be measured before replacing the current engine.

---

### Priority 4 — Fuzzy-search pruning before Jaccard

Exact lookup through the inverted index is naturally selective.

The more expensive path is the fuzzy fallback, especially when a query produces many possible lexical candidates.

The roadmap is to add a cheap pruning stage before calculating character-bigram Jaccard similarity.

Conceptually:

```text
query token
    ↓
cheap pre-filter
    ↓
small candidate vocabulary
    ↓
prefix / bigram Jaccard
    ↓
deterministic score
```

Possible pruning signals include:

- token-length bounds;
- prefix constraints;
- shared character fragments;
- first-character grouping;
- cached token signatures;
- minimum overlap estimates.

The goal is to preserve the current deterministic fuzzy behavior while avoiding unnecessary comparisons.

---

### Priority 5 — Long documents and long-form text

Improve ingestion of large documents, manuals and long conversations so useful structure is preserved during indexing.

Goals include:

- handling long files without losing section boundaries;
- keeping headings and nearby context attached to retrieved fragments;
- retrieving only the relevant section of a large source;
- avoiding unnecessary duplication;
- keeping chunk relationships traceable to the original source.

Conceptually:

```text
long document
     ↓
structured segmentation
     ↓
persistent/local index
     ↓
relevant section only
     ↓
agent
```

---

### Priority 6 — Historical conversation synchronization

The browser extension can only capture content that is actually present in the ChatGPT DOM.

When older messages are not loaded by the interface, they are outside the extension's current visibility.

The roadmap should therefore make synchronization coverage explicit.

Possible improvements:

- show whether a conversation appears fully synchronized;
- provide a helper that guides the user through loading older content;
- detect incomplete capture when possible;
- allow manual import of exported conversation data;
- avoid implying that an old conversation was fully captured when only part of it was visible.

For historical conversations, the user may need to load or scroll through older content before the extension can capture it.

---

### Priority 7 — Explicit memory cleanup

As the corpus grows, OmniMemory should provide direct controls for removing information that is no longer useful.

Examples:

```text
delete conversation
delete file
remove obsolete version
remove duplicate
remove irrelevant capture
compact storage
reindex affected scope
```

Cleanup should be understandable and auditable.

The system should not silently delete important memory merely because it was not recently retrieved.

---

### Priority 8 — Relevance-aware maintenance

OmniMemory may help identify candidates for cleanup without automatically deleting them.

Possible signals:

- exact duplicates;
- near-duplicates;
- obsolete versions;
- temporary conversations;
- content explicitly marked irrelevant;
- repeated streaming snapshots;
- sources superseded by a newer source.

Preferred flow:

```text
memory corpus
     ↓
identify cleanup candidates
     ↓
user / application policy
     ↓
keep or remove
```

This preserves user control while reducing long-term noise.

---

### Priority 9 — Project and collection scopes

Add first-class scopes beyond individual conversations.

Examples:

```text
collection: Solidity Study
collection: ExploreChem
collection: Work
collection: Personal Notes
```

A collection can group several chats, files and manuals without forcing unrelated material into the same search space.

---

### Priority 10 — Source-aware recall

Keep enough source metadata so retrieved context can be traced to where it came from.

Useful source information includes:

- conversation;
- file;
- filename;
- range;
- capture time;
- collection or project;
- original source identifier.

This allows the agent to retrieve more context from the same source when necessary instead of treating each chunk as an isolated fragment.

---

### Preserve graceful degradation

Future features should preserve one of the current architecture's most important properties:

> **OmniMemory should help the agent, not become a single point of failure.**

If a scope is empty, a source was deleted, the server is unavailable, or recall returns weak context, the agent should still be able to continue using the active conversation and other available sources.

---

### Roadmap principle

Improvements should be introduced because they solve an observed scaling or retrieval problem, not simply because a more complex architecture exists.

The preferred evolution is:

```text
simple baseline
      ↓
measure real limitation
      ↓
add the smallest useful improvement
      ↓
measure again
```

The goal is to preserve OmniMemory's identity:

```text
local-first
deterministic
selective
auditable
privacy-oriented
```

while making it more robust as the corpus grows.

---

## Design philosophy

OmniMemory follows a few simple principles:

```text
memory should stay simple
retrieval should be selective
exact information should remain exact
the agent should remain responsible for reasoning
local data should remain local whenever possible
recall should help the agent, not become a single point of failure
```

The system is intentionally designed as a memory layer rather than a second model.

---

## Short definition

**OmniMemory is a local-first deterministic memory layer for AI agents that retrieves relevant fragments from conversations and files without requiring the entire history to be loaded into the model context.**

It separates persistent memory from reasoning, keeps retrieval explainable, and allows the agent to continue operating even when recall is incomplete or unavailable.

