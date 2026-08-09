import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * True when the given module is the process entry point. Lets a module double as both an
 * importable function and a `npm run` script without a separate wrapper file.
 */
export function isMainModule(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return importMetaUrl === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
