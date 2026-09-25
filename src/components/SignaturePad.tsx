import { useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const drewSomething = useRef(false)
  const [empty, setEmpty] = useState(true)

  function getPos(clientX: number, clientY: number) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  function startAt(x: number, y: number) {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.beginPath()
    ctx.moveTo(x, y)
    drawing.current = true
  }

  function moveTo(x: number, y: number) {
    if (!drawing.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1e293b'
    ctx.lineTo(x, y)
    ctx.stroke()
    drewSomething.current = true
    if (empty) setEmpty(false)
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current!
    onChange(drewSomething.current ? canvas.toDataURL('image/png') : null)
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = getPos(e.clientX, e.clientY)
    startAt(x, y)
  }
  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = getPos(e.clientX, e.clientY)
    moveTo(x, y)
  }
  function onTouchStart(e: React.TouchEvent<HTMLCanvasElement>) {
    const t = e.touches[0]
    const { x, y } = getPos(t.clientX, t.clientY)
    startAt(x, y)
  }
  function onTouchMove(e: React.TouchEvent<HTMLCanvasElement>) {
    const t = e.touches[0]
    const { x, y } = getPos(t.clientX, t.clientY)
    moveTo(x, y)
  }

  function clear() {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drewSomething.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <canvas
          ref={canvasRef}
          width={500}
          height={140}
          className="w-full touch-none bg-white"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={end}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs text-slate-400">Mit der Maus oder dem Finger unterschreiben</span>
        <button
          type="button"
          onClick={clear}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <Eraser size={13} /> Löschen
        </button>
      </div>
    </div>
  )
}
