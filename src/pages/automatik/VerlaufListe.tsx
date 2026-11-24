// Reiter „Verlauf“: alle geplanten und verschickten automatischen Nachrichten in einer Liste — zuerst „Geplant“,
// dann „Verschickt“, dann „Fehler und nicht gesendet“. Filter nach Kanal, Nachricht und Zeitraum; Klick zeigt den Text.
import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card, EmptyState } from '../../components/ui'
import { KANAL_TITEL, KATALOG, type Kanal } from '../../lib/automatik/katalog'
import { zeitText } from '../../lib/automatik/schalter'
import { STAND_FARBE, WEG_TEXT, nachrichtName, ordneVerlauf, type VerlaufEintrag } from '../../lib/automatik/verlauf'

const KANAELE = (Object.keys(KANAL_TITEL) as Kanal[]).filter((k) => k !== 'privat')
const SELECT = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700'

export function VerlaufListe({ eintraege, hinweise, laedt }: { eintraege: VerlaufEintrag[]; hinweise: string[]; laedt: boolean }) {
  const [kanal, setKanal] = useState<Kanal | ''>('')
  const [nachricht, setNachricht] = useState('')
  const [tage, setTage] = useState<7 | 30>(30)

  const gruppen = useMemo(() => {
    const seit = new Date(Date.now() - tage * 86400000).toISOString()
    const passend = eintraege.filter(
      (v) => (!kanal || v.kanal === kanal) && (!nachricht || v.katalogId === nachricht) && (v.stand === 'geplant' || v.zeitpunkt >= seit),
    )
    return ordneVerlauf(passend)
  }, [eintraege, kanal, nachricht, tage])

  const nachrichtenWahl = useMemo(() => KATALOG.filter((e) => e.kanal !== 'privat' && e.protokoll !== 'keins' && (!kanal || e.kanal === kanal)), [kanal])
  const leer = gruppen.geplant.length + gruppen.gesendet.length + gruppen.fehler.length === 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={kanal}
          onChange={(e) => {
            setKanal(e.target.value as Kanal | '')
            setNachricht('')
          }}
          className={SELECT}
          aria-label="Kanal"
        >
          <option value="">Alle Kanäle</option>
          {KANAELE.map((k) => (
            <option key={k} value={k}>
              {KANAL_TITEL[k]}
            </option>
          ))}
        </select>
        <select value={nachricht} onChange={(e) => setNachricht(e.target.value)} className={`${SELECT} max-w-[280px]`} aria-label="Nachricht">
          <option value="">Alle Nachrichten</option>
          {nachrichtenWahl.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <select value={tage} onChange={(e) => setTage(Number(e.target.value) as 7 | 30)} className={SELECT} aria-label="Zeitraum">
          <option value={7}>letzte 7 Tage</option>
          <option value={30}>letzte 30 Tage</option>
        </select>
        {laedt && <span className="text-xs text-slate-400">wird geladen …</span>}
      </div>

      {hinweise.length > 0 && (
        <ul className="mb-3 space-y-0.5 text-xs text-slate-400">
          {hinweise.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      {leer && !laedt ? (
        <EmptyState text="Für diese Auswahl gibt es keine Nachrichten." />
      ) : (
        <div className="space-y-5">
          <Gruppe titel="Geplant" liste={gruppen.geplant} zeitTitel="geplant für" />
          <Gruppe titel="Verschickt" liste={gruppen.gesendet} zeitTitel="gesendet am" />
          <Gruppe titel="Fehler und nicht gesendet" liste={gruppen.fehler} zeitTitel="Zeitpunkt" />
        </div>
      )}
      <p className="mt-4 text-xs text-slate-400">Der private Assistent wird bewusst nirgends aufgezeichnet und fehlt deshalb hier.</p>
    </div>
  )
}

function Gruppe({ titel, liste, zeitTitel }: { titel: string; liste: VerlaufEintrag[]; zeitTitel: string }) {
  const [offen, setOffen] = useState<string | null>(null)
  if (liste.length === 0) return null
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        {titel} <span className="font-normal text-slate-400">({liste.length})</span>
      </h3>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">{zeitTitel}</th>
              <th className="px-3 py-2 font-medium">Nachricht</th>
              <th className="px-3 py-2 font-medium">An</th>
              <th className="px-3 py-2 font-medium">Kanal</th>
              <th className="px-3 py-2 font-medium">Stand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {liste.map((v) => {
              const istOffen = offen === v.key
              const hatText = !!(v.text || v.betreff)
              return (
                <Fragment key={v.key}>
                  <tr
                    onClick={() => hatText && setOffen(istOffen ? null : v.key)}
                    className={hatText ? 'cursor-pointer hover:bg-slate-50' : ''}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{zeitText(v.zeitpunkt)}</td>
                    <td className="px-3 py-2 text-slate-800">
                      <span className="flex items-center gap-1">
                        {hatText ? istOffen ? <ChevronDown size={13} className="shrink-0 text-slate-400" /> : <ChevronRight size={13} className="shrink-0 text-slate-400" /> : <span className="w-[13px]" />}
                        {v.weg === 'intern' && v.betreff ? `Wiedervorlage: ${v.betreff}` : nachrichtName(v)}
                      </span>
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-slate-600" title={v.an}>
                      {v.an}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{WEG_TEXT[v.weg]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STAND_FARBE[v.stand]}`}>{v.standText}</span>
                    </td>
                  </tr>
                  {istOffen && (
                    <tr>
                      <td colSpan={5} className="bg-slate-50 px-3 py-2">
                        {v.betreff && <p className="mb-1 text-xs font-medium text-slate-500">Betreff: {v.betreff}</p>}
                        {v.text && <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700">{v.text}</pre>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </Card>
    </section>
  )
}
