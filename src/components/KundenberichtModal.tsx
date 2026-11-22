// Statusbericht an den Kunden („Stand Ihres Projekts“, 22.11.2026). Knopf in der Akte → Entwurf aus den
// Daten der Akte (lib/kundenbericht.ts, Kern _shared/kundenberichtKern.ts) → jedes Feld änderbar →
// „Als PDF“ (Briefbogen, liegt danach in den Dokumenten der Akte) oder „Per E-Mail senden“ (über das
// gemeinsame Postfach wie Rechnungen, PDF im Anhang; die Mail steht danach in gesendete_emails und im
// Verlauf „Statusbericht verschickt …“). Fehlen Unterlagen, kommt ein Link zum Hochladen dazu (eine
// Anforderung der Art „Erinnerung“, wie „An fehlende Unterlagen erinnern“).
//
// Unten: „Wöchentlich erinnern“ — am gewählten Wochentag um 8 Uhr bekommt der Verantwortliche eine
// Telegram-Nachricht, dass der Bericht fertig ist. Der Server schickt dem Kunden NIE selbst etwas.
// Der Link in dieser Telegram-Nachricht öffnet die Akte mit ?statusbericht=1 — dann geht das Fenster gleich auf.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ClipboardList, Download, Mail } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { empfaengerZeilen, useRechnungAktionen } from './rechnungen/aktionen'
import { herunterladen } from '../lib/briefe'
import { isEmailGatewayConfigured } from '../lib/emailGateway'
import { uid } from '../lib/dates'
import {
  AMPEL_KUNDENTEXT,
  AMPEL_NAME,
  WOCHENTAGE,
  anforderungFuerBericht,
  baueBericht,
  berichtAlsText,
  berichtDateiname,
  deDatum,
  heuteBerlin,
  hochladeLink,
  ladeBerichtEinstellung,
  ladeBerichtSchalter,
  ladeKundenbericht,
  neueKennung,
  setzeBerichtSchalter,
  speichereBerichtEinstellung,
  vermerkeBerichtVersand,
  type BerichtEinstellung,
  type BerichtGeladen,
  type KundenAmpel,
  type Kundenbericht,
} from '../lib/kundenbericht'
import { erzeugeKundenberichtPdf } from '../lib/kundenberichtPdf'
import type { Kunde, KundeBereich } from '../types'

type Felder = {
  betreff: string
  anrede: string
  einleitung: string
  ampel: KundenAmpel
  ampelText: string
  stand: string
  erledigt: string
  naechste: string
  vonIhnen: string
  schluss: string
  gruss: string
}

const zeilen = (t: string) => t.split('\n').map((z) => z.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean)

function felderAus(b: Kundenbericht): Felder {
  return {
    betreff: b.betreff,
    anrede: b.anrede,
    einleitung: b.einleitung,
    ampel: b.ampel,
    ampelText: b.ampelText,
    stand: b.stand,
    erledigt: b.erledigt.join('\n'),
    naechste: b.naechste.join('\n'),
    vonIhnen: b.vonIhnen.join('\n'),
    schluss: b.schluss,
    gruss: b.gruss,
  }
}

export function KundenberichtModal({ bereich, kunde, nutzerName, nurLesen = false }: { bereich: KundeBereich; kunde: Kunde; nutzerName: string; nurLesen?: boolean }) {
  const [offen, setOffen] = useState(false)
  const [einstellung, setEinstellung] = useState<BerichtEinstellung | null>(null)
  const [params, setParams] = useSearchParams()

  // Link aus der Telegram-Erinnerung: …?statusbericht=1 öffnet das Fenster gleich.
  useEffect(() => {
    if (params.get('statusbericht') !== '1') return
    setOffen(true)
    const neu = new URLSearchParams(params)
    neu.delete('statusbericht')
    setParams(neu, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    ladeBerichtEinstellung(kunde.id).then(setEinstellung).catch(() => setEinstellung(null))
  }, [kunde.id, offen])

  if (bereich === 'privat') return null
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SecondaryButton onClick={() => setOffen(true)}>
          <ClipboardList size={14} /> Statusbericht an Kunden
        </SecondaryButton>
        {einstellung?.aktiv && <span className="text-xs text-slate-400">wöchentlich, {WOCHENTAGE.find((w) => w.wert === einstellung.wochentag)?.name ?? ''}</span>}
        {einstellung?.letzterVersand && <span className="text-xs text-slate-400">zuletzt am {deDatum(einstellung.letzterVersand)}</span>}
      </div>
      {offen && <BerichtFenster bereich={bereich} kunde={kunde} nutzerName={nutzerName} nurLesen={nurLesen} onClose={() => setOffen(false)} />}
    </>
  )
}

