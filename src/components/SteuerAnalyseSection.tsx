import { useEffect, useState } from 'react'
import { Loader2, Landmark, FileText, AlertTriangle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { CURRENT_USER } from '../data/constants'
import { supabase } from '../lib/supabaseClient'
import { starteSteuerAnalyse, setzeSteuerAnalyseFort } from '../lib/emailGateway'
import { Card, Modal, PrimaryButton, SecondaryButton } from './ui'
import { fmtDateTime } from '../lib/dates'
import type { KundeBereich, SteuerVorschlag } from '../types'

const BELASTBARKEIT = {
  hoch: { text: 'Beruht auf Zahlen aus Unterlagen der Akte', farbe: 'bg-emerald-50 text-emerald-700' },
  mittel: { text: 'Beruht auf veröffentlichten Zahlen', farbe: 'bg-amber-50 text-amber-700' },
  niedrig: { text: 'Aus Branche und Struktur abgeleitet, ohne Zahlen', farbe: 'bg-slate-100 text-slate-600' },
} as const

// Steuerliche Ansatzpunkte als Teil der Potenzial-Analyse: liest Finanzunterlagen der Akte, bezieht
// alle Firmen des Kunden samt öffentlich einsehbarer Abschlüsse ein und schlägt Wege zur
// Steuerersparnis und Steuerverlagerung vor. Die Arbeit läuft auf dem Server in vier Schritten
// (mehrere Minuten); hier wird nur gestartet, der Fortschritt abgefragt und das Ergebnis gezeigt.
export function SteuerAnalyseSection({ bereich, kundeId }: { bereich: KundeBereich; kundeId: string }) {
  const { state, dispatch } = useApp()
  const [startModal, setStartModal] = useState(false)
  const [wirdGestartet, setWirdGestartet] = useState(false)
  const [fehler, setFehler] = useState('')
  const [grundlageOffen, setGrundlageOffen] = useState(false)
  const [jetzt, setJetzt] = useState(Date.now())

  const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
  const analyse = kunde?.steuerAnalyse

  // Fortschritt abfragen, solange die Analyse auf dem Server läuft. KUNDE_VOM_SERVER ändert nur die
  // Anzeige und schreibt nichts zurück.
  useEffect(() => {
    const client = supabase
    if (!client || analyse?.status !== 'laeuft') return
    const intervall = setInterval(async () => {
      setJetzt(Date.now())
      const { data } = await client.from('kunden').select('steuer_analyse').eq('id', kundeId).eq('bereich', bereich).maybeSingle()
      const frisch = data?.steuer_analyse
      if (frisch && JSON.stringify(frisch) !== JSON.stringify(analyse)) {
        dispatch({ type: 'KUNDE_VOM_SERVER', bereich, id: kundeId, patch: { steuerAnalyse: frisch } })
      }
    }, 5000)
    return () => clearInterval(intervall)
  }, [analyse, bereich, kundeId, dispatch])

  if (!kunde) return null

  const letzterFortschritt = analyse ? new Date(analyse.aktualisiertAm ?? analyse.gestartetAm).getTime() : 0
  const haengt = analyse?.status === 'laeuft' && jetzt - letzterFortschritt > 5 * 60 * 1000
  const laeuftSeitMin = analyse ? Math.max(0, Math.round((jetzt - new Date(analyse.gestartetAm).getTime()) / 60000)) : 0

  async function starten() {
    setStartModal(false)
    setWirdGestartet(true)
    setFehler('')
    try {
      await starteSteuerAnalyse({ bereich, kundeId, gestartetVon: CURRENT_USER })
      const gestartetAm = new Date().toISOString()
      dispatch({
        type: 'KUNDE_VOM_SERVER',
        bereich,
        id: kundeId,
        patch: { steuerAnalyse: { status: 'laeuft', schritt: 'Wird gestartet …', schrittNr: 1, gestartetAm, aktualisiertAm: gestartetAm, gestartetVon: CURRENT_USER } },
      })
      setJetzt(Date.now())
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Steuer-Analyse konnte nicht gestartet werden.')
    } finally {
      setWirdGestartet(false)
    }
  }

  async function fortsetzen() {
    setFehler('')
    try {
      await setzeSteuerAnalyseFort({ bereich, kundeId })
      setJetzt(Date.now())
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Die Steuer-Analyse konnte nicht fortgesetzt werden.')
    }
  }

  const vorschlaege = analyse?.vorschlaege ?? []
  const firmen = [...new Set(vorschlaege.map((v) => v.firma || 'Ohne Zuordnung'))]
  const gelesen = (analyse?.gelesen ?? []).filter((g) => g.ergebnis === 'gelesen')
  const nichtGelesen = (analyse?.gelesen ?? []).filter((g) => g.ergebnis !== 'gelesen')
  const darfStarten = !analyse || analyse.status !== 'laeuft' || haengt

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Landmark size={15} className="text-accent-600" /> Steuerliche Ansatzpunkte
          </h4>
          <p className="text-xs text-slate-400">
            Liest BWA, Jahresabschluss und ähnliche Unterlagen aus der Akte, bezieht alle Firmen des Kunden mit ihren veröffentlichten Abschlüssen ein und sucht Wege zur
            Steuerersparnis und Steuerverlagerung.
          </p>
        </div>
        {darfStarten && (
          <PrimaryButton onClick={() => setStartModal(true)} disabled={wirdGestartet}>
            {wirdGestartet ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />}
            {haengt ? 'Von vorn starten' : analyse?.status === 'fertig' ? 'Erneut analysieren' : analyse?.status === 'fehler' ? 'Erneut versuchen' : 'Steuer-Analyse starten'}
          </PrimaryButton>
        )}
      </div>

      {fehler && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">{fehler}</p>}

      {analyse?.status === 'laeuft' && !haengt && (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 size={16} className="animate-spin text-accent-600" />
            {analyse.schrittNr ? `Schritt ${analyse.schrittNr} von 4: ` : ''}
            {analyse.schritt ?? 'Analyse läuft …'}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Läuft seit {laeuftSeitMin < 1 ? 'weniger als einer Minute' : `${laeuftSeitMin} Min.`} — üblich sind 4 bis 8 Minuten. Du kannst die Seite verlassen, die Analyse läuft auf dem
            Server weiter.
          </p>
        </Card>
      )}

      {haengt && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <p>
            Die Analyse ist hängen geblieben: seit {Math.round((jetzt - letzterFortschritt) / 60000)} Minuten kein Fortschritt{analyse?.schritt ? ` (zuletzt: ${analyse.schritt})` : ''}.
          </p>
          {analyse?.schrittNr && (
            <button onClick={fortsetzen} className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
              Ab Schritt {analyse.schrittNr} fortsetzen
            </button>
          )}
        </div>
      )}

      {analyse?.status === 'fehler' && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-600">Fehler: {analyse.fehler ?? 'unbekannt'}</p>}

      {analyse?.status === 'fertig' && (
        <div className="space-y-3">
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <p>
              Das ist keine Steuerberatung, sondern eine Vorbereitung für das Gespräch mit dem Mandanten und seinem Steuerberater. Zahlen, Rechtsstand und Eignung müssen vor jeder
              Umsetzung dort geprüft werden.
            </p>
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-700">Ergebnis und Grundlage</p>
                <p className="text-xs text-slate-400">
                  Erstellt am {fmtDateTime(analyse.abgeschlossenAm ?? analyse.gestartetAm)}
                  {analyse.gestartetVon ? ` · gestartet von ${analyse.gestartetVon}` : ''}
                </p>
              </div>
              <button
                onClick={() => setGrundlageOffen((o) => !o)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                {grundlageOffen ? 'Grundlage ausblenden' : 'Grundlage im Einzelnen anzeigen'}
              </button>
            </div>
            {analyse.zusammenfassung && <p className="mt-3 text-sm text-slate-700">{analyse.zusammenfassung}</p>}
            {analyse.datenlage && (
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Datenlage:</span> {analyse.datenlage}
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              <span className="font-medium text-slate-600">Aus der Akte gelesen:</span>{' '}
              {gelesen.length > 0 ? gelesen.map((g) => g.name).join(', ') : 'keine Finanzunterlage — in der Akte lag keine lesbare BWA oder kein Jahresabschluss.'}
            </p>

            {grundlageOffen && (
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                {nichtGelesen.length > 0 && (
                  <Abschnitt titel="Nicht gelesene Dateien der Akte">
                    <ul className="space-y-1">
                      {nichtGelesen.map((g) => (
                        <li key={g.name} className="flex gap-2">
                          <FileText size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
                          <span>
                            {g.name} — {g.ergebnis}
                            {g.hinweis ? ` (${g.hinweis})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Abschnitt>
                )}
                {analyse.zwischen?.unterlagen && <Abschnitt titel="Was aus den Unterlagen der Akte gelesen wurde" text={analyse.zwischen.unterlagen} />}
                {analyse.zwischen?.firmen && <Abschnitt titel="Firmen des Kunden laut öffentlicher Recherche" text={analyse.zwischen.firmen} />}
                {analyse.zwischen?.zahlen && <Abschnitt titel="Öffentlich einsehbare Finanzdaten dieser Firmen" text={analyse.zwischen.zahlen} />}
                {analyse.zwischen?.rechtsstand && <Abschnitt titel="Geprüfter aktueller Rechtsstand" text={analyse.zwischen.rechtsstand} />}
                {(analyse.quellen ?? []).length > 0 && (
                  <Abschnitt titel="Quellen">
                    <ul className="space-y-1">
                      {(analyse.quellen ?? []).map((q, i) => (
                        <li key={i} className="break-words">
                          <QuelleMitLink text={q} />
                        </li>
                      ))}
                    </ul>
                  </Abschnitt>
                )}
              </div>
            )}
          </Card>

          {vorschlaege.length === 0 && (
            <Card className="p-4 text-sm text-slate-500">Aus den vorliegenden Daten ließ sich kein belastbarer steuerlicher Ansatzpunkt ableiten.</Card>
          )}

          {firmen.map((firma) => (
            <div key={firma}>
              <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">{firma}</p>
              <div className="space-y-3">
                {vorschlaege
                  .filter((v) => (v.firma || 'Ohne Zuordnung') === firma)
                  .map((v, i) => (
                    <VorschlagKarte key={i} v={v} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!analyse && <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">Noch keine Steuer-Analyse durchgeführt.</p>}

      <Modal open={startModal} onClose={() => setStartModal(false)} title="Steuer-Analyse starten">
        <p className="text-sm text-slate-600">
          Die Analyse liest die Finanzunterlagen dieser Akte, sucht öffentlich nach allen Firmen des Kunden und deren veröffentlichten Abschlüssen, prüft die aktuell geltenden
          Steuerregeln und erarbeitet daraus Vorschläge. Das dauert etwa 4 bis 8 Minuten und verursacht echte KI-Kosten von grob 1 bis 2 € je Durchlauf.
        </p>
        <p className="mt-2 text-sm text-slate-600">Je mehr Zahlen in der Akte liegen (BWA, Jahresabschluss), desto konkreter werden die Vorschläge.</p>
        <div className="mt-4 flex justify-end gap-2">
          <SecondaryButton onClick={() => setStartModal(false)}>Abbrechen</SecondaryButton>
          <PrimaryButton onClick={starten}>Jetzt starten</PrimaryButton>
        </div>
      </Modal>
    </div>
  )
}

function VorschlagKarte({ v }: { v: SteuerVorschlag }) {
  const b = BELASTBARKEIT[v.belastbarkeit] ?? BELASTBARKEIT.niedrig
  return (
    <Card className="p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.art === 'Steuerverlagerung' ? 'bg-sky-50 text-sky-700' : 'bg-accent-50 text-accent-700'}`}>
          {v.art === 'Steuerverlagerung' ? 'Steuerverlagerung (zeitlich)' : 'Steuerersparnis (dauerhaft)'}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${b.farbe}`}>{b.text}</span>
      </div>
      <p className="mb-2 text-sm font-medium text-slate-800">{v.titel}</p>
      <dl className="space-y-1.5 text-sm">
        <Zeile label="Maßnahme" text={v.massnahme} />
        <Zeile label="Wirkung" text={v.wirkung} />
        <Zeile label="Voraussetzungen" text={v.voraussetzungen} />
        <Zeile label="Haken" text={v.haken} />
        <Zeile label="Nächster Schritt" text={v.naechster_schritt} />
      </dl>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        <p>
          <span className="font-medium text-slate-600">Stützt sich auf:</span> {v.grundlage || 'keine Angabe'}
        </p>
        {v.rechtsgrundlage && (
          <p className="mt-1">
            <span className="font-medium text-slate-600">Rechtsgrundlage:</span> {v.rechtsgrundlage}
          </p>
        )}
      </div>
    </Card>
  )
}

function Zeile({ label, text }: { label: string; text: string }) {
  if (!text) return null
  return (
    <div className="sm:flex sm:gap-3">
      <dt className="flex-shrink-0 text-xs font-medium text-slate-400 sm:w-32 sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words text-slate-700">{text}</dd>
    </div>
  )
}

function Abschnitt({ titel, text, children }: { titel: string; text?: string; children?: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{titel}</p>
      <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{text ?? children}</div>
    </div>
  )
}

// Quellen kommen als "Titel – https://…" aus einer KI-Antwort: nur echte Web-Adressen werden zum Link.
function QuelleMitLink({ text }: { text: string }) {
  const m = text.match(/https?:\/\/[^\s)]+/)
  if (!m) return <>{text}</>
  const vorher = text.slice(0, m.index).replace(/[\s–-]+$/, '')
  return (
    <>
      {vorher ? `${vorher} · ` : ''}
      <a href={m[0]} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
        {m[0]}
      </a>
    </>
  )
}
