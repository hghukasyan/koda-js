/**
 * KODA decoder worker. Runs in a Worker Thread; loads native addon or uses JS fallback.
 * Receives binary buffer (transferable), decodes, posts result. Keeps main thread non-blocking.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';
import type { KodaValue } from '../ast.js';
import { decode as decodeJS } from '../decoder.js';
import type { DecodeOptions } from '../decoder.js';
import { loadNative, type NativeBinding } from '../native.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const addonPath = join(__dirname, '..', '..', 'build', 'Release', 'koda_js.node');

let cachedNative: NativeBinding | null | undefined = undefined;

function getNative(): NativeBinding | null {
  if (cachedNative !== undefined) return cachedNative;
  cachedNative = loadNative(import.meta.url, addonPath);
  return cachedNative;
}

export interface DecoderWorkerMessageIn {
  id: number;
  buffer: ArrayBuffer;
  options?: DecodeOptions;
}

export interface DecoderWorkerMessageOutSuccess {
  id: number;
  value: KodaValue;
}

export interface DecoderWorkerMessageOutError {
  id: number;
  error: string;
}

function doDecode(buffer: ArrayBuffer, options?: DecodeOptions): KodaValue {
  const buf = Buffer.from(buffer);
  const binding = getNative();
  if (binding) {
    return binding.decode(buf, {
      maxDepth: options?.maxDepth,
      maxDictionarySize: options?.maxDictionarySize,
      maxStringLength: options?.maxStringLength,
    }) as KodaValue;
  }
  return decodeJS(new Uint8Array(buffer), options);
}

parentPort!.on('message', (msg: DecoderWorkerMessageIn) => {
  const { id, buffer, options } = msg;
  try {
    const value = doDecode(buffer, options);
parentPort!.postMessage({ id, value } as DecoderWorkerMessageOutSuccess);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort!.postMessage({ id, error: message } as DecoderWorkerMessageOutError);
  }
});
