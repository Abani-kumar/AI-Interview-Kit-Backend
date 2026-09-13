# Queue Layer — Architecture & Design Document

Primary onboarding reference for the Queue Layer. Read this before the code.
Covers: BullMQ + Redis workflow, MongoDB state management, SSE progress, and all design decisions.

---

## 1. ARCHITECTURE

### Overview

A kit is generated through a linear pipeline of discrete stages. Each stage is an
independent BullMQ job. No stage knows about the stages before or after it — the
registry defines the sequence, and each stage only runs when the previous one has
successfully persisted its output to MongoDB.

```
HTTP POST /api/kits
       │
       ▼
Kit document created in MongoDB          ← status: queued
       │
       ▼
First stage job enqueued in BullMQ/Redis ← extract-requirements:kitId:0
       │
       ▼
┌─────────────────────────────────────────────────────┐
│                  BullMQ Worker (generic)             │
│                                                      │
│  1. Atomically claim stage (pending → running)       │
│  2. Look up handler in Stage Registry                │
│  3. Call handler(kitId)                              │
│  4. Handler reads input from MongoDB                 │
│  5. Handler writes output to MongoDB (results.*)     │
│  6. Mark stage done in MongoDB                       │
│  7. Enqueue next stage job → BullMQ/Redis            │
│  8. Emit SSE progress event                          │
└─────────────────────────────────────────────────────┘
       │
       ▼
Repeat for each stage until validate-and-finalize
       │
       ▼
Kit document updated                     ← status: ready, data: { ...Appendix A }
```

### Components and Responsibilities

**BullMQ Queue (`kit-pipeline`)**
Owns job lifecycle: scheduling, retries, exponential backoff, dead-letter handling.
The application never manually retries a job — if a stage fails, BullMQ retries it
according to that stage's configured attempt count and backoff policy. Once all
attempts are exhausted, BullMQ moves the job to failed state and fires the `failed`
event. Business logic does not live here.

**Redis**
Backing store for BullMQ. Holds the job queue, job state, and retry metadata.
Redis is ephemeral from the application's perspective — MongoDB is the durable
source of truth. If Redis is lost and restarted, the reconciler re-enqueues any
kit stuck in `queued` or `stalled` state from MongoDB.

**Stage Registry (`stageRegistry.js`)**
A plain object mapping stage name → `{ handler, next, jobOptions }`. It is the
only place in the system that defines the pipeline's shape and per-stage retry
configuration. The generic worker looks up this registry; it has no hardcoded
knowledge of any stage. Adding or reordering a stage means editing the registry
only — the worker and queue are untouched.

**Generic Worker (`worker.js`)**
A single BullMQ Worker processes all stage job types from the `kit-pipeline` queue.
It is entirely domain-agnostic: receive job → look up registry → call handler →
mark done → enqueue next. It contains no interview-kit business logic.

**Stage Handlers (`kits/stages/*.js`)**
Each handler encapsulates the business logic for exactly one pipeline stage. A
handler receives only `kitId`, reads whatever it needs from MongoDB, does its work
(LLM call, web crawl, deterministic computation), and writes its output back to
`kit.results.*`. Handlers never enqueue jobs directly — that is the worker's
responsibility after the handler returns.

**MongoDB (Kit document)**
The durable state store for the entire pipeline. Every stage reads its inputs from
and writes its outputs to the Kit document. This means: if the worker process
restarts mid-pipeline, no work is lost — the next worker picks up from wherever
MongoDB says the kit currently is. The Kit document tracks:
- `status`: overall kit status (queued → generating → ready | failed | stalled)
- `currentStage`: which stage the kit is currently at, used as an atomic guard
- `stages.*`: per-stage status, attempt count, error, and completion time
- `results.*`: intermediate outputs written incrementally by each stage handler
- `data`: the final assembled Appendix A structure, written only by validate-and-finalize

**SSE Progress (`progress.sse.js`)**
When the frontend creates a kit, it opens a Server-Sent Events connection to
`GET /api/kits/:id/progress`. The worker emits a progress event after each stage
transition (running, done, failed). The frontend receives stage-level granularity,
not a single overall spinner. The SSE connection is closed by the server when the
final `ready` or `failed` event is sent.

### Stage Flow

