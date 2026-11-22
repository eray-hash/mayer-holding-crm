import { useDeferredValue, useMemo } from 'react'
import { Link2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useBereichsRechte } from '../lib/bereichsRechte'
import { type AkteFuerZuordnung, findeKvKandidaten, KV_STUFE_TEXT, wortHaeufigkeit } from '../../supabase/functions/_shared/kvZuordnung.ts'
import type { Kunde } from '../types'

// Vorschlag einer passenden Akte im Formular „Neuer Kostenvoranschlag“ bzw. beim Bearbeiten eines Eintrags ohne
// Akte (22.11.2026). Gleiche Regeln wie die einmalige Zuordnung auf der Seite (Kern: _shared/kvZuordnung.ts):
// Name, Beschreibung und Notiz werden mit den Akten verglichen, die der Mitarbeiter sehen darf. Öffentliche
// Einträge nur zu öffentlichen Akten, private nur zu eigenen privaten. Ein Klick wählt die Akte nur aus —
// gespeichert wird wie immer mit „Speichern“.

function name(k: Pick<Kunde, 'firma' | 'ansprechpartner'>): string {
  const f = (k.firma ?? '').trim()
  const p = (k.ansprechpartner ?? '').trim()
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

export function KvAkteVorschlag({
  name: kvName,
  beschreibung,
  notiz,
  privat,
  onWaehlen,
}: {
  name: string
  beschreibung: string
  notiz: string
  /** true = Eintrag soll privat bleiben (nur eigene private Akten kommen in Frage). */
  privat: boolean
  onWaehlen: (kundeId: string) => void
}) {
  const { state } = useApp()
  const { session } = useAuth()
  const { kundenBereiche } = useBereichsRechte()
  const email = (session?.user.email ?? '').toLowerCase()
  const eingabe = useDeferredValue(`${kvName}\u0000${beschreibung}\u0000${notiz}`)

  const { akten, haeufigkeit, infos } = useMemo(() => {
    const akten: AkteFuerZuordnung[] = []
    const infos = new Map<string, { titel: string; bereich: string }>()
    for (const b of kundenBereiche) {
      for (const k of b.get(state)) {
        // Eigene private Akten ohne hinterlegten Besitzer gehören beim Speichern dem Angemeldeten (siehe zuordnungZuAkte).
        akten.push({ id: k.id, bereich: b.id, firma: k.firma, ansprechpartner: k.ansprechpartner, email: k.email, verantwortlich_email: b.id === 'privat' ? k.verantwortlichEmail || email : k.verantwortlichEmail })
        infos.set(k.id, { titel: name(k), bereich: b.id === 'privat' ? 'Privat' : b.label })
      }
    }
    return { akten, haeufigkeit: wortHaeufigkeit(akten), infos }
  }, [kundenBereiche, state, email])

  const kandidaten = useMemo(() => {
    const [n, be, no] = eingabe.split('\u0000')
    if (n.trim().length < 3) return []
    return findeKvKandidaten(
      { id: 'neu', name: n, beschreibung: be, notiz: no, bereich: privat ? 'privat' : null, privat_besitzer: privat ? email || null : null },
      akten,
      { haeufigkeit },
    ).slice(0, 2)
  }, [eingabe, privat, email, akten, haeufigkeit])

  if (!kandidaten.length) return null
  return (
    <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-sky-800">
        <Link2 size={13} /> {kandidaten.length === 1 ? 'Passende Akte gefunden' : 'Passende Akten gefunden'} — ohne Akte fehlt der Eintrag in Umsatzvorschau und Rechnungsvorschlägen.
      </p>
      <ul className="space-y-1.5">
        {kandidaten.map((k) => {
          const info = infos.get(k.kunde_id)
          return (
            <li key={k.kunde_id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{info?.titel ?? k.kunde_id}</span>
                <span className="text-xs text-slate-500"> · {info?.bereich} · {KV_STUFE_TEXT[k.stufe]}</span>
                <span className="block text-xs text-slate-500">{k.gruende.join('; ')}</span>
              </span>
              <button type="button" onClick={() => onWaehlen(k.kunde_id)} className="rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100">
                Diese Akte wählen
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
