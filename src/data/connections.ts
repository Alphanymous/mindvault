/** "Test this" buttons in Settings. Each returns a plain-language result instead of throwing. */
import { embedTexts } from '../core/embeddings'
import { failResult, okResult, type TestResult } from '../core/providers'
import { runPrompt } from '../core/promptRun'
import { fetchHtmlWithRoute } from '../import/web'
import { getAccessToken } from '../sync/google'
import { getState } from './store'

const CORS_HINT = 'In a browser some services refuse direct calls (CORS); the desktop and Android apps do not have that limit.'
const isNetworkError = (e: unknown) => e instanceof TypeError

const ROUTE_LABEL = {
  desktop: 'the desktop app',
  android: 'the Android app',
  direct: 'a direct browser request',
  proxy: 'your clip proxy',
} as const

export async function testClipDownload(): Promise<TestResult> {
  try {
    const started = performance.now()
    const { html, route } = await fetchHtmlWithRoute('https://example.com/')
    if (!/example domain/i.test(html)) return { ok: false, message: 'A page came back, but it was not the expected test page. Check the proxy address.' }
    return okResult(`Downloaded a test page through ${ROUTE_LABEL[route]} in ${Math.round(performance.now() - started)} ms.`)
  } catch (e) {
    return failResult(e)
  }
}

export async function testChat(): Promise<TestResult> {
  const s = getState().settings
  try {
    const reply = await runPrompt({ endpoint: s.llmEndpoint, model: s.llmModel, apiKey: s.llmApiKey }, 'Reply with the single word OK.', fetch, 25_000)
    return okResult(`Connected. The model answered: “${reply.slice(0, 40)}”.`)
  } catch (e) {
    return failResult(e, isNetworkError(e) ? CORS_HINT : '')
  }
}

export async function testEmbeddings(): Promise<TestResult> {
  const s = getState().settings
  if (!s.embeddingsEndpoint) return { ok: false, message: 'Add the embeddings address first.' }
  try {
    const [vec] = await embedTexts({ endpoint: s.embeddingsEndpoint, model: s.embeddingsModel, apiKey: s.llmApiKey }, ['connection test'])
    return okResult(`Connected. Each note becomes a ${vec.length}-number fingerprint.`)
  } catch (e) {
    return failResult(e, isNetworkError(e) ? CORS_HINT : '')
  }
}

/** Sign in if needed, then ask Drive for the private app folder. Confirms the whole chain: client ID, consent, API, scope. */
export async function testDrive(opts: { switchAccount?: boolean } = {}): Promise<TestResult> {
  const clientId = getState().settings.googleClientId
  try {
    const token = await getAccessToken(clientId, true, opts)
    const res = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1&fields=files(id)', { headers: { authorization: `Bearer ${token}` } })
    if (res.status === 403) {
      const body = await res.text()
      if (/accessNotConfigured|has not been used|disabled/i.test(body)) return { ok: false, message: 'Signed in, but the Google Drive API is switched off for your project. Enable it in Google Cloud (step 2), wait a minute, and retry.' }
      return { ok: false, message: 'Signed in, but Google refused access to the app folder. Check that the Drive API is on and your account is a test user.' }
    }
    if (!res.ok) return { ok: false, message: `Google Drive answered ${res.status}.` }
    return okResult('Connected to your private Mindvault folder in Google Drive.')
  } catch (e) {
    return failResult(e)
  }
}