```
extract-requirements        LLM — parse JD into structured requirements
        ↓
research-company            Network — crawl site + search public discussion (parallel inside stage)
        ↓
generate-brief              LLM — produce company brief from crawl + discussion data
        ↓
generate-questions          LLM — generate questions per requirement per category
        ↓
check-coverage          ←── Deterministic — compare requirement IDs against question.requirement_ids
        │                   Returns { next } dynamically:
        │                     - gaps found AND passes remaining → generate-questions (loop)
        │                     - no gaps OR passes exhausted   → generate-flashcards
        ↓
generate-flashcards         LLM — generate flashcards from requirements + questions
        ↓
build-schedule              Deterministic — arithmetic allocation of questions across days
        ↓
validate-and-finalize       Deterministic — assemble results.* into Appendix A shape, validate, save
```

### Coverage Loop

The coverage check is the one place where the pipeline loops rather than advances
linearly. After `generate-questions`, `check-coverage` computes which must-have
requirements have no question covering them. If gaps exist and the coverage pass
limit has not been reached, it resets `generate-questions` to `pending` and
returns `{ next: 'generate-questions' }` to the worker. The worker increments the
pass number and enqueues `generate-questions` with a new unique job ID
(`kitId:generate-questions:passNumber`). This prevents BullMQ from deduplicating
the second enqueue against the first. The domain-level pass counter (`coveragePass`)
lives on the Kit document and is completely separate from BullMQ's retry attempt
counter. After MAX_COVERAGE_PASSES (currently 2), any remaining gaps are recorded
honestly in `coverage.uncovered_requirement_ids` and the pipeline proceeds.

### Boundary: Infrastructure vs. Business Logic

| Responsibility | Where it lives |
|---|---|
| Job scheduling, retries, backoff, dead-letter | BullMQ (infrastructure) |
| Pipeline sequence definition | Stage Registry (infrastructure) |
| Generic job execution loop | Worker (infrastructure) |
| Stage transition guards (atomic claim, next-stage enqueue) | Worker + enqueueNextStage (infrastructure) |
| Durable state and intermediate results | MongoDB Kit document (infrastructure) |
| SSE event delivery | progress.sse.js (infrastructure) |
| LLM calls, web crawling, prompt construction | Stage Handlers (business logic) |
| Requirement extraction, question generation, brief generation | Stage Handlers (business logic) |
| Coverage gap computation | checkCoverage stage handler (business logic) |
| Schedule allocation algorithm | buildSchedule stage handler (business logic) |
| Appendix A assembly and validation | validateAndFinalize stage handler (business logic) |

---

## 2. DESIGN DECISIONS

**Stage-per-job (not one monolithic job)**
Each pipeline stage is an independent BullMQ job with its own retry budget. If
`generate-questions` fails, only that stage retries — the crawl, brief, and
requirement extraction results already persisted to MongoDB are untouched. A
monolithic job would restart the entire 90-second pipeline on every transient
LLM failure.

**Single BullMQ queue, stages differentiated by job name**
One queue with named job types (stage names) rather than a separate queue per
stage. Operationally simpler: one queue to monitor, one worker process to deploy.
Per-stage retry configuration is passed at enqueue time via `jobOptions`, so the
flexibility of separate queues is preserved without the operational overhead.

**Stage Registry pattern**
The worker is generic; the pipeline shape lives in a single registry object. This
keeps the worker stable as the pipeline evolves — adding, removing, or reordering
a stage is a one-line registry change. The alternative (a switch/case in the
worker) would couple pipeline logic to infrastructure code.

**`{ kitId }` only as job payload**
Jobs carry only the kit ID. All inputs are read from MongoDB by the stage handler.
This keeps job payloads small, makes jobs trivially resumable after a restart, and
means the job queue never holds sensitive data (the JD text, company URL). The
trade-off is one extra MongoDB read per stage, which is acceptable given stage
durations of seconds to minutes.

**MongoDB as durable state; Redis as ephemeral execution state**
MongoDB is the single source of truth for kit state and results. Redis/BullMQ is
the execution engine. If Redis is flushed, the reconciler can reconstruct the
execution state from MongoDB. The inverse is not true — MongoDB must not be lost.
This separation means the queue can be treated as disposable infrastructure.

**Per-stage retry configuration (not uniform)**
LLM stages get 3 attempts with exponential backoff (5s base) because transient
rate-limit failures are expected. The network/crawl stage gets 2 attempts with a
longer backoff (10s base) to avoid hammering slow sites. Deterministic stages
(coverage check, schedule build, validation) get 1 attempt — if they throw, it
is a code bug, not a transient failure, and retrying the same code won't fix it.
Surfacing bugs immediately is more useful than masking them with retries.

