/** "Run it now": send a filled prompt to the user's own OpenAI-compatible chat endpoint. */

export interface RunConfig {
  endpoint: string
  model: string
  apiKey: string
}

export async function runPrompt(cfg: RunConfig, prompt: string, fetchImpl: typeof fetch = fetch, timeoutMs = 120_000): Promise<string> {
  if (!cfg.endpoint) throw new Error('Add a chat endpoint in Settings → AI first.')
  const res = await fetchImpl(cfg.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`The endpoint answered ${res.status}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = json.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim()) throw new Error('The endpoint returned no text.')
  return text.trim()
}

/** Models offered as one-tap "used with" labels. */
export const MODEL_LABELS = ['ChatGPT', 'Claude', 'Gemini', 'Other'] as const
