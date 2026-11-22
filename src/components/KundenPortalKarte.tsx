// „Kundenbereich“ in der Akte (22.11.2026): persönlichen Link für den Kunden erstellen, kopieren, per E-Mail
// schicken (nur auf Knopfdruck, Text vorher bearbeitbar), verlängern und beenden. Dazu die eigene Einstellung
// „Nachrichten aus dem Kundenbereich per Telegram“ und der Schalter je Dokument (DokumentFreigabeKnopf), mit dem
// ein Dokument der Akte im Kundenbereich erscheint. Was der Kunde sieht, regelt email-gateway/kundenPortal.ts.
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Globe, Mail, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Field, inputClass, Modal, PrimaryButton, SecondaryButton } from './ui'
import { isEmailGatewayConfigured, sendEmail, type SendEmailKundeKontext } from '../lib/emailGateway'
import { gemerkterAbsender, merkeAbsender, postfachBezeichnung, usePostfaecher } from '../lib/postfaecher'
import {
  beendeKundenPortalZugang,
  erstelleKundenPortalZugang,
  kundenPortalLink,
  kundenPortalMailText,
  ladeKundenPortalZugang,
  ladeNachrichtTelegram,
  merkeKundenPortalVersand,
  setzeNachrichtTelegram,
  verlaengereKundenPortalZugang,
  type KundenPortalZugang,
} from '../lib/kundenPortal'
import { today, uid } from '../lib/dates'
import type { ActivityEntry, Dokument, Kunde, KundeBereich } from '../types'

/** Dokument der Akte mit der Freigabe für den Kundenbereich (kunden.dokumente[].fuerKunde). */
export type FreigabeDokument = Dokument & { fuerKunde?: boolean }