**Deterministic coverage checking and schedule allocation (never LLM)**
Coverage checking compares requirement IDs against `question.requirement_ids`
arrays — pure set arithmetic. Schedule allocation distributes questions across
days by priority and difficulty — pure sorting and bucketing. The brief explicitly
requires these to be application code decisions, not model decisions. LLMs are
non-deterministic and would produce inconsistent, uncheckable output for these
two operations.

**Promise.allSettled for research sub-operations**
Inside `research-company`, crawling the company site and searching public
discussion forums run concurrently via `Promise.allSettled`. These two have no
dependency on each other and together take the longest of any single stage. If
one fails (e.g., the company site returns 403), the other's result is still used.
`Promise.all` would fail the entire stage if either sub-operation fails, losing
whatever the other found. `allSettled` treats partial research results as an
honest, acceptable outcome rather than a pipeline failure.

**Idempotency on every stage handler**
Every handler checks whether its output already exists in `results.*` before doing
work. If it does, it returns immediately. This makes handlers safe to run twice:
on a BullMQ retry after a transient post-write failure, on a duplicate job from a
race condition, or during development when re-running a kit manually. Without this,
a retry after a successful write-but-failed-acknowledgement would duplicate LLM
calls and corrupt `results.questions` by appending to an existing array.

**Atomic stage transition (`pending → running`)**
The worker claims a stage with `findOneAndUpdate({ status: 'pending' })`. If two
worker instances (or a retry overlapping a slow-running attempt) both try to claim
the same stage, only one wins — the other sees `null` and exits. This prevents
duplicate work without requiring a distributed lock service. The `currentStage`
field serves a similar guard when enqueueing the next stage: only the worker that
atomically advances `currentStage` from the completed stage's name is allowed to
enqueue the next job.

**Unique job IDs including pass number (`kitId:stageName:passNumber`)**
BullMQ deduplicates jobs by job ID. If `generate-questions` runs twice (initial
pass + gap-fill re-entry), the second enqueue must have a different job ID or
BullMQ silently drops it. Appending the coverage pass number ensures each
re-entry gets a unique ID. Non-looping stages always use pass number 0.

**SSE for progress (not polling)**
Server-Sent Events push stage transitions to the frontend as they happen, with no
polling overhead. The alternative (polling `GET /api/kits/:id`) would work but
adds unnecessary requests during a 60–90 second generation. SSE is unidirectional
(server → client), which is all that's needed here. WebSockets would be heavier
infrastructure for no additional benefit.

**Stalled status + startup reconciler (not full outbox)**
If a stage completes in MongoDB but the subsequent Redis enqueue fails (Redis
briefly unavailable), the kit is marked `stalled`. On next server startup, the
reconciler finds kits in `queued` or `stalled` state older than 5 minutes and
re-enqueues the current stage. This is not a transactional outbox (which would
require an outbox collection and a separate relay process), but it provides
durable recovery with substantially less complexity. The window of vulnerability
is the time between the crash and the next server restart.

---

## 3. ASSUMPTIONS

**Deployment model**
A single backend process runs both the Express HTTP server and the BullMQ worker.
The worker is started by importing `queue/worker.js` in `app.js`. This is
intentional for the assessment — a production system would separate the worker
into its own process or container.

**Single worker instance**
The atomic stage-claim guard and job-ID deduplication protect against accidental
concurrency, but the design assumes one active worker process. The system is
correct with multiple workers (the guards hold), but SSE progress events are
in-memory and would not be delivered cross-process.

**Redis availability**
Redis is assumed to be available and healthy during normal operation. Short Redis
outages are recoverable via the startup reconciler. Extended Redis loss (longer
than a server restart cycle) could result in kits remaining in `stalled` state
until the reconciler runs again on next startup. Redis is treated as ephemeral —
no kit state is permanently lost if Redis is flushed, because MongoDB holds the
durable state.

**MongoDB is the source of durable application state**
All kit inputs, intermediate results, and final output live in MongoDB. If Redis
is lost and rebuilt, the reconciler can reconstruct which jobs need to be
re-enqueued from MongoDB alone. MongoDB availability is a hard dependency — if
MongoDB is down, the pipeline cannot run at all.

**Sequential stage progression per kit**
Each kit progresses through stages one at a time. There is no parallelism across
stages for a single kit. The only intra-kit concurrency is inside `research-company`,
which runs two sub-operations concurrently within a single job. This is intentional
— stage outputs feed into subsequent stages, and parallelising across stages would
require a more complex dependency graph (e.g., Temporal, Airflow).

**Research sub-operations are independent**
Crawling the company site and searching public discussion forums are assumed to
have no dependency on each other and to produce results that can be used
independently. If either fails, the other's result is used in full. This is the
basis for using `Promise.allSettled` rather than sequential awaits.

