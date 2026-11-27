// Release tooling (scripts/release.sh), never loaded by the plugin: merges the release that
// `orca plugin release-entry --json` printed into the repo's orca-catalog.json.

/** One `releases` entry, exactly as `orca plugin release-entry` printed it. */
export type CatalogRelease = { version: string; commit: string; [key: string]: unknown }

/** The `result` of `orca plugin release-entry <dir> --json`. */
export type ReleaseEntryResult = { pluginKey: string; sourcePath: string | null; entry: CatalogRelease }

/** The most releases Orca accepts for one catalog plugin; older ones beyond it are dropped. */
export const MAX_RELEASES = 32

type CatalogPlugin = { id: string; source: { path?: string }; releases: CatalogRelease[] }
type Catalog = { plugins: CatalogPlugin[] }

/**
 * Puts `result.entry` first in the releases of the catalog plugin whose `source.path` is
 * `result.sourcePath` and whose id ends in the same manifest id, dropping a release of the same
 * version (so a re-run replaces rather than duplicates; one with the same content hash is kept
 * as it is), and dropping the oldest releases past MAX_RELEASES, which Orca would refuse. Returns
 * the catalog as text, printed the way the committed file is, the release it replaced and the
 * releases it dropped.
 */
export function mergeRelease(
  catalogText: string,
  result: ReleaseEntryResult
): { text: string; replaced: CatalogRelease | null; dropped: CatalogRelease[] } {
  const catalog = JSON.parse(catalogText) as Catalog
  const { entry, sourcePath } = result
  const plugin = catalog.plugins.find((p) => (p.source.path ?? null) === sourcePath)
  if (plugin === undefined) throw new Error(`orca-catalog.json has no plugin with "source.path": ${JSON.stringify(sourcePath)}`)
  const manifestId = result.pluginKey.slice(result.pluginKey.indexOf('.') + 1)
  if (!plugin.id.endsWith(`.${manifestId}`)) throw new Error(`the catalog entry ${plugin.id} is not ${manifestId}`)
  const replaced = plugin.releases.find((r) => r.version === entry.version) ?? null
  // Same files under a later commit (say, the catalog commit itself): keep the original pin.
  if (replaced !== null && replaced['contentHash'] === entry['contentHash']) return { text: catalogText, replaced, dropped: [] }
  const rest = plugin.releases.filter((r) => r !== replaced)
  const newest = rest.find((r) => compareVersions(r.version, entry.version) > 0)
  if (newest) throw new Error(`${entry.version} is older than ${newest.version}, which the catalog already lists`)
  const releases = [entry, ...rest]
  plugin.releases = releases.slice(0, MAX_RELEASES)
  return { text: `${print(catalog, 0)}\n`, replaced, dropped: releases.slice(MAX_RELEASES) }
}

/** Compares two x.y.z versions numerically (a pre-release suffix is ignored). */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('-')[0]!.split('.').map(Number)
  const [pa, pb] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

const WIDTH = 120

/** JSON, two-space indented. Objects stay expanded unless they sit in an array; an array, or an
 *  object of plain values inside one, goes on one line when that line fits in WIDTH columns. */
function print(value: unknown, indent: number, inArray = false, prefix = 0): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const pad = ' '.repeat(indent + 2)
  const end = ' '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const flat = value.every((v) => v === null || typeof v !== 'object' || isFlatObject(v))
    const oneLine = `[${value.map((v) => print(v, 0, true, Infinity)).join(', ')}]`
    if (flat && indent + prefix + oneLine.length <= WIDTH) return oneLine
    return `[\n${value.map((v) => pad + print(v, indent + 2, true)).join(',\n')}\n${end}]`
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  if (inArray && isFlatObject(value)) {
    const oneLine = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`
    if (prefix === Infinity || indent + 2 + oneLine.length <= WIDTH) return oneLine
  }
  const lines = entries.map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `
    return pad + key + print(v, indent + 2, false, key.length + 1)
  })
  return `{\n${lines.join(',\n')}\n${end}}`
}

function isFlatObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => v === null || typeof v !== 'object')
  )
}
