// Sprache der Aufnahme auf dem Reiter „Abschrift“ (Runde 5): erkannte Sprache und Einstellung, „mit anderer Sprache
// neu abschreiben“ (nur wer aufgenommen hat, solange der Ton da ist) und die deutsche Übersetzung der Abschrift —
// nur auf Knopfdruck, vom Server zwischengespeichert (gespraech_uebersetzen).
import { useState, type ReactNode } from 'react'
import { normalisiereSprachwahl, SPRACHEN, sprachName, type GespraechSprache } from '../../../supabase/functions/_shared/gespraechSchema.ts'
import { neuAbschreiben, uebersetzeAbschrift, zeit, type AufnahmeR5 } from './api'
import { feld, fehlerText } from './bausteine'

/** Ist die Abschrift (ganz oder teilweise) nicht Deutsch? */
export function istFremdsprachig(zeile: AufnahmeR5): boolean {
  if (zeile.sprache_erkannt && zeile.sprache_erkannt !== 'de') return true
  return (zeile.segmente ?? []).some((s) => {
    const sp = (s as { sprache?: string }).sprache
    return !!sp && sp !== 'de' && !!String(s.text ?? '').trim()
  })
}

export function SprachLeiste({ id, zeile, neuLaden }: { id: string; zeile: AufnahmeR5; neuLaden: () => void }) {
  const wahl = normalisiereSprachwahl(zeile.sprache)
  const [neu, setNeu] = useState<GespraechSprache>(wahl === 'deutsch' ? 'automatisch' : 'deutsch')
  const [offen, setOffen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const darfNeu = zeile.besitzer !== false && !zeile.audio_geloescht_am && ['fertig', 'fehler'].includes(zeile.status) && (zeile.segmente ?? []).length > 0
  const einstellung = SPRACHEN.find((s) => s.schluessel === wahl)?.name ?? 'Deutsch'

  async function los() {
    setLaeuft(true)
    setFehler('')
    try {
      await neuAbschreiben(id, neu)
      setOffen(false)
      neuLaden()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Sprache: <span className="font-medium">{zeile.sprache_erkannt ? sprachName(zeile.sprache_erkannt) : einstellung}</span></span>
        {wahl !== 'deutsch' && <span className="text-xs text-slate-500">Einstellung: {einstellung}</span>}
        {darfNeu && !offen && <button className="ml-auto text-xs text-indigo-600" onClick={() => setOffen(true)}>Falsche Sprache?</button>}
      </div>
      {offen && (
        <div className="mt-2">
          <p className="mb-2 text-xs text-slate-500">Die Aufnahme wird mit der gewählten Sprache noch einmal abgeschrieben und neu ausgewertet. Die Auswertung ist immer auf Deutsch.</p>
          <div className="flex gap-2">
            <select className={feld} value={neu} onChange={(e) => setNeu(e.target.value as GespraechSprache)}>
              {SPRACHEN.filter((s) => s.schluessel !== wahl).map((s) => <option key={s.schluessel} value={s.schluessel}>{s.name}</option>)}
            </select>
            <button onClick={los} disabled={laeuft} className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{laeuft ? '…' : 'Neu abschreiben'}</button>
          </div>
          <button className="mt-1 text-xs text-slate-500" onClick={() => setOffen(false)}>Abbrechen</button>
        </div>
      )}
      {fehler && <p className="mt-2 text-xs text-rose-700">{fehler}</p>}
    </div>
  )
}

/** Umschalter Original / Deutsch über der Abschrift; die deutsche Fassung wird erst beim ersten Antippen geholt. */
export function DeutscheFassung({ id, zeile, springe, original }: { id: string; zeile: AufnahmeR5; springe: (sek: number) => void; original: ReactNode }) {
  const absaetze = (zeile.sprecher ?? []).filter((a) => typeof a?.text === 'string')
  const gespeichert = zeile.uebersetzung?.abschrift
  const [liste, setListe] = useState<string[]>(gespeichert && gespeichert.quelle === absaetze.length ? gespeichert.absaetze : [])
  const [deutsch, setDeutsch] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [hinweis, setHinweis] = useState('')

  async function zeigeDeutsch() {
    setDeutsch(true)
    if (liste.length >= absaetze.length || laeuft) return
    setLaeuft(true)
    setFehler('')
    setHinweis('')
    try {
      // Lange Gespräche kommen in Teilen — so oft nachfragen, bis alles da ist (höchstens 20 Runden).
      for (let runde = 0; runde < 20; runde++) {
        const r = await uebersetzeAbschrift(id)
        setListe(r.absaetze)
        if (r.hinweis) setHinweis(r.hinweis)
        if (r.fertig || r.hinweis) break
      }
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  if (absaetze.length === 0) return <>{original}</>
  return (
    <div>
      <div className="mb-3 flex rounded-lg bg-slate-100 p-1 text-sm">
        <button onClick={() => setDeutsch(false)} className={`flex-1 rounded-md px-3 py-1.5 ${!deutsch ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500'}`}>Original</button>
        <button onClick={zeigeDeutsch} className={`flex-1 rounded-md px-3 py-1.5 ${deutsch ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500'}`}>Deutsche Übersetzung</button>
      </div>
      {!deutsch ? (
        original
      ) : (
        <div>
          {fehler && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{fehler}</p>}
          {hinweis && <p className="mb-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{hinweis}</p>}
          {laeuft && <p className="mb-2 text-sm text-slate-500">Wird übersetzt … {liste.length > 0 ? `(${liste.length} von ${absaetze.length} Absätzen)` : ''}</p>}
          {absaetze.map((a, i) => (
            <p key={i} className="mb-2 text-[15px] leading-relaxed text-slate-800">
              {typeof a.sek === 'number' && <button onClick={() => springe(a.sek!)} className="mr-1.5 rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-xs text-indigo-700">{zeit(a.sek)}</button>}
              <span className="font-semibold text-slate-900">{a.name || a.label}: </span>
              {liste[i] ?? <span className="text-slate-400">…</span>}
            </p>
          ))}
          <p className="mt-3 text-xs text-slate-500">Maschinell übersetzt — im Zweifel gilt das Original.</p>
        </div>
      )}
    </div>
  )
}