**LLM provider behaviour**
The LLM provider is assumed to return valid JSON when instructed to, most of the
time. Transient failures (rate limits, 5xx errors) are handled by BullMQ retries
with exponential backoff. Persistent invalid JSON from the provider (malformed
response, incomplete generation) is a stage failure that will exhaust retries and
mark the stage failed. Prompt engineering to elicit well-structured JSON is the
responsibility of the LLM client layer (`llm/llmClient.js`), not the queue layer.

**Worker concurrency and LLM rate limits**
Worker concurrency is set to 3, meaning up to 3 stage jobs run simultaneously
across all kits. The primary bottleneck is the LLM provider's free-tier
tokens-per-minute limit, not CPU or memory. Concurrency of 3 is a conservative
estimate — if TPM limits are hit frequently, this should be lowered to 1 or 2.
The LLM client layer is responsible for handling provider-level rate-limit
responses (429s) before they reach the stage handler as exceptions.

**Coverage pass limit**
Two coverage gap-fill passes (MAX_COVERAGE_PASSES = 2) are assumed to be
sufficient for the assessment's job descriptions. This means the pipeline makes
at most 3 question-generation calls per kit (1 initial + 2 gap-fill). If a kit
still has uncovered must-have requirements after 2 passes, the gaps are recorded
honestly and the pipeline continues — a kit with uncovered requirements is
considered an honest output, not a failure.

---

## 4. NOT HANDLED / V2

**Multi-instance SSE / shared event bus**
`progress.sse.js` stores active SSE connections in a process-local `Map`. If the
backend scales to multiple instances, a progress event emitted by worker instance A
will not reach a client connected to instance B. Fix in V2: replace the in-memory
Map with Redis pub/sub — the worker publishes events to a Redis channel, and all
HTTP instances subscribe and forward to their local SSE clients.

**Transactional outbox for stage transitions**
The current implementation advances `currentStage` in MongoDB and then enqueues
the next job in Redis as two separate operations. If Redis fails between these two
steps, the kit is marked `stalled` and recovered on next server startup. This is
not atomic. A proper outbox pattern would write the pending job to an outbox
collection in the same MongoDB transaction as the stage transition, with a separate
relay process moving outbox entries to BullMQ. Not implemented; current recovery
window is bounded by server restart frequency.

**Automatic background reconciliation**
The reconciler runs once at server startup. Kits that become stuck after startup
(e.g., Redis goes down mid-run and comes back) will not be recovered until the
next server restart. V2: run the reconciler on a periodic interval (e.g., every
5 minutes) as a background task.

**Distributed locking beyond current idempotency**
The atomic `findOneAndUpdate` guards prevent most duplicate work, but they rely on
MongoDB's document-level atomicity. There is no application-level distributed lock
(e.g., Redlock). In adversarial concurrency scenarios (many workers, rapid restarts),
the current guards are sufficient but not mathematically guaranteed to prevent all
double-processing. Accepted trade-off for this assessment.

**Kit-level cancellation**
There is no mechanism to cancel an in-progress kit. A kit in `generating` state
will run to completion (or failure) regardless of user action. V2: add a
`cancelled` status, check it at the start of each stage handler, and have BullMQ
drain the remaining jobs for that kit.

**Per-user queue fairness**
All kits from all users share a single queue with FIFO ordering. A user who
submits many kits simultaneously will consume worker concurrency and delay other
users' kits. V2: weighted fair queuing per user, or a separate queue per user
with shared worker pool.

**Stage-level regeneration via the queue**
The current design assumes full pipeline runs only. The brief requires users to
regenerate individual sections (e.g., regenerate only the company brief without
re-running the full pipeline). This is not yet wired into the queue layer — a
partial-pipeline re-run would need to enqueue from an arbitrary stage rather than
always from `extract-requirements`, and would need to preserve existing results.*
fields for stages not being regenerated.

**Advanced LLM failure handling**
The queue layer delegates LLM error handling to `llm/llmClient.js`. Currently,
any exception from the LLM client causes the stage to fail and BullMQ to retry.
There is no distinction at the queue layer between a retryable rate-limit error and
a non-retryable invalid-response error. V2: the LLM client could throw typed errors
that the worker inspects to decide whether to retry or fail-fast.

**Metrics and observability**
There is no instrumentation beyond `console.log` statements. BullMQ provides a
built-in dashboard (Bull Board) and metrics hooks that are not configured. V2: add
Bull Board for queue visibility, and emit structured logs with stage name, kit ID,
duration, and attempt number for each transition.