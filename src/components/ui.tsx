import { type ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'
import type { Prioritaet } from '../types'
import { PRIORITAET_COLOR } from '../data/constants'

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: string
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16 backdrop-blur-[1px]">
      <div className={`w-full ${width} rounded-xl bg-white shadow-xl ring-1 ring-slate-200`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Schließen"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

export function PriorityBadge({ value }: { value: Prioritaet }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${PRIORITAET_COLOR[value]}`}>
      {value}
    </span>
  )
}

export function StatusBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  className = '',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-700 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function SecondaryButton({
  children,
  onClick,
  className = '',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100'

export function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">{text}</div>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}
