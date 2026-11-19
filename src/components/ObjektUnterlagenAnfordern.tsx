import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Check, CheckCircle2, ChevronDown, ChevronUp, Circle, ClipboardCheck, Link2, Send } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { Card, Field, inputClass, Modal, PrimaryButton, SecondaryButton } from './ui'
import { shareableUrl } from './FormularLink'
import { CURRENT_USER } from '../data/constants'
import { pruefeUnterlagenVollstaendigkeit } from '../data/objektUnterlagenPflicht'
import { isEmailGatewayConfigured, sendEmail } from '../lib/emailGateway'
import { gemerkterAbsender, merkeAbsender, postfachBezeichnung, usePostfaecher } from '../lib/postfaecher'
import { addDays, fmtDate, today, uid } from '../lib/dates'
import { useEigentuemerPfad } from '../lib/eigentuemerLink'
import { DOKUMENT_ORDNER } from '../types'
import type { ActivityEntry, DokumentOrdnerName, FollowUp, Objekt, UnterlagenAnforderung } from '../types'

// ── Kleine Helfer ────────────────────────────────────────────────────────────────────────────────

const WIEDERVORLAGE_TAGE = 7
/** So beginnt die Notiz jeder Wiedervorlage, die diese Karte selbst setzt — daran wird sie wiedererkannt. */
const WIEDERVORLAGE_NOTIZ = 'Unterlagen vom Eigentümer:'

type Art = UnterlagenAnforderung['art']

/** Was ein neues Fenster vorbelegt bekommt — bei einer Erinnerung nur das, was noch fehlt. */
type Vorgabe = {
  art: Art
  ordner: DokumentOrdnerName[]
  weitere: string
  an: string
  anName: string
  /** Bei einer Erinnerung: Datum der Anforderung, an die erinnert wird. */
  bezugDatum?: string
  /** Bei einer Erinnerung: Ist seit der Anforderung schon etwas angekommen? */
  schonEtwasDa?: boolean
}

function istDa(objekt: Objekt, ordner: DokumentOrdnerName): boolean {
  return (objekt.dokumente[ordner]?.length ?? 0) > 0
}

function istMailAdresse(text: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(text.trim())
}

/** Pflichtunterlagen der Objektart zuerst (in ihrer Reihenfolge), danach alle übrigen Ordner. */
function ordnerReihenfolge(pflicht: DokumentOrdnerName[]): DokumentOrdnerName[] {
  return [...pflicht, ...DOKUMENT_ORDNER.filter((o) => !pflicht.includes(o))]
}

/** Volle Adresse der Eigentümer-Seite (mit geheimem Zeichen) oder '' solange es noch nicht bekannt ist. */
function useEigentuemerSeite(objekt: Objekt): string {
  const pfad = useEigentuemerPfad(objekt)
  return pfad ? shareableUrl(pfad) : ''
}

function weitereZeilen(weitere: string): string[] {
  return weitere
    .split('\n')
    .map((z) => z.trim())
    .filter(Boolean)
}

function vorschlagBetreff(objekt: Objekt, art: Art): string {
  const wozu = objekt.adresse.trim() || objekt.bezeichnung.trim()
  return art === 'erinnerung' ? `Erinnerung: Unterlagen zu Ihrem Objekt${wozu ? ` – ${wozu}` : ''}` : `Bitte um Unterlagen zu Ihrem Objekt${wozu ? ` – ${wozu}` : ''}`
}