const datum = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–')
const zeitpunkt = (iso?: string) => (iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')

function istMailAdresse(text: string): boolean {
  return /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]{2,}$/.test(text.trim())
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
  return signaturHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

// `bereich` wie bei KundenberichtModal / UnterschriftAnfragen (einheitlicher Aufruf auf allen Aktenseiten).
export function KundenPortalKarte({ bereich, kunde, nutzerName, nurLesen = false }: { bereich: KundeBereich; kunde: Kunde; nutzerName: string; nurLesen?: boolean }) {
  const { dispatch } = useApp()
  const { session, ansichtAls } = useAuth()
  const meineEmail = (session?.user?.email ?? '').toLowerCase()
  const [zugang, setZugang] = useState<KundenPortalZugang | null | undefined>(undefined)
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const [mailOffen, setMailOffen] = useState(false)
  const [telegram, setTelegram] = useState<boolean | null>(null)

  const laden = useCallback(() => {
    setFehler('')
    ladeKundenPortalZugang(kunde.id)
      .then(setZugang)
      .catch((e) => {
        setFehler(e instanceof Error ? e.message : String(e))
        setZugang(null)
      })
  }, [kunde.id])

  useEffect(() => {
    laden()
  }, [laden])

  useEffect(() => {
    if (!meineEmail || ansichtAls) return
    ladeNachrichtTelegram(meineEmail).then(setTelegram).catch(() => setTelegram(null))
  }, [meineEmail, ansichtAls])

  if (bereich === 'privat') return null

  const aktiv = zugang?.status === 'aktiv' && new Date(zugang.gueltigBis).getTime() > Date.now() ? zugang : null
  const freigegeben = ((kunde.dokumente ?? []) as FreigabeDokument[]).filter((d) => d.fuerKunde === true).length

  function verlauf(text: string) {
    const eintrag: ActivityEntry = { id: uid('act'), date: today(), text, user: nutzerName }
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { activities: [eintrag, ...(kunde.activities ?? [])], letzteAktivitaet: today() } })
  }

  async function mache(arbeit: () => Promise<void>) {
    if (laeuft) return
    setLaeuft(true)
    setFehler('')
    try {
      await arbeit()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    } finally {
      setLaeuft(false)
      laden()
    }
  }

  const erstellen = (neu: boolean) =>
    mache(async () => {
      if (neu && !window.confirm('Neuen Link erstellen? Der bisherige Link funktioniert danach nicht mehr.')) return
      const z = await erstelleKundenPortalZugang(kunde.id, nutzerName)
      setZugang(z)
      verlauf(neu ? 'Kundenbereich: neuer Link erstellt (der bisherige ist beendet).' : 'Kundenbereich: persönlichen Link für den Kunden erstellt.')
    })

  const beenden = () =>
    mache(async () => {
      if (!aktiv || !window.confirm('Kundenbereich beenden? Der Kunde kann den Link danach nicht mehr öffnen.')) return
      await beendeKundenPortalZugang(aktiv.id, nutzerName)
      verlauf('Kundenbereich: Link beendet.')
    })

  const verlaengern = () =>
    mache(async () => {
      if (!aktiv) return
      await verlaengereKundenPortalZugang(aktiv.id)
    })

  async function kopiere() {
    if (!aktiv) return
    const link = kundenPortalLink(aktiv.token)
    try {
      await navigator.clipboard.writeText(link)
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2000)
    } catch {
      window.prompt('Link kopieren:', link)
    }
  }

  async function schalteTelegram(an: boolean) {
    setFehler('')
    try {
      await setzeNachrichtTelegram(meineEmail, an)
      setTelegram(an)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Globe size={14} /> Kundenbereich</h3>
        <button type="button" onClick={laden} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Neu laden" title="Neu laden">
          <RefreshCw size={13} />
        </button>
      </div>
      {fehler && <p className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-600">{fehler}</p>}

      {zugang === undefined ? (
        <p className="text-xs text-slate-400">Lädt …</p>
      ) : aktiv ? (
        <>
          <p className="text-xs text-slate-500">
            Aktiv bis {datum(aktiv.gueltigBis)} · {aktiv.zugriffe ? `${aktiv.zugriffe}× geöffnet, zuletzt ${zeitpunkt(aktiv.letzterZugriff)}` : 'noch nicht geöffnet'}
            {aktiv.versendetAm ? ` · per E-Mail an ${aktiv.versendetAn} am ${datum(aktiv.versendetAm)}` : ''}
            {aktiv.letzteNachrichtAm ? ` · letzte Nachricht vom Kunden ${zeitpunkt(aktiv.letzteNachrichtAm)}` : ''}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
            <button onClick={kopiere} className="inline-flex items-center gap-1 font-medium text-slate-600 hover:underline">
              {kopiert ? <Check size={12} /> : <Copy size={12} />} Link kopieren
            </button>
            {!nurLesen && (
              <>
                <button onClick={() => setMailOffen(true)} disabled={!isEmailGatewayConfigured} className="inline-flex items-center gap-1 font-medium text-accent-600 hover:underline disabled:opacity-50">
                  <Mail size={12} /> Per E-Mail senden
                </button>
                <button onClick={verlaengern} disabled={laeuft} className="text-slate-600 hover:underline">Verlängern</button>
                <button onClick={() => erstellen(true)} disabled={laeuft} className="text-slate-600 hover:underline">Neuer Link</button>
                <button onClick={beenden} disabled={laeuft} className="text-rose-600 hover:underline">Beenden</button>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            {zugang && zugang.status === 'widerrufen'
              ? `Beendet am ${datum(zugang.widerrufenAm)}${zugang.widerrufenVon ? ` von ${zugang.widerrufenVon}` : ''}.`
              : zugang
                ? `Abgelaufen am ${datum(zugang.gueltigBis)}.`
                : 'Ein Link für den Kunden mit Stand, fehlenden Unterlagen, Unterschriften, Terminen, Rechnungen und einer Nachricht an uns.'}
          </p>
          {!nurLesen && (
            <button onClick={() => erstellen(false)} disabled={laeuft} className="mt-1.5 text-xs font-medium text-accent-600 hover:underline">
              {laeuft ? 'Wird erstellt …' : 'Link erstellen'}
            </button>
          )}
        </>
      )}

      <p className="mt-2 text-xs text-slate-400">
        {freigegeben === 0
          ? 'Dokumente sieht der Kunde erst, wenn du sie im Reiter „Dokumente“ mit dem Augen-Knopf freigibst.'
          : `${freigegeben === 1 ? '1 Dokument' : `${freigegeben} Dokumente`} für den Kunden freigegeben.`}
      </p>
      {telegram !== null && (
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <input type="checkbox" checked={telegram} onChange={(e) => schalteTelegram(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
          Nachrichten von Kunden (meine Akten) per Telegram an mich
        </label>
      )}

      {mailOffen && aktiv && (
        <LinkPerMail
          bereich={bereich}
          kunde={kunde}
          zugang={aktiv}
          nutzerName={nutzerName}
          onClose={() => setMailOffen(false)}
          onGesendet={(an) => {
            verlauf(`Kundenbereich: Link per E-Mail an ${an} geschickt.`)
            merkeKundenPortalVersand(aktiv.id, an).catch(() => undefined).finally(laden)
          }}
        />
      )}
    </div>
  )
}

/** Mail mit dem Link — Text vorher bearbeitbar, geht nur auf Knopfdruck raus (bestehender Versandweg sendEmail). */
function LinkPerMail({
  bereich,
  kunde,
  zugang,
  nutzerName,
  onClose,
  onGesendet,
}: {
  bereich: KundeBereich
  kunde: Kunde
  zugang: KundenPortalZugang
  nutzerName: string
  onClose: () => void
  onGesendet: (an: string) => void
}) {
  const { state } = useApp()
  const signaturHtml = state.profil.signaturHtml?.trim() ?? ''
  const vorschlag = kundenPortalMailText({ anName: (kunde.ansprechpartner || kunde.firma || '').trim(), link: kundenPortalLink(zugang.token), gueltigBis: zugang.gueltigBis, wer: nutzerName })
  const [an, setAn] = useState(kunde.email ?? '')
  const [betreff, setBetreff] = useState(vorschlag.betreff)
  const [text, setText] = useState(vorschlag.text)
  const [sendet, setSendet] = useState(false)
  const [fehler, setFehler] = useState('')
  const [fertig, setFertig] = useState(false)

  const { postfaecher } = usePostfaecher()
  const absenderListe = postfaecher.filter((p) => p.bereit && p.kannSenden !== false)
  const [vonId, setVonId] = useState('')
  useEffect(() => {
    const erlaubt = (id?: string | null) => (id && absenderListe.some((p) => p.id === id) ? id : undefined)
    setVonId((bisher) => erlaubt(bisher) ?? erlaubt(gemerkterAbsender()) ?? absenderListe.find((p) => p.gemeinsam)?.id ?? absenderListe[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absenderListe.length])

  const linkFehlt = !text.includes(kundenPortalLink(zugang.token))
  const kannSenden = !sendet && istMailAdresse(an) && !!betreff.trim() && !!text.trim() && !linkFehlt

  async function senden() {
    if (!kannSenden) return
    setSendet(true)
    setFehler('')
    try {
      const empfaenger = an.trim()
      const signaturText = signaturHtml ? signaturAlsText(signaturHtml) : ''
      const kontext: SendEmailKundeKontext & { ohneRechnungsErkennung: boolean } = {
        toName: (kunde.ansprechpartner || empfaenger).trim(),
        kundeBereich: bereich,
        kundeId: kunde.id,
        kundeName: kunde.firma,
        ohneRechnungsErkennung: true,
      }
      await sendEmail(
        empfaenger,
        betreff.trim(),
        signaturText ? `${text.trim()}\n\n--\n${signaturText}` : text.trim(),
        `<div>${alsHtml(text.trim())}</div>${signaturHtml ? `<div>${signaturHtml}</div>` : ''}`,
        kontext,
        undefined,
        { postfachId: vonId || undefined },
      )
      if (vonId) merkeAbsender(vonId)
      onGesendet(empfaenger)
      setFertig(true)
    } catch (e) {
      setFehler(e instanceof Error && e.message ? e.message : 'Die E-Mail konnte nicht gesendet werden.')
    } finally {
      setSendet(false)
    }
  }

  return (
    <Modal open onClose={() => !sendet && onClose()} title="Kundenbereich per E-Mail schicken" width="max-w-2xl">
      {fertig ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium text-emerald-700">E-Mail gesendet an {an.trim()}.</p>
          <PrimaryButton className="mt-4" onClick={onClose}>Schließen</PrimaryButton>
        </div>
      ) : (
        <div>
          <Field label="An">
            <input className={inputClass} value={an} onChange={(e) => setAn(e.target.value)} placeholder="E-Mail-Adresse des Kunden" />
          </Field>
          {!an.trim() && <p className="-mt-1 mb-3 text-xs text-amber-700">In der Akte steht keine E-Mail-Adresse. Bitte hier eintragen — oder den Link kopieren und selbst weitergeben.</p>}
          {an.trim() && !istMailAdresse(an) && <p className="-mt-1 mb-3 text-xs font-medium text-rose-600">Das ist keine vollständige E-Mail-Adresse.</p>}
          {absenderListe.length > 1 ? (
            <Field label="Von">
              <select className={inputClass} value={vonId} onChange={(e) => setVonId(e.target.value)}>
                {absenderListe.map((p) => (
                  <option key={p.id} value={p.id}>{postfachBezeichnung(p)}</option>
                ))}
              </select>
            </Field>
          ) : (
            absenderListe.length === 1 && <p className="mb-3 break-words text-xs text-slate-500">Von: {postfachBezeichnung(absenderListe[0])}</p>
          )}
          <Field label="Betreff">
            <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
          </Field>
          <Field label="Text">
            <textarea className={inputClass} rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {linkFehlt && <p className="-mt-1 mb-3 text-xs font-medium text-rose-600">Der Link fehlt im Text. Bitte wieder einfügen: {kundenPortalLink(zugang.token)}</p>}
          {signaturHtml && <p className="mb-3 text-xs text-slate-400">Deine Signatur aus „Mein Profil“ wird angehängt.</p>}
          {fehler && <p className="mb-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
          <div className="flex justify-end gap-2">
            <SecondaryButton onClick={onClose} disabled={sendet}>Abbrechen</SecondaryButton>
            <PrimaryButton onClick={senden} disabled={!kannSenden}>
              <Mail size={14} /> {sendet ? 'Wird gesendet …' : 'Senden'}
            </PrimaryButton>
          </div>
        </div>
      )}
    </Modal>
  )
}

/**
 * Augen-Knopf je Dokument (für DokumenteSection): gibt ein Dokument der Akte für den Kundenbereich frei oder nimmt
 * die Freigabe zurück. Schreibt über den normalen Speicherweg der Akte (Eintrag für Eintrag zusammengeführt).
 */
export function DokumentFreigabeKnopf({ bereich, kundeId, dokument, nurLesen = false }: { bereich: KundeBereich; kundeId: string; dokument: Dokument; nurLesen?: boolean }) {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  if (bereich === 'privat') return null
  const frei = (dokument as FreigabeDokument).fuerKunde === true
  // Private Mail-Anhänge (privat:…) und fremde Adressen kann der Kundenbereich nicht ausliefern.
  const lieferbar = !!dokument.url && !dokument.url.startsWith('privat:')

  function schalte(e: React.MouseEvent) {
    e.stopPropagation()
    if (nurLesen || !lieferbar) return
    const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)?.get(state).find((k) => k.id === kundeId)
    if (!kunde) return
    const dokumente = ((kunde.dokumente ?? []) as FreigabeDokument[]).map((d) => {
      if (d.id !== dokument.id) return d
      const { fuerKunde: _alt, ...rest } = d
      void _alt
      return frei ? (rest as FreigabeDokument) : ({ ...rest, fuerKunde: true } as FreigabeDokument)
    })
    const eintrag: ActivityEntry = {
      id: uid('act'),
      date: today(),
      text: frei ? `Kundenbereich: Freigabe für „${dokument.name}“ zurückgenommen.` : `Kundenbereich: „${dokument.name}“ für den Kunden freigegeben.`,
      user: mitarbeiter?.name ?? 'CRM',
    }
    dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kundeId, patch: { dokumente: dokumente as Dokument[], activities: [eintrag, ...(kunde.activities ?? [])], letzteAktivitaet: today() } })
  }

  const titel = !lieferbar ? 'Privater Anhang — kann nicht freigegeben werden' : frei ? 'Im Kundenbereich sichtbar — klicken zum Zurücknehmen' : 'Für den Kundenbereich freigeben'
  return (
    <button
      type="button"
      onClick={schalte}
      disabled={nurLesen || !lieferbar}
      title={titel}
      aria-label={titel}
      aria-pressed={frei}
      className={`flex-shrink-0 rounded p-1.5 ${frei ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {frei ? <Eye size={15} /> : <EyeOff size={15} />}
    </button>
  )
}
