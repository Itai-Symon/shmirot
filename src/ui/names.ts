/** Split pasted text into clean, unique names (one per line; also accepts commas). */
export function parseNames(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n,;]+/)) {
    const name = raw
      .replace(/^[\s\d.)\-–•*]+/, '') // strip list numbering / bullets
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
