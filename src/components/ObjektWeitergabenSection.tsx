import { Link } from 'react-router-dom'
import { Share2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, EmptyState, Field, inputClass } from './ui'
import { fmtDate } from '../lib/dates'
import type { Kunde, Objekt, Weitergabe } from '../types'

export type Vereinbarung = Weitergabe['vereinbarung']

/** Die vier Möglichkeiten für „Vereinbarung vorab" — `label` für die Auswahl, `kurz` für die Marke in den Listen. */
export const VEREINBARUNGEN: { id: Vereinbarung; label: string; kurz: string }[] = [
  { id: 'keine', label: 'keine', kurz: 'ohne Vereinbarung' },
  { id: 'nda', label: 'Vertraulichkeitsvereinbarung (NDA)', kurz: 'Vertraulichkeit vereinbart' },
  { id: 'nichtumgehung', label: 'Nichtumgehungsvereinbarung', kurz: 'Nichtumgehung vereinbart' },
  { id: 'beides', label: 'beides (Vertraulichkeit und Nichtumgehung)', kurz: 'Vertraulichkeit und Nichtumgehung vereinbart' },
]

/** Neueste Weitergabe zuerst. Bei gleichem Datum bleibt die Reihenfolge aus dem Bestand (dort steht die zuletzt festgehaltene vorn). */
export function neuesteZuerst(weitergaben: Weitergabe[]): Weitergabe[] {
  return [...weitergaben].sort((a, b) => b.datum.localeCompare(a.datum))
}

/** Aus Auswahl und Freitext wird der Empfänger für den Nachweis — `null`, solange keiner angegeben ist. */
export function empfaengerAus(kontakte: Kunde[], kontaktId: string, name: string): { an: string; kontaktId?: string } | null {
  if (kontaktId) {
    const kontakt = kontakte.find((k) => k.id === kontaktId)
    return kontakt ? { an: kontakt.firma, kontaktId: kontakt.id } : null
  }
  const frei = name.trim()
  return frei ? { an: frei } : null
}

/** Empfänger wählen: entweder einen Immobilien-Kontakt aus der Liste oder Name/Firma frei eintragen.
 *  Liefert zwei Felder ohne eigenen Rahmen, damit sie sich in jedes Raster einfügen. */
export function EmpfaengerFelder({
  kontakte,
  kontaktId,
  name,
  onKontakt,
  onName,
}: {
  kontakte: Kunde[]
  kontaktId: string
  name: string
  onKontakt: (id: string) => void
  onName: (name: string) => void
}) {
  const sortiert = [...kontakte].sort((a, b) => a.firma.localeCompare(b.firma, 'de'))
  return (
    <>
      <Field label="Empfänger">
        <select className={inputClass} value={kontaktId} onChange={(e) => onKontakt(e.target.value)}>
          <option value="">Nicht in den Kontakten – Namen eintragen …</option>
          {sortiert.map((k) => (
            <option key={k.id} value={k.id}>
              {k.firma}
            </option>
          ))}
        </select>
      </Field>
      {kontaktId === '' && (
        <Field label="Name oder Firma">
          <input className={inputClass} value={name} onChange={(e) => onName(e.target.value)} placeholder="z. B. Makler Schmid, Ulm" />
        </Field>
      )}
    </>
  )
}

export function VereinbarungWahl({ wert, onChange }: { wert: Vereinbarung; onChange: (v: Vereinbarung) => void }) {
  return (
    <Field label="Vereinbarung vorab">
      <select className={inputClass} value={wert} onChange={(e) => onChange(e.target.value as Vereinbarung)}>
        {VEREINBARUNGEN.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function VereinbarungMarke({ wert }: { wert: Vereinbarung }) {
  const eintrag = VEREINBARUNGEN.find((v) => v.id === wert) ?? VEREINBARUNGEN[0]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eintrag.id === 'keine' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{eintrag.kurz}</span>
  )
}

/** Empfänger als Verknüpfung zum Kontakt, wenn er im CRM geführt wird (und dort noch vorhanden ist), sonst als Text. */
export function EmpfaengerName({ weitergabe }: { weitergabe: Weitergabe }) {
  const { state } = useApp()
  const vorhanden = !!weitergabe.kontaktId && state.immobilienKunden.some((k) => k.id === weitergabe.kontaktId)
  return vorhanden ? (
    <Link to={`/immobilien/kunden/${weitergabe.kontaktId}?tab=stammdatenblatt`} className="font-medium text-accent-600 hover:underline">
      {weitergabe.an}
    </Link>
  ) : (
    <span className="font-medium text-slate-800">{weitergabe.an}</span>
  )
}

/** Welche Angaben mitgingen — bei von Hand nachgetragenen Weitergaben ist das nicht bekannt. */
export function angabenText(weitergabe: Weitergabe): string {
  return weitergabe.angaben.length > 0 ? `Mitgegeben: ${weitergabe.angaben.join(', ')}` : 'Welche Angaben mitgingen, ist nicht festgehalten'
}

/** Reiter „Weitergaben" am Objekt: Wem wurde dieses Objekt wann angeboten, unter welcher Bezeichnung, mit
 *  welchen Angaben und mit welcher Vereinbarung — der Nachweis für den Provisionsanspruch. Festgehalten wird
 *  in der Objektliste („Liste zum Weitergeben") oder von Hand auf der Seite „Weitergaben". */
export function ObjektWeitergabenSection({ objekt }: { objekt: Objekt }) {
  const { state } = useApp()
  const weitergaben = neuesteZuerst(state.weitergaben.filter((w) => w.objektIds.includes(objekt.id)))

  return (
    <Card className="p-5">
      <div className="mb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Share2 size={14} /> Wem wurde dieses Objekt angeboten?
        </h3>
        <p className="text-xs text-slate-400">
          {weitergaben.length > 0
            ? `${weitergaben.length} ${weitergaben.length === 1 ? 'Weitergabe' : 'Weitergaben'} · die neueste steht oben`
            : 'Festgehalten wird, sobald du das Objekt in einer Liste zum Weitergeben mit Empfänger kopierst oder druckst.'}
        </p>
      </div>

      {weitergaben.length === 0 ? (
        <EmptyState text="Dieses Objekt wurde noch niemandem weitergegeben." />
      ) : (
        <ul className="space-y-3">
          {weitergaben.map((w) => {
            const weitere = w.objektIds.length - 1
            const gezeigtAls = w.bezeichnungen[objekt.id]?.trim()
            return (
              <li key={w.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-800">{fmtDate(w.datum)}</span>
                  <span className="min-w-0 break-words">
                    <span className="text-slate-400">an </span>
                    <EmpfaengerName weitergabe={w} />
                  </span>
                  <VereinbarungMarke wert={w.vereinbarung} />
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  weitergegeben von {w.von || 'unbekannt'}
                  {w.weg ? ` · ${w.weg}` : ''}
                  {weitere > 0 ? ` · zusammen mit ${weitere} ${weitere === 1 ? 'weiteren Objekt' : 'weiteren Objekten'}` : ''}
                </div>
                <div className="mt-1 break-words text-xs text-slate-500">
                  {w.angaben.includes('Bezeichnung') && gezeigtAls ? `Gezeigt als „${gezeigtAls}“ · ` : w.angaben.length > 0 ? 'Ohne Bezeichnung gezeigt · ' : ''}
                  {angabenText(w)}
                </div>
                {w.notiz?.trim() && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-slate-700">{w.notiz}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
