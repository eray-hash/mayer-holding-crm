// Reiter „Eigentümerbericht" der Objektakte (21.11.2026, nach dem Vergleich mit Propstack): der Bericht an
// den Eigentümer, was im gewählten Zeitraum für die Vermarktung geschehen ist. Zusammengestellt aus
// Besichtigungen (Tabelle besichtigungen), Weitergaben, Vorschlägen, passenden Gesuchen und dem Verlauf des
// Objekts. Der Mitarbeiter wählt, welche Tätigkeiten der Eigentümer sieht, und ob Interessenten mit Namen
// erscheinen (Vorgabe: nein). Ausgabe als PDF auf dem Briefbogen, auf Wunsch im Objekt abgelegt.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileText, FolderInput, Plus, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { CURRENT_USER } from '../data/constants'
import { briefkopfAus } from '../data/briefkopf'
import { IMMOBILIEN_STATUS } from '../data/statusNetworks'
import { addDays, fmtEUR, today, uid } from '../lib/dates'
import { herunterladen } from '../lib/briefe'
import { alleGesuche, passendeGesuche } from '../lib/gesuche'
import { ladeObjektDokumentHoch } from '../lib/objektDokumenteStorage'
import { interesseLabel, ladeBesichtigungen, statusLabel, type Besichtigung } from '../lib/besichtigungen'
import { deDatum, eigentuemerberichtDateiname, erzeugeEigentuemerberichtPdf, type EigentuemerberichtDaten } from '../lib/eigentuemerberichtPdf'
import { Card, Field, PrimaryButton, SecondaryButton, inputClass } from './ui'
import type { ActivityEntry, Dokument, Objekt } from '../types'

const ABLAGE_ORDNER = 'Sonstiges' as const

/** Tätigkeiten, die für den Eigentümer typischerweise von Belang sind — nur eine Vorauswahl. */
const VERMARKTUNG = /expos|besichtig|weitergeb|weitergabe|angebot|inserat|anzeige|vorgeschlagen|vorschlag|gesuch|notar|reserv|unterlagen angefordert|bewertung|interessent|status:/i
/** Interne Vermerke, die nicht vorausgewählt werden. */
const INTERN = /provision|abrechnung|frage an|geschäftsführung|intern|eigentümerbericht|noch nicht geprüft|übernommen:|abgelegt/i

const berlinTag = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
const tagVon = (datum: string) => (datum.length > 10 ? (datum.includes('T') ? berlinTag(datum) : datum.slice(0, 10)) : datum)

type Taetigkeit = { id: string; datum: string; text: string; an: boolean; eigen?: boolean }

