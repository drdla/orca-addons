// Lets plain Node (22.18+, which strips TypeScript types) run the plugin's modules outside Orca,
// for the live smoke script (src/smoke). They import each other without extensions
// (`'../seams/gitlab'`), as Orca's loader allows, so a relative specifier that doesn't resolve
// is retried with `.ts`, `.tsx` and `/index.ts`.
import { registerHooks } from 'node:module'

const SUFFIXES = ['.ts', '.tsx', '/index.ts']

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.')) throw error
      for (const suffix of SUFFIXES) {
        try {
          return nextResolve(specifier + suffix, context)
        } catch {
          // try the next suffix
        }
      }
      throw error
    }
  }
})
