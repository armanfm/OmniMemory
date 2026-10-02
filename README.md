# OmniMemory

**The librarian for your AI.**



Local-first memory for AI agents, with durable JSONL files and an in-memory index, deterministic lexical retrieval and no embeddings.

OmniMemory keeps captured conversations and files in a local archive. When an agent needs context, it consults the index, retrieves relevant passages and brings nearby text along. The agent interprets that material and reasons over it.

> Keep the archive local. Retrieve useful context. Let the agent reason.

For installation and migration instructions in Portuguese, read [COMECE_AQUI.md](COMECE_AQUI.md).

## The librarian metaphor

| Library | OmniMemory |
| --- | --- |
| Archive | Captured conversations and files |
| Catalog | In-memory inverted index and lexical vocabulary |
| Passages | Chunks with section titles and source offsets |
| Retrieval request | `search_memory` |
| Nearby passages | Bounded context expansion |
| Source reference | Stable source UID, revision, content hash and character range |
| Reader | The AI agent that interprets the retrieved material |

The metaphor explains responsibilities. The search engine follows lexical rules; it does not interpret meaning like a human librarian.

Conceptually, OmniMemory is a bridge between a **memory palace** and **memory that an AI agent can query**, the use case represented by services such as Zep. The memory-palace metaphor describes keeping information in identifiable places and visiting the relevant parts on demand. OmniMemory implements that idea with addressable source fragments, a searchable catalog and neighboring context. The agent requests evidence through a tool and interprets what comes back.

“The librarian for your AI” describes its role in that bridge: preserve the archive, locate useful passages and deliver their context. This conceptual position is not a technical maturity scale or a performance ranking against services such as Zep. The implemented retrieval is deterministic and lexical, with exact normalized words and a limited typo fallback; it uses no embeddings or generated knowledge graph.

## Requirements and quick start

- Node.js **24 or newer**.
- Chrome for automatic ChatGPT capture.
- An MCP client or existing connection able to reach the local server.

From this project directory:

```bash
npm install
npm start
```

The server creates `data/omnimemory.jsonl`, a random local capture key and `extension/config.js`. Start the server **before** loading the extension. There is no capture key to fill in manually.

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this project's `extension` directory and reload ChatGPT. Disable the previous capture extension when replacing it.

Default endpoints:

| Endpoint | Purpose |
| --- | --- |
| `http://127.0.0.1:8787/status` | Server status and corpus counts |
| `http://127.0.0.1:8787/mcp` | MCP tools |
| `/capture/batch` | Message ingestion |
| `/capture/file/start` | Start a file upload |
| `/capture/file/chunk` | Append upload bytes with an offset |
| `/capture/file/end` | Verify completion and persist the source |
| `/capture/file/abort` | Remove an unfinished upload |

The `/mcp` path and `search_memory` tool name remain compatible with the original integration. Starting a localhost server alone does not connect a remote application to it.

## Capabilities

- Sources and metadata are stored as checksummed JSONL batches; chunks and compact numeric token postings are rebuilt in RAM at startup.
- Source-level updates in transactions. Unchanged messages are skipped, and changing one source does not reindex unrelated sources.
- One-time legacy JSONL import with the original files preserved.
- Durable message delivery queue in Chrome, with retry and acknowledgement handling.
- Message ordering based on observed predecessors, with first-observed order as a fallback for legacy data.
- Ranking by matched query words, followed by exact matches and lexical score.
- Adaptive filtering: keep only candidates matching at least half as many query words as the best candidate, rounded upward.
- Short-passage expansion toward 40 words of context when neighboring material exists.
- Exact word matching after case/accent normalization, with a one-edit typo fallback and compact numeric postings.
- Section-aware chunks that retain short blocks and original character offsets.
- Collections for selected conversations or individual sources.
- Source-reading and scope-listing MCP tools.
- Explicit cleanup, backups, compaction, duplicate suggestions and exported-history import through the CLI.
- OmniMemory branding across server, package and extension.

## Storage and indexing