function vorschlagText(eingabe: {
  objekt: Objekt
  art: Art
  anName: string
  ordner: DokumentOrdnerName[]
  weitere: string
  link: string
  wer: string
  mitSignatur: boolean
  bezugDatum?: string
  schonEtwasDa?: boolean
}): string {
  const { objekt, art, anName, ordner, weitere, link, wer, mitSignatur, bezugDatum, schonEtwasDa } = eingabe
  const anrede = anName.trim() ? `Guten Tag ${anName.trim()},` : 'Guten Tag,'
  const objektText = objekt.adresse.trim() ? `Ihr Objekt (${objekt.adresse.trim()})` : objekt.bezeichnung.trim() ? `Ihr Objekt „${objekt.bezeichnung.trim()}“` : 'Ihr Objekt'
  const punkte = [...ordner, ...weitereZeilen(weitere)]
  const liste = punkte.length > 0 ? punkte.map((p) => `– ${p}`).join('\n') : '– (bitte oben auswählen, welche Unterlagen gebraucht werden)'
  // Steht eine eigene Signatur im Profil, hängt sie beim Senden unten dran — dann genügt hier der Gruß.
  const gruss = mitSignatur ? 'Freundliche Grüße' : `Freundliche Grüße\n${wer}`

  if (art === 'erinnerung') {
    return [
      anrede,
      `${bezugDatum ? `am ${fmtDate(bezugDatum)}` : 'vor einiger Zeit'} hatten wir Sie um Unterlagen für ${objektText} gebeten.${
        schonEtwasDa ? ' Vielen Dank für alles, was inzwischen bei uns angekommen ist.' : ''
      } Im Alltag geht so etwas leicht unter – deshalb möchten wir Sie freundlich daran erinnern. Uns fehlt noch:`,
      liste,
      `Hochladen können Sie die Unterlagen weiterhin über diesen Link. Eine Anmeldung ist nicht nötig, ein Foto mit dem Handy genügt:\n${link}`,
      'Falls Sie etwas davon nicht zur Hand haben oder noch Fragen offen sind, melden Sie sich gern bei uns.',
      `Vielen Dank für Ihre Mühe.\n\n${gruss}`,
    ].join('\n\n')
  }
  return [
    anrede,
    `damit wir ${objektText} zügig weiterbearbeiten können, benötigen wir von Ihnen noch Folgendes:`,
    liste,
    `Am einfachsten laden Sie die Unterlagen über diesen Link hoch. Eine Anmeldung ist nicht nötig, ein Foto mit dem Handy genügt:\n${link}`,
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

/** Gibt es schon eine offene Wiedervorlage? Liegt sie vor dem neuen Termin, bleibt sie stehen — außer sie
 *  stammt selbst von einer früheren Anforderung (`eigene`): Die wird mit jeder Erinnerung weitergeschoben,
 *  sonst bliebe sie nach dem Erinnern für immer als überfällig stehen. */
function wiedervorlageLage(objekt: Objekt, neuesDatum: string): { offen: FollowUp | null; eigene: boolean; bleibt: boolean } {
  const f = objekt.followUp
  const offen = f && !f.done && f.date ? f : null
  const eigene = !!offen && (offen.note ?? '').startsWith(WIEDERVORLAGE_NOTIZ)
  return { offen, eigene, bleibt: !!offen && !eigene && offen.date <= neuesDatum }
}

function useKopieren(): { kopiert: boolean; fehler: boolean; kopiere: (text: string) => Promise<void> } {
  const [kopiert, setKopiert] = useState(false)
  const [fehler, setFehler] = useState(false)
  const uhr = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(uhr.current), [])
  async function kopiere(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setFehler(false)
      setKopiert(true)
      window.clearTimeout(uhr.current)
      uhr.current = window.setTimeout(() => setKopiert(false), 1800)
    } catch {
      // Die Zwischenablage ist nicht überall erlaubt — dann wird der Link zum Markieren angezeigt.
      setFehler(true)
    }
  }
  return { kopiert, fehler, kopiere }
}

// ── Das Fenster zum Anfordern / Erinnern ─────────────────────────────────────────────────────────

