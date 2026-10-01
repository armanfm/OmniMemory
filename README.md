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

The current OmniMemory baseline is intentionally simple. Future work should improve how memory is organized and maintained without turning the core recall engine into a second LLM.

### Long documents and long-form text

Improve ingestion of large documents, manuals and long conversations so that useful structure is preserved during indexing.

Goals include:

- handling long files without losing section boundaries;
- keeping headings and nearby context attached to retrieved fragments;
- supporting larger documents without forcing the whole file into model context;
- allowing the agent to retrieve only the relevant portions of a long source;
- avoiding unnecessary duplication when the same source is captured more than once.

Conceptually:

```text
long document
     ↓
structured segmentation
     ↓
local index
     ↓
relevant section only
     ↓
agent
```

### Stronger separation by screen / conversation

Treat each ChatGPT conversation or screen as a first-class memory scope.

The current implementation already stores `conversation_id`. The roadmap is to make this separation more explicit in both capture and retrieval.

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

The intended retrieval order is:

```text
current screen / conversation
        ↓
selected project / collection
        ↓
global memory only if necessary
```

This reduces unrelated memories competing with each other and keeps local context easier to reason about.

### Selective capture

Allow the user to decide what should become persistent memory.

Possible controls include:

- capture this conversation;
- ignore this conversation;
- add this file;
- add this manual;
- add this project folder;
- exclude temporary or low-value material.

The goal is not to store everything by default forever.

### Memory cleanup and deletion

Add explicit mechanisms to remove information that is no longer useful.

Examples:

- delete a captured conversation;
- remove a file from memory;
- remove obsolete versions;
- delete duplicated content;
- discard low-value or irrelevant captures;
- rebuild the index after cleanup.

Conceptually:

```text
captured memory
      ↓
review / relevance decision
      ↓
keep ───────────→ indexed
delete / ignore → removed from active memory
```

Cleanup should reduce noise as the corpus grows while keeping deletion understandable and auditable.

### Relevance-aware maintenance

Over time, OmniMemory should be able to help identify content that may no longer deserve space in the active memory corpus.

Possible signals include:

- exact duplicates;
- near-duplicates;
- obsolete versions;
- temporary conversations;
- content never selected as useful;
- user-marked irrelevant material.

Automatic deletion should not be assumed. A safer model is to expose candidates for cleanup and let the user or application policy decide what is removed.

### Project and collection scopes

Add first-class scopes beyond individual conversations.

Examples:

```text
collection: Solidity Study
collection: ExploreChem
collection: Work
collection: Personal Notes
```

A collection can group several chats, files and manuals without forcing unrelated material into the same search space.

### Source-aware recall

Keep enough source metadata so that retrieved context can be traced back to where it came from.

Useful source information includes:

- conversation;
- file;
- filename;
- range;
- capture time;
- collection or project;
- original source identifier.

This keeps recall explainable and makes it possible for the agent to fetch more context from the same source when necessary.

### Preserve graceful degradation

Future features should preserve an important property of the current architecture:

> **OmniMemory should help the agent, not become a single point of failure.**

If a scope is empty, a source was deleted, or recall returns weak context, the agent should still be able to continue with the active conversation and other available tools.

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
