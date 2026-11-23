// Wiedervorlagen einer Akte (Projekt-Checkliste Stufe 2, 20.11.2026): offene Einträge mit Haken zum
// Erledigen, Verschieben und Löschen, darunter die zuletzt erledigten. Neue Einträge aus dem Katalog
// des Bereichs oder frei. Schreibt direkt in die Tabelle wiedervorlagen (kein Speichern-Knopf nötig).
import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, RotateCcw, Trash2 } from 'lucide-react'
import { inputClass, SecondaryButton } from './ui'
import {
  erledigeWiedervorlage, ladeRegeln, ladeWiedervorlagenFuerKunde, legeWiedervorlageAn, loescheWiedervorlage,
  oeffneWiedervorlageWieder, regelnFuer, verschiebeWiedervorlage, type Wiedervorlage, type WiedervorlageRegel,
} from '../lib/wiedervorlagen'
import { addDays, today } from '../lib/dates'
import type { KundeBereich } from '../types'

/** Vollständiges, plausibles Datum (keine halb getippten Jahre wie 0002). */
const gueltigesDatum = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '2000-01-01' && v <= '2100-12-31'

const kurz = (iso?: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '')

export function WiedervorlagenListe({
  kundeId,
  bereich,
  verantwortlich,
  nutzerName,
  nurLesen = false,
  onAenderung,
}: {
  kundeId: string
  bereich: KundeBereich
  verantwortlich?: string
  nutzerName: string
  nurLesen?: boolean
  /** Nach jeder Änderung (z. B. damit eine Liste ihre Übersicht neu lädt). */
  onAenderung?: () => void
}) {
  const [liste, setListe] = useState<Wiedervorlage[] | null>(null)
  const [regeln, setRegeln] = useState<WiedervorlageRegel[]>([])
  const [fehler, setFehler] = useState('')
  const [neuAuswahl, setNeuAuswahl] = useState('')
  const [neuTitel, setNeuTitel] = useState('')
  const [neuDatum, setNeuDatum] = useState(addDays(today(), 7))
  const [neuNotiz, setNeuNotiz] = useState('')
  const [zeigeErledigte, setZeigeErledigte] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  // Datum je Zeile erst beim Verlassen des Feldes (oder Eingabetaste) speichern: Beim Tippen meldet das
  // Datumsfeld nach jeder Ziffer ein gültiges Datum (Tag „1“ von „15“, Jahr „0002“) — vorher wurde jedes
  // davon sofort gespeichert und das Feld während des Speicherns gesperrt.
  const [datumEntwurf, setDatumEntwurf] = useState<Record<string, string>>({})

  async function laden() {
    try {
      setListe(await ladeWiedervorlagenFuerKunde(kundeId))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Wiedervorlagen ließen sich nicht laden.')
      setListe([])
    }
  }

  useEffect(() => {
    if (bereich === 'privat') return
    laden()
    ladeRegeln().then(setRegeln).catch(() => setRegeln([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kundeId, bereich])

  const katalog = useMemo(() => regelnFuer(regeln, bereich), [regeln, bereich])
  if (bereich === 'privat') return null

  async function aktion(f: () => Promise<void>) {
    setLaeuft(true)
    setFehler('')
    try {
      await f()
      await laden()
      onAenderung?.()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft(false)
    }
  }

  function datumUebernehmen(w: Wiedervorlage) {
    const neu = datumEntwurf[w.id]
    if (neu === undefined) return
    setDatumEntwurf((d) => {
      const rest = { ...d }
      delete rest[w.id]
      return rest
    })
    if (!gueltigesDatum(neu) || neu === w.faellig) return
    aktion(() => verschiebeWiedervorlage(w.id, neu))
  }

  function waehle(id: string) {
    setNeuAuswahl(id)
    const r = katalog.find((x) => x.id === id)
    if (r) {
      setNeuTitel(r.titel)
      setNeuDatum(addDays(today(), Math.max(0, r.tage)))
    } else if (id === '') {
      setNeuTitel('')
    }
  }

  const offen = (liste ?? []).filter((w) => !w.erledigtAm)
  const erledigt = (liste ?? []).filter((w) => w.erledigtAm)
  const heute = today()

  return (
    <div className="space-y-3">
      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
      {liste === null ? (
        <p className="text-sm text-slate-400">Lädt …</p>
      ) : offen.length === 0 ? (
        <p className="text-sm text-slate-400">Keine offene Wiedervorlage.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {offen.map((w) => (
            <li key={w.id} className="flex flex-wrap items-start gap-2 px-3 py-2 text-sm">
              <button
                type="button"
                disabled={nurLesen || laeuft}
                onClick={() => aktion(() => erledigeWiedervorlage(w.id, nutzerName))}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 text-slate-400 hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
                title="Erledigt"
                aria-label={`${w.titel} erledigt`}
              >
                <Check size={13} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-slate-700">
                  {w.titel}
                  {w.quelle === 'regel' && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-sky-700" title="Vom CRM automatisch angelegt">
                      <Bot size={10} /> automatisch
                    </span>
                  )}
                </p>
                {w.notiz && <p className="text-xs text-slate-500">{w.notiz}</p>}
                {w.verantwortlich && <p className="text-xs text-slate-400">{w.verantwortlich}</p>}
              </div>
              <input
                type="date"
                value={datumEntwurf[w.id] ?? w.faellig}
                disabled={nurLesen || laeuft}
                onChange={(e) => setDatumEntwurf((d) => ({ ...d, [w.id]: e.target.value }))}
                onBlur={() => datumUebernehmen(w)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') datumUebernehmen(w)
                }}
                className={`${inputClass} w-[9.5rem] py-1 text-xs ${w.faellig < heute ? 'font-medium text-rose-600' : ''}`}
                aria-label="Fällig am"
              />
              {!nurLesen && (
                <button
                  type="button"
                  disabled={laeuft}
                  onClick={() => aktion(() => loescheWiedervorlage(w.id))}
                  className="mt-1 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500"
                  title="Löschen (statt erledigen, z. B. wenn sie nicht passt)"
                  aria-label={`${w.titel} löschen`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!nurLesen && (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500">Neue Wiedervorlage</p>
          <select value={neuAuswahl} onChange={(e) => waehle(e.target.value)} className={`${inputClass} w-full`} aria-label="Art der Wiedervorlage">
            <option value="">Eigene Wiedervorlage (frei)</option>
            {katalog.map((r) => (
              <option key={r.id} value={r.id}>{r.titel}</option>
            ))}
          </select>
          <div className="grid gap-2 sm:grid-cols-[1fr_9.5rem]">
            <input value={neuTitel} onChange={(e) => setNeuTitel(e.target.value)} placeholder="Was ist zu tun?" className={`${inputClass} w-full`} />
            <input type="date" value={neuDatum} onChange={(e) => setNeuDatum(e.target.value)} className={`${inputClass} w-full`} aria-label="Fällig am" />
          </div>
          <input value={neuNotiz} onChange={(e) => setNeuNotiz(e.target.value)} placeholder="Notiz (optional)" className={`${inputClass} w-full`} />
          <div className="flex justify-end">
            <SecondaryButton
              disabled={laeuft || !neuTitel.trim() || !neuDatum}
              onClick={() =>
                aktion(async () => {
                  const gewaehlt = katalog.find((r) => r.id === neuAuswahl)
                  await legeWiedervorlageAn({
                    kundeId,
                    bereich,
                    titel: neuTitel,
                    faellig: neuDatum,
                    notiz: neuNotiz,
                    // Nur wenn der Titel unverändert ist, gilt die Regel (und damit ihr automatisches Erledigen).
                    regel: gewaehlt && gewaehlt.titel === neuTitel.trim() ? gewaehlt.id : undefined,
                    verantwortlich,
                    von: nutzerName,
                  })
                  setNeuAuswahl('')
                  setNeuTitel('')
                  setNeuNotiz('')
                  setNeuDatum(addDays(today(), 7))
                })
              }
            >
              Anlegen
            </SecondaryButton>
          </div>
        </div>
      )}

      {erledigt.length > 0 && (
        <div>
          <button type="button" onClick={() => setZeigeErledigte((x) => !x)} className="text-xs text-slate-500 hover:text-slate-700">
            {zeigeErledigte ? 'Erledigte ausblenden' : `Zuletzt erledigt (${erledigt.length}) zeigen`}
          </button>
          {zeigeErledigte && (
            <ul className="mt-2 space-y-1">
              {erledigt.map((w) => (
                <li key={w.id} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="line-through">{w.titel}</span>
                  <span>
                    · {kurz(w.erledigtAm?.slice(0, 10))} {w.erledigtGrund ? `(${w.erledigtGrund})` : w.erledigtVon ? `(${w.erledigtVon})` : ''}
                  </span>
                  {!nurLesen && (
                    <button type="button" disabled={laeuft} onClick={() => aktion(() => oeffneWiedervorlageWieder(w.id))} className="rounded p-0.5 hover:bg-slate-100 hover:text-slate-600" title="Wieder öffnen" aria-label={`${w.titel} wieder öffnen`}>
                      <RotateCcw size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