| Location | Contents |
| --- | --- |
| `data/omnimemory.jsonl` | Committed source and metadata batches: conversations, collections, deletion blocks, settings and audit events |
| `data/omnimemory.jsonl.lock` | Exclusive writer lock; read-only CLI commands remain available |
| `data/files/` | Captured file bytes |
| `data/capture-key` | Local capture credential generated on first startup |
| `data/backups/` | Backups created by the CLI |
| `extension/config.js` | Generated local extension connection settings |

The original `messages.jsonl` and `files.jsonl` are migration inputs. New changes are appended to `omnimemory.jsonl`. Each batch is one JSON line with a checksum, flushed before acknowledging capture. Only committed batches are replayed. An interrupted trailing line is preserved in a recovery file and excluded; corruption in a committed line stops loading with an error.

The active index contains the latest revision of each source. Older source revisions remain in the journal until `compact` replaces it with the current state. Compaction preserves collection membership, deletion blocks, revision metadata and audit events. Chunks and token postings are rebuilt rather than persisted. The journal is read in blocks at startup. Updates reindex only affected sources; corpus counts are maintained incrementally. Startup rebuilds indexes from the stored source text without rereading attached file bytes.

Exact search uses compact numeric token postings. Missing query words can use a one-edit typo fallback against the same postings. No bigram or correction index is stored. Ranking uses matched query words, exact matches and lexical score, with a relative half cutoff and bounded context. No model or embedding service is involved.

One process may open a store for writes. Stop the server before running CLI imports, collection edits, deletion or compaction. Read-only CLI commands, including backups, load a point-in-time snapshot while the server remains active. The index resides in RAM and is rebuilt at startup. Each archive supports one writer.

Message order is updated within the affected conversation. Historical JSONL data does not contain a reliable original chronology; first-observed order is used until captured predecessor relationships provide better evidence. Conflicting predecessor observations leave the prior order intact and report an `order_warning`.

## Retrieval and context selection

The engine distinguishes **matching more words from the question** from **returning more surrounding context**.

1. Normalize and tokenize the query, removing configured stopwords and duplicate tokens.
2. Find exact tokens within the requested scope.
3. For each query word missing in the requested scope, probe one-edit alternatives in the existing vocabulary. An exact match for another query word does not suppress this fallback. Count each distinct query token once per candidate.
4. Retrieve candidate chunk IDs from the in-memory inverted index.
5. Rank by the number of matched query tokens, then the number of exact query tokens, then lexical score and stable chunk ID as a tie-breaker.
6. Set the minimum matched-word count to `Math.ceil(bestMatchedWordCount / 2)`. Discard every candidate below that minimum, then apply Top-K. The rule has no identifier exception.
7. Select Top-K hits and expand each with nearby passages in the same source/conversation and allowed scope.
8. Merge overlapping or adjacent windows, prioritize stronger windows and fit the result to the character budget.

A passage matching three query words ranks before one matching two. If the best candidate matches ten query words, candidates with five or more matches remain; four or fewer are discarded. If the best matches seven, the minimum is also four. A one-word query, including an exact address or hash, has a minimum of one match. The cutoff counts distinct normalized query tokens, including accepted typo alternatives, rather than the total word count of a passage. Surviving short passages are expanded with available neighboring text. Neighboring context can contain fewer matches; the filter selects retrieval hits before expansion.

The `fuzzy_matches` field reports the original query tokens and accepted alternatives (`method: single_edit`); source text is never rewritten. Only missing normalized query words of 5–32 letters qualify. One insertion, deletion, substitution or adjacent transposition is allowed. Terms containing digits or punctuation, short query words and all-hexadecimal strings of eight or more characters stay exact-only. Multiple typos and synonyms are not handled. A valid exact word wins even if the user intended another word. Ambiguous alternatives may return unrelated passages; the edit limit does not guarantee semantic correctness. The threshold is relative to the best candidate, not the query length: if a ten-word query has a best hit of four words, the minimum is two.

This does not reward unrelated length or manufacture extra context. If a source contains only a short answer and no neighbors, the short answer is returned as it exists.

### Defaults

| Setting | Value |
| --- | --- |
| Chunk size | 800 characters |
| Default Top-K | 8; caller may request 1–20 |
| Initial previous/following neighbors | 1 before, 2 after |
| Context target | 40 whitespace-separated words |
| Maximum neighboring chunks per hit | 12, excluding the hit |
| Maximum assembled memory text | 24,000 characters |
| Scored candidate limit | 10,000 |
| Query limit | 2,000 characters and up to 32 unique search tokens |
| Text-file content indexing limit | 25 MiB |
| Upload limit | 100 MiB |

