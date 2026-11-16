// Test helper: compares the *shape* of two JSON values (key sets and value types, not values),
// so the fakes can be pinned to the sanitized real captures without copying their contents.

/**
 * Lists where `actual` does not fit the shape of `real`: a key `real` lacks, or a value of
 * another type. `null` on either side fits anything (GitLab and Orca send null for unset
 * fields), as does an empty array. Array elements are each checked against every element of
 * the other side merged into one shape. With `exact`, keys `real` has but `actual` lacks are
 * reported too.
 */
export function shapeMismatches(
  actual: unknown,
  real: unknown,
  options: { exact?: boolean } = {},
  path = '$'
): string[] {
  if (actual === null || real === null || actual === undefined) return []
  if (Array.isArray(actual) || Array.isArray(real)) {
    if (!Array.isArray(actual) || !Array.isArray(real)) return [`${path}: ${kind(actual)} vs ${kind(real)}`]
    if (actual.length === 0 || real.length === 0) return []
    const merged = mergeAll(real)
    return actual.flatMap((item, i) => shapeMismatches(item, merged, options, `${path}[${i}]`))
  }
  if (kind(actual) !== kind(real)) return [`${path}: ${kind(actual)} vs ${kind(real)}`]
  if (kind(actual) !== 'object') return []
  const a = actual as Record<string, unknown>
  const r = real as Record<string, unknown>
  const problems = Object.keys(a).flatMap((key) =>
    key in r ? shapeMismatches(a[key], r[key], options, `${path}.${key}`) : [`${path}.${key}: not in the capture`]
  )
  if (options.exact) {
    for (const key of Object.keys(r)) if (!(key in a)) problems.push(`${path}.${key}: missing`)
  }
  return problems
}

function kind(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
}

/** Merges objects in an array so one element holds every key seen (first non-null value wins). */
function mergeAll(items: unknown[]): unknown {
  const objects = items.filter((i) => kind(i) === 'object') as Record<string, unknown>[]
  if (objects.length !== items.length) return items.find((i) => i !== null) ?? null
  const merged: Record<string, unknown> = {}
  for (const o of objects) for (const [k, v] of Object.entries(o)) if (merged[k] == null) merged[k] = v
  return merged
}
