// Seite „Automatische Nachrichten“ (24.11.2026, Wunsch der Geschäftsführung): die eine Stelle, an der alle
// automatischen Nachrichten stehen — wann sie bei welchem Anlass an wen gehen, wie sie geschaltet sind, ihr Text
// (bearbeitbar, wo es eine Vorlage gibt) und was zuletzt geplant oder verschickt wurde.
// Inhalt: src/lib/automatik/katalog.ts; Stand und Schalter: lib/automatik/schalter.ts; Verlauf: lib/automatik/verlauf.ts.
// Zugang: Geschäftsführung, Admin oder Superuser; bei „Ansehen als …“ nur lesend.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, SecondaryButton } from '../../components/ui'
import { KANAL_TITEL, KATALOG, type Kanal } from '../../lib/automatik/katalog'
import {
  fehlerText,
  ladeAutomatikStand,
  ladeMitarbeiterKurz,
  setzeAutomatikSchalter,
  type AutomatikStand,
  type MitarbeiterKurz,
  type SchalterAenderung,
} from '../../lib/automatik/schalter'
import { ladeVerlauf, type VerlaufEintrag } from '../../lib/automatik/verlauf'
import { EintragKarte } from './EintragKarte'
import { VerlaufListe } from './VerlaufListe'
import { useAutomatikZugang } from './useAutomatikZugang'

type Reiter = 'uebersicht' | 'verlauf'
const KANAELE = Object.keys(KANAL_TITEL) as Kanal[]

export function AutomatischeNachrichten() {
  const { zugang } = useAutomatikZugang()
  if (zugang === null) return <p className="text-sm text-slate-400">Wird geladen …</p>
  if (!zugang) {
    return (
      <Card className="p-5 text-sm text-slate-600">
        <h1 className="mb-1 text-base font-semibold text-slate-800">Automatische Nachrichten</h1>
        Nur für die Geschäftsführung.
      </Card>
    )
  }
  return <Inhalt />
}

function Inhalt() {
  const { state } = useApp()
  const { darfAendern, wer } = useAutomatikZugang()
  const [reiter, setReiter] = useState<Reiter>('uebersicht')
  const [stand, setStand] = useState<AutomatikStand | null>(null)
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterKurz[]>([])
  const [verlauf, setVerlauf] = useState<VerlaufEintrag[]>([])
  const [hinweise, setHinweise] = useState<string[]>([])
  const [verlaufGeladen, setVerlaufGeladen] = useState(false)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState('')

  const kundenNamen = useMemo(() => new Map(state.kunden.map((k) => [k.id, k.firma || k.ansprechpartner])), [state.kunden])
  const kundenName = useCallback((id?: string | null) => (id ? kundenNamen.get(id) : undefined), [kundenNamen])

  const laden = useCallback(async () => {
    setLaedt(true)
    setFehler('')
    try {
      const [s, m] = await Promise.all([ladeAutomatikStand(), ladeMitarbeiterKurz().catch(() => [] as MitarbeiterKurz[])])
      setStand(s)
      setMitarbeiter(m)
      const v = await ladeVerlauf(30, kundenName, m)
      setVerlauf(v.eintraege)
      setHinweise(v.hinweise)
    } catch (e) {
      setFehler(fehlerText(e, 'Laden hat nicht geklappt.'))
    } finally {
      setVerlaufGeladen(true)
      setLaedt(false)
    }
    // kundenName absichtlich nicht als Abhängigkeit: sonst lädt alles neu, sobald sich eine Akte ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    laden()
  }, [laden])

  const onSchalter = useCallback(
    async (id: string, a: SchalterAenderung): Promise<boolean> => {
      if (!stand || !darfAendern) return false
      setFehler('')
      try {
        setStand(await setzeAutomatikSchalter(id, a, stand, wer))
        return true
      } catch (e) {
        setFehler(fehlerText(e, 'Die Einstellung ließ sich nicht speichern.'))
        return false
      }
    },
    [stand, darfAendern, wer],
  )

  const letzteJe = useMemo(() => {
    const m = new Map<string, VerlaufEintrag[]>()
    // Wiedervorlagen: die nächsten fälligen; sonst die zuletzt verschickten.
    const naechste = verlauf.filter((v) => v.katalogId === 'wv_regeln').sort((a, b) => a.zeitpunkt.localeCompare(b.zeitpunkt))
    const sortiert = [...verlauf].filter((v) => v.stand !== 'geplant').sort((a, b) => b.zeitpunkt.localeCompare(a.zeitpunkt))
    for (const v of [...naechste, ...sortiert]) {
      if (!v.katalogId) continue
      const l = m.get(v.katalogId) ?? []
      if (l.length < 5) l.push(v)
      m.set(v.katalogId, l)
    }
    return m
  }, [verlauf])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Automatische Nachrichten</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Alle Nachrichten, die das CRM von selbst verschickt: bei welchem Anlass, wann und an wen — mit Schalter, Text und dem, was zuletzt geplant oder verschickt wurde.
          </p>
        </div>
        <SecondaryButton onClick={laden} disabled={laedt}>
          <RefreshCw size={14} className={laedt ? 'animate-spin' : ''} /> Aktualisieren
        </SecondaryButton>
      </div>

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
      {!darfAendern && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Nur lesen: In der Ansicht als anderer Mitarbeiter lässt sich hier nichts ändern.</p>}
      {stand?.quelle === 'ersatz' && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Der Server liefert die Einstellungen gerade nicht. Angezeigt ist, was sich direkt lesen lässt (Willkommensnachricht, automatische Mails, Wiedervorlage-Regeln); die übrigen Schalter stehen auf „Stand unbekannt“.
        </p>
      )}

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {(
          [
            ['uebersicht', 'Übersicht'],
            ['verlauf', 'Verlauf'],
          ] as [Reiter, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setReiter(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${reiter === id ? 'border-accent-600 text-accent-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {reiter === 'uebersicht' ? (
        <div className="space-y-6">
          {KANAELE.map((k) => {
            const eintraege = KATALOG.filter((e) => e.kanal === k)
            if (eintraege.length === 0) return null
            return (
              <section key={k}>
                <h2 className="mb-2 text-sm font-semibold text-slate-700">
                  {KANAL_TITEL[k]} <span className="font-normal text-slate-400">({eintraege.length})</span>
                </h2>
                <div className="space-y-2">
                  {eintraege.map((e) => (
                    <EintragKarte
                      key={e.id}
                      eintrag={e}
                      stand={stand}
                      mitarbeiter={mitarbeiter}
                      letzte={letzteJe.get(e.id) ?? []}
                      verlaufGeladen={verlaufGeladen}
                      darfAendern={darfAendern}
                      onSchalter={onSchalter}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <VerlaufListe eintraege={verlauf} hinweise={hinweise} laedt={laedt} />
      )}
    </div>
  )
}