If there are more than 10,000 candidates, the preselection favors matched query-token count, then exact count and chunk ID. The response reports truncation. This bound limits per-search work but can reduce recall on very broad queries.

The character budget covers assembled passage text, not JSON metadata or transport overhead. If a complete window cannot fit, the engine prioritizes its hit passages and reports reduced context or truncation.

## Benchmarks

Measured with OmniMemory 1.3.0, Node.js 24.19.0 on Linux, AMD EPYC 9V74, nine visible logical CPUs, on October 1, 2026 (São Paulo). These are local retrieval measurements, excluding network calls and model reasoning. Full methods, raw records, licenses and reproduction commands are in [BENCHMARK.md](BENCHMARK.md).

### Synthetic corpus: 20,000 messages

| Measurement | Result |
| --- | ---: |
| Disk storage | 19.53 MiB |
| Initial ingestion | 0.763 s |
| Update ten messages | 2.491 ms |
| Resend ten unchanged messages | 0.195 ms |
| Reopen and rebuild the index | 0.475 s |
| Process RSS after reopening | 211.81 MiB |
| Process RSS after queries | 300.66 MiB |

| Query | p50 | Sample p95 |
| --- | ---: | ---: |
| `exact_id` | 0.110 ms | 0.152 ms |
| `exact_hash` | 0.045 ms | 0.076 ms |
| `project_topic` | 67.896 ms | 70.669 ms |
| `scoped_topic` | 6.345 ms | 9.318 ms |
| `fuzzy_identifier` | 0.005 ms | 0.055 ms |
| `typo_word` | 8.406 ms | 9.193 ms |
| `global_common` | 72.560 ms | 102.724 ms |
| `no_match` | 0.100 ms | 0.129 ms |

Each query has one warm-up and five measurements; sample p95 is therefore the maximum of five observations, not a robust production tail estimate. Ingestion uses batches of 100; reopening is the median of three separate processes with OS caches left intact. RSS after queries includes the corpus generator and temporary benchmark structures; reopening RSS does not. These are process measurements, not index-only sizes or guaranteed peaks.

The default Top-K is 8 with up to 24,000 context characters. Broad queries can match 20,000 candidates while only 10,000 are scored; candidate truncation is reported and may reduce recall.

**Synthetic retrieval: 35/40 answerable queries (87.5%) returned all expected sources.** 5/5 additional unanswerable queries correctly returned empty context. This measures evidence retrieval, not generated-answer accuracy. Expansion adds neighboring sources, so it is not conventional chunk Recall@8. The bounded one-edit fallback can recover eligible typos but does not infer synonyms; see the category breakdown in BENCHMARK.md. A fast empty result is not a successful retrieval.

### LoCoMo

All 1,540 questions in categories 1–4 were run across ten conversations and 5,882 turns. The 446 adversarial category-5 questions were excluded. Retrieval used Top-K 20 within the full relevant conversation, followed by a 10,000-character cap in the evaluation harness. The engine retains its normal 24,000-character ceiling.

| Metric | Result |
| --- | ---: |
| Complete annotated evidence in returned text | 1027/1536 — 66.86% |
| Mean per-question evidence recall | 72.65% |
| Retrieval p50 / p95 | 3.63 / 5.46 ms |
| Median context delivered for evaluation | 10,000 characters |
| Disk storage for this corpus | 4.308 MiB |
| Accumulated ingestion time | 301.30 ms |
| Process RSS after evaluation | 250.21 MiB |

Complete evidence requires the full text of every annotated support turn to survive in the returned context, normalizing whitespace only. Four questions without evidence annotations are excluded from the recall denominator but included in latency. Unresolved evidence IDs occur in three questions and count as missing. This conservative metric does not evaluate generated answers; partial turns or alternative evidence may still suffice for answering.

