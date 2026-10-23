import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike

/** Camera QR scanner using the browser's BarcodeDetector. Where it is missing, the caller shows a paste box instead. */
export function qrScanSupported(): boolean {
  return 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia
}

export function ScanQr({ onResult, onClose }: { onResult(text: string): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer = 0
    let stopped = false
    ;(async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector
        const detector = new Detector({ formats: ['qr_code'] })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const tick = async () => {
          if (stopped || !video.current) return
          try {
            const found = await detector.detect(video.current)
            if (found[0]?.rawValue) {
              onResult(found[0].rawValue)
              return
            }
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 250)
        }
        void tick()
      } catch {
        setError('Camera not available. Paste the pairing link instead.')
      }
    })()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult])

  return (
    <div className="scan">
      <video ref={video} playsInline muted />
      {error && <p className="muted small">{error}</p>}
      <button className="btn" onClick={onClose}><Icon name="x" size={16} /> Cancel</button>
    </div>
  )
}
