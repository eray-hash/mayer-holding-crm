import { useEffect, useMemo, useState } from 'react'
import { Lightbulb, Plus, RefreshCw } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'

// Wünsche und Probleme der Mitarbeiter mit dem CRM (Tabelle `wuensche`). Nur Geschäftsführung und
// Admins sehen und ändern sie (Zeilenschutz in der Datenbank, hier zusätzlich RequireAdmin in App.tsx).
// Gefüllt vom Assistenten (Werkzeug wunsch_notieren), von der täglichen Auswertung der Gespräche und
// der Server-Fehler (supabase/functions/email-gateway/wunschAnalyse.ts) und von Hand auf dieser Seite.

type Quelle = 'assistent' | 'analyse' | 'fehler' | 'crm'
type Status = 'neu' | 'geplant' | 'erledigt' | 'verworfen'

type WunschZeile = {
  id: string
  quelle: Quelle
  mitarbeiter: string | null
  titel: string
  beschreibung: string
  beleg: string | null
  status: Status
  anzahl: number
  erstellt_am: string
  zuletzt_am: string
  gemeldet_am: string | null
  notiz: string | null
}

const QUELLEN: { id: Quelle; label: string }[] = [
  { id: 'assistent', label: 'Vom Assistenten notiert' },
  { id: 'analyse', label: 'Aus den Gesprächen' },
  { id: 'fehler', label: 'Fehler und Probleme' },
  { id: 'crm', label: 'Hier eingetragen' },
]
const STATUS: { id: Status; label: string }[] = [
  { id: 'neu', label: 'Neu' },
  { id: 'geplant', label: 'Geplant' },
  { id: 'erledigt', label: 'Erledigt' },
  { id: 'verworfen', label: 'Verworfen' },
]
const STATUS_FARBE: Record<Status, string> = {
  neu: 'border-amber-200 bg-amber-50 text-amber-800',
  geplant: 'border-sky-200 bg-sky-50 text-sky-800',
  erledigt: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  verworfen: 'border-slate-200 bg-slate-50 text-slate-500',
}

const DATUM = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function datum(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : DATUM.format(d)
}

function quelleLabel(q: Quelle): string {
  return QUELLEN.find((x) => x.id === q)?.label ?? q
}

