# Extract Requirements Stage — Architecture & Design Document

Primary onboarding reference for the `extract-requirements` stage.
Read this before the code. Covers: flow, module responsibilities, LLM interface
design, all design decisions, assumptions, and known limitations.

---

## 1. ARCHITECTURE

### Position in the Pipeline

`extract-requirements` is the first stage in the kit generation pipeline.
It receives a raw job description (JD) text stored in `Kit.input.jd` and
produces a structured, validated, normalized requirements object stored in
`Kit.results.requirements`. Every downstream stage depends on this output —
questions reference requirement IDs, coverage checking validates against them,
and scheduling uses them as allocation units.

```
Kit.input.jd (MongoDB)
        │
        ▼
┌───────────────────────────────────────────────────────┐
│              extract-requirements stage               │
│                                                       │
│  1. Idempotency check                                 │
│     results.requirements already exists? → skip       │
│                                                       │
│  2. Input guard                                       │
│     Empty/missing JD → throw immediately              │
│                                                       │
│  3. Size check                                        │
│     jd.length > SAFE_JD_CHARS?                        │
│       NO  → single LLM call         (normal path)     │
│       YES → chunked extraction      (fallback path)   │
│                                                       │
│  4. LLM extraction (via LLMClient interface)          │
│     System prompt: role, rules, atomicity, JSON only  │
│     User prompt:   the JD text (or chunk)             │
│     Returns:       raw JSON object                    │
│                                                       │
│  5. Structural validation                             │
│     Missing keys, wrong types, invalid enums → throw  │
│     Empty requirements[] → valid (thin JD)            │
│                                                       │
│  6. Quality warning check (non-fatal)                 │
│     Compound requirement heuristic → warn, never throw│
│                                                       │
│  7. Deterministic normalization                       │
│     trim, collapse whitespace, remove trailing period │
│                                                       │
│  8. Exact-match deduplication                         │
│     Case-insensitive, normalized text only            │
│                                                       │
│  9. Stable ID assignment                              │
│     Application assigns r1, r2, r3... — never LLM    │
│                                                       │
│ 10. Persist to MongoDB                                │
│     Kit.results.requirements = { ...normalized,       │
│       items[], qualityWarnings[] }                    │
└───────────────────────────────────────────────────────┘
        │
        ▼
BullMQ worker marks stage done → enqueues research-company
```

### Module Responsibilities

**`extractRequirements.js` — stage handler**
The orchestrator. Loads the kit from MongoDB, runs the extraction flow in
order, persists the final result, and returns. Contains no business logic of
its own — delegates everything to the four modules below. The only file the
BullMQ worker calls directly.

**`promptBuilder.js` — prompt construction**
Owns the system prompt and user prompt for the LLM extraction call. The system
prompt encodes all extraction rules: atomicity, classification, scope limits,
output format. The user prompt wraps the JD text. This is interview-kit
business logic — it lives here, not in the LLM client.

**`requirements.schema.js` — validation**
Validates the raw object the LLM returns before any normalization. Two
categories of outcome: structural failures throw (stage fails, BullMQ retries);
quality issues produce `compoundRequirementWarning` entries and never throw.
Structural failures include: missing top-level keys, wrong types, invalid enum
values, empty requirement text. Quality warnings are heuristic-detected compound
requirements — requirements that may contain multiple independently testable
topics but cannot be mechanically proven to require splitting.

**`normalize.js` — normalization and ID assignment**
Three deterministic operations in sequence: normalize each text field (trim,
collapse whitespace, remove trailing period), exact-match deduplicate
(case-insensitive, normalized text), assign sequential IDs (`r1`, `r2`, ...).
Deliberately narrow — does not paraphrase, rewrite, synonym-match, or auto-split.

**`chunkExtract.js` — chunking fallback**
Handles JDs that exceed `SAFE_JD_CHARS`. Splits on paragraph/section boundaries,
runs extraction + normalization on each chunk independently, merges and deduplicates
across chunks, then returns a single merged object for the normal validation and
ID-assignment path to finish. Only active when the JD is genuinely oversized.

### LLM Interface Layer

No stage imports a provider SDK directly. All LLM calls go through:

