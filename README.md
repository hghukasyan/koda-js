# koda-format

Compact Object Data Architecture: a structured data format with a human-readable text syntax and a canonical binary encoding. Optimized for compact storage and scalable backend processing.

[![npm version](https://img.shields.io/npm/v/koda-format.svg)](https://www.npmjs.com/package/koda-format)

## Installation

```bash
npm install koda-format
```

Requires Node.js 18 or later.

## Quick example

```ts
import { parse, stringify, encode, decode } from 'koda-format';

// Text format (.koda): key-value, optional commas, comments
const value = parse(`
  name: "my-app"
  version: 1
  enabled: true
`);

// Binary format (.kod): canonical, deterministic
const bytes = encode(value);
const decoded = await decode(bytes);
```

## When to use KODA

KODA is suited to:

- **Large payloads** — configuration, event batches, log datasets
- **Repetitive structures** — arrays of objects with repeated keys
- **Storage-heavy workloads** — databases, caches, bulk export/import
- **IO-bound systems** — smaller payloads reduce disk and network transfer
- **Backend services** — where non-blocking decode and parallel processing matter

KODA is not a drop-in replacement for JSON in all contexts. It is optimized for compact binary storage and scalable backend processing. Use JSON where interoperability, tooling, or simple string exchange are the main requirements.

## Non-blocking decode and multithreading

**Why it matters**

`JSON.parse` is synchronous: it blocks the Node.js event loop until the parse finishes. For large payloads or many concurrent requests, that can stall I/O, timers, and other work. KODA’s default binary decode is **non-blocking** and can run in **worker threads**, so the main thread stays responsive.

**How it works**

- **`decode(buffer)`** — Returns a `Promise<KodaValue>`. Each call runs decode in a separate worker thread. The main thread only schedules the job and receives the result; it does not perform the parse. Use this for normal async usage.
- **`decodeSync(buffer)`** — Synchronous decode on the main thread. Use only when you cannot use async (e.g. some legacy code paths) or for very small payloads.
- **`createDecoderPool({ poolSize })`** — Creates a fixed pool of worker threads. `pool.decode(buffer)` dispatches to a worker from the pool and returns a promise. Reusing workers avoids per-call worker startup cost and allows **parallel decoding across multiple CPU cores**. Suited to high-throughput backends (e.g. many decode requests in parallel).

**Summary**

- Non-blocking: decode work runs off the main thread; the event loop is not blocked.
- Multithreading: decoding runs in Node.js worker threads; a decoder pool uses multiple workers and cores.
- Suited to backends and batch jobs where throughput and main-thread latency matter.

## Benchmark results

Size comparison for workloads that match KODA’s design: large documents, repeated keys, and tabular data.

| Scenario | JSON | KODA binary | Reduction |
|----------|------|-------------|-----------|
| Large (500 items) | 54.4 KB | 26.2 KB | 52% |
| 1000 rows x 100 items | 10.2 MB | 4.65 MB | 54% |
| 1 document, 10k long keys | 1.55 MB | 488 KB | 68% |

The binary format stores each key once in a dictionary; documents with many repeated keys see the largest size reduction.

## Performance characteristics

**Event loop and concurrency**

`JSON.parse` is synchronous and blocks the Node.js event loop for the duration of the parse. KODA’s primary decode API is asynchronous: decoding runs in worker threads, so the main thread remains responsive. This reduces latency impact on the rest of the application.

**Parallel processing**

Decoding can be distributed across multiple worker threads. A decoder pool (`createDecoderPool`) allows many decode operations to run in parallel and use multiple CPU cores. This suits high-throughput backends and batch processing where many payloads are decoded concurrently.

**Summary**

- Non-blocking decode: work runs off the main thread.
- Parallel scalability: multiple workers and cores can be used.
- No claim is made about raw single-thread parse speed versus JSON; the advantages are non-blocking behavior and parallel scalability.

## API overview

**Text**

| Method | Description |
|--------|-------------|
| `parse(text, options?)` | Parse KODA text to a value. Options: `maxDepth`, `maxInputLength`. |
| `stringify(value, options?)` | Serialize value to KODA text. Options: `indent`, `newline`. |

**Binary**

| Method | Description |
|--------|-------------|
| `encode(value, options?)` | Encode value to canonical binary. Returns `Uint8Array`. Options: `maxDepth`. |
| `decode(buffer, options?)` | Decode binary to value. Returns `Promise<KodaValue>`. Runs in a worker thread. |
| `decodeSync(buffer, options?)` | Synchronous decode. Blocks the event loop. |
| `createDecoderPool(options?)` | Create a pool of decoder workers. Returns `{ decode, destroy }`. Options: `poolSize`. |

**Decode options:** `maxDepth`, `maxDictionarySize`, `maxStringLength`.

**Utilities**

| Method | Description |
|--------|-------------|
| `loadFile(path, options?)` | Read and parse a `.koda` file. |
| `saveFile(path, value, options?)` | Serialize and write a `.koda` file. |
| `isNativeAvailable()` | Whether the optional C++ addon is loaded. |

**Errors:** `KodaParseError`, `KodaEncodeError`, `KodaDecodeError` (with `.position` or `.byteOffset` where applicable).

Full specification (grammar, binary layout, canonicalization): [SPEC.md](https://github.com/hghukasyan/koda-format/blob/main/SPEC.md).

## Building the native addon

The package works with pure JavaScript. An optional C++ addon improves encode/decode performance when built:

```bash
npm run build
npm run build:addon
```

Requires Node.js build tools and a C++ compiler. The addon is used automatically when present.

## License

MIT

