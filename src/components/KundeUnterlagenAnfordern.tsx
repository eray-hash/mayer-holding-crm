import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, ClipboardCheck, Link2, Send } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { Card, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from './ui'
import { shareableUrl } from './FormularLink'
import { CURRENT_USER } from '../data/constants'
import { SELBSTAUSKUNFT, SONSTIGE_UNTERLAGE, unterlagenFuerBereich } from '../data/kundenUnterlagen'
import { isEmailGatewayConfigured, sendEmail, type SendEmailKundeKontext } from '../lib/emailGateway'
import { gemerkterAbsender, merkeAbsender, postfachBezeichnung, usePostfaecher } from '../lib/postfaecher'
import { addDays, fmtDate, today, uid } from '../lib/dates'
import type { ActivityEntry, FollowUp, Kunde, KundeBereich, KundenUnterlagenAnforderung } from '../types'

// Unterlagen beim Kunden anfordern — Gegenstück zu ObjektUnterlagenAnfordern.tsx für alle Kundenakten.
// Jede Anforderung bekommt eine eigene geheime Kennung; der Link in der Mail führt zur Hochlade-Seite
// /formular/unterlagen/:token (PublicKundenUnterlagen.tsx). Was der Kunde dort hochlädt, trägt der
// Server in die Akte ein (Dokumente, Verlauf und `eingang` der Anforderung).

const WIEDERVORLAGE_TAGE = 7
/** So beginnt die Notiz jeder Wiedervorlage, die diese Karte selbst setzt — daran wird sie wiedererkannt. */
const WIEDERVORLAGE_NOTIZ = 'Unterlagen vom Kunden:'
/** Wie lange ein Link gilt — muss zu GUELTIG_TAGE in supabase/functions/email-gateway/kundenUnterlagen.ts passen. */
const GUELTIG_TAGE = 60

type Art = KundenUnterlagenAnforderung['art']

type Vorgabe = {
  art: Art
  punkte: string[]
  weitere: string
  an: string
  anName: string
  bezugDatum?: string
  schonEtwasDa?: boolean
}

// ── Kleine Helfer ────────────────────────────────────────────────────────────────────────────────

/** 32 Zufallsbytes, base64url ohne Auffüllzeichen (43 Zeichen). */
function neueKennung(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function hochladeSeite(token: string): string {
  return shareableUrl(`/formular/unterlagen/${token}`)
}

function linkGueltig(datum: string): boolean {
  return addDays(datum, GUELTIG_TAGE) >= today()
}

/** Ist ein Punkt seit `seit` angekommen — über irgendeinen Hochlade-Link dieser Akte oder (Selbstauskunft) über das Online-Formular? */
function punktDa(kunde: Kunde, punkt: string, seit: string): boolean {
  if (punkt === SELBSTAUSKUNFT && kunde.selbstauskunft?.eingereichtAm && kunde.selbstauskunft.eingereichtAm.slice(0, 10) >= seit) return true
  return (kunde.unterlagenAnforderungen ?? []).some((a) => (a.eingang ?? []).some((e) => e.punkt === punkt && e.datum >= seit))
}

function istMailAdresse(text: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(text.trim())
}

function weitereZeilen(weitere: string): string[] {
  return weitere
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
}

function vorschlagBetreff(art: Art): string {
  return art === 'erinnerung' ? 'Erinnerung: Ihre Unterlagen' : 'Bitte um Ihre Unterlagen'
}

function vorschlagText(eingabe: {
  art: Art
  anName: string
  punkte: string[]
  weitere: string
  link: string
  wer: string
  mitSignatur: boolean
  bezugDatum?: string
  schonEtwasDa?: boolean
}): string {
  const { art, anName, punkte, weitere, link, wer, mitSignatur, bezugDatum, schonEtwasDa } = eingabe
  const anrede = anName.trim() ? `Guten Tag ${anName.trim()},` : 'Guten Tag,'
  const alle = [...punkte, ...weitereZeilen(weitere)]
  const liste = alle.length > 0 ? alle.map((p) => `– ${p}`).join('\n') : '– (bitte oben auswählen, welche Unterlagen gebraucht werden)'
  const gruss = mitSignatur ? 'Freundliche Grüße' : `Freundliche Grüße\n${wer}`
  const hochladen = `Hochladen können Sie die Unterlagen über diesen Link. Eine Anmeldung ist nicht nötig, ein Foto mit dem Handy genügt:\n${link}`
  const gueltig = `Der Link gilt ${GUELTIG_TAGE} Tage. Bitte geben Sie ihn nicht weiter.`

  if (art === 'erinnerung') {
    return [
      anrede,
      `${bezugDatum ? `am ${fmtDate(bezugDatum)}` : 'vor einiger Zeit'} hatten wir Sie um einige Unterlagen gebeten.${
        schonEtwasDa ? ' Vielen Dank für alles, was inzwischen bei uns angekommen ist.' : ''
      } Im Alltag geht so etwas leicht unter – deshalb möchten wir Sie freundlich daran erinnern. Uns fehlt noch:`,
      liste,
      `${hochladen}\n${gueltig}`,
      'Falls Sie etwas davon nicht zur Hand haben oder Fragen haben, melden Sie sich gern bei uns.',
      `Vielen Dank für Ihre Mühe.\n\n${gruss}`,
    ].join('\n\n')
  }
  return [
    anrede,
    'damit wir Ihr Anliegen zügig weiterbearbeiten können, benötigen wir von Ihnen noch folgende Unterlagen:',
    liste,
    `${hochladen}\n${gueltig}`,
    'Sollte Ihnen eine Unterlage nicht vorliegen, geben Sie uns bitte kurz Bescheid.',
    `Vielen Dank für Ihre Mühe.\n\n${gruss}`,
  ].join('\n\n')
}

function htmlSicher(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Der Mailtext als einfache HTML-Fassung: Absätze bleiben Absätze, Adressen werden anklickbar. */
function alsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((absatz) => `<p>${htmlSicher(absatz).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Die Signatur aus „Mein Profil" als reiner Text — gleiche Umwandlung wie im Fenster „Neue E-Mail". */
function signaturAlsText(signaturHtml: string): string {
  return signaturHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Offene Wiedervorlage? Eine fremde, frühere bleibt stehen; eine eigene (von einer früheren Anforderung) wird weitergeschoben. */
function wiedervorlageLage(kunde: Kunde, neuesDatum: string): { offen: FollowUp | null; eigene: boolean; bleibt: boolean } {
  const f = kunde.followUp
  const offen = f && !f.done && f.date ? f : null
  const eigene = !!offen && (offen.note ?? '').startsWith(WIEDERVORLAGE_NOTIZ)
  return { offen, eigene, bleibt: !!offen && !eigene && offen.date <= neuesDatum }
}

function useKopieren(): { kopiert: string | null; fehler: string | null; kopiere: (text: string) => Promise<void> } {
  const [kopiert, setKopiert] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const uhr = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(uhr.current), [])
  async function kopiere(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setFehler(null)
      setKopiert(text)
      window.clearTimeout(uhr.current)
      uhr.current = window.setTimeout(() => setKopiert(null), 1800)
    } catch {
      // Die Zwischenablage ist nicht überall erlaubt — dann wird der Link zum Markieren angezeigt.
      setFehler(text)
    }
  }
  return { kopiert, fehler, kopiere }
}

// ── Das Fenster zum Anfordern / Erinnern ─────────────────────────────────────────────────────────

function AnforderungFenster({ bereich, kunde, vorgabe, onClose }: { bereich: KundeBereich; kunde: Kunde; vorgabe: Vorgabe; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const { art } = vorgabe

  // Nach dem Senden mit dem dann aktuellen Stand der Akte weiterschreiben.
  const kundeAktuell = useRef(kunde)
  useEffect(() => {
    kundeAktuell.current = kunde
  }, [kunde])

  // Eine Kennung je Fenster: Sie steht im Link des Mailtexts und wird beim Senden gespeichert.
  const [token] = useState(neueKennung)
  const link = hochladeSeite(token)
  const signaturHtml = state.profil.signaturHtml?.trim() ?? ''

  const liste = unterlagenFuerBereich(bereich)
  const checkliste = kunde.unterlagenCheckliste ?? {}
  // Was frei oder aus einer älteren Liste stammt, steht mit bei den weiteren Punkten.
  const fremde = vorgabe.punkte.filter((p) => !liste.standard.includes(p) && !liste.weitere.includes(p))
  const weitereListe = [...liste.weitere, ...fremde]

  const [gewaehlt, setGewaehlt] = useState<Set<string>>(() => new Set(vorgabe.punkte))
  const [weitere, setWeitere] = useState(vorgabe.weitere)
  const [an, setAn] = useState(vorgabe.an)
  const [anName, setAnName] = useState(vorgabe.anName)
  const [betreff, setBetreff] = useState(() => vorschlagBetreff(art))
  const [eigenerText, setEigenerText] = useState<string | null>(null)
  const [mitWiedervorlage, setMitWiedervorlage] = useState(true)
  const [uebrigeOffen, setUebrigeOffen] = useState(() => vorgabe.punkte.some((p) => !liste.standard.includes(p)))
  const [sendet, setSendet] = useState(false)
  const sperre = useRef(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState<{ an: string; wiedervorlage: string; nurLink: boolean } | null>(null)
  const linkKopie = useKopieren()

  const { postfaecher } = usePostfaecher()
  const absenderListe = postfaecher.filter((p) => p.bereit && p.kannSenden !== false)
  const [vonId, setVonId] = useState('')
  useEffect(() => {
    const erlaubt = (id?: string | null) => (id && absenderListe.some((p) => p.id === id) ? id : undefined)
    setVonId((bisher) => erlaubt(bisher) ?? erlaubt(gemerkterAbsender()) ?? absenderListe.find((p) => p.gemeinsam)?.id ?? absenderListe[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absenderListe.length])

  const reihenfolge = [...liste.standard, ...weitereListe]
  const punkteGewaehlt = reihenfolge.filter((p) => gewaehlt.has(p))
  const vorschlag = vorschlagText({
    art,
    anName,
    punkte: punkteGewaehlt,
    weitere,
    link,
    wer,
    mitSignatur: !!signaturHtml,
    bezugDatum: vorgabe.bezugDatum,
    schonEtwasDa: vorgabe.schonEtwasDa,
  })
  const text = eigenerText ?? vorschlag

  const neuesDatum = addDays(today(), WIEDERVORLAGE_TAGE)
  const lage = wiedervorlageLage(kunde, neuesDatum)

  const nichtsGewaehlt = punkteGewaehlt.length === 0 && !weitere.trim()
  const adresseFehlt = !an.trim()
  const adresseUngueltig = !adresseFehlt && !istMailAdresse(an)
  const kannSenden = isEmailGatewayConfigured && !sendet && !nichtsGewaehlt && istMailAdresse(an) && !!betreff.trim() && !!text.trim()
  const aufTestrechner = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

  function schalte(punkt: string) {
    setGewaehlt((alt) => {
      const neu = new Set(alt)
      if (neu.has(punkt)) neu.delete(punkt)
      else neu.add(punkt)
      return neu
    })
  }

  function schliessen() {
    if (sendet) return
    onClose()
  }

  /** Hält die Anforderung in der Akte fest (ein einziger Schreibvorgang). */
  function festhalten(empfaenger: string, name: string): string {
    const k = kundeAktuell.current
    const weitereText = weitereZeilen(weitere).join('\n')
    const anforderung: KundenUnterlagenAnforderung = {
      id: uid('kanf'),
      datum: today(),
      an: empfaenger,
      ...(name ? { anName: name } : {}),
      von: wer,
      punkte: punkteGewaehlt,
      ...(weitereText ? { weitere: weitereText } : {}),
      art,
      token,
    }
    const wasAngefordert = [...punkteGewaehlt, ...weitereZeilen(weitere)].join(', ')
    const beiWem = empfaenger ? (name ? `${name} (${empfaenger})` : empfaenger) : name || 'Kunde'
    const eintrag: ActivityEntry = {
      id: uid('act'),
      date: today(),
      text: empfaenger
        ? art === 'erinnerung'
          ? `An fehlende Unterlagen erinnert – ${beiWem}: ${wasAngefordert}`
          : `Unterlagen angefordert bei ${beiWem}: ${wasAngefordert}`
        : `Hochlade-Link für Unterlagen erstellt (ohne E-Mail weitergegeben): ${wasAngefordert}`,
      user: wer,
    }
    const lageJetzt = wiedervorlageLage(k, neuesDatum)
    const setzeWiedervorlage = mitWiedervorlage && !lageJetzt.bleibt
    const followUp: FollowUp = {
      date: neuesDatum,
      note: `${WIEDERVORLAGE_NOTIZ} Eingang prüfen, sonst erinnern (${art === 'erinnerung' ? 'erinnert' : 'angefordert'} am ${fmtDate(today())})`,
      done: false,
    }
    dispatch({
      type: 'UPDATE_KUNDE_IN_BEREICH',
      bereich,
      id: k.id,
      patch: {
        unterlagenAnforderungen: [anforderung, ...(k.unterlagenAnforderungen ?? [])],
        activities: [eintrag, ...k.activities],
        letzteAktivitaet: today(),
        ...(setzeWiedervorlage ? { followUp } : {}),
      },
    })
    return setzeWiedervorlage
      ? `Wiedervorlage gesetzt für den ${fmtDate(neuesDatum)}.`
      : mitWiedervorlage && lageJetzt.offen
        ? `Die bestehende Wiedervorlage am ${fmtDate(lageJetzt.offen.date)} bleibt stehen.`
        : 'Es wurde keine Wiedervorlage gesetzt.'
  }

  async function senden() {
    if (!kannSenden || sperre.current) return
    sperre.current = true
    setSendet(true)
    setFehler('')
    const empfaenger = an.trim()
    const name = anName.trim()
    try {
      const mailText = text.trim()
      const signaturText = signaturHtml ? signaturAlsText(signaturHtml) : ''
      // Der Mail-Verlauf der Akte zeigt die Mail; eine Rechnung ist es nie — daher ohne Rechnungs-Erkennung.
      const kontext: SendEmailKundeKontext & { ohneRechnungsErkennung: boolean } = {
        toName: name || empfaenger,
        kundeBereich: bereich,
        kundeId: kunde.id,
        kundeName: kunde.firma,
        ohneRechnungsErkennung: true,
      }
      await sendEmail(
        empfaenger,
        betreff.trim(),
        signaturText ? `${mailText}\n\n--\n${signaturText}` : mailText,
        `<div>${alsHtml(mailText)}</div>${signaturHtml ? `<div>${signaturHtml}</div>` : ''}`,
        kontext,
        undefined,
        { postfachId: vonId || undefined },
      )
      if (vonId) merkeAbsender(vonId)
    } catch (err) {
      setFehler(err instanceof Error && err.message ? err.message : 'Die E-Mail konnte nicht gesendet werden.')
      setSendet(false)
      sperre.current = false
      return
    }
    const wiedervorlage = festhalten(empfaenger, name)
    setFertig({ an: empfaenger, wiedervorlage, nurLink: false })
    setSendet(false)
    sperre.current = false
  }

  /** Ohne E-Mail: Anforderung festhalten und den Link kopieren (z. B. für eine Kurznachricht). */
  async function nurLink() {
    if (nichtsGewaehlt || sperre.current) return
    sperre.current = true
    const wiedervorlage = festhalten('', anName.trim())
    await linkKopie.kopiere(link)
    setFertig({ an: '', wiedervorlage, nurLink: true })
    sperre.current = false
  }

  const haken = 'mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-accent-600 focus:ring-accent-200'

  function punktZeile(punkt: string) {
    const laut = checkliste[punkt] === true
    const online = punkt === SELBSTAUSKUNFT && !!kunde.selbstauskunft
    const hochgeladen = punktDa(kunde, punkt, '')
    return (
      <label key={punkt} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-sm hover:bg-slate-50">
        <input type="checkbox" className={haken} checked={gewaehlt.has(punkt)} onChange={() => schalte(punkt)} />
        <span className="min-w-0 flex-1 break-words text-slate-700">
          {punkt}
          {laut && <span className="ml-1.5 text-xs text-slate-400">(laut Checkliste vorhanden)</span>}
          {online && <span className="ml-1.5 text-xs text-slate-400">(online schon ausgefüllt)</span>}
          {hochgeladen && !online && <span className="ml-1.5 text-xs text-slate-400">(schon einmal über den Link gekommen)</span>}
        </span>
      </label>
    )
  }

  const uebrigeGewaehlt = weitereListe.filter((p) => gewaehlt.has(p)).length

  return (
    <Modal open onClose={schliessen} title={art === 'erinnerung' ? 'An fehlende Unterlagen erinnern' : 'Unterlagen beim Kunden anfordern'} width="max-w-2xl">
      {fertig ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={36} />
          <p className="mb-1 text-sm font-medium text-slate-800">
            {fertig.nurLink ? 'Link erstellt.' : art === 'erinnerung' ? 'Erinnerung gesendet.' : 'Anforderung gesendet.'}
          </p>
          {fertig.an && <p className="break-words text-xs text-slate-500">an {fertig.an}</p>}
          {fertig.nurLink && (
            <p className="mx-auto mt-2 max-w-md select-all break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {linkKopie.kopiert === link ? 'In die Zwischenablage kopiert: ' : ''}
              {link}
            </p>
          )}
          <p className="mb-5 mt-2 text-xs text-slate-500">In der Akte festgehalten. {fertig.wiedervorlage}</p>
          <div className="flex justify-center">
            <PrimaryButton onClick={onClose}>Fertig</PrimaryButton>
          </div>
        </div>
      ) : (
        <div>
          {!isEmailGatewayConfigured && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              Das Postfach ist noch nicht verbunden – von hier aus kann gerade nicht gesendet werden. Den Link kannst du unten trotzdem erstellen und selbst weitergeben.
            </div>
          )}

          <div className="mb-4">
            <div className="mb-1.5 text-xs font-medium text-slate-500">Welche Unterlagen werden gebraucht?</div>
            {liste.standard.length > 0 && <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{liste.standard.map(punktZeile)}</div>}
            {weitereListe.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setUebrigeOffen((v) => !v)}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline"
                  aria-expanded={uebrigeOffen}
                >
                  {uebrigeOffen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  {uebrigeOffen ? 'Andere Unterlagen ausblenden' : 'Andere Unterlagen auswählen'}
                  {uebrigeGewaehlt > 0 ? ` (${uebrigeGewaehlt} gewählt)` : ''}
                </button>
                {uebrigeOffen && <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">{weitereListe.map(punktZeile)}</div>}
              </>
            )}
          </div>

          <Field label="Weitere Unterlagen (frei beschrieben, je Zeile eine – kann leer bleiben)">
            <textarea className={inputClass} rows={2} value={weitere} onChange={(e) => setWeitere(e.target.value)} placeholder="z. B. Mietvertrag für die Lagerhalle" />
          </Field>
          {nichtsGewaehlt && <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">Bitte mindestens eine Unterlage auswählen oder beschreiben.</p>}

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="E-Mail-Adresse des Kunden">
              <input type="email" className={inputClass} value={an} onChange={(e) => setAn(e.target.value)} placeholder="name@beispiel.de" />
            </Field>
            <Field label="Name für die Anrede">
              <input className={inputClass} value={anName} onChange={(e) => setAnName(e.target.value)} placeholder="z. B. Frau Muster" />
            </Field>
          </div>
          {adresseFehlt && (
            <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">
              In der Akte steht keine E-Mail-Adresse. Bitte hier eintragen – oder unten den Link ohne E-Mail erstellen und selbst weitergeben.
            </p>
          )}
          {adresseUngueltig && <p className="-mt-1 mb-3 text-xs font-medium text-rose-600">Das ist keine vollständige E-Mail-Adresse.</p>}

          {absenderListe.length > 1 ? (
            <Field label="Von">
              <select className={inputClass} value={vonId} onChange={(e) => setVonId(e.target.value)}>
                {absenderListe.map((p) => (
                  <option key={p.id} value={p.id}>
                    {postfachBezeichnung(p)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            absenderListe.length === 1 && <p className="mb-3 break-words text-xs text-slate-500">Von: {postfachBezeichnung(absenderListe[0])}</p>
          )}

          <Field label="Betreff">
            <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </Field>
          <Field label="Nachricht (kann vor dem Senden geändert werden)">
            <textarea className={inputClass} rows={12} value={text} onChange={(e) => setEigenerText(e.target.value)} />
          </Field>
          {eigenerText !== null && (
            <p className="-mt-1 mb-3 text-xs text-slate-500">
              Du hast den Text von Hand geändert – er passt sich der Auswahl oben nicht mehr von selbst an.{' '}
              <button type="button" onClick={() => setEigenerText(null)} className="font-medium text-accent-600 hover:underline">
                Text neu schreiben lassen
              </button>
            </p>
          )}
          {eigenerText !== null && !text.includes(link) && (
            <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">Im Text steht der Link zur Hochlade-Seite nicht mehr – ohne ihn kann der Kunde nichts hochladen.</p>
          )}
          {signaturHtml && <p className="-mt-1 mb-3 text-xs text-slate-400">Deine Signatur aus „Mein Profil“ wird beim Senden angehängt.</p>}
          {aufTestrechner && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Du arbeitest gerade auf einem Testrechner. Der Link im Text führt dorthin und funktioniert beim Kunden nicht.
            </p>
          )}

          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2.5">
            <label className={`flex items-start gap-2 text-sm ${lage.bleibt ? 'text-slate-400' : 'cursor-pointer text-slate-700'}`}>
              <input type="checkbox" className={haken} checked={mitWiedervorlage && !lage.bleibt} disabled={lage.bleibt} onChange={(e) => setMitWiedervorlage(e.target.checked)} />
              <span>
                Wiedervorlage in {WIEDERVORLAGE_TAGE} Tagen setzen <span className="whitespace-nowrap text-xs text-slate-400">({fmtDate(neuesDatum)})</span>
              </span>
            </label>
            {lage.offen && lage.bleibt && (
              <p className="mt-1.5 break-words text-xs text-slate-500">
                Es gibt schon eine offene Wiedervorlage am {fmtDate(lage.offen.date)}
                {lage.offen.note ? ` („${lage.offen.note}“)` : ''}. Sie bleibt stehen, es wird keine neue gesetzt.
              </p>
            )}
            {lage.offen && lage.eigene && mitWiedervorlage && lage.offen.date !== neuesDatum && (
              <p className="mt-1.5 break-words text-xs text-slate-500">
                Die Wiedervorlage zur letzten Anforderung ({fmtDate(lage.offen.date)}) wird auf den {fmtDate(neuesDatum)} verschoben.
              </p>
            )}
            {lage.offen && !lage.eigene && !lage.bleibt && mitWiedervorlage && (
              <p className="mt-1.5 break-words text-xs text-amber-700">
                Die bisherige Wiedervorlage am {fmtDate(lage.offen.date)}
                {lage.offen.note ? ` („${lage.offen.note}“)` : ''} liegt später und wird durch die neue ersetzt. Haken entfernen, wenn sie bleiben soll.
              </p>
            )}
          </div>

          {fehler && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0 break-words">Nicht gesendet: {fehler}</span>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <SecondaryButton onClick={nurLink} disabled={nichtsGewaehlt || sendet}>
              <Link2 size={14} /> Ohne E-Mail: nur Link erstellen
            </SecondaryButton>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton onClick={schliessen} disabled={sendet}>
                Abbrechen
              </SecondaryButton>
              <PrimaryButton onClick={senden} disabled={!kannSenden}>
                <Send size={14} /> {sendet ? 'Wird gesendet …' : 'Jetzt senden'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Die Karte oben im Reiter „Dokumente" ─────────────────────────────────────────────────────────

function PunktStand({ name, da }: { name: string; da: boolean }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${da ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {da ? <CheckCircle2 size={12} className="flex-shrink-0" /> : <Circle size={12} className="flex-shrink-0" />}
      <span className="min-w-0 break-words">
        {name} · {da ? 'inzwischen da' : 'fehlt noch'}
      </span>
    </span>
  )
}

/** Unterlagen beim Kunden anfordern: schreibt die E-Mail mit dem Hochlade-Link, hält die Anforderung in der
 *  Akte fest, zeigt je Punkt, was inzwischen angekommen ist, und erinnert an das, was noch fehlt. */
export function KundeUnterlagenAnfordern({ bereich, kunde }: { bereich: KundeBereich; kunde: Kunde }) {
  const [vorgabe, setVorgabe] = useState<Vorgabe | null>(null)
  const linkKopie = useKopieren()

  const liste = unterlagenFuerBereich(bereich)
  const anforderungen = kunde.unterlagenAnforderungen ?? []
  const letzte = anforderungen[0]
  const letzteOffen = letzte ? letzte.punkte.filter((p) => !punktDa(kunde, p, letzte.datum)) : []
  const checkliste = kunde.unterlagenCheckliste ?? {}
  const kundeName = kunde.ansprechpartner?.trim() || ''

  function anfordern() {
    // Vorauswahl: die üblichen Unterlagen des Bereichs, ohne das, was laut Checkliste, Online-Formular oder
    // früherem Hochladen über einen Link schon da ist (bei Bedarf einfach wieder anhaken).
    const punkte = liste.standard.filter((p) => checkliste[p] !== true && !(p === SELBSTAUSKUNFT && kunde.selbstauskunft) && !punktDa(kunde, p, ''))
    setVorgabe({ art: 'anforderung', punkte, weitere: '', an: kunde.email?.trim() ?? '', anName: kundeName })
  }

  function erinnern() {
    if (!letzte) return
    setVorgabe({
      art: 'erinnerung',
      punkte: letzteOffen,
      weitere: letzte.weitere ?? '',
      an: letzte.an || kunde.email?.trim() || '',
      anName: letzte.anName ?? kundeName,
      bezugDatum: letzte.datum,
      schonEtwasDa: letzteOffen.length < letzte.punkte.length,
    })
  }

  return (
    <Card className="mb-4 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <ClipboardCheck size={14} className="flex-shrink-0" /> Unterlagen vom Kunden
          </h3>
          <p className="text-xs text-slate-400">
            {letzte
              ? letzteOffen.length === 0
                ? 'Alles zuletzt Angeforderte ist angekommen.'
                : `Zuletzt angefordert am ${fmtDate(letzte.datum)} · ${letzteOffen.length === 1 ? 'eine Unterlage fehlt' : `${letzteOffen.length} Unterlagen fehlen`} noch`
              : 'Mit einem Klick per E-Mail anfordern. Der Kunde lädt über einen Link hoch, auch mit dem Handy.'}
          </p>
        </div>
        <PrimaryButton onClick={anfordern}>
          <Send size={14} /> Unterlagen anfordern
        </PrimaryButton>
      </div>

      {anforderungen.length > 0 && (
        <div className="mt-2 border-t border-slate-100 pt-4">
          <div className="mb-2 text-xs font-medium text-slate-500">Bisher angefordert · die neueste Anforderung steht oben</div>
          <ul className="space-y-3">
            {anforderungen.map((a, i) => {
              const gueltig = linkGueltig(a.datum)
              const link = a.token ? hochladeSeite(a.token) : ''
              const eingang = a.eingang ?? []
              return (
                <li key={a.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold text-slate-800">{fmtDate(a.datum)}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${a.art === 'erinnerung' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                      {a.art === 'erinnerung' ? 'Erinnerung' : 'Anforderung'}
                    </span>
                    <span className="min-w-0 break-all text-slate-600">
                      {a.an ? (
                        <>
                          <span className="text-slate-400">an </span>
                          {a.anName ? `${a.anName} · ${a.an}` : a.an}
                        </>
                      ) : (
                        <span className="text-slate-400">ohne E-Mail, Link selbst weitergegeben</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">von {a.von || 'unbekannt'}</div>
                  {a.punkte.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {a.punkte.map((p) => (
                        <PunktStand key={p} name={p} da={punktDa(kunde, p, a.datum)} />
                      ))}
                    </div>
                  )}
                  {a.weitere?.trim() && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Außerdem erbeten:</span> {a.weitere.trim()}{' '}
                      <span className="text-slate-400">
                        {eingang.some((e) => e.punkt === SONSTIGE_UNTERLAGE) ? '(dazu ist etwas hochgeladen worden, bitte prüfen)' : '(Eingang bitte selbst prüfen)'}
                      </span>
                    </p>
                  )}
                  {eingang.length > 0 && (
                    <p className="mt-2 break-words text-xs text-slate-500">
                      <span className="font-medium text-slate-600">Über diesen Link hochgeladen:</span>{' '}
                      {eingang.map((e) => `${e.name} (${e.punkt}, ${fmtDate(e.datum)})`).join(' · ')}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    {i === 0 && letzteOffen.length > 0 && (
                      <SecondaryButton onClick={erinnern}>
                        <Bell size={14} /> Erinnern
                      </SecondaryButton>
                    )}
                    {link && gueltig && (
                      <SecondaryButton onClick={() => linkKopie.kopiere(link)}>
                        {linkKopie.kopiert === link ? <Check size={14} className="text-emerald-600" /> : <Link2 size={14} />}
                        {linkKopie.kopiert === link ? 'Link kopiert' : 'Link kopieren'}
                      </SecondaryButton>
                    )}
                    {link && !gueltig && <span className="text-xs text-slate-400">Link abgelaufen ({GUELTIG_TAGE} Tage)</span>}
                    {i === 0 && letzteOffen.length === 0 && a.punkte.length > 0 && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 size={13} className="flex-shrink-0" /> Alles Angeforderte ist angekommen.
                      </span>
                    )}
                  </div>
                  {linkKopie.fehler === link && link && <p className="mt-2 select-all break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{link}</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {vorgabe && <AnforderungFenster bereich={bereich} kunde={kunde} vorgabe={vorgabe} onClose={() => setVorgabe(null)} />}
    </Card>
  )
}
