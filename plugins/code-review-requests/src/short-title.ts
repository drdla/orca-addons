// A card's merge request title, cut to about two lines.

/**
 * About two lines of title at the panel's usual width. Orca's Text clamps to one line at most
 * (`truncate`), so longer titles are cut by characters instead, at a word where one is near.
 */
export const TITLE_MAX = 80

export function shortTitle(title: string, max = TITLE_MAX): string {
  if (title.length <= max) return title
  const cut = title.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space >= max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
