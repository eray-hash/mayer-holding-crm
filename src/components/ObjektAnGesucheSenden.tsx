import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Mail, Paperclip, Send, XCircle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { VereinbarungWahl, type Vereinbarung } from './ObjektWeitergabenSection'
import { ExposeEinstellungenFelder, erstelleExpose, groesseText, useExposeEinstellungen, useExposeKontext, type ExposeErgebnis } from './ExposePdf'
import { CURRENT_USER } from '../data/constants'
import { kundeBereichLabel } from '../data/kundenBereiche'
import { isEmailGatewayConfigured, sendEmail, type SendEmailKundeKontext } from '../lib/emailGateway'
import { gemerkterAbsender, merkeAbsender, postfachBezeichnung, usePostfaecher } from '../lib/postfaecher'
import { exposeFakten, interneAngabenIn, mailBetreffVorschlag, mailTextVorschlag, mitName, NAME_PLATZHALTER } from '../lib/exposeDaten'
import { pdfAlsBase64 } from '../lib/exposePdf'
import { fmtDate, today, uid } from '../lib/dates'
import type { GesuchTreffer } from '../lib/gesuche'
import type { ActivityEntry, Kunde, KundeBereich, Objekt } from '../types'

/** Höchstens so viele Empfänger je Durchgang. */
export const MAX_EMPFAENGER = 20

type Empfaenger = {
  schluessel: string
  kunde: Kunde
  bereich: KundeBereich
  email: string
  emailGueltig: boolean
  /** Titel der passenden Gesuche dieses Kontakts. */
  gesuche: string[]
  /** Mindestens ein Gesuch passt ohne offene Punkte. */
  voll: boolean
  offen: string[]
  /** Datum der letzten Weitergabe dieses Objekts an diesen Kontakt. */
  schonAm?: string
}

type Ergebnis = { ok: boolean; fehler?: string }

function istMailAdresse(text: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(text.trim())
}