Turns include speaker names, session timestamps and supplied image captions. Answers, evidence labels, observations and summaries are never indexed. Each conversation has one warm-up query, followed by one measured retrieval per question. Percentiles span 1,540 different questions. The final context cap and evidence evaluation occur outside the search timer. Evaluation RSS includes retained contexts and test data. No reader model or LLM judge was run.

### Zep: published reference

Zep was **not executed** in this evaluation. Its published LoCoMo figures are listed as external reference, with different quality metrics:

| Configuration | Retrieval p50 / p95 | Context | Quality metric |
| --- | --- | --- | --- |
| OmniMemory — measured locally | 3.63 / 5.46 ms | 10,000-character evaluation cap | 66.86% complete evidence |
| Zep Auto Search — vendor-reported | 115 / 173 ms | 10,000-character cap; median 2,680 tokens | 86.5% answer accuracy |
| Zep Multi-scope — vendor-reported | 87 / 155 ms | median 5,760 tokens | 94.7% answer accuracy |

The matching Auto Search character budget does not equalize infrastructure, network, corpus preparation or evaluation. Zep reports a gpt-5.4 reader and judge; no such answering stage was used here. Its published category distribution also differs from the official dataset snapshot used in this run. These results do not establish superiority over Zep, and the percentages must not be ranked against each other. No equivalent total-storage measurement was available.

