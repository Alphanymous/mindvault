import { fillPrompt, promptBody, promptVariables } from '../core/prompts'
import type { Item } from '../core/types'
import { getUsage, recordPromptUse } from '../data/usage'
import { copyText } from './util'

export type QuickCopyResult = 'copied' | 'needs-input' | 'failed'

/**
 * One-tap copy. Variables are filled from the answers remembered on this device;
 * if some are unknown the caller should open the prompt so the user can fill them in.
 */
export async function quickCopyPrompt(item: Item): Promise<QuickCopyResult> {
  const body = promptBody(item.content)
  const memory = getUsage().vars
  if (promptVariables(body).some((v) => !memory[v])) return 'needs-input'
  const ok = await copyText(fillPrompt(body, memory))
  if (ok) recordPromptUse(item.id)
  return ok ? 'copied' : 'failed'
}

/** Prompts ordered for a shelf: pinned first, then by use count and recency. */
export function rankPrompts(items: Item[], stats: Record<string, { count: number; last: number }>): Item[] {
  return items
    .filter((i) => !i.deleted && i.type === 'prompt' && i.status === 'organized')
    .sort((a, b) => {
      const pin = Number(!!b.pinned) - Number(!!a.pinned)
      if (pin) return pin
      const ca = stats[a.id]?.count ?? 0
      const cb = stats[b.id]?.count ?? 0
      return cb - ca || (stats[b.id]?.last ?? b.updatedAt) - (stats[a.id]?.last ?? a.updatedAt)
    })
}
