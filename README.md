# OmniMemory

**The librarian for your AI.**

Local-first memory for AI agents, with durable JSONL files and an in-memory index, deterministic lexical retrieval and no embeddings.

OmniMemory keeps captured conversations and files in a local archive. Search indexes user questions, assistant replies and files. Matching passages bring nearby context from the same conversation or source, within the requested scope. The agent interprets that material and reasons over it.

> Keep the archive local. Retrieve useful context. Let the agent reason.

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

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, select this project's `extension` directory and reload ChatGPT. Keep only one capture extension enabled for this archive.

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

The agent accesses memory through `/mcp` and the `search_memory` tool. Starting a localhost server alone does not connect a remote application to it.

## Capabilities

- Sources and metadata are stored as checksummed JSONL batches; chunks and compact numeric postings for questions, replies and files are rebuilt in RAM at startup.
- Source-level updates in transactions. Unchanged messages are skipped, and changing one source does not reindex unrelated sources.
- One-time JSONL archive import with input files preserved.
- Durable message delivery queue in Chrome, with retry and acknowledgement handling.
- Message ordering based on observed predecessors, with first-observed order as a fallback when predecessor links are absent.
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

`messages.jsonl` and `files.jsonl` can be used as archive import inputs. Captured changes are appended to `omnimemory.jsonl`. Each batch is one JSON line with a checksum, flushed before acknowledging capture. Only committed batches are replayed. An interrupted trailing line is preserved in a recovery file and excluded; corruption in a committed line stops loading with an error.

The active index contains the latest revision of each source. Older source revisions remain in the journal until `compact` replaces it with the current state. Compaction preserves collection membership, deletion blocks, revision metadata and audit events. Chunks and token postings are rebuilt rather than persisted. The journal is read in blocks at startup. Updates reindex only affected sources; corpus counts are maintained incrementally. Startup rebuilds indexes from the stored source text without rereading attached file bytes.

Exact search uses compact numeric token postings. Missing query words can use a one-edit typo fallback against the same postings. No bigram or correction index is stored. Ranking uses matched query words, exact matches and lexical score, with a relative half cutoff and bounded context. No model or embedding service is involved.

One process may open a store for writes. Stop the server before running CLI imports, collection edits, deletion or compaction. Read-only CLI commands, including backups, load a point-in-time snapshot while the server remains active. The index resides in RAM and is rebuilt at startup. Each archive supports one writer.

Message order is updated within the affected conversation. Imported data may lack reliable chronology; first-observed order is used until captured predecessor relationships provide better evidence. Conflicting predecessor observations leave the prior order intact and report an `order_warning`.

## Retrieval and context selection

The engine distinguishes **matching more words from the question** from **returning more surrounding context**.

1. Normalize and tokenize the query, removing configured stopwords and duplicate tokens.
2. Find exact tokens in user questions, assistant replies and files within the requested scope.
3. For each query word missing in the requested scope, probe one-edit alternatives in the existing vocabulary. An exact match for another query word does not suppress this fallback. Count each distinct query token once per candidate.
4. Retrieve candidate chunk IDs from the in-memory inverted index.
5. Rank by the number of matched query tokens, then the number of exact query tokens, then lexical score and stable chunk ID as a tie-breaker.
6. Set the minimum matched-word count to `Math.ceil(bestMatchedWordCount / 2)`. Discard every candidate below that minimum, then apply Top-K. The rule has no identifier exception.
7. Select Top-K hits and expand with nearby passages in the same source/conversation and allowed scope.
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

These measurements describe **OmniMemory 1.3.0**, the current documented configuration: user questions, assistant replies and files are searchable; the cutoff is 50% of the best matched-word count; typo fallback accepts one edit in eligible words. No bigram index is stored.

### Environment and scope

Measured on October 1, 2026 (America/Sao_Paulo), using Node v24.19.0 on linux, AMD EPYC 9V74 80-Core Processor, with 9 visible logical CPUs.
Synthetic run: `2026-10-02T01:14:01.483Z` to `2026-10-02T01:14:05.449Z` (UTC). LoCoMo run: `2026-10-02T01:14:50.053Z` to `2026-10-02T01:14:56.970Z` (UTC).