```
Stage handler
    │
    ▼
getLLMClient()          ← singleton factory, reads LLM_PROVIDER from env
    │
    ▼
LLMProvider (abstract)  ← defines complete() and completeJSON() interface
    │
    ▼
GeminiProvider          ← implements complete() for Gemini SDK
OpenAIProvider          ← implements complete() for OpenAI SDK / compatible endpoints
(future providers...)
```

`completeJSON()` is defined on the abstract base class. It calls `complete()`,
strips markdown code fences (which some models add despite instructions), parses
JSON, and throws a structured error on parse failure. Provider adapters only
implement `complete()` — they never parse JSON themselves.

Adding a new provider requires: one new adapter file + one line in the
`LLMClient` factory map. Nothing else changes.

### Data Flow and Storage

```
Kit.input.jd
    │  read from MongoDB at stage start
    ▼
rawOutput           ← process memory only (LLM response, not persisted)
    │
    ▼
validated           ← process memory only (schema check result)
    │
    ▼
normalized          ← process memory only (trim/dedup/IDs applied)
    │
    ▼
Kit.results.requirements  ← written to MongoDB once, at the end
    │
    ▼
Kit.stages['extract-requirements'].status = 'done'  ← written by worker
```

Intermediate values (raw LLM response, per-chunk results, merged pre-ID output)
live only in process memory. They are not written to Redis or MongoDB because:
- On failure, the stage retries wholesale — partial state is useless
- On success, only the final normalized output has downstream value
- The extraction LLM call is fast enough to redo on retry

Redis is not used in this stage. It becomes relevant in later stages where
raw crawl page content (large, ephemeral, needed only within one stage) benefits
from a cache layer.

### What lives in `Kit.results.requirements`

```json
{
  "roleTitle": "Senior Backend Engineer",
  "seniority": "Senior",
  "responsibilities": ["Design and maintain APIs", "..."],
  "items": [
    { "id": "r1", "text": "5+ years Node.js experience", "kind": "technical", "priority": "must" },
    { "id": "r2", "text": "Experience with AWS", "kind": "technical", "priority": "must" },
    { "id": "r3", "text": "Strong communication skills", "kind": "behavioural", "priority": "nice" }
  ],
  "qualityWarnings": [
    {
      "type": "compoundRequirementWarning",
      "index": 0,
      "text": "Strong Node.js, AWS and Docker experience",
      "message": "Requirement may contain multiple independently testable topics. Downstream generation should ensure all explicitly named topics receive adequate coverage."
    }
  ]
}
```

`items[]` is the field name all downstream stages read. Never `requirements[]`.
`qualityWarnings[]` is always present (empty array if none). Downstream stages
read it to understand where coverage may need extra attention.

---

## 2. DESIGN DECISIONS

**Single LLM call for normal-sized JDs**
One structured extraction call per JD. Not broken into sub-calls (one for
responsibilities, one for requirements, one for classification). A single call
gives the model full context to classify correctly — "5+ years with React"
reads differently next to "we are a startup" than next to "enterprise financial
systems." Sub-calls would lose that context and produce worse classification.

**LLM extracts, application validates and assigns IDs**
The LLM is responsible for identifying requirements, classifying kind/priority,
and preserving meaning from the JD. The application is responsible for schema
validation, enum enforcement, normalization, deduplication, and ID assignment.
These are distinct responsibilities. Asking the LLM to assign IDs would make
IDs non-deterministic across retries and impossible to validate; asking the
application to classify `technical` vs `behavioural` would require NLP it
cannot do reliably.

**Atomicity enforced by prompt, not by code**
Compound requirements cannot be safely auto-split in application code without
interpreting meaning — which is explicitly out of scope for this layer. The
prompt strongly instructs atomic extraction. If the model still returns a
compound requirement, the heuristic emits a `compoundRequirementWarning` as
a quality signal. That warning travels with the results to downstream stages,
which ensure explicitly named topics receive adequate coverage. Attempting to
auto-split in code would risk inventing requirements the JD did not contain —
a worse outcome than a compound warning.

**Structural validation failures throw; quality warnings never throw**
Invalid enum values, missing required keys, or empty `text` fields are
structural — they indicate the LLM ignored the format instructions entirely.
Retrying is the right response; a fresh call usually produces a valid response.
Compound requirements are a semantic quality issue — the response is structurally
valid and the data is usable. Rejecting it would waste retries, add cost (some
models produce compound requirements 30–70% of the time on dense JDs), and
achieve nothing the downstream coverage mechanism cannot compensate for.

