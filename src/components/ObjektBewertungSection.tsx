import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, ClipboardCheck, Copy, ExternalLink, FileText, Loader2, Printer, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { CURRENT_USER } from '../data/constants'
import { druckeBlatt } from '../lib/blattDruck'
import { fmtDate } from '../lib/dates'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { isEmailGatewayConfigured, ladeObjektBewertung, setzeObjektBewertungFort, starteObjektBewertung, verwerfeObjektBewertung } from '../lib/emailGateway'
import {
  ENTWURF_KURZ,
  ENTWURF_TEXT,
  bewertungDruckAbschnitte,
  bewertungHaengt,
  bewertungSignatur,
  entstehungText,
  fettStuecke,
  fortschrittProzent,
  hatUebernehmbareKennzahlen,
  kennzahlKacheln,
  letzterFortschritt,
  schlageAnweisungVor,
  schrittText,
  sichereAdresse,
  uebernehmeInKurzpruefung,
  zaehleUnterlagen,
  zeitpunkt,
  zerlegeBericht,
} from '../lib/bewertungAnzeige'
import type { Objekt, ObjektBewertung, Vorlage } from '../types'

type Vorgang = '' | 'start' | 'fortsetzen' | 'verwerfen'

const fehlerText = (err: unknown, ersatz: string) => (err instanceof Error && err.message ? err.message : ersatz)

/** Bewertung eines Objekts per Knopf: Anweisung wählen und starten, Fortschritt des Laufs auf dem Server
 *  verfolgen, Ergebnis lesen, drucken und in die Vorab-Kurzprüfung übernehmen.
 *  `objekt.bewertung` schreibt nur der Server — hier wird der Stand gelesen und mit OBJEKT_VOM_SERVER
 *  angezeigt, aber nie gespeichert. */