Tests use synthetic data and the public LoCoMo dataset, not personal conversations. Search latency measures the local engine; it excludes network transport, LLM reasoning and answer generation. Results describe these workloads on one machine.

### Synthetic corpus: 20,000 messages

| Measurement | Result |
| --- | ---: |
| Disk storage | 19.53 MiB |
| Initial ingestion | 0.763 s |
| Update ten messages | 2.491 ms |
| Resend ten unchanged messages | 0.195 ms |
| Reopen and rebuild the index | 475.39 ms |
| Process RAM after reopening (RSS) | 211.81 MiB |
| Process RAM after queries (RSS) | 300.66 MiB |

| Query | p50 | Sample p95 |
| --- | ---: | ---: |
| Exact identifier | 0.110 ms | 0.152 ms |
| Exact hash | 0.045 ms | 0.076 ms |
| Project topic across the corpus | 67.896 ms | 70.669 ms |
| Topic within one conversation | 6.345 ms | 9.318 ms |
| Misspelled identifier containing digits: no result | 0.005 ms | 0.055 ms |
| Single transposition within a scoped query | 8.406 ms | 9.193 ms |
| Common terms across the corpus | 72.560 ms | 102.724 ms |
| Absent term | 0.100 ms | 0.129 ms |

Each query has one warm-up and five measurements. With five observations, the sample p95 is the maximum, not a robust estimate of production tail latency. A fast empty result is not successful retrieval; identifiers containing digits do not receive typo correction.

Ingestion uses batches of 100. Reopening is the median of three separate processes with OS caches left intact; timing covers opening the archive and rebuilding the index, not Node process startup. RSS is process memory, not index-only size or a guaranteed peak. Post-query RSS also includes the corpus generator and benchmark structures. Disk size is measured after closing the store and includes ten source updates.

Synthetic searches use Top-K 8 and the normal 24,000-character context limit. Broad queries can find 20,000 candidates, of which at most 10,000 are scored. Candidate truncation is reported and can reduce recall.

### Synthetic retrieval quality

**35 of 40 answerable queries (87.5%) returned all expected sources.** All five additional unanswerable queries correctly returned empty context.

| Category | Complete expected-source retrieval |
| --- | ---: |
| Literal facts | 5/5 |
| Exact identifiers | 5/5 |
| Single-edit typos | 5/5 |
| Paraphrases without sufficient lexical overlap | 0/5 |
| Evidence in a neighboring message | 5/5 |
| Updated information | 5/5 |
| Conversation scope | 5/5 |
| Distributed evidence | 5/5 |

This controlled fixture checks expected source references in returned context, including neighbors. It does not score generated answers or conventional chunk Recall@8. The update cases verify retrieval of the new information, not whether an agent would choose it over an older statement. Five typo cases establish success on those cases, not general typo robustness. The five paraphrase cases failed.

### LoCoMo: annotated evidence retrieval

The evaluation ran all **1,540 questions** in categories 1–4 across ten conversations and **5,882 turns**. The 446 adversarial category-5 questions were excluded. Both participants are indexed; LoCoMo contains dialogues between people rather than actual user/AI sessions.

| Metric | Result |
| --- | ---: |
| Questions with complete annotated evidence in returned text | 1027/1536 — **66.86%** |
| Mean per-question evidence recall | 72.65% |
| Search p50 | **3.63 ms** |
| Search p95 | 5.46 ms |
| Median context delivered for evaluation | 10,000 characters |
| Disk storage for this corpus | 4.308 MiB |
| Accumulated ingestion time | 301.30 ms |
| Process RSS after evaluation | 250.21 MiB |

**Complete evidence means that every annotated supporting turn appears in full in the delivered context, after whitespace normalization. It does not mean the agent answered correctly.** Partial turns or alternative evidence may suffice to answer, but do not satisfy this conservative metric. A source reference without the corresponding text surviving the context cap does not count.

Four questions without evidence annotations are excluded from the recall denominator but included in latency. Three questions have unresolved evidence IDs; these count as missing.

Protocol:

- Import the official `locomo10.json` in sequence, including speaker names, session dates and supplied image captions. Evaluation answer keys, evidence labels, observations and summaries are not indexed.
- Restrict each query to its full conversation, across all sessions. Conversations are added progressively; questions search only their respective conversation.
- Select Top-K 20 before expansion. Keep the engine limit at 24,000 characters; the evaluator caps the delivered text at 10,000 characters.
- Run one warm-up query per conversation, then one measured retrieval per question. Percentiles span 1,540 different queries.
- Apply the final text cap and evidence checks after the search timer. No reader model or LLM judge is executed.
- Evaluation RSS includes retained contexts and benchmark data. It is not directly comparable with reopening RSS for the 20,000-message corpus.

Dataset SHA-256: `79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4`.

### Zep: published external reference

**Zep was not executed in these tests.** The following vendor-published figures were consulted on October 1, 2026. They use answer accuracy rather than the complete-evidence retrieval metric above.

| Zep configuration | Retrieval p50 / p95 | Context | Published answer accuracy |
| --- | --- | --- | ---: |
| Auto Search | 115 / 173 ms | 10,000-character cap; median 2,680 tokens | 86.5% |
| Multi-scope | 87 / 155 ms | Median 5,760 tokens | 94.7% |

Zep reports a gpt-5.4 reader with medium reasoning and a gpt-5.4 judge. Multi-scope uses 20 edges, 10 nodes, 10 episodes, five summaries, five observations and a cross-encoder. These are not equivalent to Top-K 20 chunks.

The shared Auto Search character budget does not equalize infrastructure, network, corpus preparation or evaluation. Zep’s category distribution differs from the official dataset snapshot used here. No equivalent total-storage measurement was available. The percentages must not be ranked against OmniMemory’s evidence-retrieval percentage, and these results do not establish superiority over Zep.

### Reproduction and measurement records

From the project directory, with dependencies installed:

```bash
npm test
node benchmark/run.mjs --current
node benchmark/locomo.mjs --current
```

The benchmark scripts operate on temporary test archives. The source package includes per-query records, dataset attribution and `benchmark/data/LoCoMo-LICENSE.txt`. LoCoMo is distributed under CC BY-NC 4.0 and is used here for noncommercial evaluation.