**Empty `requirements[]` is valid — missing `requirements` key is not**
A two-line JD may genuinely have no explicit requirements. That should produce
an empty `items[]`, not a stage failure. But if the `requirements` key is
entirely absent from the LLM response, the model ignored the output format —
that is structural malformation and should throw. The validator distinguishes
these two cases explicitly.

**`qualityWarnings` embedded in `results.requirements`, not a separate field**
Warnings travel with the data they describe. `generate-questions` reads both
`results.requirements.items` and `results.requirements.qualityWarnings` in one
document fetch. A separate top-level `results.qualityWarnings` field would require
coordinating which warnings belong to which result set as more stages add their own.
Embedding keeps it self-contained.

**Exact-match deduplication only — no semantic dedup**
"Node.js experience" and "Experience with Node.js" can remain as two separate
requirements in V1. Semantic deduplication would require embeddings or a second
LLM call, both of which add cost, latency, and a new failure mode. Exact-match
on normalized text catches the cases that matter most (identical phrasing from
chunk boundaries) without introducing complexity for a rare edge case.

**Chunking operates on normalized text before merging**
Each chunk's text is normalized immediately after extraction, before the chunks
are merged. Deduplication therefore operates on consistent text — trailing periods
stripped, whitespace collapsed, casing unified. Without this, "Node.js experience."
(from chunk 1) and "Node.js experience" (from chunk 2) would not deduplicate.
Normalization before merge makes the exact-match guarantee meaningful.

**SAFE_JD_CHARS default of 50,000**
Real-world JDs are typically 3,000–10,000 characters. Even a dense 3-page JD
sits around 8,000 characters. 50,000 characters (~12,500 tokens) ensures chunking
only fires on genuinely pathological inputs — scraped pages with navigation text,
concatenated postings, or documents accidentally pasted in full. The previous
default of 12,000 was too conservative and would have triggered chunking on
normal large JDs. Configurable via `SAFE_JD_CHARS` env var for model-specific
adjustment.

**Provider-agnostic LLM interface**
Every stage uses `getLLMClient()` — never a provider SDK directly. This means
swapping providers (or running tests against a mock provider) requires no changes
to any stage handler or business logic file. Groq, for example, is just the
OpenAI provider pointed at a different base URL and model. The interface boundary
also makes it straightforward to add retry-at-provider-level logic, token counting,
or cost tracking in one place without touching stage code.

**Singleton LLM client**
`getLLMClient()` returns the same instance for the lifetime of the process. Provider
SDK clients are designed to be reused — recreating them per request would recreate
HTTP connection pools unnecessarily. The singleton is reset in tests via
`resetLLMClient()`.

---

## 3. ASSUMPTIONS

**JD text is already stored and trusted as input**
This stage assumes `Kit.input.jd` contains the raw JD text exactly as the user
pasted it. No fetching, no URL resolution, no format detection. The API layer
is responsible for accepting the JD and storing it. This stage starts from there.

**JD text is plain text or lightly formatted markdown**
The LLM prompt is designed for natural language job descriptions. HTML, heavily
structured JSON, or binary content in `Kit.input.jd` will produce unpredictable
extraction results. The API layer is expected to reject non-text input before the
kit is created.

**The LLM returns valid JSON when instructed**
The prompt instructs JSON-only output. Provider-level JSON mode is enabled where
supported (Gemini `responseMimeType: 'application/json'`, OpenAI
`response_format: { type: 'json_object' }`). Occasional failures (non-JSON
response, truncated output) are handled by throwing and letting BullMQ retry.
The assumption is that structured JSON output succeeds on most attempts for any
reasonably capable model.

**Low temperature produces more consistent structured output**
Extraction runs at temperature 0.1. This assumes that lower temperature reduces
structural format deviations (missing keys, wrong enum values) while still
allowing the model to read the JD correctly. Higher temperature would increase
creativity where it is not wanted.

**3 BullMQ retry attempts are sufficient**
LLM transient failures (rate limits, 5xx responses) are assumed to resolve within
3 attempts with exponential backoff (5s, 10s, 20s). Persistent structural
failures (the model consistently ignores format instructions for this JD) are
not recoverable by retry and will exhaust attempts and mark the stage failed.

