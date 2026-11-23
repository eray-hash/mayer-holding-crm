// „Meine Aufnahmen“ (#/aufnahmen): eigene Aufnahmen mit Stand, Akte, Datum und Dauer, Suche, Öffnen
// (→ #/aufnahme/:id), Verwerfen (Ton löschen, gespraech_verwerfen) und endgültiges Löschen verworfener Einträge.
// Noch nicht hochgeladene Aufnahmen auf dem Gerät zeigt die Startseite der App selbst an.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { gespraechVerwerfen } from '../server'
import { aktenNamen, ART_NAME, datumZeit, eigeneEmail, ladeEigeneAufnahmen, loescheAufnahme, STATUS_FARBE, STATUS_NAME, zeit, type ListenZeile } from './api'

const SEITE = 50

export function AufnahmenListe() {
  const navigate = useNavigate()
  const [zeilen, setZeilen] = useState<ListenZeile[]>([])
  const [namen, setNamen] = useState<Map<string, string>>(new Map())
  const [seite, setSeite] = useState(0)
  const [mehr, setMehr] = useState(false)
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState('')
  const [suche, setSuche] = useState('')
  const [filter, setFilter] = useState<'alle' | 'offen' | 'uebernommen'>('alle')
  const [aktion, setAktion] = useState<string | null>(null)

  const lade = useCallback(async (bisSeite: number) => {
    setLaedt(true)
    setFehler('')
    try {
      const ich = await eigeneEmail()
      const alle: ListenZeile[] = []
      let letzte: ListenZeile[] = []
      for (let s = 0; s <= bisSeite; s++) {
        letzte = await ladeEigeneAufnahmen(ich, s, SEITE)
        alle.push(...letzte)
        if (letzte.length < SEITE) break
      }
      setZeilen(alle)
      setMehr(letzte.length === SEITE)
      setNamen(await aktenNamen(alle.map((z) => z.kunde_id ?? '')))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaedt(false)
    }
  }, [])

  useEffect(() => {
    void lade(seite)
  }, [lade, seite])

  // Laufende Auswertungen: alle 15 Sekunden nachsehen.
  useEffect(() => {
    if (!zeilen.some((z) => ['hochladen', 'transkription', 'analyse'].includes(z.status))) return
    const uhr = setInterval(() => void lade(seite), 15000)
    return () => clearInterval(uhr)
  }, [zeilen, lade, seite])

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return zeilen.filter((z) => {
      if (filter === 'offen' && (z.status !== 'fertig' || z.uebernommen?.protokollId)) return false
      if (filter === 'uebernommen' && !z.uebernommen?.protokollId) return false
      if (!s) return true
      return [z.titel, namen.get(z.kunde_id ?? ''), ART_NAME[z.art], datumZeit(z.erstellt_am)].some((x) => String(x ?? '').toLowerCase().includes(s))
    })
  }, [zeilen, namen, suche, filter])

  async function verwerfen(z: ListenZeile) {
    if (!window.confirm('Aufnahme verwerfen? Der Ton wird gelöscht. Ein schon übernommenes Protokoll bleibt in der Akte.')) return
    setAktion(z.id)
    try {
      await gespraechVerwerfen(z.id)
      await lade(seite)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setAktion(null)
    }
  }

  async function loeschen(z: ListenZeile) {
    if (!window.confirm('Eintrag endgültig aus der Liste löschen? Das lässt sich nicht rückgängig machen.')) return
    setAktion(z.id)
    try {
      await loescheAufnahme(z.id)
      setZeilen((liste) => liste.filter((x) => x.id !== z.id))
    } catch (e) {
      setFehler(`Löschen nicht möglich: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAktion(null)
    }
  }

  return (
    <div className="pb-4">
      <h1 className="text-xl font-semibold text-slate-900">Meine Aufnahmen</h1>
      <input
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none"
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        placeholder="Suchen: Titel, Akte, Datum"
      />
      <div className="mt-2 flex gap-2 text-sm">
        {(['alle', 'offen', 'uebernommen'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {f === 'alle' ? 'Alle' : f === 'offen' ? 'Noch zu übernehmen' : 'Übernommen'}
          </button>
        ))}
      </div>
      {fehler && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{fehler}</p>}
      <ul className="mt-3 space-y-2">
        {sichtbar.map((z) => (
          <li key={z.id} className="rounded-xl border border-slate-200 bg-white">
            <button className="w-full p-3 text-left" onClick={() => navigate(`/aufnahme/${z.id}`)} disabled={z.status === 'verworfen'}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-900">{z.titel || ART_NAME[z.art] || 'Aufnahme'}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_FARBE[z.status] ?? ''}`}>{STATUS_NAME[z.status] ?? z.status}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-500">
                <span>{datumZeit(z.erstellt_am)}</span>
                {z.dauer_s ? <span>{zeit(z.dauer_s)} Min.</span> : null}
                <span>{z.kunde_id ? namen.get(z.kunde_id) ?? 'Akte' : 'ohne Akte'}</span>
                {z.uebernommen?.protokollId && <span className="text-emerald-700">in die Akte übernommen</span>}
              </div>
              {z.status === 'fehler' && z.fehler && <p className="mt-1 text-xs text-rose-700">{z.fehler}</p>}
            </button>
            <div className="flex justify-end gap-3 border-t border-slate-100 px-3 py-1.5 text-xs">
              {z.status !== 'verworfen' ? (
                <button disabled={aktion === z.id || (['aufnahme', 'hochladen'].includes(z.status) && Date.now() - new Date(z.erstellt_am).getTime() < 24 * 3600_000)} onClick={() => verwerfen(z)} className="text-slate-500 disabled:opacity-40">Verwerfen</button>
              ) : (
                <button disabled={aktion === z.id} onClick={() => loeschen(z)} className="text-rose-600 disabled:opacity-40">Endgültig löschen</button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!laedt && sichtbar.length === 0 && <p className="mt-6 text-center text-sm text-slate-500">{zeilen.length ? 'Nichts gefunden.' : 'Noch keine Aufnahmen.'}</p>}
      {laedt && <p className="mt-6 text-center text-sm text-slate-500">Wird geladen …</p>}
      {mehr && !laedt && (
        <button onClick={() => setSeite(seite + 1)} className="mt-4 w-full rounded-lg bg-slate-100 py-2 text-sm text-slate-700">Ältere laden</button>
      )}
    </div>
  )
}