Sources: [official LoCoMo dataset](https://github.com/snap-research/locomo), [Zep research and methodology](https://www.getzep.com/research/), accessed October 1, 2026. Dataset SHA-256 and detailed methods are included in [BENCHMARK.md](BENCHMARK.md).

```bash
node benchmark/run.mjs --current
node benchmark/locomo.mjs --current
python3 benchmark/report.py
```

## MCP tools

### `search_memory`

```json
{
  "query": "ExploreChem mass balance",
  "top_k": 8
}
```

Optional `conversation_id` and `collection_id` restrict search. Supplying both uses their intersection. An unknown scope returns no matches; the server does not silently widen it.

Returned metadata includes corpus counts, query tokens, matched words, scores, matching mode, accepted typo alternatives, filtered weak-hit count, `best_matched_word_count`, `minimum_matched_words`, candidate truncation, source references and local search latency. The `latency_ms` field measures the search function, not model reasoning, network delay or total answer time.

### `read_memory_source`

Reads a bounded text range from a `source_uid` returned by search or source listing. Accepts an offset, a limit up to 24,000 characters and an optional revision. A revision mismatch reports that the source changed instead of silently returning a different version.

Source UIDs remain stable for an identity; revisions and content hashes identify its current contents. Chunk IDs and ranges can change when that source is edited. Offsets are JavaScript UTF-16 character positions in the stored source text.

### `list_memory_scopes`

Lists conversations and collections, with pagination. Reports observed coverage without claiming that unloaded conversation history was captured.

The agent chooses when to call these tools. If recall is unavailable or weak, the agent can continue with the current conversation and other available evidence.

## Capture, documents and coverage

The extension prefers explicit message-role elements and stable IDs, with a turn-based fallback. For single-message turn containers it retains the legacy turn ID when available. It sends predecessor relationships to preserve the visible sequence.

New chats are captured only after their real `/c/` conversation ID exists. Files selected before that point are held in the page and may be uploaded after a send action is observed and the draft receives its conversation URL; they are not durable across a page reload. If a draft is abandoned or navigation is ambiguous, select the file again in the intended conversation.

Messages are first persisted in Chrome's local outbox. Failed deliveries remain queued, including across a background-worker restart. New snapshots of the same message replace its queued snapshot. The extension retries periodically and exposes a **Tentar envio agora** button in its popup. This popup reports observed messages, pending deliveries and the last successful send.

File uploads validate offset and byte count, compute SHA-256 server-side and deduplicate by content within each conversation. File retries depend on the page remaining open; unlike message delivery, file bytes are not persisted in Chrome's outbox. Failed uploads are retried up to five times. Abandoned upload fragments older than one day are removed at startup.

Text formats such as Markdown, JSON, CSV, source code and configuration files are indexed as UTF-8. Markdown headings are carried as section metadata across chunks, and short blocks are preserved. Code-fence contents are not interpreted as headings.

PDF, DOCX, images and other binary formats are stored and searchable by filename/MIME metadata. Their internal content is not extracted in this release. Empty or oversized text files also use metadata-only indexing.

The extension captures loaded page content and file selection/drop events. It cannot see unloaded historical messages or automatically download all old attachments. File selection can trigger local capture before submitting a message.

## Migration

Stop the old server. Copy its complete `data` directory into this project before starting OmniMemory. The first startup reads `messages.jsonl` and `files.jsonl`, keeps the last record for each source identity, resolves available file bytes and builds the initial in-memory index.

The migration is transactional and recorded in the journal. Later startups skip it. Invalid JSON lines are counted and skipped; missing file bytes produce metadata-only records and a migration warning count. Inspect the migration summary before retiring the old installation.

Original files are not rewritten or deleted. To retry an intentionally corrected legacy input, the CLI supports `import-legacy --force`; it can overwrite matching current source identities with the imported version, so use it deliberately.

Paths default to this project directory, not the shell's current directory. Custom server configuration supports `OMNI_DATA_DIR`, `OMNI_MEMORY_PATH`, `OMNI_FILE_DIR`, `OMNI_CAPTURE_KEY` and `PORT`. The existing `TD_MEMORY_PATH`, `TD_FILE_META_PATH`, `TD_FILE_DIR` and `TD_CAPTURE_KEY` variables remain compatibility aliases. Reload the extension after changing generated connection settings.

## Organization, imports and maintenance

```bash
npm run memory -- help
npm run memory -- status
npm run memory -- list
npm run memory -- sources
npm run memory -- collections
npm run memory -- search "balanço de massa"
npm run memory -- duplicates
npm run memory -- backup
npm run memory -- compact
```

The CLI help documents commands that require actual IDs or local file paths:

- `collection-add`: create a collection and optionally attach an existing conversation or source.
- `collection-remove`: remove the grouping without deleting its content.
- `read`: read additional source text and inspect its revision.
- `import-chatgpt`: import user/assistant text from the exported conversation's current branch.
- `delete-conversation` and `delete-source`: require `--yes`, create a JSONL snapshot first, remove active content and block automatic recapture of that identity.
- `allow-recapture`: explicitly remove a deletion block.

`list` and `sources` support pagination. Duplicate suggestions are based on identical stored text hashes and compatible source kind/role; they do not automatically remove anything. Near-duplicate and superseded-source detection remain future work.

Deletion removes live source records and their index entries; old text can remain in earlier journal batches until compaction. Raw uploaded files, previous backups and original JSONL inputs remain on disk; this is not secure erasure. Back up `data/files/` along with the JSONL journal when retaining a complete copy. The CLI backup command backs up current sources and metadata only.

The ChatGPT export importer uses the current branch, preserves its sequence, and imports text parts only. It does not import alternate branches or attachment contents. It accepts exported JSON files up to 250 MiB and reports unsupported records.

## Privacy and operational boundary

The server listens on `127.0.0.1`. Archive storage and search are local. Captured message snapshots can also reside temporarily in Chrome storage until delivered. Passages sent through MCP to a remote agent leave the local memory layer.

Capture endpoints require the generated local credential. The MCP endpoint retains the original transport's access behavior and does not require that capture key. Any externally exposed tunnel must supply its own access controls.

## Validation and remaining work

Run:

```bash
npm test
```

The included tests cover persistent and incremental indexing, ordering, exact word matching and bounded typo fallback, matched-word ranking, short-context expansion, exact identifiers, collections, migration, export import, uploads, cleanup, extension retry logic and actual MCP client calls.

Validation was performed with Node.js 24 on Linux. Chrome's live ChatGPT DOM and the user's Windows installation must still be verified in their environment. The extension tests use controlled browser-API simulations. Measured performance and retrieval results are documented below and in [BENCHMARK.md](BENCHMARK.md), with raw records and reproducible scripts.

Remaining work includes binary document text extraction, stronger branch/edit identity reconciliation, durable file-upload retries, near-duplicate suggestions and broader capture coverage detection. Journal writes, indexing and searching use synchronous operations. Startup rebuilds the index; large imports and broad searches can occupy the server event loop.

**OmniMemory is the librarian for your AI: a local archive that brings relevant passages and their context into the conversation.**

**by Armando Freire**
