import type { Item, ItemType, Suggestion } from './types'
import { firstHeading, frontmatterTags, parseFrontmatter, parseInlineTags, titleFromFileName, words } from './markdown'

/** Topic dictionary: folder name -> trigger keywords (lowercase, prefix-matched). */
export const TOPICS: Record<string, string[]> = {
  'Dev/Code': [
    'code', 'function', 'api', 'javascript', 'typescript', 'python', 'rust', 'react', 'node', 'git', 'github',
    'database', 'sql', 'docker', 'deploy', 'bug', 'compiler', 'framework', 'library', 'programming', 'software',
    'algorithm', 'frontend', 'backend', 'devops', 'kubernetes', 'linux', 'terminal', 'npm', 'css', 'html',
  ],
  'AI/Machine Learning': [
    'llm', 'gpt', 'claude', 'prompt', 'neural', 'embedding', 'transformer', 'machine learning', 'deep learning',
    'model', 'training', 'inference', 'openai', 'anthropic', 'agent', 'rag', 'fine-tuning', 'diffusion', 'chatbot',
  ],
  'Research/Science': [
    'study', 'research', 'paper', 'abstract', 'hypothesis', 'experiment', 'journal', 'physics', 'biology',
    'chemistry', 'mathematics', 'theorem', 'dataset', 'peer-reviewed', 'arxiv', 'doi', 'methodology',
  ],
  'Business/Finance': [
    'revenue', 'invoice', 'budget', 'investment', 'market', 'startup', 'pricing', 'customer', 'sales', 'tax',
    'finance', 'accounting', 'profit', 'stock', 'strategy', 'marketing', 'contract', 'cashflow', 'roadmap',
    'money', 'cash', 'cost', 'price', 'expense', 'payment', 'salary', 'income', 'spend', 'quarterly',
  ],
  'Health/Fitness': [
    'health', 'workout', 'exercise', 'diet', 'nutrition', 'sleep', 'medical', 'doctor', 'symptom', 'protein',
    'fitness', 'meditation', 'therapy', 'calorie',
  ],
  'Design/Creative': [
    'design', 'typography', 'color', 'palette', 'figma', 'ux', 'ui', 'layout', 'illustration', 'brand',
    'photography', 'video', 'animation', 'logo', 'mockup',
  ],
  'Learning/Education': [
    'course', 'tutorial', 'lesson', 'learn', 'syllabus', 'lecture', 'exam', 'study guide', 'curriculum',
    'beginner', 'guide', 'how to', 'notes on',
  ],
  'Writing/Content': [
    'article', 'essay', 'blog', 'draft', 'outline', 'newsletter', 'copywriting', 'headline', 'story', 'script',
  ],
  'Personal/Life': [
    'travel', 'recipe', 'home', 'family', 'shopping', 'journal', 'diary', 'goal', 'habit', 'todo', 'plan',
    'birthday', 'trip', 'budgeting',
  ],
  'Legal/Admin': ['legal', 'policy', 'terms', 'agreement', 'compliance', 'gdpr', 'license', 'visa', 'passport', 'insurance'],
}

export const STOPWORDS = new Set(
  (
    'a about above after again all also am an and any are as at be because been before being below between both but ' +
    'by can could did do does doing down during each few for from further had has have having he her here hers ' +
    'him his how i if in into is it its just me more most my no nor not now of off on once only or other our out ' +
    'over own same she should so some such than that the their them then there these they this those through to ' +
    'too under until up very was we were what when where which while who whom why will with would you your ' +
    'de la el en los las un una y que es por con para del se su al lo como mas pero sus le ya o fue este ha si ' +
    'porque esta son entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno ' +
    'um uma os as dos das em no na nos nas por para com que e é mais como mas foi ao ele das tem à seu sua ou ser ' +
    'quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem ' +
    'http https www com html htm php amp nbsp page click share new one two use used using get also may will can ' +
    'like make made way well even many much say said see time year years need want find first last back'
  ).split(/\s+/),
)

export interface ClassifyInput {
  title?: string
  content: string
  url?: string
  fileName?: string
  mime?: string
  /** Type already known by the importer (e.g. PDF import). */
  forcedType?: ItemType
}

export interface ClassifyContext {
  /** Existing organized items, used to learn from the user's own folders and tags. */
  items?: Item[]
}

