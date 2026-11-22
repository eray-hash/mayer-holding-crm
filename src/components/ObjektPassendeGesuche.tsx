// „Welche Käufer passen zu diesem Objekt?“ (22.11.2026): die passenden Gesuche in der Objektakte, beste
// zuerst, je mit Grund (was passt, was beim Objekt noch fehlt), dem Stand im Interessenten-Portal und dem
// Knopf „Portal-Link schicken“. Der Knopf legt — falls der Kontakt noch keinen offenen Zugang hat — einen
// Zugang an wie „Interessent freischalten“ (legeFreigabeAn, gleiche Provision als Vorschlag) und öffnet die
// Mail mit dem Link: gleicher Text und gleicher Versandweg wie „Per E-Mail“ in ObjektFreigaben.tsx.
// Verschickt wird erst mit dem Knopf „Senden“. Im privaten Bereich gibt es kein Interessenten-Portal.
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Link2, Send } from 'lucide-react'
import { Card, Modal, PrimaryButton, SecondaryButton, inputClass } from './ui'
import { useKvNutzer } from './KostenvoranschlaegeSection'
import { budgetText, eckdatenTexte, type GesuchTreffer } from '../lib/gesuche'
import { sendEmail } from '../lib/emailGateway'
import { ladeFreigaben, legeFreigabeAn, portalLink, type ObjektFreigabe } from '../lib/objektPortal'
import type { KundeBereich, Objekt } from '../types'

// Gleich wie PROVISION_VORSCHLAG in ObjektFreigaben.tsx, email-gateway/anfragenManager.ts und
// telegram-gateway/gesucheWerkzeuge.ts — bei Änderung alle anpassen.
const PROVISION_VORSCHLAG = '3 % des beurkundeten Kaufpreises zzgl. gesetzlicher Umsatzsteuer'

const STAND: Record<ObjektFreigabe['status'], { label: string; farbe: string }> = {
  eingeladen: { label: 'Portal: noch nicht zugestimmt', farbe: 'bg-amber-50 text-amber-700' },
  zugestimmt: { label: 'Portal: zugestimmt', farbe: 'bg-emerald-50 text-emerald-700' },
  widerrufen: { label: 'Portal: Zugang beendet', farbe: 'bg-slate-100 text-slate-500' },
}

const offenerZugang = (f: ObjektFreigabe) => f.status !== 'widerrufen' && (!f.gueltigBis || Date.parse(f.gueltigBis) > Date.now())

/** Betreff und Text — wortgleich zu LinkMail in ObjektFreigaben.tsx (und portalEinladung in telegram-gateway/gesucheWerkzeuge.ts). */
function einladung(objekt: Objekt, f: ObjektFreigabe, absender: string) {
  return {
    betreff: `Ihre Unterlagen zu ${objekt.bezeichnung}`,
    text: `Guten Tag ${f.name},\n\nvielen Dank für Ihr Interesse an ${objekt.bezeichnung}. Über diesen Link sehen Sie das Exposé und die Unterlagen, sobald Sie unseren Bedingungen und der Provisionsvereinbarung zugestimmt haben:\n${portalLink(f.token)}\n\nFür Fragen oder einen Besichtigungstermin antworten Sie einfach auf diese E-Mail.\n\nMit freundlichen Grüßen\n${absender}\nAndreas Mayer Holding`,
  }
}