export function Wuensche() {
  const { mitarbeiter } = useAuth()
  const [zeilen, setZeilen] = useState<WunschZeile[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'offen' | 'alle' | Status>('offen')
  const [quelleFilter, setQuelleFilter] = useState<'alle' | Quelle>('alle')
  const [neuOffen, setNeuOffen] = useState(false)
  const [neuTitel, setNeuTitel] = useState('')
  const [neuBeschreibung, setNeuBeschreibung] = useState('')
  const [speichert, setSpeichert] = useState(false)

  async function laden() {
    if (!supabase) {
      setLaedt(false)
      return
    }
    setLaedt(true)
    setFehler(null)
    const { data, error } = await supabase.from('wuensche').select('*').order('zuletzt_am', { ascending: false }).limit(1000)
    if (error) setFehler(`Die Wünsche konnten nicht geladen werden: ${error.message}`)
    else setZeilen((data ?? []) as WunschZeile[])
    setLaedt(false)
  }

  useEffect(() => {
    void laden()
  }, [])

  const sichtbar = useMemo(
    () =>
      zeilen.filter(
        (z) =>
          (statusFilter === 'alle' || (statusFilter === 'offen' ? z.status === 'neu' || z.status === 'geplant' : z.status === statusFilter)) &&
          (quelleFilter === 'alle' || z.quelle === quelleFilter),
      ),
    [zeilen, statusFilter, quelleFilter],
  )

  async function aendere(id: string, aenderung: Partial<Pick<WunschZeile, 'status' | 'notiz'>>) {
    if (!supabase) return
    const vorher = zeilen
    setZeilen((alt) => alt.map((z) => (z.id === id ? { ...z, ...aenderung } : z)))
    const { error } = await supabase.from('wuensche').update(aenderung).eq('id', id)
    if (error) {
      setZeilen(vorher)
      setFehler(`Die Änderung wurde nicht gespeichert: ${error.message}`)
    }
  }

  async function anlegen() {
    if (!supabase || !neuTitel.trim()) return
    setSpeichert(true)
    setFehler(null)
    const jetzt = new Date().toISOString()
    const zeile: WunschZeile = {
      id: `w_${crypto.randomUUID()}`,
      quelle: 'crm',
      mitarbeiter: mitarbeiter?.name ?? null,
      titel: neuTitel.trim().slice(0, 120),
      beschreibung: neuBeschreibung.trim().slice(0, 600),
      beleg: null,
      status: 'neu',
      anzahl: 1,
      erstellt_am: jetzt,
      zuletzt_am: jetzt,
      // Selbst eingetragen — muss nicht noch einmal per Telegram gemeldet werden.
      gemeldet_am: jetzt,
      notiz: null,
    }
    const { error } = await supabase.from('wuensche').insert(zeile)
    setSpeichert(false)
    if (error) {
      setFehler(`Der Eintrag wurde nicht gespeichert: ${error.message}`)
      return
    }
    setZeilen((alt) => [zeile, ...alt])
    setNeuTitel('')
    setNeuBeschreibung('')
    setNeuOffen(false)
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold text-slate-800">Wünsche</h1>
        <EmptyState text="Die Wünsche gibt es nur mit angebundener Datenbank." />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mb-1 flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Lightbulb size={20} className="text-amber-500" /> Wünsche
          </h1>
          <p className="text-sm text-slate-500">
            Was Mitarbeiter im CRM oder beim Assistenten wollten und nicht ging, und Fehler, die das System bemerkt hat. Ohne Kundendaten. Ein Bericht
            geht täglich um 18 Uhr per Telegram an die Admins.
          </p>
        </div>
        <div className="flex gap-2">
          <SecondaryButton onClick={() => void laden()} disabled={laedt}>
            <RefreshCw size={15} /> Neu laden
          </SecondaryButton>
          <PrimaryButton onClick={() => setNeuOffen((o) => !o)}>
            <Plus size={15} /> Eintragen
          </PrimaryButton>
        </div>
      </div>

      {neuOffen && (
        <Card className="mb-4 p-4">
          <Field label="Titel (die gewünschte Funktion)">
            <input className={inputClass} value={neuTitel} maxLength={120} onChange={(e) => setNeuTitel(e.target.value)} placeholder="z. B. Exposé direkt per WhatsApp verschicken" />
          </Field>
          <Field label="Beschreibung">
            <textarea className={inputClass} rows={2} value={neuBeschreibung} maxLength={600} onChange={(e) => setNeuBeschreibung(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => void anlegen()} disabled={speichert || !neuTitel.trim()}>
              Speichern
            </PrimaryButton>
            <SecondaryButton onClick={() => setNeuOffen(false)}>Abbrechen</SecondaryButton>
          </div>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
          <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="offen">Offen (neu und geplant)</option>
            {STATUS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
            <option value="alle">Alle</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Herkunft</span>
          <select className={inputClass} value={quelleFilter} onChange={(e) => setQuelleFilter(e.target.value as typeof quelleFilter)}>
            <option value="alle">Alle</option>
            {QUELLEN.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {fehler && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{fehler}</div>}

      {laedt ? (
        <EmptyState text="Lädt …" />
      ) : sichtbar.length === 0 ? (
        <EmptyState text={zeilen.length === 0 ? 'Noch keine Wünsche erfasst.' : 'Keine Einträge zu diesem Filter.'} />
      ) : (
        <Card className="overflow-hidden">
          {/* Kopfzeile nur auf breiten Bildschirmen; schmal wird jede Zeile zur Karte. */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_4.5rem_7.5rem_8rem_minmax(0,1.4fr)] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500 lg:grid">
            <span>Titel und Beschreibung</span>
            <span>Wer</span>
            <span>Wie oft</span>
            <span>Zuletzt</span>
            <span>Status</span>
            <span>Notiz</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {sichtbar.map((z) => (
              <WunschEintrag key={z.id} zeile={z} onAendere={(a) => void aendere(z.id, a)} />
            ))}
          </ul>
        </Card>
      )}
      {!laedt && sichtbar.length > 0 && <p className="mt-2 text-xs text-slate-400">{sichtbar.length} Einträge</p>}
    </div>
  )
}

function WunschEintrag({ zeile, onAendere }: { zeile: WunschZeile; onAendere: (a: Partial<Pick<WunschZeile, 'status' | 'notiz'>>) => void }) {
  const [notiz, setNotiz] = useState(zeile.notiz ?? '')
  useEffect(() => setNotiz(zeile.notiz ?? ''), [zeile.notiz])

  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_4.5rem_7.5rem_8rem_minmax(0,1.4fr)] lg:gap-3">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-slate-800">{zeile.titel}</p>
        {zeile.beschreibung && <p className="mt-0.5 break-words text-sm text-slate-600">{zeile.beschreibung}</p>}
        {zeile.beleg && <p className="mt-0.5 break-words text-xs text-slate-400">Beispiel: {zeile.beleg}</p>}
        <p className="mt-1 text-xs text-slate-400">{quelleLabel(zeile.quelle)}</p>
      </div>
      <div className="min-w-0 break-words text-sm text-slate-600">
        <span className="text-xs text-slate-400 lg:hidden">Wer: </span>
        {zeile.mitarbeiter || '–'}
      </div>
      <div className="text-sm text-slate-600">
        <span className="text-xs text-slate-400 lg:hidden">Wie oft: </span>
        {zeile.anzahl}×
      </div>
      <div className="text-sm text-slate-600">
        <span className="text-xs text-slate-400 lg:hidden">Zuletzt: </span>
        {datum(zeile.zuletzt_am)}
      </div>
      <div>
        <select
          aria-label="Status"
          className={`w-full rounded-lg border px-2 py-1.5 text-sm font-medium outline-none ${STATUS_FARBE[zeile.status] ?? STATUS_FARBE.neu}`}
          value={zeile.status}
          onChange={(e) => onAendere({ status: e.target.value as Status })}
        >
          {STATUS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <textarea
          aria-label="Notiz"
          className={`${inputClass} min-h-[2.25rem] py-1.5`}
          rows={1}
          placeholder="Notiz"
          value={notiz}
          onChange={(e) => setNotiz(e.target.value)}
          onBlur={() => {
            if (notiz !== (zeile.notiz ?? '')) onAendere({ notiz: notiz.trim() || null })
          }}
        />
      </div>
    </li>
  )
}
