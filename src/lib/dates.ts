// Date-Strings im App-weiten Format YYYY-MM-DD werden überall als LOKALES Kalenderdatum behandelt
// (siehe fmtDate: parst mit 'T00:00:00', also lokale Mitternacht). toISOString() liefert dagegen das
// UTC-Datum, das z.B. in Deutschland (UTC+1/+2) kurz nach lokaler Mitternacht noch auf den Vortag
// zeigt — daher hier bewusst über die lokalen Date-Komponenten statt toISOString().
function toLocalISODate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function today(): string {
  return toLocalISODate(new Date())
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
  return toLocalISODate(d)
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}
