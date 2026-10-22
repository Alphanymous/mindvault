/** Reusable prompt helpers: {{variable}} placeholders. */

const VAR_RE = /\{\{\s*([A-Za-z_][\w -]{0,40}?)\s*\}\}/g

export function promptVariables(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

export function fillPrompt(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string) => (values[name] ? values[name] : whole))
}

/** Strip frontmatter so what is copied is only the prompt body. */
export function promptBody(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}