function AnforderungFenster({ objekt, vorgabe, onClose }: { objekt: Objekt; vorgabe: Vorgabe; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const { art } = vorgabe

  // Nach dem Senden wird mit dem dann aktuellen Stand des Objekts weitergeschrieben — in der Zwischenzeit
  // kann z. B. der Eigentümer etwas hochgeladen haben, das nicht überschrieben werden darf.
  const objektAktuell = useRef(objekt)
  useEffect(() => {
    objektAktuell.current = objekt
  }, [objekt])

  const check = pruefeUnterlagenVollstaendigkeit(objekt)
  const alleOrdner = ordnerReihenfolge(check.pflicht)
  const link = useEigentuemerSeite(objekt)
  const signaturHtml = state.profil.signaturHtml?.trim() ?? ''

  const [gewaehlt, setGewaehlt] = useState<Set<DokumentOrdnerName>>(() => new Set(vorgabe.ordner))
  const [weitere, setWeitere] = useState(vorgabe.weitere)
  const [an, setAn] = useState(vorgabe.an)
  const [anName, setAnName] = useState(vorgabe.anName)
  const [betreff, setBetreff] = useState(() => vorschlagBetreff(objekt, art))
  // null = der vorgeschriebene Text, der sich mit der Auswahl oben mitändert; sonst der von Hand geänderte.
  const [eigenerText, setEigenerText] = useState<string | null>(null)
  const [mitWiedervorlage, setMitWiedervorlage] = useState(true)
  const [uebrigeOffen, setUebrigeOffen] = useState(() => vorgabe.ordner.some((o) => !check.pflicht.includes(o)))
  const [sendet, setSendet] = useState(false)
  const sperre = useRef(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState<{ an: string; wiedervorlage: string } | null>(null)
  const linkKopie = useKopieren()

  // Absender wie im Fenster „Neue E-Mail": alle Postfächer, die dieser Mitarbeiter benutzen darf;
  // vorbelegt das zuletzt gewählte, sonst das gemeinsame Hauptpostfach.
  const { postfaecher } = usePostfaecher()
  const absenderListe = postfaecher.filter((p) => p.bereit && p.kannSenden !== false)
  const [vonId, setVonId] = useState('')
  useEffect(() => {
    const erlaubt = (id?: string | null) => (id && absenderListe.some((p) => p.id === id) ? id : undefined)
    setVonId((bisher) => erlaubt(bisher) ?? erlaubt(gemerkterAbsender()) ?? absenderListe.find((p) => p.gemeinsam)?.id ?? absenderListe[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absenderListe.length])

  const ordnerGewaehlt = alleOrdner.filter((o) => gewaehlt.has(o))
  const vorschlag = vorschlagText({
    objekt,
    art,
    anName,
    ordner: ordnerGewaehlt,
    weitere,
    link,
    wer,
    mitSignatur: !!signaturHtml,
    bezugDatum: vorgabe.bezugDatum,
    schonEtwasDa: vorgabe.schonEtwasDa,
  })
  const text = eigenerText ?? vorschlag

  const neuesDatum = addDays(today(), WIEDERVORLAGE_TAGE)
  const lage = wiedervorlageLage(objekt, neuesDatum)

  const nichtsGewaehlt = ordnerGewaehlt.length === 0 && !weitere.trim()
  const adresseFehlt = !an.trim()
  const adresseUngueltig = !adresseFehlt && !istMailAdresse(an)
  const kannSenden = isEmailGatewayConfigured && !sendet && !nichtsGewaehlt && istMailAdresse(an) && !!betreff.trim() && !!text.trim() && !!link
  const aufTestrechner = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

  function schalte(ordner: DokumentOrdnerName) {
    setGewaehlt((alt) => {
      const neu = new Set(alt)
      if (neu.has(ordner)) neu.delete(ordner)
      else neu.add(ordner)
      return neu
    })
  }

  function schliessen() {
    if (sendet) return
    onClose()
  }

  async function senden() {
    if (!kannSenden || sperre.current) return
    sperre.current = true
    setSendet(true)
    setFehler('')
    const empfaenger = an.trim()
    const name = anName.trim()
    const weitereText = weitereZeilen(weitere).join('\n')
    try {
      const mailText = text.trim()
      const signaturText = signaturHtml ? signaturAlsText(signaturHtml) : ''
      await sendEmail(
        empfaenger,
        betreff.trim(),
        signaturText ? `${mailText}\n\n--\n${signaturText}` : mailText,
        `<div>${alsHtml(mailText)}</div>${signaturHtml ? `<div>${signaturHtml}</div>` : ''}`,
        { toName: name || empfaenger },
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

    // Die Mail ist raus — jetzt am Objekt festhalten (ein einziger Schreibvorgang).
    const o = objektAktuell.current
    const anforderung: UnterlagenAnforderung = {
      id: uid('anf'),
      datum: today(),
      an: empfaenger,
      ...(name ? { anName: name } : {}),
      von: wer,
      ordner: ordnerGewaehlt,
      ...(weitereText ? { weitere: weitereText } : {}),
      art,
    }
    const wasAngefordert = [...ordnerGewaehlt, ...weitereZeilen(weitere)].join(', ')
    const beiWem = name ? `${name} (${empfaenger})` : empfaenger
    const eintrag: ActivityEntry = {
      id: uid('act'),
      date: today(),
      text: art === 'erinnerung' ? `An fehlende Unterlagen erinnert – ${beiWem}: ${wasAngefordert}` : `Unterlagen angefordert bei ${beiWem}: ${wasAngefordert}`,
      user: wer,
    }
    const lageJetzt = wiedervorlageLage(o, neuesDatum)
    const setzeWiedervorlage = mitWiedervorlage && !lageJetzt.bleibt
    const followUp: FollowUp = {
      date: neuesDatum,
      note: `${WIEDERVORLAGE_NOTIZ} Eingang prüfen, sonst erinnern (${art === 'erinnerung' ? 'erinnert' : 'angefordert'} am ${fmtDate(today())})`,
      done: false,
    }
    dispatch({
      type: 'UPDATE_OBJEKT',
      id: o.id,
      patch: {
        unterlagenAnforderungen: [anforderung, ...(o.unterlagenAnforderungen ?? [])],
        activities: [eintrag, ...o.activities],
        ...(setzeWiedervorlage ? { followUp } : {}),
      },
    })
    setFertig({
      an: empfaenger,
      wiedervorlage: setzeWiedervorlage
        ? `Wiedervorlage gesetzt für den ${fmtDate(neuesDatum)}.`
        : mitWiedervorlage && lageJetzt.offen
          ? `Die bestehende Wiedervorlage am ${fmtDate(lageJetzt.offen.date)} bleibt stehen.`
          : 'Es wurde keine Wiedervorlage gesetzt.',
    })
    setSendet(false)
    sperre.current = false
  }

  const haken = 'mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-accent-600 focus:ring-accent-200'

  function ordnerZeile(ordner: DokumentOrdnerName) {
    const anzahl = objekt.dokumente[ordner]?.length ?? 0
    return (
      <label key={ordner} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-sm hover:bg-slate-50">
        <input type="checkbox" className={haken} checked={gewaehlt.has(ordner)} onChange={() => schalte(ordner)} />
        <span className="min-w-0 flex-1 break-words text-slate-700">
          {ordner}
          {anzahl > 0 && <span className="ml-1.5 whitespace-nowrap text-xs text-slate-400">({anzahl} schon da)</span>}
        </span>
      </label>
    )
  }

  const uebrige = alleOrdner.filter((o) => !check.pflicht.includes(o))
  const uebrigeGewaehlt = uebrige.filter((o) => gewaehlt.has(o)).length

  return (
    <Modal open onClose={schliessen} title={art === 'erinnerung' ? 'An fehlende Unterlagen erinnern' : 'Unterlagen beim Eigentümer anfordern'} width="max-w-2xl">
      {fertig ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 text-emerald-500" size={36} />
          <p className="mb-1 text-sm font-medium text-slate-800">{art === 'erinnerung' ? 'Erinnerung gesendet.' : 'Anforderung gesendet.'}</p>
          <p className="break-words text-xs text-slate-500">an {fertig.an}</p>
          <p className="mb-5 mt-2 text-xs text-slate-500">Am Objekt festgehalten. {fertig.wiedervorlage}</p>
          <div className="flex justify-center">
            <PrimaryButton onClick={onClose}>Fertig</PrimaryButton>
          </div>
        </div>
      ) : (
        <div>
          {!isEmailGatewayConfigured && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              Das Postfach ist noch nicht verbunden – von hier aus kann gerade nicht gesendet werden. Den Link zur Eigentümer-Seite kannst du unten trotzdem kopieren.
            </div>
          )}

          <div className="mb-4">
            <div className="mb-1.5 text-xs font-medium text-slate-500">
              {check.pflicht.length > 0 ? `Pflichtunterlagen für „${objekt.typ}“` : 'Welche Unterlagen werden gebraucht?'}
            </div>
            {check.pflicht.length > 0 && (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {check.pflicht.map(ordnerZeile)}
              </div>
            )}
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
            {uebrigeOffen && (
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {uebrige.map(ordnerZeile)}
              </div>
            )}
          </div>

          <Field label="Weitere Unterlagen (frei beschrieben, je Zeile eine – kann leer bleiben)">
            <textarea className={inputClass} rows={2} value={weitere} onChange={(e) => setWeitere(e.target.value)} placeholder="z. B. Nachweis über die neue Heizung" />
          </Field>
          {nichtsGewaehlt && <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">Bitte mindestens eine Unterlage auswählen oder beschreiben.</p>}

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="E-Mail-Adresse des Eigentümers">
              <input type="email" className={inputClass} value={an} onChange={(e) => setAn(e.target.value)} placeholder="name@beispiel.de" />
            </Field>
            <Field label="Name für die Anrede">
              <input className={inputClass} value={anName} onChange={(e) => setAnName(e.target.value)} placeholder="z. B. Frau Muster" />
            </Field>
          </div>
          {adresseFehlt && (
            <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">
              Für dieses Objekt ist keine E-Mail-Adresse des Eigentümers hinterlegt. Bitte hier eintragen – oder unten den Link kopieren und auf anderem Weg weitergeben.
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
          {!link && (
            <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">Der Link zur Eigentümer-Seite wird noch vorbereitet – bitte einen Moment warten oder die Seite neu laden.</p>
          )}
          {link && eigenerText !== null && !text.includes(link) && (
            <p className="-mt-1 mb-3 text-xs font-medium text-amber-700">Im Text steht der Link zur Eigentümer-Seite nicht mehr – ohne ihn kann der Eigentümer nichts hochladen.</p>
          )}
          {signaturHtml && <p className="-mt-1 mb-3 text-xs text-slate-400">Deine Signatur aus „Mein Profil“ wird beim Senden angehängt.</p>}
          {aufTestrechner && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Du arbeitest gerade auf einem Testrechner. Der Link im Text führt dorthin und funktioniert beim Eigentümer nicht.
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
          {linkKopie.fehler && <p className="mb-3 select-all break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{link}</p>}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <SecondaryButton onClick={() => link && linkKopie.kopiere(link)} disabled={!link}>
              {linkKopie.kopiert ? <Check size={14} className="text-emerald-600" /> : <Link2 size={14} />}
              {linkKopie.kopiert ? 'Link kopiert' : 'Nur Link kopieren'}
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

function OrdnerStand({ name, da }: { name: string; da: boolean }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${da ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      {da ? <CheckCircle2 size={12} className="flex-shrink-0" /> : <Circle size={12} className="flex-shrink-0" />}
      <span className="min-w-0 break-words">
        {name} · {da ? 'inzwischen da' : 'fehlt noch'}
      </span>
    </span>
  )
}

/** Unterlagen beim Eigentümer anfordern: zeigt, welche Pflichtunterlagen fehlen, schreibt die E-Mail mit dem
 *  Link zur Eigentümer-Seite, hält die Anforderung am Objekt fest und erinnert später an das, was noch fehlt. */
export function ObjektUnterlagenAnfordern({ objekt }: { objekt: Objekt }) {
  const [vorgabe, setVorgabe] = useState<Vorgabe | null>(null)
  const linkKopie = useKopieren()

  const check = pruefeUnterlagenVollstaendigkeit(objekt)
  const anforderungen = objekt.unterlagenAnforderungen ?? []
  const letzte = anforderungen[0]
  const letzteOffen = letzte ? letzte.ordner.filter((o) => !istDa(objekt, o)) : []
  const link = useEigentuemerSeite(objekt)

  const eigentuemerMail = objekt.eigentuemer?.email?.trim() || objekt.verkaufsdaten?.auftraggeber?.email?.trim() || ''
  const eigentuemerName = objekt.eigentuemer?.name?.trim() || objekt.verkaufsdaten?.auftraggeber?.name?.trim() || ''

  function anfordern() {
    setVorgabe({ art: 'anforderung', ordner: check.fehlend, weitere: '', an: eigentuemerMail, anName: eigentuemerName })
  }

  function erinnern() {
    if (!letzte) return
    setVorgabe({
      art: 'erinnerung',
      ordner: letzteOffen,
      weitere: letzte.weitere ?? '',
      an: letzte.an || eigentuemerMail,
      anName: letzte.anName ?? eigentuemerName,
      bezugDatum: letzte.datum,
      schonEtwasDa: letzteOffen.length < letzte.ordner.length,
    })
  }

  return (
    <Card className="mb-4 p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <ClipboardCheck size={14} className="flex-shrink-0" /> Unterlagen vom Eigentümer
          </h3>
          <p className="text-xs text-slate-400">
            {check.pflicht.length === 0
              ? `Für „${objekt.typ}“ sind keine Pflichtunterlagen hinterlegt.`
              : `${check.vorhanden.length} von ${check.pflicht.length} Pflichtunterlagen da`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton onClick={() => link && linkKopie.kopiere(link)} disabled={!link}>
            {linkKopie.kopiert ? <Check size={14} className="text-emerald-600" /> : <Link2 size={14} />}
            {linkKopie.kopiert ? 'Link kopiert' : 'Link zur Eigentümer-Seite kopieren'}
          </SecondaryButton>
          <PrimaryButton onClick={anfordern}>
            <Send size={14} /> {check.fehlend.length > 0 ? 'Fehlende Unterlagen anfordern' : 'Unterlagen anfordern'}
          </PrimaryButton>
        </div>
      </div>
      {linkKopie.fehler && <p className="mb-3 select-all break-all rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{link}</p>}

      {check.pflicht.length > 0 && (
        <>
          <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${check.prozent === 100 ? 'bg-emerald-500' : 'bg-accent-500'}`} style={{ width: `${check.prozent}%` }} />
          </div>
          {check.fehlend.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2 size={15} className="flex-shrink-0" /> Alle Pflichtunterlagen liegen vor.
            </p>
          ) : (
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-500">Es fehlt noch:</div>
              <ul className="flex flex-wrap gap-1.5">
                {check.fehlend.map((o) => (
                  <li key={o} className="max-w-full break-words rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {anforderungen.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 text-xs font-medium text-slate-500">Bisher angefordert · die neueste Anforderung steht oben</div>
          <ul className="space-y-3">
            {anforderungen.map((a, i) => (
              <li key={a.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold text-slate-800">{fmtDate(a.datum)}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${a.art === 'erinnerung' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                    {a.art === 'erinnerung' ? 'Erinnerung' : 'Anforderung'}
                  </span>
                  <span className="min-w-0 break-all text-slate-600">
                    <span className="text-slate-400">an </span>
                    {a.anName ? `${a.anName} · ${a.an}` : a.an}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">gesendet von {a.von || 'unbekannt'}</div>
                {a.ordner.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.ordner.map((o) => (
                      <OrdnerStand key={o} name={o} da={istDa(objekt, o)} />
                    ))}
                  </div>
                )}
                {a.weitere?.trim() && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-500">
                    <span className="font-medium text-slate-600">Außerdem erbeten:</span> {a.weitere.trim()} <span className="text-slate-400">(Eingang bitte selbst prüfen)</span>
                  </p>
                )}
                {i === 0 && letzteOffen.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <SecondaryButton onClick={erinnern}>
                      <Bell size={14} /> Erinnern
                    </SecondaryButton>
                    <span className="text-xs text-slate-400">
                      {letzteOffen.length === 1 ? 'Eine Unterlage fehlt noch.' : `${letzteOffen.length} Unterlagen fehlen noch.`}
                    </span>
                  </div>
                )}
                {i === 0 && letzteOffen.length === 0 && a.ordner.length > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 size={13} className="flex-shrink-0" /> Alles Angeforderte ist angekommen.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {vorgabe && <AnforderungFenster objekt={objekt} vorgabe={vorgabe} onClose={() => setVorgabe(null)} />}
    </Card>
  )
}
