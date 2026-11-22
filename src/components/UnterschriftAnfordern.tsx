// „Zum Unterschreiben schicken“ (22.11.2026): aus dem Fenster „Ausfüllen“ einer Vorlage (VorlageAusfuellenModal).
// Der Text wird genau so festgehalten, wie er gerade ausgefüllt ist; nur die Felder, die hier „füllt der Kunde aus“
// tragen, bleiben für den Kunden offen. Danach geht der Link per E-Mail an den Kunden (über das gewählte Postfach,
// mit der eigenen Signatur) oder wird nur erstellt und kopiert. Unterschreibt der Kunde, legt der Server das PDF in
// die Akte (email-gateway/unterschrift.ts); den Stand zeigt UnterschriftAnfragen.tsx in der Akte.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Link2, Send } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { CURRENT_USER } from '../data/constants'
import { kopfstilFuer } from '../lib/vorlagePdf'
import { felderAus } from '../lib/vorlagenFuellen'
import { isEmailGatewayConfigured, sendEmail, type SendEmailKundeKontext } from '../lib/emailGateway'
import { gemerkterAbsender, merkeAbsender, postfachBezeichnung, usePostfaecher } from '../lib/postfaecher'
import { legeUnterschriftAnfrageAn, unterschriftLink } from '../lib/unterschrift'
import { neuesUnterschriftToken, schnappschuss, UNTERSCHRIFT_GUELTIG_TAGE, type KundenFeld } from '../../supabase/functions/_shared/unterschriftKern.ts'
import { today, uid } from '../lib/dates'
import { Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { UnterschriftDokument } from './UnterschriftDokument'
import type { ActivityEntry, Kunde, KundeBereich, Vorlage } from '../types'

type Wahl = 'pflicht' | 'freiwillig' | 'leer'

function istMailAdresse(text: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(text.trim())
}

function htmlSicher(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Mailtext als einfache HTML-Fassung: Absätze bleiben Absätze, Adressen werden anklickbar. */
function alsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((absatz) => `<p>${htmlSicher(absatz).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Signatur aus „Mein Profil“ als reiner Text — wie in KundeUnterlagenAnfordern.tsx. */
function signaturAlsText(signaturHtml: string): string {
  return signaturHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

function vorschlagText(e: { anName: string; titel: string; link: string; mitFeldern: boolean; wer: string; mitSignatur: boolean }): string {
  const anrede = e.anName.trim() ? `Guten Tag ${e.anName.trim()},` : 'Guten Tag,'
  return [
    anrede,
    `anbei erhalten Sie „${e.titel}“ zur Unterschrift. Über den folgenden Link können Sie das Dokument in Ruhe lesen${e.mitFeldern ? ', Ihre fehlenden Angaben ergänzen' : ''} und direkt am Handy oder Computer unterschreiben – ohne Ausdrucken und Einscannen:\n${e.link}`,
    `Der Link gilt ${UNTERSCHRIFT_GUELTIG_TAGE} Tage. Bitte geben Sie ihn nicht weiter.`,
    'Bei Fragen melden Sie sich gern bei uns.',
    e.mitSignatur ? 'Freundliche Grüße' : `Freundliche Grüße\n${e.wer}`,
  ].join('\n\n')
}

export function UnterschriftAnfordern({
  vorlage,
  werte,
  angekreuzt,
  auswahl,
  onClose,
}: {
  vorlage: Vorlage
  werte: Record<string, string>
  angekreuzt: ReadonlySet<number>
  auswahl: { bereich: KundeBereich; kunde: Kunde }
  onClose: () => void
}) {
  const { state, dispatch } = useApp()
  const { mitarbeiter, ansichtAls } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const { bereich, kunde } = auswahl
  const signaturHtml = state.profil.signaturHtml?.trim() ?? ''

  // Eine Kennung je Fenster: Sie steht im Link des Mailtexts und wird beim Anlegen gespeichert.
  const [token] = useState(neuesUnterschriftToken)
  const link = unterschriftLink(token)

  // Felder, die noch leer sind: Der Mitarbeiter entscheidet, ob der Kunde sie ausfüllt.
  const leere = useMemo(() => felderAus(vorlage.text).filter((n) => !(werte[n] ?? '').trim()), [vorlage.text, werte])
  const [wahl, setWahl] = useState<Record<string, Wahl>>(() => Object.fromEntries(leere.map((n) => [n, /unterschrift|berater/i.test(n) ? 'leer' : 'pflicht'])))
  const felder: KundenFeld[] = useMemo(
    () => leere.filter((n) => (wahl[n] ?? 'pflicht') !== 'leer').map((n) => ({ name: n, pflicht: (wahl[n] ?? 'pflicht') === 'pflicht' })),
    [leere, wahl],
  )
  const kopfstil = kopfstilFuer(vorlage.name)
  const text = useMemo(() => schnappschuss(vorlage.text, werte, angekreuzt, felder.map((f) => f.name)), [vorlage.text, werte, angekreuzt, felder])

  const [titel, setTitel] = useState(vorlage.name)
  const [an, setAn] = useState(kunde.email?.trim() ?? '')
  const [anName, setAnName] = useState(kunde.ansprechpartner?.trim() || kunde.firma || '')
  const [betreff, setBetreff] = useState(`Bitte unterschreiben: ${vorlage.name}`)
  const [eigenerText, setEigenerText] = useState<string | null>(null)
  const [vorschau, setVorschau] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const sperre = useRef(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState<{ nurLink: boolean; an?: string; mailFehler?: string } | null>(null)
  const [kopiert, setKopiert] = useState(false)

  const { postfaecher } = usePostfaecher()
  const absenderListe = postfaecher.filter((p) => p.bereit && p.kannSenden !== false)
  const [vonId, setVonId] = useState('')
  useEffect(() => {
    const erlaubt = (id?: string | null) => (id && absenderListe.some((p) => p.id === id) ? id : undefined)
    setVonId((bisher) => erlaubt(bisher) ?? erlaubt(gemerkterAbsender()) ?? absenderListe.find((p) => p.gemeinsam)?.id ?? absenderListe[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absenderListe.length])

  const vorschlag = vorschlagText({ anName, titel: titel.trim() || vorlage.name, link, mitFeldern: felder.length > 0, wer, mitSignatur: !!signaturHtml })
  const mailText = eigenerText ?? vorschlag
  const nurLesen = !!ansichtAls
  const titelOk = titel.trim().length > 0

  async function kopiere() {
    try {
      await navigator.clipboard.writeText(link)
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2000)
    } catch {
      window.prompt('Link kopieren:', link)
    }
  }

  function verlauf(textEintrag: string) {
    const aktuell = KUNDEN_BEREICHE.find((b) => b.id === bereich)?.get(state).find((k) => k.id === kunde.id) ?? kunde
    const eintrag: ActivityEntry = { id: uid('act'), date: today(), text: textEintrag, user: wer }
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { activities: [eintrag, ...(aktuell.activities ?? [])], letzteAktivitaet: today() } })
  }

  async function los(mitMail: boolean) {
    if (sperre.current || nurLesen || !titelOk) return
    if (mitMail && (!istMailAdresse(an) || !betreff.trim() || !mailText.trim())) return
    sperre.current = true
    setLaeuft(true)
    setFehler('')
    try {
      await legeUnterschriftAnfrageAn({
        token, kundeId: kunde.id, bereich, vorlageId: vorlage.id, titel: titel.trim(), kopfstil, text, felder,
        email: mitMail ? an.trim() : undefined, anName: anName.trim() || undefined, von: wer,
      })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Die Anfrage ließ sich nicht anlegen.')
      setLaeuft(false)
      sperre.current = false
      return
    }
    if (!mitMail) {
      verlauf(`Link zum Unterschreiben erstellt (ohne E-Mail weitergegeben): „${titel.trim()}“`)
      await kopiere()
      setFertig({ nurLink: true })
      setLaeuft(false)
      return
    }
    try {
      const signaturText = signaturHtml ? signaturAlsText(signaturHtml) : ''
      const kontext: SendEmailKundeKontext & { ohneRechnungsErkennung: boolean } = {
        toName: anName.trim() || an.trim(),
        kundeBereich: bereich,
        kundeId: kunde.id,
        kundeName: kunde.firma,
        ohneRechnungsErkennung: true,
      }
      await sendEmail(
        an.trim(),
        betreff.trim(),
        signaturText ? `${mailText.trim()}\n\n--\n${signaturText}` : mailText.trim(),
        `<div>${alsHtml(mailText.trim())}</div>${signaturHtml ? `<div>${signaturHtml}</div>` : ''}`,
        kontext,
        undefined,
        { postfachId: vonId || undefined },
      )
      if (vonId) merkeAbsender(vonId)
      verlauf(`Zum Unterschreiben geschickt: „${titel.trim()}“ an ${anName.trim() ? `${anName.trim()} (${an.trim()})` : an.trim()}`)
      setFertig({ nurLink: false, an: an.trim() })
    } catch (e) {
      verlauf(`Link zum Unterschreiben erstellt: „${titel.trim()}“ (die E-Mail an ${an.trim()} ging nicht raus)`)
      setFertig({ nurLink: false, an: an.trim(), mailFehler: e instanceof Error && e.message ? e.message : 'Die E-Mail konnte nicht gesendet werden.' })
    }
    setLaeuft(false)
  }

  if (fertig) {
    return (
      <Modal open onClose={onClose} title="Zum Unterschreiben geschickt" width="max-w-lg" aktionen={<PrimaryButton onClick={onClose}>Fertig</PrimaryButton>}>
        <div className="space-y-3 text-sm text-slate-700">
          {fertig.mailFehler ? (
            <p className="rounded-lg bg-amber-50 p-2 text-amber-800">Die Anfrage ist angelegt, aber die E-Mail an {fertig.an} ging nicht raus: {fertig.mailFehler} Du kannst den Link unten kopieren und selbst weitergeben.</p>
          ) : fertig.nurLink ? (
            <p className="rounded-lg bg-emerald-50 p-2 text-emerald-800">Der Link ist erstellt{kopiert ? ' und in die Zwischenablage kopiert' : ''}. Gib ihn nur an den Kunden weiter.</p>
          ) : (
            <p className="rounded-lg bg-emerald-50 p-2 text-emerald-800">Gesendet an {fertig.an}.</p>
          )}
          <div className="flex items-center gap-2">
            <input readOnly value={link} className={`${inputClass} min-w-0 flex-1 text-xs`} aria-label="Link zum Unterschreiben" onFocus={(e) => e.target.select()} />
            <SecondaryButton onClick={kopiere}>{kopiert ? <Check size={14} /> : <Copy size={14} />} {kopiert ? 'Kopiert' : 'Kopieren'}</SecondaryButton>
          </div>
          <p className="text-xs text-slate-500">
            Sobald der Kunde unterschreibt, liegt das unterschriebene PDF in den Dokumenten der Akte und der Verantwortliche bekommt eine Telegram-Nachricht. Den Stand siehst du in der Akte unter „Zum Unterschreiben verschickt“.
          </p>
        </div>
      </Modal>
    )
  }

  const feld = 'mb-1 block text-xs font-medium text-slate-500'
  return (
    <Modal
      open
      onClose={() => !laeuft && onClose()}
      title={`Zum Unterschreiben schicken: ${vorlage.name}`}
      width="max-w-3xl"
      aktionen={
        <div className="flex flex-wrap justify-end gap-2">
          <SecondaryButton onClick={() => los(false)} disabled={laeuft || nurLesen || !titelOk}>
            <Link2 size={14} /> Nur Link erstellen und kopieren
          </SecondaryButton>
          <PrimaryButton onClick={() => los(true)} disabled={laeuft || nurLesen || !titelOk || !isEmailGatewayConfigured || !istMailAdresse(an) || !betreff.trim() || !mailText.trim()}>
            <Send size={14} /> {laeuft ? 'Wird gesendet …' : 'Per E-Mail senden'}
          </PrimaryButton>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-rose-600">{fehler}</p>}
        <p className="text-slate-500">
          Der Kunde bekommt einen persönlichen Link ({UNTERSCHRIFT_GUELTIG_TAGE} Tage gültig). Er sieht genau diesen ausgefüllten Text, ergänzt die unten gewählten Angaben und unterschreibt mit Finger oder Maus. Das unterschriebene PDF landet von selbst in der Akte von {kunde.ansprechpartner || kunde.firma}.
        </p>

        <label className="block">
          <span className={feld}>Titel des Dokuments (so heißt es für den Kunden und in der Akte)</span>
          <input value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} className={`${inputClass} w-full`} />
        </label>

        {leere.length > 0 ? (
          <div>
            <p className={feld}>Noch leere Felder — wer füllt sie aus?</p>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {leere.map((n) => (
                <div key={n} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-slate-700">{n}</span>
                  <select value={wahl[n] ?? 'pflicht'} onChange={(e) => setWahl((alt) => ({ ...alt, [n]: e.target.value as Wahl }))} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs">
                    <option value="pflicht">Kunde füllt aus (muss)</option>
                    <option value="freiwillig">Kunde füllt aus (freiwillig)</option>
                    <option value="leer">bleibt leer (Linie)</option>
                  </select>
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">Was du im Fenster davor ausgefüllt hast, kann der Kunde nicht ändern. Fehlt dort noch etwas, schließe dieses Fenster und ergänze es zuerst.</p>
          </div>
        ) : (
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">Alle Felder sind ausgefüllt — der Kunde liest nur und unterschreibt.</p>
        )}

        <button type="button" onClick={() => setVorschau((v) => !v)} className="text-xs font-medium text-accent-600 hover:underline">
          {vorschau ? 'Vorschau ausblenden' : 'So sieht es der Kunde (Vorschau)'}
        </button>
        {vorschau && (
          <div className="max-h-96 overflow-y-auto rounded-lg bg-slate-50 p-2">
            <UnterschriftDokument text={text} kopfstil={kopfstil} felder={felder} />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={feld}>An (E-Mail)</span>
            <input value={an} onChange={(e) => setAn(e.target.value)} className={`${inputClass} w-full`} placeholder="kunde@beispiel.de" />
          </label>
          <label className="block">
            <span className={feld}>Name für die Anrede</span>
            <input value={anName} onChange={(e) => setAnName(e.target.value)} className={`${inputClass} w-full`} />
          </label>
        </div>
        {an.trim() && !istMailAdresse(an) && <p className="text-xs text-rose-600">Diese E-Mail-Adresse ist nicht vollständig.</p>}
        {absenderListe.length > 1 && (
          <label className="block">
            <span className={feld}>Senden von</span>
            <select value={vonId} onChange={(e) => setVonId(e.target.value)} className={`${inputClass} w-full`}>
              {absenderListe.map((p) => <option key={p.id} value={p.id}>{postfachBezeichnung(p)}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className={feld}>Betreff</span>
          <input value={betreff} onChange={(e) => setBetreff(e.target.value)} className={`${inputClass} w-full`} />
        </label>
        <label className="block">
          <span className={feld}>Text {signaturHtml ? '(deine Signatur aus „Mein Profil“ wird angehängt)' : ''}</span>
          <textarea value={mailText} onChange={(e) => setEigenerText(e.target.value)} rows={10} className={`${inputClass} w-full`} />
        </label>
        {eigenerText !== null && !eigenerText.includes(link) && <p className="text-xs text-amber-700">Achtung: Der Link zum Unterschreiben steht nicht mehr im Text.</p>}
        {!isEmailGatewayConfigured && <p className="text-xs text-amber-700">Das Postfach ist nicht eingerichtet — nur „Link erstellen“ ist möglich.</p>}
      </div>
    </Modal>
  )
}
