// Seminare eines Akademie-Teilnehmers (21.11.2026): welche Seminare er angefragt, gebucht oder besucht hat.
// Gespeichert in kunden.seminare; der Katalog kommt aus der Tabelle seminare (Seite Akademie → Seminare).
// Seit 22.11.2026 darunter die Anmeldungen dieser Akte zu konkreten Terminen (Tabelle seminar_anmeldungen).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { inputClass } from './ui'
import { ladeSeminare, nachBereich, TEILNEHMER_STAND, type Seminar } from '../lib/seminare'
import { ANMELDE_STATUS, ladeAnmeldungen, ladeTermine, terminZeit, type SeminarAnmeldung, type SeminarTermin } from '../lib/seminarTermine'
import type { Kunde, SeminarBuchung, SeminarStand } from '../types'

export function AkademieSeminare({ kunde, nurLesen = false }: { kunde: Kunde; nurLesen?: boolean }) {
  const { dispatch } = useApp()
  const [katalog, setKatalog] = useState<Seminar[]>([])
  const [auswahl, setAuswahl] = useState('')
  const [anmeldungen, setAnmeldungen] = useState<SeminarAnmeldung[]>([])
  const [termine, setTermine] = useState<SeminarTermin[]>([])
  useEffect(() => {
    ladeSeminare().then(setKatalog).catch(() => setKatalog([]))
  }, [])
  useEffect(() => {
    ladeAnmeldungen({ kundeId: kunde.id })
      .then(async (a) => {
        setAnmeldungen(a)
        if (a.length) setTermine((await ladeTermine()).filter((t) => a.some((x) => x.terminId === t.id)))
      })
      .catch(() => setAnmeldungen([]))
  }, [kunde.id])

  const gebucht = kunde.seminare ?? []
  const frei = useMemo(() => nachBereich(katalog.filter((s) => !gebucht.some((g) => g.id === s.id))), [katalog, gebucht])
  const setze = (liste: SeminarBuchung[]) => dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: 'akademie', id: kunde.id, patch: { seminare: liste } })

  return (
    <div className="space-y-2">
      {gebucht.length === 0 ? (
        <p className="text-sm text-slate-400">Noch kein Seminar eingetragen.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {gebucht.map((g) => (
            <li key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="min-w-0 flex-1 text-slate-700">{katalog.find((s) => s.id === g.id)?.titel ?? g.titel}</span>
              <select
                value={g.stand}
                disabled={nurLesen}
                onChange={(e) => setze(gebucht.map((x) => (x.id === g.id ? { ...x, stand: e.target.value as SeminarStand } : x)))}
                className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
                aria-label={`Stand für ${g.titel}`}
              >
                {TEILNEHMER_STAND.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {!nurLesen && (
                <button onClick={() => setze(gebucht.filter((x) => x.id !== g.id))} className="rounded p-0.5 text-slate-300 hover:text-rose-500" aria-label={`${g.titel} entfernen`}>
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!nurLesen && (
        <select
          value={auswahl}
          onChange={(e) => {
            const s = katalog.find((x) => x.id === e.target.value)
            if (s) setze([...gebucht, { id: s.id, titel: s.titel, stand: 'interessiert' }])
            setAuswahl('')
          }}
          className={`${inputClass} w-full`}
          aria-label="Seminar hinzufügen"
        >
          <option value="">Seminar hinzufügen …</option>
          {frei.map(([bereich, liste]) => (
            <optgroup key={bereich} label={bereich}>
              {liste.map((s) => <option key={s.id} value={s.id}>{s.titel}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      {anmeldungen.length > 0 && (
        <div>
          <p className="mb-1 mt-2 text-xs font-medium text-slate-500">Angemeldet zu Terminen</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {anmeldungen.map((a) => {
              const t = termine.find((x) => x.id === a.terminId)
              const st = ANMELDE_STATUS.find((x) => x.id === a.status)
              return (
                <li key={a.id}>
                  <Link to={`/akademie/termine/${a.terminId}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
                    <span className="min-w-0 flex-1 text-slate-700">
                      {katalog.find((s) => s.id === t?.seminarId)?.titel ?? 'Seminar'}
                      {t && <span className="block text-xs text-slate-500">{terminZeit(t.beginn, t.ende)}</span>}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${st?.farbe ?? ''}`}>{st?.label ?? a.status}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <Link to="/akademie/seminare" className="inline-block text-xs text-slate-500 hover:text-slate-700 hover:underline">Zum Seminarkatalog</Link>
    </div>
  )
}
