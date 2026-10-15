/**
 * cls — className joiner. Drops false/null/undefined so conditional classes
 * stay readable inline (avoids pulling in clsx as a dependency).
 */
export function cls(...parts) {
  return parts
    .flat(Infinity)
    .filter((p) => typeof p === 'string' && p.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export default cls
