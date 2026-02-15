/**
 * KODA — Compact Object Data Architecture
 * Text (.koda) and canonical binary (.kod) format.
 * Uses C++ native addon when built for best size and speed; falls back to JS.
 * @module koda-js
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KodaValue } from './ast.js';
import { decode as decodeBinary } from './decoder.js';
import type { DecodeOptions } from './decoder.js';
import { encode as encodeBinary } from './encoder.js';
import type { EncodeOptions } from './encoder.js';
import { KodaDecodeError, KodaParseError } from './errors.js';
import { loadNative, type NativeBinding } from './native.js';
import { parseFast } from './parseFast.js';
import { parse as parseWithLexer } from './parser.js';
import type { ParseOptions } from './parser.js';
import { decodeAsync } from './decode-async.js';
import { stringify as stringifyText } from './stringify.js';
import type { StringifyOptions } from './stringify.js';

export type { KodaValue, KodaObject, KodaArray, SourcePosition } from './ast.js';
export { isKodaObject, isKodaArray, isKodaString, isKodaNumber, isKodaBoolean, isKodaNull } from './ast.js';
export { KodaError, KodaParseError, KodaEncodeError, KodaDecodeError } from './errors.js';
export type { ParseOptions } from './parser.js';
export type { StringifyOptions } from './stringify.js';
export type { EncodeOptions } from './encoder.js';
export type { DecodeOptions } from './decoder.js';
export { decodeAsync, createDecoderPool } from './decode-async.js';
export type { DecoderPool, DecoderPoolOptions } from './decode-async.js';
export { createEncodeStream, createDecodeStream } from './streams.js';
export type { EncodeStreamOptions, DecodeStreamOptions } from './streams.js';

const _addonPath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'build', 'Release', 'koda_js.node');

function getNative(): NativeBinding | null {
  return loadNative(import.meta.url, _addonPath);
}

/** True if the C++ native addon is in use. */
export function isNativeAvailable(): boolean {
  return getNative() !== null;
}

/**
 * Parse KODA text (.koda) into a value.
 * Uses native C++ implementation when addon is built (faster, better for huge files).
 */
export function parse(text: string, options?: ParseOptions): KodaValue {
  const native = getNative();
  if (native) {
    try {
      return native.parse(text, { maxDepth: options?.maxDepth }) as KodaValue;
    } catch (e) {
      throw e instanceof KodaParseError ? e : new KodaParseError((e as Error).message);
    }
  }
  return parseFast(text, options);
}

/**
 * Serialize a value to KODA text.
 * Uses native C++ when addon is built (unless options like indent are used).
 */
export function stringify(value: KodaValue, options?: StringifyOptions): string {
  const native = getNative();
  if (native && !options?.indent) {
    return native.stringify(value);
  }
  return stringifyText(value, options);
}

/**
 * Encode a value to canonical binary (.kod).
 * Uses native C++ when addon is built (smaller, faster, better for huge payloads).
 */
export function encode(value: KodaValue, options?: EncodeOptions): Uint8Array {
  const native = getNative();
  if (native) {
    return native.encode(value, { maxDepth: options?.maxDepth }) as Uint8Array;
  }
  return encodeBinary(value, options);
}

/**
 * Decode binary (.kod) to a value. Non-blocking: runs in a worker thread so the
 * main thread stays responsive. Prefer this over decodeSync for large payloads.
 */
export function decode(buffer: Uint8Array, options?: DecodeOptions): Promise<KodaValue> {
  return decodeAsync(buffer, options);
}

/**
 * Synchronous decode. Blocks the event loop; use sparingly or for small payloads.
 * Uses native C++ when addon is built, otherwise JS fallback.
 */
export function decodeSync(buffer: Uint8Array, options?: DecodeOptions): KodaValue {
  const native = getNative();
  if (native) {
    try {
      const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      return native.decode(buf, {
        maxDepth: options?.maxDepth,
        maxDictionarySize: options?.maxDictionarySize,
        maxStringLength: options?.maxStringLength,
      }) as KodaValue;
    } catch (e) {
      throw e instanceof KodaDecodeError ? e : new KodaDecodeError((e as Error).message);
    }
  }
  return decodeBinary(buffer, options);
}

/**
 * Load and parse a .koda text file (UTF-8).
 */
export async function loadFile(path: string, options?: ParseOptions): Promise<KodaValue> {
  const content = await readFile(path, 'utf-8');
  return parse(content, options);
}

/** Lexer-based parser (better error positions); default parse uses fast path when no native. */
export { parseWithLexer };

/**
 * Serialize a value to KODA text and write to file.
 */
export async function saveFile(path: string, value: KodaValue, options?: StringifyOptions): Promise<void> {
  const content = stringify(value, options);
  await writeFile(path, content, 'utf-8');
}

/**
 * Convert KODA value to JSON string.
 */
export function toJSON(value: KodaValue): string {
  return JSON.stringify(value);
}

/**
 * Parse JSON string to a KODA-compatible value.
 */
export function fromJSON(json: string): KodaValue {
  return JSON.parse(json) as KodaValue;
}
