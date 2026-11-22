// Spalte „Anrufe“ einer Zeile im Tagesablauf: Telefonnummern der verknüpften Akte bzw. des Objekts (am Handy antippen
// = anrufen) und „Anruf notieren“ — die Notiz landet oben im Verlauf der Akte/des Objekts (Server-Aktion tagesplan,
// art anruf_notieren) und als Zeile in den „Anrufen“ des Tages.
import { useState } from 'react'
import { Phone, PhoneCall } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { call as gatewayCall, isEmailGatewayConfigured } from '../../lib/emailGateway'
import type { PlanBezug } from '../../../supabase/functions/_shared/tagesplanKern.ts'
import type { ActivityEntry, Kunde, KundeBereich } from '../../types'
import { alleKunden, bezugPfad, bezugSichtbar, telefonnummern, telLink } from './planDaten'

export function AnrufSpalte({ bezug, onNotiert, kompakt }: { bezug?: PlanBezug; onNotiert: (zeile: string) => void; kompakt?: boolean }) {
  const { state, dispatch } = useApp()
  const [offen, setOffen] = useState(false)
  const [text, setText] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [meldung, setMeldung] = useState('')

  if (!bezug || !bezugSichtbar(bezug, state)) return null
  const nummern = telefonnummern(bezug, state)

  async function notieren() {
    const t = text.trim()
    if (!t || laeuft || !bezug) return
    setLaeuft(true)
    setMeldung('')
    try {
      const r = (await gatewayCall({ action: 'tagesplan', art: 'anruf_notieren', bezug, text: t })) as { eintrag?: ActivityEntry }
      // Den neuen Verlaufseintrag auch hier im Fenster übernehmen (ohne ihn zurückzuschreiben).
      if (r.eintrag) {
        if (bezug.art === 'objekt') {
          const o = state.objekte.find((x) => x.id === bezug.id)
          if (o) dispatch({ type: 'OBJEKT_VOM_SERVER', id: o.id, patch: { activities: [r.eintrag, ...(o.activities ?? [])] } })
        } else {
          const k = alleKunden(state).find((x) => x.id === bezug.id) as (Kunde & { bereich?: string }) | undefined
          if (k?.bereich && k.bereich !== 'privat') {
            dispatch({ type: 'KUNDE_VOM_SERVER', bereich: k.bereich as KundeBereich, id: k.id, patch: { activities: [r.eintrag, ...(k.activities ?? [])], letzteAktivitaet: r.eintrag.date } })
          }
        }
      }
      onNotiert(`${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} ${bezug.name}: ${t}`)
      setText('')
      setOffen(false)
      setMeldung('Im Verlauf notiert.')
    } catch (err) {
      setMeldung(err instanceof Error ? err.message : 'Der Anruf konnte nicht notiert werden.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${kompakt ? '' : 'text-xs'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link to={bezugPfad(bezug, state)} className="truncate text-xs font-medium text-accent-700 hover:underline" title={`${bezug.art === 'objekt' ? 'Objekt' : 'Akte'} öffnen`}>
          {bezug.name}
        </Link>
        {nummern.map((n) => (
          <a key={n.nummer} href={telLink(n.nummer)} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100" title={`${n.wer} anrufen`}>
            <Phone size={12} /> {n.nummer}
          </a>
        ))}
        {isEmailGatewayConfigured && (
          <button onClick={() => setOffen(!offen)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50" aria-expanded={offen}>
            <PhoneCall size={12} /> Anruf notieren
          </button>
        )}
      </div>
      {offen && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && notieren()}
            placeholder="Was ist herausgekommen?"
            aria-label={`Anruf zu ${bezug.name} notieren`}
            autoFocus
          />
          <button onClick={notieren} disabled={!text.trim() || laeuft} className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
            {laeuft ? 'Speichert …' : 'In den Verlauf'}
          </button>
        </div>
      )}
      {meldung && <span className="text-xs text-slate-500">{meldung}</span>}
    </div>
  )
}
