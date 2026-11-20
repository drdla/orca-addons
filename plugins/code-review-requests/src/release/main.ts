// Called by scripts/release.sh: `node … src/release/main.ts <orca-catalog.json> <release-entry.json>`,
// where the second file holds the output of `orca plugin release-entry <dir> --json`. Writes the
// merged catalog back in place. Never loaded by the plugin.
import { readFileSync, writeFileSync } from 'node:fs'
import { mergeRelease, type ReleaseEntryResult } from './catalog'

const [catalogPath, entryPath] = process.argv.slice(2)
if (!catalogPath || !entryPath) {
  console.error('usage: main.ts <orca-catalog.json> <release-entry.json>')
  process.exit(2)
}
try {
  const output = JSON.parse(readFileSync(entryPath, 'utf8')) as { ok: boolean; result: ReleaseEntryResult }
  if (!output.ok) throw new Error('orca plugin release-entry failed')
  const { entry } = output.result
  const { text, replaced } = mergeRelease(readFileSync(catalogPath, 'utf8'), output.result)
  writeFileSync(catalogPath, text)
  if (replaced === null) console.log(`Added release ${entry.version} (commit ${entry.commit}).`)
  else if (replaced['contentHash'] === entry['contentHash'])
    console.log(`Release ${entry.version} is already listed with these files (commit ${replaced.commit}).`)
  else
    console.log(
      `Replaced release ${entry.version}: commit ${replaced.commit} -> ${entry.commit}.\n` +
        'Installs of the old commit see no newer version; raise the version instead if anyone installed it.'
    )
} catch (error) {
  console.error(`Couldn't update ${catalogPath}: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