export function ObjektEigentuemerbericht({ objekt }: { objekt: Objekt }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER

  // Zeitraum: ab dem Tag nach dem letzten Bericht, sonst die letzten 30 Tage.
  const letzterBericht = objekt.activities.find((a) => a.text.startsWith('Eigentümerbericht'))
  const [von, setVon] = useState(() => (letzterBericht ? addDays(tagVon(letzterBericht.date), 1) : addDays(today(), -30)))
  const [bis, setBis] = useState(today())
  const [besichtigungen, setBesichtigungen] = useState<Besichtigung[]>([])
  const [ladeFehler, setLadeFehler] = useState('')
  const [mitNamen, setMitNamen] = useState(false)
  const [mitRueckmeldung, setMitRueckmeldung] = useState(true)
  const [mitAbgesagten, setMitAbgesagten] = useState(false)
  const name = objekt.eigentuemer?.name?.trim() ?? ''
  const [empfaenger, setEmpfaenger] = useState(name)
  const [anrede, setAnrede] = useState(name ? `Guten Tag ${name},` : 'Sehr geehrte Damen und Herren,')
  const [einleitung, setEinleitung] = useState('')
  const [einschaetzung, setEinschaetzung] = useState('')
  const [absender, setAbsender] = useState(wer)
  const [taetigkeiten, setTaetigkeiten] = useState<Taetigkeit[]>([])
  const [arbeitet, setArbeitet] = useState(false)
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)
  const vermerkt = useRef(false)

  useEffect(() => {
    ladeBesichtigungen(objekt.id)
      .then((l) => {
        setBesichtigungen(l)
        setLadeFehler('')
      })
      .catch((err) => setLadeFehler(err instanceof Error ? err.message : 'Besichtigungen konnten nicht geladen werden.'))
  }, [objekt.id])

  // Tätigkeiten aus dem Verlauf neu vorschlagen, wenn sich der Zeitraum ändert; eigene Einträge bleiben.
  useEffect(() => {
    setTaetigkeiten((alt) => {
      const vorher = new Map(alt.map((t) => [t.id, t]))
      const ausVerlauf = objekt.activities
        .filter((a) => {
          const tag = tagVon(a.date)
          return tag >= von && tag <= bis
        })
        .map((a) => vorher.get(a.id) ?? { id: a.id, datum: tagVon(a.date), text: a.text, an: VERMARKTUNG.test(a.text) && !INTERN.test(a.text) })
        .sort((a, b) => a.datum.localeCompare(b.datum))
      return [...ausVerlauf, ...alt.filter((t) => t.eigen)]
    })
  }, [objekt.activities, von, bis])

  useEffect(() => {
    setEinleitung(`gern informieren wir Sie über den Stand der Vermarktung Ihrer Immobilie in der Zeit vom ${deDatum(von)} bis ${deDatum(bis)}.`)
  }, [von, bis])

  const imZeitraum = useMemo(() => besichtigungen.filter((b) => {
    const tag = berlinTag(b.beginn)
    return tag >= von && tag <= bis
  }), [besichtigungen, von, bis])

  // Interessenten ohne Namen: fortlaufend nummeriert nach erstem Auftreten, gleiche Person = gleiche Nummer.
  const nennung = useMemo(() => {
    const nummern = new Map<string, number>()
    for (const b of [...imZeitraum].sort((a, c) => a.beginn.localeCompare(c.beginn))) {
      const schluessel = (b.kundeId ?? b.interessent).toLowerCase()
      if (!nummern.has(schluessel)) nummern.set(schluessel, nummern.size + 1)
    }
    return (b: Besichtigung) => (mitNamen ? b.interessent : `Interessent ${nummern.get((b.kundeId ?? b.interessent).toLowerCase()) ?? ''}`.trim())
  }, [imZeitraum, mitNamen])

  const auswertung = useMemo(() => {
    const durchgefuehrt = imZeitraum.filter((b) => b.status === 'durchgefuehrt')
    const abgesagt = imZeitraum.filter((b) => b.status === 'abgesagt' || b.status === 'nicht_erschienen')
    const jetzt = Date.now()
    const anstehend = besichtigungen.filter((b) => b.status === 'geplant' && new Date(b.beginn).getTime() >= jetzt)
    const angebote = imZeitraum.filter((b) => b.angebot && b.angebot > 0).sort((a, b) => a.beginn.localeCompare(b.beginn))
    const hoechstes = angebote.reduce((m, b) => Math.max(m, b.angebot ?? 0), 0)
    const weitergaben = state.weitergaben.filter((w) => w.objektIds.includes(objekt.id) && w.datum.slice(0, 10) >= von && w.datum.slice(0, 10) <= bis)
    const empfaengerWeitergabe = [...new Set(weitergaben.map((w) => w.an.trim()).filter(Boolean))]
    const vorschlaege = state.objektVorschlaege.filter((v) => v.objektId === objekt.id && tagVon(v.erstelltAm) >= von && tagVon(v.erstelltAm) <= bis)
    const gesuche = passendeGesuche(objekt, alleGesuche(state)).filter((g) => g.offen.length === 0)
    return { durchgefuehrt, abgesagt, anstehend, angebote, hoechstes, empfaengerWeitergabe, vorschlaege, gesuche }
  }, [imZeitraum, besichtigungen, state, objekt, von, bis])

  const preis = objekt.kaufpreis || objekt.verkaufsdaten?.kennzahlen.kaufpreisvorstellung || 0

  function berichtDaten(): EigentuemerberichtDaten {
    const a = auswertung
    const kennzahlen: { label: string; wert: string }[] = [
      { label: 'Besichtigungen im Zeitraum', wert: String(a.durchgefuehrt.length) },
      ...(a.anstehend.length > 0 ? [{ label: 'Bereits vereinbart', wert: `${a.anstehend.length} weitere ${a.anstehend.length === 1 ? 'Besichtigung' : 'Besichtigungen'}` }] : []),
      { label: 'Kaufpreisangebote', wert: a.angebote.length > 0 ? `${a.angebote.length}, höchstes ${fmtEUR(a.hoechstes)}` : 'noch keines' },
      ...(a.empfaengerWeitergabe.length > 0
        ? [{ label: 'Gezielt angeboten', wert: mitNamen ? a.empfaengerWeitergabe.join(', ') : `${a.empfaengerWeitergabe.length} ausgewählten Interessenten bzw. Investoren` }]
        : []),
      ...(a.vorschlaege.length > 0 ? [{ label: 'Exposé vorgestellt', wert: `${a.vorschlaege.length} ${a.vorschlaege.length === 1 ? 'Kunde' : 'Kunden'}` }] : []),
      ...(a.gesuche.length > 0 ? [{ label: 'Passende Suchkunden', wert: `${a.gesuche.length} vorgemerkte ${a.gesuche.length === 1 ? 'Suchanfrage passt' : 'Suchanfragen passen'} zu Ihrem Objekt` }] : []),
    ]
    const liste = imZeitraum
      .filter((b) => b.status === 'durchgefuehrt' || (mitAbgesagten && (b.status === 'abgesagt' || b.status === 'nicht_erschienen')))
      .sort((x, y) => x.beginn.localeCompare(y.beginn))
    return {
      briefkopf: briefkopfAus(state.vorlagenBeratung),
      empfaenger: empfaenger.split('\n'),
      datum: today(),
      objekt: { bezeichnung: objekt.bezeichnung, adresse: objekt.adresse, typ: objekt.typ, stand: IMMOBILIEN_STATUS[objekt.status]?.label ?? objekt.status, preis: preis || undefined },
      von,
      bis,
      anrede,
      einleitung,
      kennzahlen,
      besichtigungen: liste.map((b) => ({
        datum: berlinTag(b.beginn),
        interessent: nennung(b),
        stand: b.status === 'durchgefuehrt' ? '' : statusLabel(b.status),
        interesse: interesseLabel(b.interesse),
        rueckmeldung: mitRueckmeldung ? b.rueckmeldung : '',
        angebot: b.angebot,
      })),
      angebote: a.angebote.map((b) => ({ datum: berlinTag(b.beginn), interessent: nennung(b), betrag: b.angebot ?? 0 })),
      taetigkeiten: taetigkeiten.filter((t) => t.an && t.text.trim()).map((t) => ({ datum: t.datum, text: t.text.trim() })),
      einschaetzung,
      absender,
    }
  }

  function imVerlaufVermerken(zusatz: string) {
    if (vermerkt.current) return
    vermerkt.current = true
    const eintrag: ActivityEntry = { id: uid('act'), date: today(), text: `Eigentümerbericht für ${deDatum(von)} bis ${deDatum(bis)} erstellt${zusatz}`, user: wer }
    dispatch({ type: 'UPDATE_OBJEKT', id: objekt.id, patch: { activities: [eintrag, ...objekt.activities] } })
  }

  function pruefen(): boolean {
    if (!von || !bis || von > bis) {
      setMeldung({ ok: false, text: 'Bitte einen gültigen Zeitraum wählen (Beginn vor Ende).' })
      return false
    }
    return true
  }

  function pdfHerunterladen() {
    if (!pruefen()) return
    setMeldung(null)
    try {
      herunterladen(erzeugeEigentuemerberichtPdf(berichtDaten()), eigentuemerberichtDateiname(objekt.bezeichnung, bis))
      imVerlaufVermerken('')
    } catch (err) {
      setMeldung({ ok: false, text: err instanceof Error ? err.message : 'Das PDF konnte nicht erstellt werden.' })
    }
  }

  async function imObjektAblegen() {
    if (!pruefen()) return
    setArbeitet(true)
    setMeldung(null)
    try {
      const dateiname = eigentuemerberichtDateiname(objekt.bezeichnung, bis)
      const datei = new File([erzeugeEigentuemerberichtPdf(berichtDaten())], dateiname, { type: 'application/pdf' })
      const { pfad, groesse } = await ladeObjektDokumentHoch(objekt.id, datei)
      const dokument: Dokument = { id: uid('dok'), name: dateiname, typ: 'application/pdf', datum: today(), groesse, url: pfad }
      dispatch({ type: 'ADD_DOKUMENT', objektId: objekt.id, ordner: ABLAGE_ORDNER, dokument })
      imVerlaufVermerken(` und unter Dokumente → ${ABLAGE_ORDNER} abgelegt`)
      setMeldung({ ok: true, text: `Abgelegt unter Dokumente → ${ABLAGE_ORDNER}.` })
    } catch (err) {
      setMeldung({ ok: false, text: err instanceof Error ? err.message : 'Ablegen hat nicht geklappt.' })
    } finally {
      setArbeitet(false)
    }
  }

  const setzeTaetigkeit = (id: string, patch: Partial<Taetigkeit>) => setTaetigkeiten((l) => l.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const a = auswertung
  const gewaehlt = taetigkeiten.filter((t) => t.an).length

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <FileText size={15} className="text-slate-400" /> Eigentümerbericht
            </h3>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              Fasst zusammen, was im Zeitraum für die Vermarktung geschehen ist. Sie bestimmen, welche Tätigkeiten der Eigentümer sieht. Interessenten erscheinen ohne Namen, solange das Häkchen unten nicht gesetzt ist.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => void imObjektAblegen()} disabled={arbeitet}>
              <FolderInput size={14} /> {arbeitet ? 'Legt ab …' : 'Im Objekt ablegen'}
            </SecondaryButton>
            <PrimaryButton onClick={pdfHerunterladen} disabled={arbeitet}>
              <Download size={14} /> PDF herunterladen
            </PrimaryButton>
          </div>
        </div>
        {meldung && <p className={`mt-3 rounded-lg px-3 py-2 text-xs ${meldung.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>{meldung.text}</p>}
        {ladeFehler && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Besichtigungen fehlen im Bericht: {ladeFehler}</p>}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Zeitraum von">
            <input className={inputClass} type="date" value={von} onChange={(e) => setVon(e.target.value)} />
          </Field>
          <Field label="bis">
            <input className={inputClass} type="date" value={bis} onChange={(e) => setBis(e.target.value)} />
          </Field>
          <div className="flex flex-col justify-end gap-1.5 text-sm text-slate-600 sm:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mitNamen} onChange={(e) => setMitNamen(e.target.checked)} /> Namen der Interessenten und Empfänger nennen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mitRueckmeldung} onChange={(e) => setMitRueckmeldung(e.target.checked)} /> Rückmeldungen der Interessenten übernehmen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mitAbgesagten} onChange={(e) => setMitAbgesagten(e.target.checked)} /> Abgesagte Besichtigungen aufführen
            </label>
          </div>
        </div>
        {letzterBericht && <p className="mt-2 text-xs text-slate-400">Letzter Bericht laut Verlauf: {deDatum(tagVon(letzterBericht.date))} ({letzterBericht.user}).</p>}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Auf einen Blick</h4>
          <dl className="space-y-1.5 text-sm">
            <Zeile label="Aktueller Stand" wert={IMMOBILIEN_STATUS[objekt.status]?.label ?? objekt.status} />
            <Zeile label="Angebotspreis" wert={preis ? fmtEUR(preis) : '–'} />
            <Zeile label="Besichtigungen im Zeitraum" wert={String(a.durchgefuehrt.length)} />
            <Zeile label="Abgesagt / nicht erschienen" wert={String(a.abgesagt.length)} />
            <Zeile label="Bereits vereinbart" wert={String(a.anstehend.length)} />
            <Zeile label="Kaufpreisangebote" wert={a.angebote.length > 0 ? `${a.angebote.length}, höchstes ${fmtEUR(a.hoechstes)}` : 'keine'} />
            <Zeile label="Weitergegeben an" wert={a.empfaengerWeitergabe.length > 0 ? (mitNamen ? a.empfaengerWeitergabe.join(', ') : `${a.empfaengerWeitergabe.length} Empfänger`) : 'niemanden'} />
            <Zeile label="Exposé vorgestellt" wert={String(a.vorschlaege.length)} />
            <Zeile label="Passende Suchanfragen" wert={String(a.gesuche.length)} />
          </dl>
          {imZeitraum.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 text-xs font-medium text-slate-400">So erscheinen die Besichtigungen</div>
              <ul className="space-y-1 text-xs text-slate-600">
                {imZeitraum
                  .filter((b) => b.status === 'durchgefuehrt' || (mitAbgesagten && b.status !== 'geplant'))
                  .sort((x, y) => x.beginn.localeCompare(y.beginn))
                  .map((b) => (
                    <li key={b.id}>
                      {deDatum(berlinTag(b.beginn))} · {nennung(b)}
                      {b.status !== 'durchgefuehrt' ? ` · ${statusLabel(b.status)}` : ''}
                      {b.interesse ? ` · ${interesseLabel(b.interesse)}` : ''}
                      {b.angebot ? ` · ${fmtEUR(b.angebot)}` : ''}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h4 className="mb-3 text-sm font-semibold text-slate-700">Anschreiben</h4>
          <div className="space-y-3">
            <Field label="Empfänger (eine Zeile je Angabe)">
              <textarea className={inputClass} rows={3} value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} placeholder="Name&#10;Straße&#10;PLZ Ort" />
            </Field>
            <Field label="Anrede">
              <input className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)} />
            </Field>
            <Field label="Einleitung">
              <textarea className={inputClass} rows={2} value={einleitung} onChange={(e) => setEinleitung(e.target.value)} />
            </Field>
            <Field label="Unsere Einschätzung und die nächsten Schritte">
              <textarea
                className={inputClass}
                rows={4}
                value={einschaetzung}
                onChange={(e) => setEinschaetzung(e.target.value)}
                placeholder="z. B. Die Nachfrage ist gut, zwei Interessenten prüfen die Finanzierung. Wir empfehlen, den Preis vorerst zu halten …"
              />
            </Field>
            <Field label="Unterschrift">
              <input className={inputClass} value={absender} onChange={(e) => setAbsender(e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-700">
            Tätigkeiten im Zeitraum <span className="font-normal text-slate-400">({gewaehlt} von {taetigkeiten.length} im Bericht)</span>
          </h4>
          <button
            onClick={() => setTaetigkeiten((l) => [...l, { id: uid('tt'), datum: bis, text: '', an: true, eigen: true }])}
            className="flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
          >
            <Plus size={13} /> Tätigkeit hinzufügen
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">Aus dem Verlauf des Objekts. Vorausgewählt sind Einträge zur Vermarktung; interne Vermerke bleiben draußen. Den Wortlaut können Sie für den Eigentümer anpassen.</p>
        {taetigkeiten.length === 0 ? (
          <p className="text-sm text-slate-400">Im Zeitraum steht nichts im Verlauf.</p>
        ) : (
          <ul className="space-y-2">
            {taetigkeiten.map((t) => (
              <li key={t.id} className="flex items-start gap-2">
                <input type="checkbox" className="mt-2.5" checked={t.an} onChange={(e) => setzeTaetigkeit(t.id, { an: e.target.checked })} />
                {t.eigen ? (
                  <input className={`${inputClass} w-36 flex-shrink-0`} type="date" value={t.datum} onChange={(e) => setzeTaetigkeit(t.id, { datum: e.target.value })} />
                ) : (
                  <span className="mt-2 w-24 flex-shrink-0 text-xs text-slate-400">{deDatum(t.datum)}</span>
                )}
                <input
                  className={`${inputClass} ${t.an ? '' : 'text-slate-400'}`}
                  value={t.text}
                  onChange={(e) => setzeTaetigkeit(t.id, { text: e.target.value })}
                  placeholder="z. B. Anzeige in der Tageszeitung geschaltet"
                />
                {t.eigen && (
                  <button onClick={() => setTaetigkeiten((l) => l.filter((x) => x.id !== t.id))} className="mt-1.5 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="Entfernen">
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Zeile({ label, wert }: { label: string; wert: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-700">{wert}</dd>
    </div>
  )
}