export function ObjektBewertungSection({ objekt }: { objekt: Objekt }) {
  const { state, dispatch } = useApp()
  const bewertung = objekt.bewertung
  const status = bewertung?.status
  const laeuft = status === 'laeuft'

  // Die hinterlegten KI-Anweisungen der Abteilung — dieselbe Auswahl wie beim Exposé in ObjektDetail.tsx.
  const anweisungen = useMemo(() => state.vorlagenImmobilien.filter((v) => v.kategorie === 'ki' && v.text.trim() !== ''), [state.vorlagenImmobilien])
  const [wahl, setWahl] = useState<string | null>(null)
  const vorlageId = wahl ?? schlageAnweisungVor(anweisungen, bewertung?.vorlageId)
  const [zusatz, setZusatz] = useState('')
  const [neuEinlesen, setNeuEinlesen] = useState(false)
  const [formOffen, setFormOffen] = useState(false)

  const [vorgang, setVorgang] = useState<Vorgang>('')
  const [fehler, setFehler] = useState('')
  const [abfrageFehler, setAbfrageFehler] = useState('')
  const [uebernahme, setUebernahme] = useState<{ text: string; eingetragen: boolean } | null>(null)
  const [kopiert, setKopiert] = useState(false)
  const [jetzt, setJetzt] = useState(() => Date.now())

  // Aktueller Stand für die Abfrage im Hintergrund, ohne sie bei jeder Änderung neu aufzusetzen.
  const standRef = useRef(bewertung)
  useEffect(() => {
    standRef.current = bewertung
  }, [bewertung])
  // Nach „Starten"/„Fortsetzen" zeigt das Fenster schon „läuft", während in der Datenbank noch kurz der
  // alte Stand steht. Solange die Abfrage genau diesen alten Stand liefert, wird er nicht zurückgeholt.
  const alterStand = useRef<{ signatur: string; seit: number } | null>(null)

  function zeige(b: ObjektBewertung | undefined) {
    dispatch({ type: 'OBJEKT_VOM_SERVER', id: objekt.id, patch: { bewertung: b } })
  }

  // Stand aus der Datenbank holen: einmal beim Öffnen (jemand anderes kann inzwischen gestartet haben, oder
  // der Lauf ist fertig geworden) und alle 5 Sekunden, solange die Bewertung läuft.
  useEffect(() => {
    let aktiv = true
    let unterwegs = false
    let leerInFolge = 0
    async function abfragen() {
      if (unterwegs) return
      unterwegs = true
      try {
        const frisch = await ladeObjektBewertung(objekt.id)
        if (!aktiv) return
        const lokal = standRef.current
        if (!frisch) {
          // Kein Stand mehr in der Datenbank: in einem anderen Fenster verworfen. Bei einem gerade
          // gestarteten Lauf erst nach drei leeren Antworten glauben.
          leerInFolge += 1
          if (lokal && isSupabaseConfigured && leerInFolge >= (lokal.status === 'laeuft' ? 3 : 1)) {
            alterStand.current = null
            dispatch({ type: 'OBJEKT_VOM_SERVER', id: objekt.id, patch: { bewertung: undefined } })
            setAbfrageFehler('Zu diesem Objekt gibt es auf dem Server keine Bewertung mehr – vermutlich wurde sie in einem anderen Fenster verworfen.')
          }
          return
        }
        leerInFolge = 0
        setAbfrageFehler('')
        const signatur = bewertungSignatur(frisch)
        const alt = alterStand.current
        if (alt && alt.signatur === signatur && Date.now() - alt.seit < 90_000) return
        alterStand.current = null
        if (signatur !== bewertungSignatur(lokal)) dispatch({ type: 'OBJEKT_VOM_SERVER', id: objekt.id, patch: { bewertung: frisch } })
      } catch (err) {
        if (aktiv) setAbfrageFehler(`Der Stand konnte gerade nicht abgefragt werden: ${fehlerText(err, 'unbekannter Fehler')}`)
      } finally {
        unterwegs = false
      }
    }
    void abfragen()
    if (!laeuft) {
      return () => {
        aktiv = false
      }
    }
    const takt = setInterval(() => {
      setJetzt(Date.now())
      void abfragen()
    }, 5000)
    return () => {
      aktiv = false
      clearInterval(takt)
    }
  }, [objekt.id, laeuft, dispatch])

  const haengt = bewertungHaengt(bewertung, jetzt)
  const beschaeftigt = vorgang !== ''

  async function starten() {
    if (!vorlageId || beschaeftigt) return
    setVorgang('start')
    setFehler('')
    setAbfrageFehler('')
    setUebernahme(null)
    const vorher = bewertungSignatur(bewertung)
    try {
      const hinweis = zusatz.trim()
      await starteObjektBewertung(objekt.id, vorlageId, hinweis, neuEinlesen)
      let frisch: ObjektBewertung | null = null
      try {
        frisch = await ladeObjektBewertung(objekt.id)
      } catch {
        // Die Abfrage im Hintergrund holt den Stand gleich nach; bis dahin gilt der vorläufige unten.
      }
      if (frisch && bewertungSignatur(frisch) !== vorher) {
        alterStand.current = null
        zeige(frisch)
      } else {
        const zeit = new Date().toISOString()
        alterStand.current = { signatur: vorher, seit: Date.now() }
        zeige({ status: 'laeuft', schritt: 'Wird gestartet …', gestartetAm: zeit, aktualisiertAm: zeit, gestartetVon: CURRENT_USER, vorlageId, vorlageName: anweisungen.find((a) => a.id === vorlageId)?.name, zusatz: hinweis || undefined })
      }
      setFormOffen(false)
      setZusatz('')
      setJetzt(Date.now())
    } catch (err) {
      setFehler(fehlerText(err, 'Die Bewertung konnte nicht gestartet werden.'))
    } finally {
      setVorgang('')
    }
  }

  async function fortsetzen() {
    if (!bewertung || beschaeftigt) return
    const vorher = bewertung
    setVorgang('fortsetzen')
    setFehler('')
    setAbfrageFehler('')
    // Gleich als „läuft" zeigen, damit der Fortschritt wieder abgefragt wird, auch wenn der Aufruf länger dauert.
    alterStand.current = { signatur: bewertungSignatur(vorher), seit: Date.now() }
    zeige({ ...vorher, status: 'laeuft', fehler: undefined, aktualisiertAm: new Date().toISOString() })
    setFormOffen(false)
    setJetzt(Date.now())
    try {
      await setzeObjektBewertungFort(objekt.id)
    } catch (err) {
      setFehler(fehlerText(err, 'Die Bewertung konnte nicht fortgesetzt werden.'))
      // Zurück auf den wirklichen Stand: den aus der Datenbank, sonst den von vor dem Klick.
      alterStand.current = null
      let stand: ObjektBewertung = vorher
      try {
        stand = (await ladeObjektBewertung(objekt.id)) ?? vorher
      } catch {
        // bleibt beim Stand von vor dem Klick
      }
      zeige(stand)
    } finally {
      setVorgang('')
    }
  }

  async function verwerfen(frage: string) {
    if (beschaeftigt || !window.confirm(frage)) return
    setVorgang('verwerfen')
    setFehler('')
    setAbfrageFehler('')
    try {
      await verwerfeObjektBewertung(objekt.id)
      alterStand.current = null
      zeige(undefined)
      setFormOffen(false)
      setUebernahme(null)
    } catch (err) {
      setFehler(fehlerText(err, 'Die Bewertung konnte nicht verworfen werden.'))
    } finally {
      setVorgang('')
    }
  }

  function formOeffnen() {
    // Dieselbe Anweisung und denselben Hinweis wie beim letzten Lauf vorschlagen.
    setWahl(null)
    setZusatz(bewertung?.zusatz ?? '')
    setFormOffen(true)
  }

  function inKurzpruefung() {
    const r = uebernehmeInKurzpruefung(objekt, bewertung?.kennzahlen)
    if (r.gefuellt.length === 0) {
      setUebernahme({
        eingetragen: false,
        text:
          r.belegt.length > 0
            ? `Nichts eingetragen: In der Kurzprüfung ${r.belegt.length === 1 ? 'ist das Marktwert-Feld' : 'sind die Marktwert-Felder'} für ${r.belegt.join(', ')} schon ausgefüllt.`
            : 'Nichts eingetragen: Die Bewertung nennt keine Kennzahlen, die in die Kurzprüfung passen.',
      })
      return
    }
    dispatch({ type: 'UPDATE_OBJEKT', id: objekt.id, patch: { kurzpruefung: r.kurzpruefung } })
    setUebernahme({
      eingetragen: true,
      text: `In die Spalte „Marktwert“ der Kurzprüfung eingetragen: ${r.gefuellt.join(', ')}.${r.belegt.length > 0 ? ` Schon ausgefüllt und nicht geändert: ${r.belegt.join(', ')}.` : ''}`,
    })
  }

  async function kopieren() {
    const text = bewertung?.bericht ?? ''
    let gelungen = false
    try {
      await navigator.clipboard.writeText(text)
      gelungen = true
    } catch {
      // Zwischenablage gesperrt (z. B. Fenster nicht im Vordergrund): der ältere Weg über ein verstecktes Textfeld.
      const feld = document.createElement('textarea')
      feld.value = text
      feld.setAttribute('readonly', '')
      feld.style.position = 'fixed'
      feld.style.opacity = '0'
      document.body.appendChild(feld)
      feld.select()
      try {
        gelungen = document.execCommand('copy')
      } catch {
        gelungen = false
      }
      feld.remove()
    }
    if (gelungen) {
      setFehler('')
      setKopiert(true)
      setTimeout(() => setKopiert(false), 2500)
    } else {
      // Die Meldung des Browsers wäre englisch — deshalb ein eigener Satz.
      setFehler('Der Text konnte nicht in die Zwischenablage kopiert werden. Bitte den Text unten markieren und von Hand kopieren.')
    }
  }

  function drucken() {
    if (!bewertung) return
    druckeBlatt(`Bewertung – ${objekt.bezeichnung}`, `${ENTWURF_KURZ.replace(/\.$/, '')} · ${entstehungText(bewertung)}`, bewertungDruckAbschnitte(objekt, bewertung))
  }

  const formular = (erneut: boolean) => (
    <StartFormular
      objekt={objekt}
      anweisungen={anweisungen}
      vorlageId={vorlageId}
      onVorlage={setWahl}
      zusatz={zusatz}
      onZusatz={setZusatz}
      grundlage={bewertung?.status === 'fertig' ? bewertung.grundlage : undefined}
      neuEinlesen={neuEinlesen}
      onNeuEinlesen={setNeuEinlesen}
      onStart={starten}
      startet={vorgang === 'start'}
      gesperrt={beschaeftigt}
      erneut={erneut}
      onSchliessen={erneut ? () => setFormOffen(false) : undefined}
    />
  )

  const kacheln = status === 'fertig' ? kennzahlKacheln(bewertung?.kennzahlen, objekt.kaufpreis) : []
  const gestartet = bewertung ? zeitpunkt(bewertung.gestartetAm) : ''
  const laeuftSeitMin = bewertung ? Math.max(0, Math.round((jetzt - new Date(bewertung.gestartetAm).getTime()) / 60000)) || 0 : 0
  const stilleMin = bewertung ? Math.max(0, Math.round((jetzt - letzterFortschritt(bewertung)) / 60000)) : 0

  return (
    <div className="min-w-0 space-y-5">
      {fehler && (
        <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 [overflow-wrap:anywhere]">
          {fehler}
        </p>
      )}
      {abfrageFehler && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 [overflow-wrap:anywhere]">{abfrageFehler}</p>}

      {!bewertung && formular(false)}

      {bewertung && laeuft && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            {haengt ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-500" /> : <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-accent-600" />}
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-700 [overflow-wrap:anywhere]">{schrittText(bewertung)}</h3>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label="Fortschritt der Bewertung"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={fortschrittProzent(bewertung)}
              >
                <div className={`h-full rounded-full transition-all duration-500 ${haengt ? 'bg-amber-400' : 'bg-accent-600'}`} style={{ width: `${fortschrittProzent(bewertung)}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-500 [overflow-wrap:anywhere]">
                {gestartet ? `Gestartet am ${gestartet}` : 'Gestartet'}
                {bewertung.gestartetVon ? ` von ${bewertung.gestartetVon}` : ''} · läuft seit {laeuftSeitMin < 1 ? 'weniger als einer Minute' : `${laeuftSeitMin} Min.`}
                {bewertung.vorlageName ? ` · Anweisung „${bewertung.vorlageName}“` : ''}
              </p>
              {!haengt && (
                <p className="mt-1 text-xs text-slate-400">Üblich sind 3 bis 8 Minuten. Du kannst das Fenster schließen – die Bewertung läuft auf dem Server weiter und steht danach hier.</p>
              )}
            </div>
          </div>

          {haengt && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Die Bewertung scheint zu hängen.</p>
              <p className="mt-0.5">
                Seit {stilleMin} Minuten gibt es keinen Fortschritt{bewertung.schritt ? ` (zuletzt: ${bewertung.schritt})` : ''}. „Fortsetzen“ macht ab dem letzten fertigen Schritt weiter.
              </p>
              <PrimaryButton onClick={fortsetzen} disabled={beschaeftigt} className="mt-2">
                {vorgang === 'fortsetzen' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Fortsetzen
              </PrimaryButton>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={() => verwerfen('Die laufende Bewertung abbrechen und verwerfen? Was bisher erarbeitet wurde, geht verloren.')} disabled={beschaeftigt}>
              {vorgang === 'verwerfen' ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Abbrechen und verwerfen
            </SecondaryButton>
          </div>
        </Card>
      )}

      {bewertung && status === 'fehler' && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-700">Die Bewertung ist abgebrochen</h3>
              <p className="mt-0.5 text-xs text-slate-500 [overflow-wrap:anywhere]">
                Abgebrochen bei: {schrittText(bewertung, 'Schritt unbekannt')}
                {gestartet ? ` · gestartet am ${gestartet}` : ''}
                {bewertung.gestartetVon ? ` von ${bewertung.gestartetVon}` : ''}
                {bewertung.vorlageName ? ` · Anweisung „${bewertung.vorlageName}“` : ''}
              </p>
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-sm text-rose-700 [overflow-wrap:anywhere]">{bewertung.fehler?.trim() || 'Der Server hat keinen Grund genannt.'}</p>
              <p className="mt-2 text-xs text-slate-400">„Fortsetzen“ macht ab dem letzten fertigen Schritt weiter – was schon erarbeitet ist, bleibt erhalten. „Neu starten“ beginnt von vorn.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={() => verwerfen('Die abgebrochene Bewertung verwerfen?')} disabled={beschaeftigt}>
              {vorgang === 'verwerfen' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Verwerfen
            </SecondaryButton>
            <SecondaryButton onClick={formOeffnen} disabled={beschaeftigt || formOffen}>
              <Sparkles size={14} /> Neu starten
            </SecondaryButton>
            <PrimaryButton onClick={fortsetzen} disabled={beschaeftigt}>
              {vorgang === 'fortsetzen' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Fortsetzen
            </PrimaryButton>
          </div>
        </Card>
      )}

      {bewertung && status === 'fertig' && (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-700 [overflow-wrap:anywhere]">Bewertung – {objekt.bezeichnung}</h3>
              <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">{entstehungText(bewertung)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton onClick={formOeffnen} disabled={beschaeftigt || formOffen}>
                <RefreshCw size={14} /> Neu bewerten
              </SecondaryButton>
              <SecondaryButton onClick={() => verwerfen('Diese Bewertung verwerfen? Der Text und die Kennzahlen werden gelöscht. Was schon in die Kurzprüfung übernommen wurde, bleibt dort stehen.')} disabled={beschaeftigt}>
                {vorgang === 'verwerfen' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Verwerfen
              </SecondaryButton>
            </div>
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <p>
              <strong>{ENTWURF_KURZ}</strong> {ENTWURF_TEXT}
            </p>
          </div>
        </Card>
      )}

      {bewertung && !laeuft && formOffen && formular(true)}

      {bewertung && status === 'fertig' && (
        <>
          {kacheln.length > 0 && (
            <div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                {kacheln.map((k) => (
                  <div key={k.id} className={`min-w-0 rounded-xl border p-4 shadow-sm ${k.breit ? 'col-span-2 border-accent-100 bg-accent-50' : 'border-slate-200 bg-white'}`}>
                    <div className={`text-xs font-medium ${k.breit ? 'text-accent-700' : 'text-slate-500'}`}>{k.titel}</div>
                    <div className="mt-1 text-lg font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere]">{k.wert}</div>
                    {k.zusatz && <div className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{k.zusatz}</div>}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {hatUebernehmbareKennzahlen(bewertung.kennzahlen) && (
                  <SecondaryButton onClick={inKurzpruefung} disabled={beschaeftigt}>
                    <ClipboardCheck size={14} /> In die Kurzprüfung übernehmen
                  </SecondaryButton>
                )}
                <p className="min-w-0 basis-full text-xs text-slate-400 [overflow-wrap:anywhere] sm:flex-1 sm:basis-0">Die Zahlen sind aus dem Text unten herausgezogen. Übernommen wird nur in leere Marktwert-Felder der Kurzprüfung.</p>
              </div>
              {uebernahme && (
                <p className={`mt-2 rounded-lg p-3 text-sm ${uebernahme.eingetragen ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`} role="status">
                  {uebernahme.text}
                </p>
              )}
            </div>
          )}
          {kacheln.length === 0 && <p className="text-xs text-slate-400">Der Text nennt keine Kennzahlen, die sich eindeutig herausziehen ließen – deshalb gibt es hier keine Übersicht und nichts für die Kurzprüfung.</p>}

          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-700">Bewertungstext</h3>
              <div className="flex flex-wrap items-center gap-2">
                {kopiert && (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-600" role="status">
                    <Check size={13} /> Kopiert
                  </span>
                )}
                <SecondaryButton onClick={kopieren} disabled={!bewertung.bericht}>
                  <Copy size={14} /> Text kopieren
                </SecondaryButton>
                <SecondaryButton onClick={drucken}>
                  <Printer size={14} /> Drucken
                </SecondaryButton>
              </div>
            </div>
            {bewertung.bericht?.trim() ? <BerichtAnzeige text={bewertung.bericht} /> : <p className="text-sm text-slate-400">Der Server hat keinen Text geliefert. Bitte „Neu bewerten“.</p>}
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Grundlage dieser Bewertung</h3>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <NamenListe titel="Gelesene Unterlagen" namen={bewertung.gelesen ?? []} leer="Es wurden keine Unterlagen gelesen – die Bewertung stützt sich nur auf die Stammdaten und die Marktrecherche." gelesen />
              <NamenListe titel="Nicht gelesen" namen={bewertung.nichtGelesen ?? []} leer="Keine Unterlage wurde ausgelassen." hinweis="Zu groß oder in einer Art, die die KI nicht lesen kann. Was dort steht, fehlt in der Bewertung." />
            </div>

            <h4 className="mb-2 mt-5 text-xs font-medium uppercase tracking-wide text-slate-400">Quellen der Marktrecherche</h4>
            {(bewertung.quellen ?? []).length === 0 ? (
              <p className="text-sm text-slate-400">Der Server hat keine Quellen gemeldet. Zahlen zum Markt sind dann nicht belegt und besonders sorgfältig zu prüfen.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {(bewertung.quellen ?? []).map((q, i) => {
                  const adresse = sichereAdresse(q?.url)
                  const titel = q?.titel?.trim() || q?.url || 'Quelle'
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <ExternalLink size={13} className="mt-1 shrink-0 text-slate-300" />
                      {adresse ? (
                        <a href={adresse} target="_blank" rel="noopener noreferrer" className="min-w-0 text-accent-700 hover:underline [overflow-wrap:anywhere]">
                          {titel}
                        </a>
                      ) : (
                        <span className="min-w-0 text-slate-600 [overflow-wrap:anywhere]">{titel}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
              <Angabe label="Gestartet" wert={[gestartet, bewertung.gestartetVon ? `von ${bewertung.gestartetVon}` : ''].filter(Boolean).join(' ')} />
              <Angabe label="Fertig" wert={zeitpunkt(bewertung.abgeschlossenAm)} />
              <Angabe label="KI-Anweisung" wert={bewertung.vorlageName ?? ''} />
              <Angabe label="Zusätzlicher Hinweis" wert={bewertung.zusatz ?? ''} />
              <Angabe
                label="Übernommen"
                wert={[
                  bewertung.wiederverwendet?.unterlagenVom ? `Faktenblatt der Unterlagen vom ${fmtDate(bewertung.wiederverwendet.unterlagenVom.slice(0, 10))}` : '',
                  bewertung.wiederverwendet?.marktVom ? `Marktrecherche vom ${fmtDate(bewertung.wiederverwendet.marktVom.slice(0, 10))}` : '',
                ].filter(Boolean).join(' · ')}
              />
            </dl>
          </Card>
        </>
      )}
    </div>
  )
}

// ── Startformular ────────────────────────────────────────────────────────────────────────────────

function StartFormular({
  objekt,
  anweisungen,
  vorlageId,
  onVorlage,
  zusatz,
  onZusatz,
  grundlage,
  neuEinlesen,
  onNeuEinlesen,
  onStart,
  startet,
  gesperrt,
  erneut,
  onSchliessen,
}: {
  objekt: Objekt
  anweisungen: Vorlage[]
  vorlageId: string
  onVorlage: (id: string) => void
  zusatz: string
  onZusatz: (text: string) => void
  /** Grundlage des letzten fertigen Laufs: Unverändertes wird übernommen statt neu bezahlt. */
  grundlage?: { unterlagenAm: string; marktAm: string }
  neuEinlesen: boolean
  onNeuEinlesen: (wert: boolean) => void
  onStart: () => void
  startet: boolean
  gesperrt: boolean
  /** Es gibt schon eine Bewertung, die beim Start ersetzt wird. */
  erneut: boolean
  onSchliessen?: () => void
}) {
  const unterlagen = zaehleUnterlagen(objekt)
  const ohneDatei = unterlagen.gesamt - unterlagen.mitDatei

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <Sparkles size={15} className="shrink-0 text-accent-600" /> {erneut ? 'Neu bewerten' : 'Bewertung per Knopf'}
        </h3>
        {onSchliessen && (
          <button type="button" onClick={onSchliessen} disabled={gesperrt} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50" aria-label="Schließen">
            <X size={16} />
          </button>
        )}
      </div>

      <p className="mb-4 text-sm text-slate-600">
        Die KI liest die Unterlagen dieses Objekts, recherchiert den Markt und schreibt daraus eine Bewertung nach einer eurer hinterlegten KI-Anweisungen. Das dauert etwa 3 bis 8 Minuten und läuft auf dem
        Server weiter, auch wenn du das Fenster schließt. Das Ergebnis ist ein Entwurf, den ein Mensch prüfen muss – kein Gutachten.
        {erneut ? ' Die bisherige Bewertung bleibt stehen, bis der neue Lauf startet, und wird dann ersetzt.' : ''}
      </p>

      {!isEmailGatewayConfigured && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Die Verbindung zum Server ist in dieser Umgebung nicht eingerichtet. Die Bewertung lässt sich hier nicht starten.</p>}

      {anweisungen.length === 0 ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          Es ist noch keine KI-Anweisung mit Text hinterlegt. Lege zuerst eine unter{' '}
          <Link to="/immobilien/vorlagen/ki" className="font-medium underline">
            Vorlagen → KI-Anweisungen
          </Link>{' '}
          an.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2">
          <Field label="KI-Anweisung">
            <select className={inputClass} value={vorlageId} onChange={(e) => onVorlage(e.target.value)} disabled={gesperrt}>
              <option value="">Anweisung wählen …</option>
              {anweisungen.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Zusätzlicher Hinweis (wenn nötig)">
            <input className={inputClass} value={zusatz} onChange={(e) => onZusatz(e.target.value)} placeholder="z. B. „Dach wurde 2019 erneuert“" disabled={gesperrt} maxLength={1000} />
          </Field>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
        <FileText size={15} className="mt-0.5 shrink-0 text-slate-400" />
        <p className="min-w-0">
          {unterlagen.mitDatei === 0 ? (
            <>
              Zu diesem Objekt {unterlagen.gesamt === 0 ? 'sind noch keine Unterlagen abgelegt' : 'ist noch keine Unterlage als Datei abgelegt'}. Die Bewertung stützt sich dann nur auf die Stammdaten und die
              Marktrecherche. Starten kannst du trotzdem.
            </>
          ) : (
            <>
              Das Objekt hat {unterlagen.mitDatei === 1 ? 'eine Unterlage' : `${unterlagen.mitDatei} Unterlagen`}
              {unterlagen.ordner > 1 ? ` in ${unterlagen.ordner} Ordnern` : ''}. Die KI liest sie vor der Bewertung; sehr große Dateien und Bilder können ausgelassen werden – das steht dann beim Ergebnis.
            </>
          )}
          {unterlagen.mitDatei > 0 && ohneDatei > 0 ? ` ${ohneDatei === 1 ? 'Ein weiterer Eintrag hat' : `${ohneDatei} weitere Einträge haben`} keine Datei und ${ohneDatei === 1 ? 'wird' : 'werden'} nicht gelesen.` : ''}
        </p>
      </div>

      {grundlage && (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" className="mt-0.5" checked={neuEinlesen} onChange={(e) => onNeuEinlesen(e.target.checked)} disabled={gesperrt} />
          <span className="min-w-0">
            Unterlagen und Markt neu einlesen. Ohne Haken übernimmt die KI das Faktenblatt der letzten Bewertung, solange keine Unterlage dazugekommen oder weggefallen ist, und Marktdaten bis 30 Tage alt (Markt vom {fmtDate(grundlage.marktAm.slice(0, 10))}) — das geht schneller.
          </span>
        </label>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {onSchliessen && (
          <SecondaryButton onClick={onSchliessen} disabled={gesperrt}>
            Abbrechen
          </SecondaryButton>
        )}
        <PrimaryButton onClick={onStart} disabled={gesperrt || !vorlageId || !isEmailGatewayConfigured || anweisungen.length === 0}>
          {startet ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {startet ? 'Wird gestartet …' : 'Bewertung starten'}
        </PrimaryButton>
      </div>
    </Card>
  )
}

// ── Kleine Anzeigeteile ──────────────────────────────────────────────────────────────────────────

function Angabe({ label, wert }: { label: string; wert: string }) {
  if (!wert.trim()) return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-slate-700 [overflow-wrap:anywhere]">{wert}</dd>
    </div>
  )
}

function NamenListe({ titel, namen, leer, hinweis, gelesen }: { titel: string; namen: string[]; leer: string; hinweis?: string; gelesen?: boolean }) {
  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        {titel} ({namen.length})
      </h4>
      {namen.length === 0 ? (
        <p className="text-sm text-slate-400">{leer}</p>
      ) : (
        <>
          <ul className="space-y-1 text-sm text-slate-700">
            {namen.map((n, i) => (
              <li key={i} className="flex items-start gap-2">
                {gelesen ? <Check size={14} className="mt-0.5 shrink-0 text-emerald-500" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />}
                <span className="min-w-0 [overflow-wrap:anywhere]">{n}</span>
              </li>
            ))}
          </ul>
          {hinweis && <p className="mt-2 text-xs text-slate-400">{hinweis}</p>}
        </>
      )}
    </div>
  )
}

function Fett({ text }: { text: string }) {
  return (
    <>
      {fettStuecke(text).map((s, i) =>
        s.fett ? (
          <strong key={i} className="font-semibold text-slate-800">
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  )
}

/** Der Bewertungstext, lesbar gesetzt: Überschriften, Absätze, Listen und Tabellen (siehe zerlegeBericht). */
function BerichtAnzeige({ text }: { text: string }) {
  const bloecke = useMemo(() => zerlegeBericht(text), [text])
  return (
    <div className="min-w-0 space-y-3 text-sm leading-relaxed text-slate-700 [overflow-wrap:anywhere]">
      {bloecke.map((b, i) => {
        if (b.art === 'ueberschrift') {
          const abstand = i === 0 ? '' : 'pt-3'
          if (b.ebene === 1) return <h4 key={i} className={`text-base font-semibold text-slate-800 ${abstand}`}>{b.text}</h4>
          if (b.ebene === 2) return <h5 key={i} className={`border-b border-slate-100 pb-1 text-sm font-semibold text-slate-800 ${abstand}`}>{b.text}</h5>
          return <h6 key={i} className={`text-sm font-semibold text-slate-700 ${i === 0 ? '' : 'pt-1'}`}>{b.text}</h6>
        }
        if (b.art === 'absatz') {
          return (
            <p key={i} className="whitespace-pre-line">
              <Fett text={b.text} />
            </p>
          )
        }
        if (b.art === 'liste') {
          return (
            <ul key={i} className="space-y-1">
              {b.punkte.map((p, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="w-5 shrink-0 text-right text-slate-400">{p.marke ?? '•'}</span>
                  <span className="min-w-0">
                    <Fett text={p.text} />
                  </span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <div key={i} className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm [overflow-wrap:normal]">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500">
                  {b.kopf.map((k, j) => (
                    <th key={j} className="border-b border-slate-200 px-2 py-1.5 first:pl-0">
                      <Fett text={k} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.zeilen.map((z, j) => (
                  <tr key={j}>
                    {z.map((w, k) => (
                      <td key={k} className="border-b border-slate-100 px-2 py-1.5 align-top first:pl-0">
                        <Fett text={w} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
