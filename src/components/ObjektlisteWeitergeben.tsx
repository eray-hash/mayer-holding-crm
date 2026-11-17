import { useMemo, useRef, useState } from 'react'
import { Check, ClipboardCheck, Copy, Printer } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { EmpfaengerFelder, VereinbarungWahl, empfaengerAus, type Vereinbarung } from './ObjektWeitergabenSection'
import { fmtDate, fmtEUR, today, uid } from '../lib/dates'
import type { Objekt } from '../types'

type SpalteId = 'bezeichnung' | 'ort' | 'typ' | 'preis'
const SPALTEN: { id: SpalteId; label: string }[] = [
  { id: 'bezeichnung', label: 'Bezeichnung' },
  { id: 'ort', label: 'Ort' },
  { id: 'typ', label: 'Objektart' },
  { id: 'preis', label: 'Kaufpreis' },
]

function html(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type Weg = 'Text kopiert' | 'Ausdruck' | 'nur festgehalten'

/** Ausgewählte Objekte als kurze Liste zum Weitergeben an Makler, Investoren oder Kunden: nur die
 *  angehakten Angaben, nie Eigentümer, Unterlagen, Verlauf oder interne Zuständigkeiten. Die Bezeichnung
 *  lässt sich je Objekt für diese Liste umformulieren (interne Namen enthalten oft den Eigentümer).
 *
 *  Ist ein Empfänger angegeben, wird beim Kopieren oder Drucken festgehalten, wer welche Objekte wann
 *  bekommen hat (Nachweis für den Provisionsanspruch) — je Empfänger ein Eintrag, solange das Fenster
 *  offen ist: Erst kopieren und dann drucken ergänzt denselben Eintrag, statt einen zweiten anzulegen. */
export function ObjektlisteWeitergeben({ open, onClose, objekte, absender }: { open: boolean; onClose: () => void; objekte: Objekt[]; absender: string }) {
  const { state, dispatch } = useApp()
  const [spalten, setSpalten] = useState<Set<SpalteId>>(new Set(['bezeichnung', 'ort', 'typ', 'preis']))
  const [namen, setNamen] = useState<Record<string, string>>({})
  const [kopiert, setKopiert] = useState(false)
  const [kontaktId, setKontaktId] = useState('')
  const [freierName, setFreierName] = useState('')
  const [vereinbarung, setVereinbarung] = useState<Vereinbarung>('keine')
  const [notiz, setNotiz] = useState('')
  // Was in diesem Fenster schon festgehalten wurde: je Empfänger die Kennung des Eintrags und die Wege.
  const festgehalten = useRef(new Map<string, { id: string; wege: Set<Weg> }>())
  // Mit welcher Vereinbarung und Notiz je Empfänger zuletzt festgehalten wurde — für die Rückmeldung unten.
  const [stand, setStand] = useState<Record<string, string>>({})
  const nichtOeffentlich = objekte.some((o) => o.offMarket)

  const empfaenger = empfaengerAus(state.immobilienKunden, kontaktId, freierName)
  const schluessel = empfaenger
    ? `${empfaenger.kontaktId ?? `frei:${empfaenger.an.toLowerCase()}`}|${objekte
        .map((o) => o.id)
        .sort()
        .join(',')}`
    : ''
  const fingerabdruck = `${vereinbarung}|${notiz.trim()}`
  const schonFestgehalten = schluessel !== '' && stand[schluessel] !== undefined
  const unveraendert = schonFestgehalten && stand[schluessel] === fingerabdruck

  const zeilen = useMemo(
    () =>
      objekte.map((o, i) => ({
        id: o.id,
        nr: i + 1,
        bezeichnung: namen[o.id] ?? o.bezeichnung,
        ort: o.adresse || '–',
        typ: o.typ,
        preis: o.kaufpreis > 0 ? fmtEUR(o.kaufpreis) : 'auf Anfrage',
      })),
    [objekte, namen],
  )
  const aktiv = SPALTEN.filter((s) => spalten.has(s.id))
  const hinweis = nichtOeffentlich ? 'Vertraulich – diese Objekte werden nicht öffentlich angeboten. Weitergabe nur nach Absprache.' : ''

  function alsText(): string {
    const kopf = `Objektliste – Andreas Mayer Holding, Stand ${fmtDate(today())}`
    const liste = zeilen.map((z) => `${z.nr}. ${aktiv.map((s) => z[s.id]).join(' · ')}`)
    return [kopf, hinweis, '', ...liste, '', `Bei Interesse melden Sie sich gern bei ${absender}.`].filter((x, i) => x !== '' || i > 1).join('\n')
  }

  /** Hält die Weitergabe an den gewählten Empfänger fest. Ein zweiter Aufruf für denselben Empfänger
   *  ersetzt den Eintrag (gleiche Kennung) und ergänzt den Weg, legt aber keinen zweiten Eintrag an. */
  function halteFest(weg: Weg) {
    if (!empfaenger) return
    const bisher = festgehalten.current.get(schluessel) ?? { id: uid('wg'), wege: new Set<Weg>() }
    if (weg !== 'nur festgehalten') bisher.wege.add(weg)
    festgehalten.current.set(schluessel, bisher)
    const kopiertSchon = bisher.wege.has('Text kopiert')
    const gedruckt = bisher.wege.has('Ausdruck')
    dispatch({
      type: 'SPEICHERE_WEITERGABE',
      weitergabe: {
        id: bisher.id,
        datum: today(),
        an: empfaenger.an,
        kontaktId: empfaenger.kontaktId,
        objektIds: zeilen.map((z) => z.id),
        bezeichnungen: Object.fromEntries(zeilen.map((z) => [z.id, z.bezeichnung])),
        angaben: aktiv.map((s) => s.label),
        weg: kopiertSchon && gedruckt ? 'Text kopiert und Ausdruck' : kopiertSchon ? 'Text kopiert' : gedruckt ? 'Ausdruck' : 'nur festgehalten',
        vereinbarung,
        notiz: notiz.trim() || undefined,
        von: absender,
      },
    })
    setStand((s) => ({ ...s, [schluessel]: fingerabdruck }))
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(alsText())
      halteFest('Text kopiert')
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2500)
    } catch {
      // Zwischenablage gesperrt — der Text lässt sich über „Drucken" trotzdem ausgeben.
    }
  }

  function drucken() {
    const fenster = window.open('', '_blank')
    if (!fenster) return
    const kopf = aktiv.map((s) => `<th>${html(s.label)}</th>`).join('')
    const rumpf = zeilen.map((z) => `<tr><td>${z.nr}</td>${aktiv.map((s) => `<td>${html(String(z[s.id]))}</td>`).join('')}</tr>`).join('')
    fenster.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Objektliste</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:32px}h1{font-size:18px;margin:0 0 4px}p{font-size:12px;color:#475569;margin:0 0 14px}
      table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #cbd5e1;padding:7px 8px;text-align:left;vertical-align:top}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b}.hinweis{font-weight:bold;color:#1e293b}.fuss{margin-top:18px}
    </style></head><body><h1>Objektliste</h1><p>Andreas Mayer Holding · Stand ${html(fmtDate(today()))}</p>
    ${hinweis ? `<p class="hinweis">${html(hinweis)}</p>` : ''}
    <table><thead><tr><th>Nr.</th>${kopf}</tr></thead><tbody>${rumpf}</tbody></table>
    <p class="fuss">Bei Interesse melden Sie sich gern bei ${html(absender)}.</p></body></html>`)
    fenster.document.close()
    halteFest('Ausdruck')
    fenster.focus()
    fenster.print()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Objektliste zum Weitergeben (${objekte.length} ${objekte.length === 1 ? 'Objekt' : 'Objekte'})`} width="max-w-3xl">
      <p className="mb-3 text-sm text-slate-500">
        Weitergegeben werden nur die angehakten Angaben. Eigentümer, Unterlagen, Verlauf und interne Zuständigkeiten gehen nie mit.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {SPALTEN.map((s) => {
          const an = spalten.has(s.id)
          return (
            <button
              key={s.id}
              type="button"
              onClick={() =>
                setSpalten((alt) => {
                  const neu = new Set(alt)
                  if (an) neu.delete(s.id)
                  else neu.add(s.id)
                  return neu.size === 0 ? alt : neu
                })
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium ${an ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              aria-pressed={an}
            >
              {s.label}
            </button>
          )
        })}
      </div>
      {spalten.has('bezeichnung') && (
        <p className="mb-2 text-xs text-amber-600">Die Bezeichnung enthält intern oft den Namen des Eigentümers — hier für diese Liste umformulieren oder die Spalte abwählen.</p>
      )}
      <div className="mb-4 max-h-80 overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Nr.</th>
              {aktiv.map((s) => (
                <th key={s.id} className="px-3 py-2">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2 text-slate-400">{z.nr}</td>
                {aktiv.map((s) => (
                  <td key={s.id} className="px-3 py-2 text-slate-700">
                    {s.id === 'bezeichnung' ? (
                      <input
                        className={`${inputClass} py-1`}
                        value={z.bezeichnung}
                        onChange={(e) => setNamen((n) => ({ ...n, [z.id]: e.target.value }))}
                        aria-label={`Bezeichnung für Objekt ${z.nr}`}
                      />
                    ) : (
                      z[s.id]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hinweis && <p className="mb-3 text-xs font-medium text-slate-600">{hinweis}</p>}

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="text-sm font-semibold text-slate-700">An wen geht die Liste?</h3>
        <p className="mb-3 text-xs text-slate-500">Mit Empfänger wird beim Kopieren oder Drucken festgehalten, wer welche Objekte wann bekommen hat — dein Nachweis für die Provision.</p>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <EmpfaengerFelder kontakte={state.immobilienKunden} kontaktId={kontaktId} name={freierName} onKontakt={setKontaktId} onName={setFreierName} />
          <VereinbarungWahl wert={vereinbarung} onChange={setVereinbarung} />
          <div className="sm:col-span-2">
            <Field label="Notiz (freiwillig)">
              <input className={inputClass} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. nach Telefonat, Vereinbarung vom 03.11. liegt unterschrieben vor" />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-xs" role="status">
            {!empfaenger ? (
              <span className="text-slate-400">Ohne Empfänger wird nichts festgehalten — kopieren und drucken kannst du trotzdem.</span>
            ) : unveraendert ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                <Check size={13} /> Weitergabe festgehalten ({empfaenger.an})
              </span>
            ) : schonFestgehalten ? (
              <span className="text-amber-600">Vereinbarung oder Notiz geändert — das ist noch nicht festgehalten.</span>
            ) : (
              <span className="text-slate-500">Beim Kopieren oder Drucken wird die Weitergabe an {empfaenger.an} festgehalten.</span>
            )}
          </p>
          <SecondaryButton onClick={() => halteFest('nur festgehalten')} disabled={!empfaenger || unveraendert}>
            <ClipboardCheck size={14} /> {schonFestgehalten && !unveraendert ? 'Änderung festhalten' : 'Nur festhalten'}
          </SecondaryButton>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <SecondaryButton onClick={kopieren}>
          {kopiert ? <Check size={14} /> : <Copy size={14} />} {kopiert ? 'Kopiert' : 'Als Text kopieren (E-Mail, WhatsApp)'}
        </SecondaryButton>
        <PrimaryButton onClick={drucken}>
          <Printer size={14} /> Drucken / als PDF speichern
        </PrimaryButton>
      </div>
    </Modal>
  )
}