function htmlSicher(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function alsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((absatz) => `<p>${htmlSicher(absatz).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function signaturAlsText(signaturHtml: string): string {
  return signaturHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Passende Gesuche je Kontakt zusammenfassen: Wer mehrere passende Gesuche hat, bekommt trotzdem nur eine Mail. */
export function empfaengerAusTreffern(treffer: GesuchTreffer[], weitergaben: { objektIds: string[]; kontaktId?: string; an: string; datum: string }[], objektId: string): Empfaenger[] {
  const nachKontakt = new Map<string, Empfaenger>()
  for (const t of treffer) {
    const schluessel = `${t.bereich}:${t.kunde.id}`
    const email = (t.kunde.email ?? '').trim()
    const e =
      nachKontakt.get(schluessel) ??
      ({ schluessel, kunde: t.kunde, bereich: t.bereich, email, emailGueltig: istMailAdresse(email), gesuche: [], voll: false, offen: [] } as Empfaenger)
    e.gesuche.push(t.gesuch.titel)
    if (t.offen.length === 0) e.voll = true
    for (const o of t.offen) if (!e.offen.includes(o)) e.offen.push(o)
    nachKontakt.set(schluessel, e)
  }
  const firma = (s: string) => s.trim().toLowerCase()
  for (const e of nachKontakt.values()) {
    const frueher = weitergaben.filter(
      (w) => w.objektIds.includes(objektId) && (w.kontaktId === e.kunde.id || (!w.kontaktId && firma(w.an) !== '' && firma(w.an) === firma(e.kunde.firma))),
    )
    if (frueher.length > 0) e.schonAm = frueher.map((w) => w.datum).sort().pop()
  }
  // Volle Treffer zuerst, dann „zu prüfen“, Kontakte ohne gültige Adresse zuletzt; innerhalb alphabetisch.
  const rang = (e: Empfaenger) => (!e.emailGueltig ? 2 : e.voll ? 0 : 1)
  return [...nachKontakt.values()].sort((a, b) => rang(a) - rang(b) || a.kunde.firma.localeCompare(b.kunde.firma, 'de'))
}

/** Vorauswahl: nur volle Treffer mit gültiger Adresse, die das Objekt noch nicht bekommen haben — höchstens 20. */
export function vorauswahl(liste: Empfaenger[]): Set<string> {
  return new Set(
    liste
      .filter((e) => e.voll && e.emailGueltig && !e.schonAm)
      .slice(0, MAX_EMPFAENGER)
      .map((e) => e.schluessel),
  )
}

/** „An passende Gesuche schicken“: anonymes Angebot mit dem Exposé als PDF — je Empfänger eine eigene Mail,
 *  niemand sieht die anderen Empfänger. Gesendet wird erst nach einer ausdrücklichen Bestätigung. */
export function ObjektAnGesucheSenden({ objekt, treffer, onClose }: { objekt: Objekt; treffer: GesuchTreffer[]; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const wer = mitarbeiter?.name ?? CURRENT_USER
  const kontext = useExposeKontext()
  const { e: expose, aendere: aendereExpose } = useExposeEinstellungen(objekt)
  const signaturHtml = state.profil.signaturHtml?.trim() ?? ''

  // Nach dem Senden mit dem dann aktuellen Stand des Objekts weiterschreiben.
  const objektAktuell = useRef(objekt)
  useEffect(() => {
    objektAktuell.current = objekt
  }, [objekt])

  const liste = useMemo(() => empfaengerAusTreffern(treffer, state.weitergaben, objekt.id), [treffer, state.weitergaben, objekt.id])
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(() => vorauswahl(liste))
  const [schritt, setSchritt] = useState<'auswahl' | 'bestaetigen' | 'senden' | 'fertig'>('auswahl')
  const [exposeOffen, setExposeOffen] = useState(false)
  const [eigenerBetreff, setEigenerBetreff] = useState<string | null>(null)
  const [eigenerText, setEigenerText] = useState<string | null>(null)
  const [vereinbarung, setVereinbarung] = useState<Vereinbarung>('keine')
  const [pdf, setPdf] = useState<ExposeErgebnis | null>(null)
  const [erstellt, setErstellt] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fortschritt, setFortschritt] = useState(0)
  const [ergebnisse, setErgebnisse] = useState<Record<string, Ergebnis>>({})
  const sperre = useRef(false)

  // Absender wie in den anderen Mailfenstern.
  const { postfaecher } = usePostfaecher()
  const absenderListe = postfaecher.filter((p) => p.bereit && p.kannSenden !== false)
  const [vonId, setVonId] = useState('')
  useEffect(() => {
    const erlaubt = (id?: string | null) => (id && absenderListe.some((p) => p.id === id) ? id : undefined)
    setVonId((bisher) => erlaubt(bisher) ?? erlaubt(gemerkterAbsender()) ?? absenderListe.find((p) => p.gemeinsam)?.id ?? absenderListe[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absenderListe.length])
  const absender = absenderListe.find((p) => p.id === vonId)

  const titel = expose.titel.trim() || objekt.typ
  const betreff = eigenerBetreff ?? mailBetreffVorschlag(titel)
  const text =
    eigenerText ??
    mailTextVorschlag({
      titel,
      fakten: exposeFakten(objekt),
      vertraulich: !!objekt.offMarket,
      wer,
      mitSignatur: !!signaturHtml,
    })
  const warnungen = interneAngabenIn(objekt, `${betreff}\n${text}`, expose.adresseZeigen)
  const ausgewaehlt = liste.filter((e) => gewaehlt.has(e.schluessel))
  const voll = ausgewaehlt.length >= MAX_EMPFAENGER
  const kannWeiter = isEmailGatewayConfigured && ausgewaehlt.length > 0 && !!betreff.trim() && !!text.trim() && !erstellt

  function schalte(e: Empfaenger) {
    if (!e.emailGueltig) return
    setGewaehlt((alt) => {
      const neu = new Set(alt)
      if (neu.has(e.schluessel)) neu.delete(e.schluessel)
      else if (neu.size < MAX_EMPFAENGER) neu.add(e.schluessel)
      return neu
    })
  }

  async function weiter() {
    if (!kannWeiter) return
    setErstellt(true)
    setFehler('')
    try {
      // Das Exposé einmal erzeugen — jeder Empfänger bekommt dieselbe Datei.
      setPdf(await erstelleExpose(objekt, expose, kontext))
      setSchritt('bestaetigen')
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das Exposé konnte nicht erstellt werden.')
    } finally {
      setErstellt(false)
    }
  }

  async function senden() {
    if (!pdf || sperre.current || schritt !== 'bestaetigen') return
    sperre.current = true
    setSchritt('senden')
    setFortschritt(0)
    const anhang = [{ filename: pdf.anzeigeName, contentBase64: pdfAlsBase64(pdf.doc), contentType: 'application/pdf' }]
    const signaturText = signaturHtml ? signaturAlsText(signaturHtml) : ''
    const neu: Record<string, Ergebnis> = {}
    const empfaenger = ausgewaehlt.slice(0, MAX_EMPFAENGER)
    for (const [i, e] of empfaenger.entries()) {
      const mailText = mitName(text, e.kunde.ansprechpartner || '').trim()
      try {
        await sendEmail(
          e.email,
          betreff.trim(),
          signaturText ? `${mailText}\n\n--\n${signaturText}` : mailText,
          `<div>${alsHtml(mailText)}</div>${signaturHtml ? `<div>${signaturHtml}</div>` : ''}`,
          // Ohne Rechnungserkennung: sonst prüfte die KI jede einzelne Angebotsmail darauf, ob sie eine Rechnung ist.
          { toName: e.kunde.ansprechpartner || e.kunde.firma, kundeBereich: e.bereich, kundeId: e.kunde.id, kundeName: e.kunde.firma, ohneRechnungsErkennung: true } as SendEmailKundeKontext,
          anhang,
          { postfachId: vonId || undefined },
        )
        neu[e.schluessel] = { ok: true }
        dispatch({
          type: 'SPEICHERE_WEITERGABE',
          weitergabe: {
            id: uid('wg'),
            datum: today(),
            an: e.kunde.firma,
            kontaktId: e.kunde.id,
            objektIds: [objekt.id],
            bezeichnungen: { [objekt.id]: titel },
            angaben: ['Exposé (PDF)', expose.adresseZeigen ? 'Adresse' : 'Ort', 'Objektart', 'Eckdaten', 'Kaufpreis'],
            weg: 'E-Mail mit Exposé',
            vereinbarung,
            notiz: `An ${e.email} · passend zu: ${e.gesuche.join(', ')}`,
            von: wer,
          },
        })
      } catch (err) {
        neu[e.schluessel] = { ok: false, fehler: err instanceof Error && err.message ? err.message : 'Unbekannter Fehler' }
      }
      setFortschritt(i + 1)
      setErgebnisse({ ...neu })
    }
    if (vonId) merkeAbsender(vonId)

    const gesendet = empfaenger.filter((e) => neu[e.schluessel]?.ok).map((e) => e.kunde.firma)
    const nicht = empfaenger.filter((e) => !neu[e.schluessel]?.ok).map((e) => e.kunde.firma)
    if (gesendet.length > 0 || nicht.length > 0) {
      const o = objektAktuell.current
      const eintrag: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text:
          (gesendet.length > 0 ? `Exposé per E-Mail an ${gesendet.length} passende ${gesendet.length === 1 ? 'Gesuch' : 'Gesuche'} geschickt: ${gesendet.join(', ')}` : 'Exposé an passende Gesuche: nichts gesendet') +
          (nicht.length > 0 ? ` · nicht gesendet: ${nicht.join(', ')}` : ''),
        user: wer,
      }
      dispatch({ type: 'UPDATE_OBJEKT', id: o.id, patch: { activities: [eintrag, ...o.activities] } })
    }
    setSchritt('fertig')
    sperre.current = false
  }

  function fehlgeschlageneNochmal() {
    const nochmal = liste.filter((e) => ergebnisse[e.schluessel] && !ergebnisse[e.schluessel].ok).map((e) => e.schluessel)
    setGewaehlt(new Set(nochmal))
    setErgebnisse({})
    setSchritt('auswahl')
  }

  const offMarketWarnung = objekt.offMarket && (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
      <span className="min-w-0">
        <strong>Nicht öffentlich – bitte nur an ausgewählte Empfänger.</strong> Dieses Objekt wird nicht öffentlich angeboten. Schick es nur an Kontakte, bei denen das abgesprochen ist.
      </span>
    </div>
  )

  const haken = 'mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-accent-600 focus:ring-accent-200'
  const titelFenster = schritt === 'fertig' ? 'Angebot verschickt' : schritt === 'auswahl' ? 'An passende Gesuche schicken' : 'Senden bestätigen'

  return (
    <Modal open onClose={() => schritt !== 'senden' && onClose()} title={titelFenster} width="max-w-2xl">
      {schritt === 'auswahl' && (
        <div>
          {offMarketWarnung}
          {!isEmailGatewayConfigured && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              Das Postfach ist noch nicht verbunden – von hier aus kann gerade nicht gesendet werden.
            </div>
          )}

          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Empfänger</h3>
            <span className="text-xs text-slate-400">
              {ausgewaehlt.length} gewählt · höchstens {MAX_EMPFAENGER} je Durchgang
            </span>
          </div>
          <p className="mb-2 text-xs text-slate-500">Vorgewählt sind nur Gesuche, die ganz passen. „Zu prüfen“ und Kontakte, die das Objekt schon bekommen haben, sind nicht angehakt.</p>
          <ul className="mb-4 space-y-1.5 sm:max-h-80 sm:overflow-y-auto">
            {liste.map((e) => {
              const an = gewaehlt.has(e.schluessel)
              const gesperrt = !e.emailGueltig || (!an && voll)
              return (
                <li key={e.schluessel}>
                  <label className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-sm ${!e.emailGueltig ? 'border-slate-100 bg-slate-50 text-slate-400' : an ? 'cursor-pointer border-accent-200 bg-accent-50/40' : 'cursor-pointer border-slate-100 hover:bg-slate-50'}`}>
                    <input type="checkbox" className={haken} checked={an} disabled={gesperrt} onChange={() => schalte(e)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={`font-medium ${e.emailGueltig ? 'text-slate-800' : 'text-slate-400'}`}>{e.kunde.firma}</span>
                        {e.kunde.ansprechpartner && e.kunde.ansprechpartner !== e.kunde.firma && <span className="text-xs text-slate-500">{e.kunde.ansprechpartner}</span>}
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${e.voll ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{e.voll ? 'passt' : 'zu prüfen'}</span>
                        {e.schonAm && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">schon erhalten am {fmtDate(e.schonAm)}</span>}
                      </span>
                      <span className="block break-all text-xs">{e.emailGueltig ? e.email : e.email ? `${e.email} – keine gültige E-Mail-Adresse` : 'keine E-Mail-Adresse hinterlegt'}</span>
                      <span className="block break-words text-xs text-slate-400">
                        {kundeBereichLabel(e.bereich)} · sucht: {e.gesuche.join(', ')}
                        {!e.voll && e.offen.length > 0 && <span className="text-amber-600"> · {e.offen.join(', ')}</span>}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="mb-4 rounded-lg border border-slate-200">
            <button type="button" onClick={() => setExposeOffen((v) => !v)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm" aria-expanded={exposeOffen}>
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-700">
                <Paperclip size={14} className="flex-shrink-0" /> <span className="truncate">Anhang: Exposé „{titel}“</span>
              </span>
              <span className="flex flex-shrink-0 items-center gap-1 text-xs text-accent-600">
                {exposeOffen ? 'Zuklappen' : 'Anpassen'} {exposeOffen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            </button>
            {!exposeOffen && (
              <p className="px-3 pb-2.5 text-xs text-slate-500">
                {expose.bilder.length === 0 ? 'ohne Bilder' : `${expose.bilder.length} ${expose.bilder.length === 1 ? 'Bild' : 'Bilder'}`} · {expose.adresseZeigen ? 'mit Adresse' : `nur Ort: ${expose.ort || '–'}`}
              </p>
            )}
            {exposeOffen && (
              <div className="border-t border-slate-100 px-3 pt-3">
                <ExposeEinstellungenFelder objekt={objekt} e={expose} aendere={aendereExpose} />
              </div>
            )}
          </div>

          {absenderListe.length > 1 ? (
            <Field label="Von">
              <select className={inputClass} value={vonId} onChange={(ev) => setVonId(ev.target.value)}>
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
            <input className={inputClass} value={betreff} onChange={(ev) => setEigenerBetreff(ev.target.value)} />
          </Field>
          <Field label={`Nachricht (${NAME_PLATZHALTER} wird je Empfänger durch den Namen ersetzt)`}>
            <textarea className={inputClass} rows={12} value={text} onChange={(ev) => setEigenerText(ev.target.value)} />
          </Field>
          {(eigenerText !== null || eigenerBetreff !== null) && (
            <p className="-mt-1 mb-3 text-xs text-slate-500">
              Von Hand geändert – Titel und Eckdaten werden nicht mehr von selbst übernommen.{' '}
              <button
                type="button"
                onClick={() => {
                  setEigenerText(null)
                  setEigenerBetreff(null)
                }}
                className="font-medium text-accent-600 hover:underline"
              >
                Neu schreiben lassen
              </button>
            </p>
          )}
          {signaturHtml && <p className="-mt-1 mb-3 text-xs text-slate-400">Deine Signatur aus „Mein Profil“ wird beim Senden angehängt.</p>}
          {warnungen.length > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0 break-words">In Betreff oder Nachricht steht noch: {warnungen.join(', ')}. Das Angebot soll anonym sein – bitte entfernen.</span>
            </div>
          )}
          <div className="mb-3 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <VereinbarungWahl wert={vereinbarung} onChange={setVereinbarung} />
          </div>

          {fehler && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span className="min-w-0 break-words">{fehler}</span>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={weiter} disabled={!kannWeiter}>
              <Mail size={14} /> {erstellt ? 'Exposé wird erstellt …' : 'Weiter zur Bestätigung'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {(schritt === 'bestaetigen' || schritt === 'senden') && pdf && (
        <div>
          {offMarketWarnung}
          <p className="mb-2 text-base font-semibold text-slate-800">
            An {ausgewaehlt.length} Empfänger senden?
          </p>
          <p className="mb-3 text-xs text-slate-500">Jeder bekommt eine eigene E-Mail – die anderen Empfänger sieht niemand.</p>
          <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-2 text-sm">
            {ausgewaehlt.map((e, i) => {
              const r = ergebnisse[e.schluessel]
              return (
                <li key={e.schluessel} className="flex items-start gap-2">
                  <span className="w-5 flex-shrink-0 text-right text-xs text-slate-400">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-medium text-slate-800">{e.kunde.firma}</span> <span className="break-all text-xs text-slate-500">{e.email}</span>
                  </span>
                  {r?.ok && <CheckCircle2 size={15} className="flex-shrink-0 text-emerald-500" />}
                  {r && !r.ok && <XCircle size={15} className="flex-shrink-0 text-rose-500" />}
                </li>
              )
            })}
          </ul>
          <dl className="mb-4 space-y-1 text-xs text-slate-600">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Betreff:</dt>
              <dd className="min-w-0 break-words">{betreff}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-slate-400">Anhang:</dt>
              <dd className="min-w-0 break-words">
                {pdf.anzeigeName} ({pdf.doc.getNumberOfPages()} Seiten, {groesseText(pdf.groesse)})
              </dd>
            </div>
            {absender && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-400">Von:</dt>
                <dd className="min-w-0 break-words">{postfachBezeichnung(absender)}</dd>
              </div>
            )}
          </dl>
          {pdf.ohneBilder.length > 0 && <p className="mb-3 text-xs text-amber-700">Diese Bilder ließen sich nicht laden und fehlen im Exposé: {pdf.ohneBilder.join(', ')}.</p>}
          {pdf.groesse > 5 * 1024 * 1024 && <p className="mb-3 text-xs font-medium text-amber-700">Das Exposé ist recht groß – manche Postfächer nehmen so große Anhänge nicht an. Weniger Bilder wählen hilft.</p>}
          {warnungen.length > 0 && <p className="mb-3 text-xs font-medium text-amber-700">Achtung: In Betreff oder Nachricht steht noch {warnungen.join(', ')}.</p>}
          {schritt === 'senden' && (
            <p className="mb-3 text-sm text-slate-600" role="status">
              Wird gesendet … {fortschritt} von {ausgewaehlt.length}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <SecondaryButton onClick={() => setSchritt('auswahl')} disabled={schritt === 'senden'}>
              <ArrowLeft size={14} /> Zurück
            </SecondaryButton>
            <PrimaryButton onClick={senden} disabled={schritt === 'senden'}>
              <Send size={14} /> {schritt === 'senden' ? 'Wird gesendet …' : `Ja, an ${ausgewaehlt.length} Empfänger senden`}
            </PrimaryButton>
          </div>
        </div>
      )}

      {schritt === 'fertig' && (
        <div>
          {(() => {
            const gut = ausgewaehlt.filter((e) => ergebnisse[e.schluessel]?.ok).length
            const schlecht = ausgewaehlt.length - gut
            return (
              <p className="mb-3 text-sm font-medium text-slate-800">
                {gut} gesendet{schlecht > 0 ? `, ${schlecht} nicht gesendet` : ''}. Die Weitergaben sind am Objekt festgehalten.
              </p>
            )
          })()}
          <ul className="mb-4 space-y-1.5 text-sm">
            {ausgewaehlt.map((e) => {
              const r = ergebnisse[e.schluessel]
              return (
                <li key={e.schluessel} className={`flex items-start gap-2 rounded-lg px-2.5 py-2 ${r?.ok ? 'bg-emerald-50/60' : 'bg-rose-50'}`}>
                  {r?.ok ? <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-emerald-600" /> : <XCircle size={15} className="mt-0.5 flex-shrink-0 text-rose-600" />}
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-medium text-slate-800">{e.kunde.firma}</span> <span className="break-all text-xs text-slate-500">{e.email}</span>
                    <span className={`block text-xs ${r?.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{r?.ok ? 'gesendet' : `nicht gesendet: ${r?.fehler ?? 'unbekannt'}`}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            {ausgewaehlt.some((e) => ergebnisse[e.schluessel] && !ergebnisse[e.schluessel].ok) && (
              <SecondaryButton onClick={fehlgeschlageneNochmal}>Nicht gesendete erneut versuchen</SecondaryButton>
            )}
            <PrimaryButton onClick={onClose}>Fertig</PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}