export function ObjektPassendeGesuche({
  objekt,
  treffer,
  privat,
  kontaktPfad,
  onAnGesucheSchicken,
}: {
  objekt: Objekt
  treffer: GesuchTreffer[]
  /** Privater Bereich: ohne Interessenten-Portal und ohne Sammelversand. */
  privat?: boolean
  kontaktPfad: (bereich: KundeBereich, id: string) => string
  /** Der vorhandene Sammelversand „An passende Gesuche schicken“ (ObjektAnGesucheSenden). */
  onAnGesucheSchicken?: () => void
}) {
  const nutzer = useKvNutzer()
  const [freigaben, setFreigaben] = useState<ObjektFreigabe[]>([])
  const [fuer, setFuer] = useState<GesuchTreffer | null>(null)

  const laden = () => {
    if (privat) return
    // Ohne Rechte oder vor dem Einspielen der Tabelle: Liste trotzdem zeigen, nur ohne Stand im Portal.
    ladeFreigaben(objekt.id).then(setFreigaben).catch(() => setFreigaben([]))
  }
  useEffect(laden, [objekt.id, privat])

  // Beste zuerst: wenig Offenes, dann viel Passendes (wie passendeObjekte in lib/gesuche.ts).
  const sortiert = useMemo(
    () => [...treffer].sort((a, b) => a.offen.length - b.offen.length || b.passt.length - a.passt.length || a.kunde.firma.localeCompare(b.kunde.firma, 'de')),
    [treffer],
  )

  /** Zugang eines Kontakts: zugestimmt vor offen vor beendet. */
  function zugangVon(t: GesuchTreffer): ObjektFreigabe | undefined {
    const mail = (t.kunde.email ?? '').trim().toLowerCase()
    const eigene = freigaben.filter((f) => f.kundeId === t.kunde.id || (!!mail && (f.email ?? '').toLowerCase() === mail))
    const rang = (f: ObjektFreigabe) => (f.status === 'zugestimmt' ? 0 : offenerZugang(f) ? 1 : 2)
    return [...eigene].sort((a, b) => rang(a) - rang(b))[0]
  }

  const vollstaendig = sortiert.filter((t) => t.offen.length === 0).length

  return (
    <Card className="mb-4 p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Passende Gesuche{sortiert.length > 0 ? ` (${sortiert.length}, davon ${vollstaendig} ohne offene Punkte)` : ''}
        </h3>
        {/* Privat kein Versand: er hält eine Weitergabe im gemeinsamen Verzeichnis fest. */}
        {sortiert.length > 0 && !privat && onAnGesucheSchicken && (
          <SecondaryButton onClick={onAnGesucheSchicken}><Send size={13} /> An passende Gesuche schicken</SecondaryButton>
        )}
      </div>
      {sortiert.length === 0 ? (
        <p className="text-sm text-slate-500">Zurzeit sucht niemand ein solches Objekt. Gesuche erfasst du unter „Gesuche“ in der Seitenleiste.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {sortiert.map((t) => {
            const zugang = privat ? undefined : zugangVon(t)
            return (
              <li key={`${t.kunde.id}:${t.gesuch.id}`} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <a href={`#${kontaktPfad(t.bereich, t.kunde.id)}`} className="font-medium text-accent-600 hover:underline">
                    {t.kunde.firma || t.kunde.ansprechpartner}
                  </a>
                  {t.kunde.ansprechpartner && t.kunde.ansprechpartner !== t.kunde.firma && <span className="text-slate-500"> ({t.kunde.ansprechpartner})</span>}
                  <span className="text-slate-600"> sucht: {t.gesuch.titel}</span>
                  <div className="text-xs text-slate-500">
                    {[t.gesuch.objekttypen.join(', '), t.gesuch.lage, budgetText(t.gesuch), ...eckdatenTexte(t.gesuch)].filter((x) => x && x !== '–').join(' · ')}
                  </div>
                  <div className="text-xs text-slate-600">
                    Passt: {t.passt.join(', ')}
                    {t.offen.length > 0 && <span className="text-amber-600"> · Noch offen: {t.offen.join(', ')}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${t.offen.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {t.offen.length === 0 ? 'Passt vollständig' : 'Zu prüfen'}
                  </span>
                  {zugang && <span className={`rounded px-2 py-0.5 text-xs font-medium ${STAND[zugang.status].farbe}`}>{STAND[zugang.status].label}</span>}
                  {!privat && !nutzer.nurLesen && (
                    <button onClick={() => setFuer(t)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:underline">
                      <Link2 size={13} /> Portal-Link schicken
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {fuer && (
        <PortalLinkSchicken
          objekt={objekt}
          treffer={fuer}
          vorhanden={(() => {
            const z = zugangVon(fuer)
            return z && offenerZugang(z) ? z : undefined
          })()}
          absender={nutzer.name}
          onAngelegt={laden}
          onClose={() => setFuer(null)}
        />
      )}
    </Card>
  )
}

/** Zwei Schritte in einem Fenster: Zugang anlegen (falls keiner offen ist), dann die Mail mit dem Link. */
function PortalLinkSchicken({ objekt, treffer, vorhanden, absender, onAngelegt, onClose }: {
  objekt: Objekt
  treffer: GesuchTreffer
  vorhanden?: ObjektFreigabe
  absender: string
  onAngelegt: () => void
  onClose: () => void
}) {
  const k = treffer.kunde
  const [freigabe, setFreigabe] = useState<ObjektFreigabe | undefined>(vorhanden)
  const [email, setEmail] = useState((k.email ?? '').trim())
  const [provision, setProvision] = useState(PROVISION_VORSCHLAG)
  const [betreff, setBetreff] = useState(vorhanden ? einladung(objekt, vorhanden, absender).betreff : '')
  const [text, setText] = useState(vorhanden ? einladung(objekt, vorhanden, absender).text : '')
  const [stand, setStand] = useState<'' | 'arbeitet' | 'gesendet'>('')
  const [fehler, setFehler] = useState('')
  const [kopiert, setKopiert] = useState(false)
  const name = (k.ansprechpartner || k.firma).trim()

  async function anlegen() {
    if (!provision.trim()) {
      setFehler('Die Provision ist nötig.')
      return
    }
    setStand('arbeitet')
    setFehler('')
    try {
      const f = await legeFreigabeAn({ objektId: objekt.id, name, email, telefon: k.telefon, provision, kundeId: k.id, kundeBereich: treffer.bereich, von: absender })
      const mail = einladung(objekt, f, absender)
      setFreigabe(f)
      setBetreff(mail.betreff)
      setText(mail.text)
      onAngelegt()
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
    setStand('')
  }

  async function senden() {
    if (!freigabe) return
    const an = (freigabe.email ?? email).trim()
    setStand('arbeitet')
    setFehler('')
    try {
      await sendEmail(an, betreff, text, undefined, { toName: freigabe.name, kundeBereich: treffer.bereich, kundeId: k.id, kundeName: freigabe.name })
      setStand('gesendet')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
      setStand('')
    }
  }

  async function kopiere() {
    if (!freigabe) return
    try {
      await navigator.clipboard.writeText(portalLink(freigabe.token))
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2000)
    } catch {
      window.prompt('Link kopieren:', portalLink(freigabe.token))
    }
  }

  const empfaenger = (freigabe?.email ?? email).trim()
  const aktionen = !freigabe ? (
    <PrimaryButton onClick={anlegen} disabled={stand === 'arbeitet'}>{stand === 'arbeitet' ? 'Legt an …' : 'Link erstellen'}</PrimaryButton>
  ) : stand === 'gesendet' || !empfaenger ? (
    <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>
  ) : (
    <PrimaryButton onClick={senden} disabled={stand === 'arbeitet'}>{stand === 'arbeitet' ? 'Sendet …' : 'Senden'}</PrimaryButton>
  )
  const feld = 'mb-1 block text-xs font-medium text-slate-500'

  return (
    <Modal open onClose={onClose} title={`Portal-Link für ${name}`} width="max-w-xl" aktionen={aktionen}>
      <div className="space-y-3">
        {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}
        {stand === 'gesendet' && <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-700">Gesendet an {empfaenger}.</p>}
        {!freigabe ? (
          <>
            <p className="text-sm text-slate-600">
              {name} bekommt einen eigenen Link zum Interessenten-Portal von „{objekt.bezeichnung}“. Dort sieht er zuerst nur Ort, Art und Kaufpreis, nach seiner Zustimmung zu AGB und Provisionsvereinbarung das Exposé und die freigegebenen Unterlagen.
            </p>
            <label className="block"><span className={feld}>E-Mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} /></label>
            <label className="block">
              <span className={feld}>Provision (steht so in der Provisionsvereinbarung)</span>
              <input value={provision} onChange={(e) => setProvision(e.target.value)} className={inputClass} />
            </label>
            <p className="text-xs text-slate-400">Der Link ist 90 Tage gültig und lässt sich im Reiter „Interessenten-Portal“ jederzeit beenden. Verschickt wird erst im nächsten Schritt mit „Senden“.</p>
          </>
        ) : (
          <>
            {vorhanden && <p className="rounded-lg bg-sky-50 p-2 text-xs text-sky-700">{name} hat schon einen offenen Zugang — es wird derselbe Link geschickt.</p>}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="min-w-0 flex-1 truncate">{portalLink(freigabe.token)}</span>
              <button onClick={kopiere} className="inline-flex items-center gap-1 text-slate-600 hover:underline">{kopiert ? <Check size={13} /> : <Copy size={13} />} Link kopieren</button>
            </div>
            {!empfaenger ? (
              <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-700">Für {name} ist keine E-Mail-Adresse hinterlegt. Den Link bitte kopieren und selbst weitergeben.</p>
            ) : (
              stand !== 'gesendet' && (
                <>
                  <p className="text-xs text-slate-500">An: {empfaenger}</p>
                  <input value={betreff} onChange={(e) => setBetreff(e.target.value)} className={inputClass} aria-label="Betreff" />
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={11} className={inputClass} aria-label="Text" />
                </>
              )
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