function BerichtFenster({ bereich, kunde, nutzerName, nurLesen, onClose }: { bereich: KundeBereich; kunde: Kunde; nutzerName: string; nurLesen: boolean; onClose: () => void }) {
  const { dispatch } = useApp()
  const { briefkopf, pdfAblegen, pdfSenden } = useRechnungAktionen()
  const kundeAktuell = useRef(kunde)
  kundeAktuell.current = kunde

  const [geladen, setGeladen] = useState<BerichtGeladen | null>(null)
  const [ladeFehler, setLadeFehler] = useState('')
  const [seit, setSeit] = useState('')
  const [f, setF] = useState<Felder | null>(null)
  const [ampelTextVonHand, setAmpelTextVonHand] = useState(false)
  const [mitLink, setMitLink] = useState(true)
  const [an, setAn] = useState(kunde.email?.trim() ?? '')
  const [vorschau, setVorschau] = useState(false)
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState('')
  const [token] = useState(neueKennung)
  const linkFestgehalten = useRef(false)

  useEffect(() => {
    let weg = false
    ladeKundenbericht(kunde, bereich)
      .then((g) => {
        if (weg) return
        setGeladen(g)
        setSeit(g.bericht.seit)
        setF(felderAus(g.bericht))
      })
      .catch((e) => !weg && setLadeFehler(e instanceof Error ? e.message : 'Der Bericht ließ sich nicht vorbereiten.'))
    return () => {
      weg = true
    }
    // Nur beim Öffnen laden — spätere Änderungen an der Akte überschreiben die Bearbeitung nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bericht = useMemo(() => (geladen && seit ? baueBericht(geladen.daten, kunde, bereich, seit) : null), [geladen, seit, kunde, bereich])

  function neuerZeitraum(neu: string) {
    if (!geladen || !/^\d{4}-\d{2}-\d{2}$/.test(neu) || neu > heuteBerlin()) return
    setSeit(neu)
    setF(felderAus(baueBericht(geladen.daten, kunde, bereich, neu)))
    setAmpelTextVonHand(false)
  }

  const setze = <K extends keyof Felder>(k: K, v: Felder[K]) => setF((alt) => (alt ? { ...alt, [k]: v } : alt))
  const heute = heuteBerlin()
  const brauchen = f ? zeilen(f.vonIhnen) : []
  const linkAn = mitLink && brauchen.length > 0
  const link = linkAn ? hochladeLink(token) : undefined
  const name = kunde.ansprechpartner?.trim() || kunde.firma?.trim() || ''
  const textAngaben = f
    ? { anrede: f.anrede, einleitung: f.einleitung, ampel: f.ampel, ampelText: f.ampelText, stand: f.stand, erledigt: zeilen(f.erledigt), naechste: zeilen(f.naechste), vonIhnen: brauchen, schluss: f.schluss, gruss: f.gruss }
    : null
  const mailText = textAngaben ? berichtAlsText(textAngaben, link) : ''
  const dateiname = berichtDateiname(name, heute)

  function pdf(): Blob {
    if (!f || !textAngaben) throw new Error('Der Bericht ist noch nicht fertig geladen.')
    return erzeugeKundenberichtPdf({
      briefkopf,
      empfaenger: empfaengerZeilen({ anschrift: undefined }, { kunde, bereich, bereichLabel: '' }),
      datum: heute,
      seit,
      ...textAngaben,
      link,
    })
  }

  /** Die Anforderung muss in der Akte stehen, bevor der Kunde den Link öffnen kann — einmal je Fenster. */
  function linkFesthalten(empfaenger: string) {
    if (!linkAn || linkFestgehalten.current || !bericht) return
    const k = kundeAktuell.current
    const anforderung = anforderungFuerBericht({ token, an: empfaenger, anName: name, von: nutzerName, zeilen: brauchen, fehlendePunkte: bericht.fehlendePunkte, datum: heute })
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: k.id, patch: { unterlagenAnforderungen: [anforderung, ...(k.unterlagenAnforderungen ?? [])] } })
    linkFestgehalten.current = true
  }

  function verlauf(text: string) {
    const k = kundeAktuell.current
    dispatch({
      type: 'UPDATE_KUNDE_IN_BEREICH',
      bereich,
      id: k.id,
      patch: { letzteAktivitaet: heute, activities: [{ id: uid('act'), date: heute, text, user: nutzerName }, ...(k.activities ?? [])] },
    })
  }

  const zeitraum = seit === heute ? deDatum(heute) : `${deDatum(seit)} bis ${deDatum(heute)}`

  async function ausfuehren(weg: 'email' | 'pdf') {
    if (!f || arbeitet) return
    setFehler('')
    if (weg === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(an.trim())) return setFehler('Bitte eine gültige E-Mail-Adresse eintragen.')
      if (!f.betreff.trim()) return setFehler('Bitte einen Betreff eintragen.')
    }
    setArbeitet(true)
    try {
      linkFesthalten(weg === 'email' ? an.trim() : '')
      const blob = pdf()
      if (weg === 'email') await pdfSenden({ an: an.trim(), betreff: f.betreff, text: mailText, blob, dateiname, kundeId: kunde.id })
      else herunterladen(blob, dateiname)
      let ablage = ''
      try {
        await pdfAblegen(kunde.id, blob, dateiname)
        ablage = ' Das PDF liegt in der Akte unter Dokumente.'
      } catch (e) {
        ablage = ` Das PDF ließ sich aber nicht in der Akte ablegen (${e instanceof Error ? e.message : 'unbekannter Fehler'}).`
      }
      const mitLinkText = linkAn ? ', mit Link zum Hochladen fehlender Unterlagen' : ''
      verlauf(weg === 'email' ? `Statusbericht verschickt an ${an.trim()} (Zeitraum ${zeitraum}${mitLinkText})` : `Statusbericht als PDF erstellt (Zeitraum ${zeitraum}${mitLinkText})`)
      await vermerkeBerichtVersand(kunde.id, bereich, heute, nutzerName).catch(() => undefined)
      setFertig(weg === 'email' ? `Gesendet an ${an.trim()}.${ablage}` : `Das PDF wurde heruntergeladen.${ablage}`)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte noch einmal versuchen.')
    } finally {
      setArbeitet(false)
    }
  }

  function ansehen() {
    setFehler('')
    try {
      herunterladen(pdf(), dateiname)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das PDF ließ sich nicht erstellen.')
    }
  }

  return (
    <Modal open onClose={onClose} title="Statusbericht an den Kunden" width="max-w-3xl">
      {fertig ? (
        <div className="py-4 text-center">
          <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            <Check size={15} className="mr-1 inline" /> {fertig}
          </p>
          <PrimaryButton onClick={onClose}>Fertig</PrimaryButton>
        </div>
      ) : ladeFehler ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{ladeFehler}</p>
      ) : !f || !bericht ? (
        <p className="py-6 text-center text-sm text-slate-400">Bericht wird vorbereitet …</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-slate-600">
              <span className="mb-1 block text-xs font-medium text-slate-400">Zeitraum ab</span>
              <input type="date" className={inputClass} value={seit} max={heute} onChange={(e) => neuerZeitraum(e.target.value)} />
            </label>
            <p className="pb-2 text-xs text-slate-400">
              Vorschlag: {geladen?.seitVorschlag === seit ? 'seit dem letzten Bericht bzw. die letzten 7 Tage' : `ab ${deDatum(geladen?.seitVorschlag)}`}. Ein anderer Zeitraum baut den Entwurf neu (eigene Änderungen gehen dabei verloren).
            </p>
          </div>

          {bericht.hinweise.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="mb-1 font-medium">Nur für dich — steht nicht im Bericht:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {bericht.hinweise.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Betreff">
            <input className={inputClass} value={f.betreff} onChange={(e) => setze('betreff', e.target.value)} />
          </Field>
          <Field label="Anrede">
            <input className={inputClass} value={f.anrede} onChange={(e) => setze('anrede', e.target.value)} />
          </Field>
          <Field label="Einleitung">
            <textarea className={inputClass} rows={2} value={f.einleitung} onChange={(e) => setze('einleitung', e.target.value)} />
          </Field>
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-[10rem_1fr]">
            <Field label="Ampel">
              <select
                className={inputClass}
                value={f.ampel}
                onChange={(e) => {
                  const a = e.target.value as KundenAmpel
                  setF((alt) => (alt ? { ...alt, ampel: a, ampelText: ampelTextVonHand ? alt.ampelText : AMPEL_KUNDENTEXT[a] } : alt))
                }}
              >
                {(['gruen', 'gelb', 'rot'] as KundenAmpel[]).map((a) => (
                  <option key={a} value={a}>{AMPEL_NAME[a]}</option>
                ))}
              </select>
            </Field>
            <Field label="Satz zur Ampel">
              <input
                className={inputClass}
                value={f.ampelText}
                onChange={(e) => {
                  setze('ampelText', e.target.value)
                  setAmpelTextVonHand(true)
                }}
              />
            </Field>
          </div>
          <Field label="Stand im Ablauf (leer = weglassen)">
            <input className={inputClass} value={f.stand} onChange={(e) => setze('stand', e.target.value)} />
          </Field>
          <Field label="Was seitdem passiert ist (eine Zeile je Punkt)">
            <textarea className={inputClass} rows={Math.min(8, Math.max(3, zeilen(f.erledigt).length + 1))} value={f.erledigt} onChange={(e) => setze('erledigt', e.target.value)} />
          </Field>
          <Field label="Die nächsten Schritte (eine Zeile je Punkt)">
            <textarea className={inputClass} rows={Math.min(8, Math.max(3, zeilen(f.naechste).length + 1))} value={f.naechste} onChange={(e) => setze('naechste', e.target.value)} />
          </Field>
          <Field label="Was wir noch vom Kunden brauchen (eine Zeile je Punkt)">
            <textarea className={inputClass} rows={Math.min(8, Math.max(2, brauchen.length + 1))} value={f.vonIhnen} onChange={(e) => setze('vonIhnen', e.target.value)} />
          </Field>
          <label className={`-mt-2 mb-3 flex items-start gap-2 text-sm ${brauchen.length ? 'text-slate-600' : 'text-slate-300'}`}>
            <input type="checkbox" className="mt-0.5" checked={mitLink} disabled={brauchen.length === 0} onChange={(e) => setMitLink(e.target.checked)} />
            <span>
              Link zum Hochladen anhängen
              <span className="block text-xs text-slate-400">Der Kunde lädt ohne Anmeldung hoch, auch mit dem Handy. Was er schickt, landet in den Dokumenten der Akte.</span>
            </span>
          </label>
          <Field label="Schlusssatz">
            <textarea className={inputClass} rows={2} value={f.schluss} onChange={(e) => setze('schluss', e.target.value)} />
          </Field>
          <Field label="Gruß (Name des Ansprechpartners)">
            <input className={inputClass} value={f.gruss} onChange={(e) => setze('gruss', e.target.value)} placeholder="Ihr Team der Mayer Holding" />
          </Field>

          <button type="button" onClick={() => setVorschau((x) => !x)} className="mb-3 text-xs font-medium text-accent-600 hover:underline">
            {vorschau ? 'Vorschau der E-Mail ausblenden' : 'Vorschau der E-Mail zeigen'}
          </button>
          {vorschau && <pre className="mb-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-xs text-slate-700">{mailText}</pre>}

          <div className="mb-3 rounded-lg border border-slate-200 p-3">
            {isEmailGatewayConfigured ? (
              <>
                <Field label="An">
                  <input className={inputClass} type="email" value={an} onChange={(e) => setAn(e.target.value)} placeholder="E-Mail-Adresse des Kunden" />
                </Field>
                <p className="-mt-2 text-xs text-slate-400">Absender: gemeinsames Postfach. Der Bericht steht im Text der E-Mail und als PDF im Anhang; deine Signatur aus „Mein Profil“ kommt darunter.</p>
              </>
            ) : (
              <p className="text-sm text-amber-800">Das Postfach ist noch nicht verbunden — bitte „Als PDF“ wählen.</p>
            )}
          </div>

          {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <SecondaryButton onClick={ansehen} className="justify-center">
              <Download size={15} /> PDF ansehen
            </SecondaryButton>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <SecondaryButton onClick={() => ausfuehren('pdf')} disabled={arbeitet || nurLesen} className="justify-center">
                Als PDF
              </SecondaryButton>
              <PrimaryButton onClick={() => ausfuehren('email')} disabled={arbeitet || nurLesen || !isEmailGatewayConfigured} className="justify-center">
                <Mail size={15} /> {arbeitet ? 'Einen Moment …' : 'Per E-Mail senden'}
              </PrimaryButton>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">„Als PDF“ lädt den Bericht herunter (z. B. für die Post) und legt ihn in der Akte ab. „PDF ansehen“ ändert nichts an der Akte.</p>

          <Woechentlich bereich={bereich} kundeId={kunde.id} nutzerName={nutzerName} nurLesen={nurLesen} />
        </>
      )}
    </Modal>
  )
}

function Woechentlich({ bereich, kundeId, nutzerName, nurLesen }: { bereich: KundeBereich; kundeId: string; nutzerName: string; nurLesen: boolean }) {
  const { mitarbeiter, istSuperuser, ansichtAls } = useAuth()
  const darfSchalter = !ansichtAls && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || istSuperuser)
  const [e, setE] = useState<BerichtEinstellung | null>(null)
  const [schalter, setSchalter] = useState<{ aktiv: boolean } | null>(null)
  const [meldung, setMeldung] = useState('')

  useEffect(() => {
    ladeBerichtEinstellung(kundeId).then(setE).catch((x) => setMeldung(x instanceof Error ? x.message : 'Einstellung ließ sich nicht laden.'))
    ladeBerichtSchalter().then(setSchalter).catch(() => setSchalter(null))
  }, [kundeId])

  async function speichere(neu: { aktiv: boolean; wochentag: number }) {
    setMeldung('')
    try {
      await speichereBerichtEinstellung({ kundeId, bereich, ...neu }, nutzerName)
      setE(await ladeBerichtEinstellung(kundeId))
    } catch (x) {
      setMeldung(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    }
  }

  async function schalte(aktiv: boolean) {
    setMeldung('')
    try {
      await setzeBerichtSchalter(aktiv, nutzerName)
      setSchalter(await ladeBerichtSchalter())
    } catch (x) {
      setMeldung(x instanceof Error ? x.message : 'Das hat nicht geklappt.')
    }
  }

  const aktiv = e?.aktiv ?? false
  const wochentag = e?.wochentag ?? 1
  return (
    <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
      <p className="mb-1 font-medium text-slate-700">Wöchentlich erinnern</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-slate-600">
          <input type="checkbox" checked={aktiv} disabled={nurLesen} onChange={(x) => speichere({ aktiv: x.target.checked, wochentag })} />
          jeden
        </label>
        <select className="rounded border border-slate-200 px-1 py-0.5 text-sm" value={wochentag} disabled={nurLesen} onChange={(x) => speichere({ aktiv, wochentag: Number(x.target.value) })}>
          {WOCHENTAGE.map((w) => (
            <option key={w.wert} value={w.wert}>{w.name}</option>
          ))}
        </select>
        <span className="text-slate-600">um 8 Uhr eine Telegram-Nachricht an den Verantwortlichen: „Statusbericht ist fertig — prüfen und senden“.</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">An den Kunden geht dabei nichts von selbst — gesendet wird immer erst hier nach deiner Prüfung.</p>
      {schalter && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          Für alle Akten: {schalter.aktiv ? <span className="font-medium text-emerald-700">eingeschaltet</span> : <span className="font-medium text-amber-700">ausgeschaltet — es kommen noch keine Erinnerungen</span>}
          {darfSchalter && (
            <button type="button" onClick={() => schalte(!schalter.aktiv)} className="font-medium text-accent-600 hover:underline">
              {schalter.aktiv ? 'ausschalten' : 'einschalten'}
            </button>
          )}
          {!darfSchalter && !schalter.aktiv && <span>(einschalten kann die Geschäftsführung)</span>}
        </p>
      )}
      {meldung && <p className="mt-1 text-xs text-rose-600">{meldung}</p>}
    </div>
  )
}