const PROMPT_START_RE =
  /^\s*(you are|you're|act as|acting as|imagine you|pretend (to be|you)|your task|as an? [a-z ]{3,40},|write (me )?an? |create an? |generate |summari[sz]e |translate |explain |eres |actúa|actua como|você é|aja como)/i

export function detectType(input: ClassifyInput): { type: ItemType; reason: string } {
  if (input.forcedType) return { type: input.forcedType, reason: 'known from import' }
  const name = (input.fileName ?? '').toLowerCase()
  const mime = (input.mime ?? '').toLowerCase()
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return { type: 'pdf', reason: 'PDF file' }
  if (input.url && /^https?:\/\//i.test(input.url)) return { type: 'web', reason: 'has a web link' }
  const title = (input.title ?? '').toLowerCase()
  const body = parseFrontmatter(input.content).body
  const fm = parseFrontmatter(input.content).data
  if (fm.type === 'prompt' || fm.prompt === 'true') return { type: 'prompt', reason: 'frontmatter says prompt' }
  if (looksLikePrompt(title, body)) return { type: 'prompt', reason: 'reads like an AI prompt' }
  if (/^https?:\/\/\S+$/i.test(input.content.trim())) return { type: 'web', reason: 'text is a single link' }
  if (name && !/\.(md|markdown|txt)$/.test(name)) return { type: 'file', reason: 'non-text file' }
  return { type: 'note', reason: 'plain text / markdown' }
}

export function looksLikePrompt(title: string, body: string): boolean {
  const t = title.toLowerCase()
  if (/\bprompts?\b/.test(t) || /\bsystem message\b/.test(t)) return true
  const text = body.trim()
  if (text.length < 12 || text.length > 8000) return false
  if (PROMPT_START_RE.test(text)) return true
  const placeholders = (text.match(/\{\{[^}]+\}\}|\[[A-Z][A-Z _]{2,}\]/g) ?? []).length
  if (placeholders >= 1 && /\b(you|your|write|act|respond|answer)\b/i.test(text)) return true
  const imperative = /\b(step by step|do not|don't|output format|respond with|return only|few-shot|constraints?:)\b/i.test(text)
  return imperative && /^\s*(you|your|write|act|create|generate)/i.test(text)
}

/** Top keywords by frequency, filtered for stopwords and short tokens. */
export function extractKeywords(text: string, limit = 5): string[] {
  const freq = new Map<string, number>()
  for (const w of words(text)) {
    if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w)
}

interface TopicScore {
  folder: string
  score: number
  hits: string[]
}

export function scoreTopics(text: string, title: string): TopicScore[] {
  const hay = ` ${title.toLowerCase()} ${title.toLowerCase()} ${text.toLowerCase().slice(0, 20000)} `
  const tokens = words(hay)
  const tokenSet = new Map<string, number>()
  for (const t of tokens) tokenSet.set(t, (tokenSet.get(t) ?? 0) + 1)
  const result: TopicScore[] = []
  for (const [folder, kws] of Object.entries(TOPICS)) {
    let score = 0
    const hits: string[] = []
    for (const kw of kws) {
      let count = 0
      if (kw.includes(' ')) {
        let idx = hay.indexOf(kw)
        while (idx !== -1 && count < 5) {
          count++
          idx = hay.indexOf(kw, idx + kw.length)
        }
      } else {
        count = Math.min(tokenSet.get(kw) ?? 0, 5)
      }
      if (count > 0) {
        score += 1 + Math.log2(count)
        hits.push(kw)
      }
    }
    if (score > 0) result.push({ folder, score, hits })
  }
  return result.sort((a, b) => b.score - a.score)
}

function domainOf(url?: string): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/** Find an existing user folder whose tags/titles overlap with this item's vocabulary. */
function learnedFolder(tags: string[], keywords: string[], items: Item[]): { folder: string; score: number } | null {
  const vocab = new Set([...tags, ...keywords])
  if (vocab.size === 0) return null
  const scores = new Map<string, number>()
  for (const it of items) {
    if (it.deleted || it.status !== 'organized' || !it.folder) continue
    let overlap = 0
    for (const t of it.tags) if (vocab.has(t)) overlap++
    if (overlap) scores.set(it.folder, (scores.get(it.folder) ?? 0) + overlap)
  }
  let best: { folder: string; score: number } | null = null
  for (const [folder, score] of scores) if (!best || score > best.score) best = { folder, score }
  return best && best.score >= 2 ? best : null
}

export function classify(input: ClassifyInput, ctx: ClassifyContext = {}): Suggestion {
  const { type, reason: typeReason } = detectType(input)
  const fm = parseFrontmatter(input.content)
  const title =
    input.title?.trim() ||
    firstHeading(input.content) ||
    (input.fileName ? titleFromFileName(input.fileName) : '') ||
    'Untitled'

  // --- folder ---
  let folder = typeof fm.data.folder === 'string' ? fm.data.folder : ''
  let folderReason = ''
  let confidence = 0.35
  const topics = scoreTopics(fm.body, title)
  const keywords = extractKeywords(fm.body, 6)
  const explicitTags = [...frontmatterTags(fm), ...parseInlineTags(fm.body)]

  if (folder) {
    folderReason = 'folder set in frontmatter'
    confidence = 0.95
  } else {
    const learned = learnedFolder([...explicitTags, ...keywords], keywords, ctx.items ?? [])
    const top = topics[0]
    if (learned) {
      folder = learned.folder
      folderReason = `matches your folder "${learned.folder}"`
      confidence = Math.min(0.9, 0.55 + learned.score * 0.08)
    } else if (top && top.score >= 2) {
      folder = top.folder
      folderReason = `mentions ${top.hits.slice(0, 3).join(', ')}`
      const second = topics[1]?.score ?? 0
      confidence = Math.min(0.85, 0.4 + (top.score - second) * 0.06 + Math.min(top.score, 8) * 0.03)
    } else if (type === 'prompt') {
      folder = 'AI/Prompts'
      folderReason = 'prompt'
      confidence = 0.7
    }
  }
  if (type === 'prompt' && !folder.startsWith('AI')) {
    // Prompts live together so "one-click copy" is easy to find.
    folder = 'AI/Prompts'
    folderReason = 'prompts are grouped together'
    confidence = Math.max(confidence, 0.75)
  }
  if (!folder) {
    folder = type === 'web' ? 'Reading' : type === 'pdf' ? 'Documents' : type === 'file' ? 'Files' : 'Notes'
    folderReason = `default for ${type}`
    confidence = 0.3
  }

  // --- tags ---
  const tags = new Set<string>(explicitTags)
  const domain = domainOf(input.url)
  if (domain) tags.add(domain.split('.').slice(-2, -1)[0] ?? domain)
  if (type === 'prompt') tags.add('prompt')
  if (topics[0] && topics[0].score >= 2) for (const h of topics[0].hits.slice(0, 2)) tags.add(h.replace(/\s+/g, '-'))
  for (const k of keywords) {
    if (tags.size >= 6) break
    tags.add(k)
  }

  return {
    type,
    folder,
    tags: [...tags].slice(0, 6),
    confidence: Math.round(confidence * 100) / 100,
    reason: [typeReason, folderReason].filter(Boolean).join(' · '),
  }
}

/** Optional LLM refinement. Any failure falls back to the rule-based suggestion. */
export interface LlmConfig {
  endpoint: string
  model: string
  apiKey: string
}

export async function refineWithLlm(
  base: Suggestion,
  input: ClassifyInput,
  existingFolders: string[],
  cfg: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Suggestion> {
  if (!cfg.endpoint) return base
  try {
    const sample = input.content.slice(0, 3000)
    const res = await fetchImpl(cfg.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Classify the document for a personal knowledge base. Reply with JSON only: ' +
              '{"folder": string (prefer one of the existing folders), "tags": string[] (max 6, lowercase), "type": "note"|"prompt"|"web"|"pdf"|"file"}.',
          },
          {
            role: 'user',
            content: `Existing folders: ${existingFolders.join(', ') || '(none)'}\nTitle: ${input.title ?? ''}\nURL: ${input.url ?? ''}\n\n${sample}`,
          },
        ],
      }),
    })
    if (!res.ok) return base
    const json = await res.json()
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? '{}')
    const folder = typeof parsed.folder === 'string' && parsed.folder.trim() ? parsed.folder.trim() : base.folder
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t: unknown): t is string => typeof t === 'string').map((t: string) => t.toLowerCase().trim()).filter(Boolean).slice(0, 6)
      : base.tags
    const type: ItemType = ['note', 'prompt', 'web', 'pdf', 'file'].includes(parsed.type) && !input.forcedType ? parsed.type : base.type
    return { type, folder, tags: tags.length ? tags : base.tags, confidence: Math.max(base.confidence, 0.8), reason: 'refined by AI' }
  } catch {
    return base
  }
}