**Chunking is a rare fallback, not a primary concern**
The implementation assumes real JDs will not exceed 50,000 characters. Chunking
logic is present for correctness, not because it is expected to run in normal
usage. The quality of chunk-merged output (particularly compound dedup across
chunk boundaries) is assumed to be acceptable given the rarity of the path.

**Downstream stages read `results.requirements.items`, not `results.requirements.requirements`**
The normalized output uses `items` as the key for the requirements array, not
`requirements`, to avoid a confusing nested `requirements.requirements` path.
Every downstream stage is assumed to read `kit.results.requirements.items`. This
is a naming convention, not enforced by schema — breaking it silently produces
empty results downstream.

**`qualityWarnings` are informational for downstream stages**
`generate-questions` is assumed to read `qualityWarnings` and adjust its prompt
to ensure compound-flagged topics receive adequate coverage. This is a convention
between stages, not an enforced contract. If `generate-questions` ignores the
warnings, coverage checking may still catch gaps — but the warnings exist to
reduce the chance of gaps occurring in the first place.

---

## 4. NOT HANDLED / V2

**Semantic deduplication**
Near-duplicate requirements with different phrasing ("Node.js experience" and
"Experience with Node.js") are not detected or merged. Only exact-match on
normalized text is applied. Semantic dedup would require embeddings or a second
LLM call. Accepted as a V1 limitation — documented in the design decisions.

**Per-chunk retry in the chunking fallback**
If any single chunk produces a malformed LLM response during chunked extraction,
the entire stage fails and BullMQ retries from scratch (re-running all chunks).
There is no per-chunk retry budget, partial-chunk salvage, or ability to resume
from a completed chunk. Acceptable because chunking is rare in practice.

**Automatic compound-requirement splitting**
The heuristic detects likely compound requirements and emits a warning. It does
not split them. Auto-splitting would require semantic interpretation — it could
invent requirements the JD did not state, which is explicitly worse than a
warning. A V2 approach might offer the user a prompt in the UI: "We noticed this
requirement may cover multiple topics — want to split it?"

**JD language detection and multi-language support**
The prompt and validation assume English-language JDs. Non-English JDs will
extract in whatever language the LLM returns — kind/priority classification may
be less reliable, and the compound-requirement heuristic (which looks for
capitalized English tech-noun patterns) will not fire correctly. Not in scope
for V1.

**Token-level context limit awareness**
`SAFE_JD_CHARS` is a character-count proxy for token count. Different models have
different tokenization ratios for different content (code-heavy JDs tokenize
differently than plain text). The implementation does not call a tokenizer — it
uses a conservative character estimate. A JD with dense technical content could
exceed a model's actual token limit before hitting `SAFE_JD_CHARS`. V2: integrate
a lightweight tokenizer (e.g., `tiktoken` for OpenAI models) to count actual tokens.

**Streaming LLM responses**
The LLM client uses non-streaming `complete()` calls. The full response is
buffered before parsing. For very long responses (large JDs producing many
requirements), this increases time-to-first-byte. Streaming would allow
progressive parsing but significantly complicates the JSON validation layer.
Not worth the complexity for this stage's response sizes.

**Cost tracking and token usage logging**
The LLM client does not capture or log token usage from provider responses.
Provider responses typically include token counts in their metadata. V2: capture
`promptTokens`, `completionTokens`, and `totalTokens` per call and write them
to the Kit document for cost visibility.

**Requirement versioning across regeneration**
If `extract-requirements` is re-run for an existing kit (via a future regenerate
feature), it reassigns IDs from scratch (`r1`, `r2`, ...). Any existing questions
that reference old IDs will have dangling `requirement_ids`. This is a known
forward-compatibility risk documented in the queue-layer design. ID stability
across regeneration is not solved in this stage — it requires a higher-level
strategy (e.g., stable IDs derived from content hash rather than position) that
is out of scope for V1.

**Validation of `responsibilities[]` content**
Responsibilities are extracted and stored but not structurally validated beyond
"must be an array of strings." Individual responsibility entries are not checked
for minimum length, non-emptiness, or duplication. Low priority because
responsibilities are displayed to the user but not used as units in coverage
checking or scheduling.