Sources: [LoCoMo — Snap Research](https://github.com/snap-research/locomo), Maharana et al., ACL 2024; [Zep research and methodology](https://www.getzep.com/research/).

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

Messages are first persisted in Chrome's local outbox. Failed deliveries remain queued, including across a background-worker restart. New snapshots of the same message replace its queued snapshot. The extension retries periodically and exposes a **Tentar envio agora** button in its popup. This popup reports observed messages, queued message deliveries and the last successful message send. Its retry button retries the message queue; file-upload progress and errors are not shown there. File failures are logged in the page console.

File uploads validate offset and byte count, compute SHA-256 server-side and deduplicate by content within each conversation. File retries depend on the page remaining open; unlike message delivery, file bytes are not persisted in Chrome's outbox. Failed uploads are retried up to five times. Abandoned upload fragments older than one day are removed at startup.

Text formats such as Markdown, JSON, CSV, source code and configuration files are indexed as UTF-8. Markdown headings are carried as section metadata across chunks, and short blocks are preserved. Code-fence contents are not interpreted as headings.

PDF, DOCX, images and other binary formats are stored and searchable by filename/MIME metadata. Their internal content is not extracted in this release. Empty or oversized text files also use metadata-only indexing.

The extension captures loaded page content and file selection/drop events. It has no clipboard paste listener and does not scan existing attachment cards for file bytes. Text that ChatGPT converts internally into an attachment is not a supported capture path. It cannot see unloaded historical messages or automatically download all old attachments. File selection can trigger local capture before submitting a message.

### Live Markdown capture and recall validation

A live check on **October 1, 2026, at 23:15 (America/Sao_Paulo)** confirmed that an attached Markdown document was stored and its contents were retrievable through the connected OmniMemory MCP tool.

| Evidence | Observed result |
| --- | --- |
| Stored filename | `ExploreChem_RWA_Divulgacao_Oferta.md` |
| Server capture timestamp | `2026-10-02T02:15:29.543Z` |
| Content query | `carbonato misto de terras raras` |
| Requested Top-K | 3 |
| Returned source type | `file` |
| Retrieved content | The document's offer-presentation rule, its example involving a 100 kg reference lot, and surrounding justification |
| Source attribution | Filename, section headings, source UID, revision, content hash and character offsets |
| Corpus snapshot reported by the tool | 46 messages, 1 file and 207 chunks across all sources |
| Engine time reported for this query | 0.293 ms |

The returned passage contained text from inside the document and was attributed to a file source. A chat message containing the filename alone would not establish content indexing. The corpus counts describe the whole archive at the time of the query, not the size of this document. The reported time is one local search observation, not a latency benchmark or the total ChatGPT response time.

This confirms successful capture, text indexing and MCP retrieval for this attachment in the user's running installation. It does not establish clipboard capture, recovery of older attachments, binary text extraction or reliability across every browser interaction.

To check a newly attached text file:

1. Keep the server running and the extension active, then select or drop the file in an existing conversation.
2. Check `http://127.0.0.1:8787/status`; the `files` count reports committed file sources. Reattaching identical content in the same conversation can be deduplicated, so a successful repeat need not increase the count.
3. Ask `search_memory` for distinctive words from inside the file.
4. Confirm `source_type: file`, the expected filename and matching document text in the returned evidence.

A zero file count means no file source has been committed. It does not by itself distinguish a missed selection event from a failed upload. The popup's message-delivery status does not verify file-upload success.

## Archive import and configuration

The server can import `messages.jsonl` and `files.jsonl` from its data directory. It keeps the last record for each identity, resolves available captured file bytes, and records completion so the import runs once. The import is transactional; input files are preserved. Invalid JSON lines and missing file bytes are reported. Missing file bytes produce metadata-only entries.

The CLI also accepts exported ChatGPT conversations. `import-legacy --force` explicitly reruns JSONL import and can overwrite matching source identities with imported content.

Paths default to the project directory. Configuration supports `OMNI_DATA_DIR`, `OMNI_MEMORY_PATH`, `OMNI_FILE_DIR`, `OMNI_CAPTURE_KEY` and `PORT`. Reload the extension after changing generated connection settings.

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

`list` and `sources` support pagination. Duplicate suggestions use identical text hashes and compatible source kind/role. They do not automatically delete content, identify near-duplicates or decide which information is superseded.

Deletion removes live source records and their index entries; old text can remain in earlier journal batches until compaction. Raw uploaded files, previous backups and original JSONL inputs remain on disk; this is not secure erasure. Back up `data/files/` along with the JSONL journal when retaining a complete copy. The CLI backup command backs up current sources and metadata only.

The ChatGPT export importer uses the current branch, preserves its sequence, and imports text parts only. It does not import alternate branches or attachment contents. It accepts exported JSON files up to 250 MiB and reports unsupported records.

## Privacy and operational boundary

The server listens on `127.0.0.1`. Archive storage and search are local. Captured message snapshots can also reside temporarily in Chrome storage until delivered. Passages sent through MCP to a remote agent leave the local memory layer.

Capture endpoints require the generated local credential. The MCP endpoint does not require that capture key. Any externally exposed tunnel must supply its own access controls.

## Validation and current limitations

The recorded validation for OmniMemory 1.3.0 passed **30 automated tests** with Node.js 24 on Linux. Run the supplied test suite with:

```bash
npm test
```

Coverage includes persistence, transaction rollback, interrupted writes, writer locking, incremental indexing, restart, ordering, scope restrictions, the half-best cutoff, all four supported typo edits, identifier protection, source offsets, uploads, imports, cleanup, extension retry behavior and actual MCP client calls.

The retrieval engine is lexical. It can miss synonyms, indirect references and evidence distributed beyond the selected windows. An exact word is not reinterpreted merely because a different word might have been intended. Ambiguous typo alternatives can add irrelevant passages. An empty result can reflect missing capture, scope restrictions or a retrieval limitation; it does not prove that information never existed.

Capture depends on the ChatGPT page structure and covers only loaded content. The browser API tests use controlled simulations; they do not establish compatibility with every live page structure. The live Markdown check above confirms one attachment's capture and recall in the user's installation. Binary document contents are not extracted. File retries depend on the page remaining available.

Journal writes, indexing and search are synchronous. The index resides in RAM and is rebuilt at startup. Large imports and broad searches can occupy the event loop. Backup files, retained journal revisions and raw attachments consume disk until explicitly maintained.

