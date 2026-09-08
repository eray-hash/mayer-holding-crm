export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function fmtDate(iso: string): string {
  if (!iso) return '–'
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function isOverdue(date: string, done: boolean): boolean {
  if (done || !date) return false
  return date < today()
}

export function daysSince(date: string): number {
  const d = new Date(date + 'T00:00:00').getTime()
  const t = new Date(today() + 'T00:00:00').getTime()
  return Math.max(0, Math.round((t - d) / (1000 * 60 * 60 * 24)))
}

export function fmtEUR(value: number): string {
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}
