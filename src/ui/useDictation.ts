import { useCallback, useEffect, useRef, useState } from 'react'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

function ctor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** The browser speech API works in Chrome, Edge and Safari. Electron has the API but no speech service behind it. */
export function dictationSupported(): boolean {
  return !!ctor() && window.mindvault?.platform !== 'electron'
}

const MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access was denied.',
  'service-not-allowed': 'Speech recognition is not allowed here.',
  'no-speech': 'Did not hear anything.',
  network: 'Speech recognition needs an internet connection.',
}

export function useDictation(onFinal: (text: string) => void) {
  const rec = useRef<Recognition | null>(null)
  const cb = useRef(onFinal)
  cb.current = onFinal
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')

  const stop = useCallback(() => rec.current?.stop(), [])

  const start = useCallback(() => {
    const Ctor = ctor()
    if (!Ctor || rec.current) return
    const r = new Ctor()
    r.lang = navigator.language || 'en-US'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) cb.current(res[0].transcript.trim() + ' ')
        else live += res[0].transcript
      }
      setInterim(live)
    }
    r.onerror = (e) => setError(MESSAGES[e.error] ?? `Voice input failed (${e.error}).`)
    r.onend = () => {
      rec.current = null
      setListening(false)
      setInterim('')
    }
    rec.current = r
    setError('')
    setListening(true)
    try {
      r.start()
    } catch {
      rec.current = null
      setListening(false)
    }
  }, [])

  useEffect(() => () => rec.current?.abort(), [])
  return { listening, interim, error, start, stop, supported: dictationSupported() }
}
