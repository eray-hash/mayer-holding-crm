// Akte für eine Aufnahme wählen: bestehende Kundenakte suchen oder eine neue mit den nötigsten Angaben
// anlegen (Server: gespraech_akte_setzen). Neue Akten nur in freigegebenen Bereichen oder als privater Kontakt.
import { useEffect, useState } from 'react'
import { BEREICH_NAMEN, sucheAkten, type AkteTreffer } from '../akten'
import { akteSetzen, eigeneEmail, ladeTeam, ServerFehler, type NeueAkte } from './api'

const NEU_BEREICHE = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

export function AkteZuordnen({ aufnahmeId, vorschlagName, onFertig }: { aufnahmeId: string; vorschlagName?: string; onFertig: () => void }) {
  const [modus, setModus] = useState<'suchen' | 'neu'>('suchen')
  const [suche, setSuche] = useState(vorschlagName ?? '')
  const [treffer, setTreffer] = useState<AkteTreffer[]>([])
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState('')
  const [doppelt, setDoppelt] = useState<{ id: string; name: string } | null>(null)
  const [erlaubt, setErlaubt] = useState<string[]>([])
  const [neu, setNeu] = useState<NeueAkte>({ bereich: '', firma: vorschlagName ?? '', ansprechpartner: '', telefon: '', email: '' })

  useEffect(() => {
    let aktiv = true
    Promise.all([ladeTeam(), eigeneEmail()]).then(([team, ich]) => {
      if (!aktiv) return
      const m = team.find((x) => x.email === ich)
      const alle = m && (m.rolle === 'geschaeftsfuehrung' || m.ist_admin)
      const liste = NEU_BEREICHE.filter((b) => alle || (m?.bereiche ?? []).includes(b === 'immobilienkunden' ? 'immobilien' : b))
      setErlaubt([...liste, 'privat'])
      setNeu((n) => ({ ...n, bereich: n.bereich || liste[0] || 'privat' }))
    }).catch(() => setErlaubt(['privat']))
    return () => {
      aktiv = false
    }
  }, [])

  useEffect(() => {
    if (modus !== 'suchen') return
    const s = suche.trim()
    if (s.length < 2) {
      setTreffer([])
      return
    }
    let aktiv = true
    const uhr = setTimeout(() => {
      sucheAkten(s)
        .then((t) => aktiv && setTreffer(t.filter((x) => x.art === 'kunde')))
        .catch(() => aktiv && setTreffer([]))
    }, 250)
    return () => {
      aktiv = false
      clearTimeout(uhr)
    }
  }, [suche, modus])

  async function waehle(kundeId: string) {
    setLaeuft(true)
    setFehler('')
    try {
      await akteSetzen(aufnahmeId, { kundeId })
      onFertig()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaeuft(false)
    }
  }

  async function anlegen(trotzDoppelt = false) {
    setLaeuft(true)
    setFehler('')
    setDoppelt(null)
    try {
      await akteSetzen(aufnahmeId, { neu, trotzDoppelt })
      onFertig()
    } catch (e) {
      const d = e instanceof ServerFehler ? (e.daten.doppelt as { id: string; name: string } | undefined) : undefined
      if (d) setDoppelt(d)
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaeuft(false)
    }
  }

  const feld = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-indigo-500 focus:outline-none'
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">Noch keine Akte zugeordnet</p>
      <div className="mt-2 flex gap-2 text-sm">
        <button className={`rounded-lg px-3 py-1.5 ${modus === 'suchen' ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`} onClick={() => setModus('suchen')}>Akte suchen</button>
        <button className={`rounded-lg px-3 py-1.5 ${modus === 'neu' ? 'bg-white font-medium shadow-sm' : 'text-slate-600'}`} onClick={() => setModus('neu')}>Neue Akte anlegen</button>
      </div>
      {modus === 'suchen' ? (
        <div className="mt-3">
          <input className={feld} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Firma oder E-Mail" autoFocus />
          <div className="mt-2 space-y-1.5">
            {treffer.map((t) => (
              <button key={t.id} disabled={laeuft} onClick={() => waehle(t.id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-indigo-300">
                <span className="text-slate-800">{t.name}</span>
                <span className="text-xs text-slate-400">{t.zusatz}</span>
              </button>
            ))}
            {suche.trim().length >= 2 && treffer.length === 0 && <p className="text-sm text-slate-500">Keine Akte gefunden.</p>}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <select className={feld} value={neu.bereich} onChange={(e) => setNeu({ ...neu, bereich: e.target.value })}>
            {erlaubt.map((b) => <option key={b} value={b}>{b === 'privat' ? 'Privat (nur für mich sichtbar)' : BEREICH_NAMEN[b] ?? b}</option>)}
          </select>
          <input className={feld} value={neu.firma} onChange={(e) => setNeu({ ...neu, firma: e.target.value })} placeholder="Name oder Firma" />
          <input className={feld} value={neu.ansprechpartner} onChange={(e) => setNeu({ ...neu, ansprechpartner: e.target.value })} placeholder="Ansprechpartner (freiwillig)" />
          <input className={feld} value={neu.telefon} onChange={(e) => setNeu({ ...neu, telefon: e.target.value })} placeholder="Telefon (freiwillig)" inputMode="tel" />
          <input className={feld} value={neu.email} onChange={(e) => setNeu({ ...neu, email: e.target.value })} placeholder="E-Mail (freiwillig)" inputMode="email" />
          <button disabled={laeuft || !neu.firma.trim() || !neu.bereich} onClick={() => anlegen(false)} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white disabled:opacity-50">
            Akte anlegen und zuordnen
          </button>
        </div>
      )}
      {fehler && <p className="mt-2 text-sm text-rose-700">{fehler}</p>}
      {doppelt && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={laeuft} onClick={() => waehle(doppelt.id)} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium shadow-sm">„{doppelt.name}“ nehmen</button>
          <button disabled={laeuft} onClick={() => anlegen(true)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 underline">Trotzdem neu anlegen</button>
        </div>
      )}
    </div>
  )
}
