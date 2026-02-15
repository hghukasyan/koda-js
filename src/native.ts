/**
 * Load the C++ native addon if available. Used for fast parse/stringify/encode/decode.
 * Falls back to JS implementation when addon is not built.
 */

import { createRequire } from 'node:module';

export interface NativeBinding {
  parse(text: string, options?: { maxDepth?: number }): unknown;
  stringify(value: unknown): string;
  encode(value: unknown, options?: { maxDepth?: number }): Buffer;
  decode(buffer: Buffer, options?: { maxDepth?: number; maxDictionarySize?: number; maxStringLength?: number }): unknown;
}

let cached: NativeBinding | null | undefined = undefined;

/**
 * Return the native binding if the addon was built, otherwise null.
 * @param callerUrl - URL of the calling module (e.g. import.meta.url) for resolve context
 * @param addonPath - Path to koda_js.node
 */
export function loadNative(callerUrl: string, addonPath: string): NativeBinding | null {
  if (cached !== undefined) return cached;
  try {
    const req = createRequire(callerUrl);
    const binding = req(addonPath) as NativeBinding;
    if (
      typeof binding.parse === 'function' &&
      typeof binding.stringify === 'function' &&
      typeof binding.encode === 'function' &&
      typeof binding.decode === 'function'
    ) {
      cached = binding;
      return cached;
    }
  } catch {
    // Addon not built or load failed
  }
  cached = null;
  return null;
}
