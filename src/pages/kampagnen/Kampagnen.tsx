import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Send, Sparkles, XCircle } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../../data/kundenBereiche'
import { PRIORITAETEN, MITARBEITER } from '../../data/constants'
import { isEmailGatewayConfigured, sendEmail, draftCampaign } from '../../lib/emailGateway'
import { applyMailVorlage } from '../../lib/mailVorlagen'
import { Card, Field, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import type { Kunde, KundeBereich, Prioritaet } from '../../types'

type Empfaenger = { bereich: KundeBereich; kunde: Kunde }
type Versandstatus = 'offen' | 'gesendet' | 'fehler'

// Bereichsübergreifende Segment-/Kampagnen-Mail (z.B. zweiwöchentlicher Newsletter) an eine nach
// Bereich/Priorität/Verantwortlichem gefilterte Kontaktliste. Sequenzieller Versand mit kleiner
// Pause zwischen den Aufrufen, damit der IONOS-SMTP-Versand nicht wie ein Spam-Burst aussieht.
export function Kampagnen() {
  const { state } = useApp()
  const [bereiche, setBereiche] = useState<Set<KundeBereich>>(new Set(KUNDEN_BEREICHE.map((b) => b.id)))
  const [prioritaeten, setPrioritaeten] = useState<Set<Prioritaet>>(new Set(PRIORITAETEN))
  const [verantwortlich, setVerantwortlich] = useState('')

  const [ziel, setZiel] = useState('')
  const [entwerfeLaeuft, setEntwerfeLaeuft] = useState(false)
  const [entwerfeFehler, setEntwerfeFehler] = useState('')
  const [betreff, setBetreff] = useState('')
  const [text, setText] = useState('')

  const [versand, setVersand] = useState<Record<string, Versandstatus>>({})
  const [sendeLaeuft, setSendeLaeuft] = useState(false)

  const empfaenger = useMemo<Empfaenger[]>(() => {
    return KUNDEN_BEREICHE.filter((b) => bereiche.has(b.id)).flatMap((b) =>
      b.get(state)
        .filter((k) => prioritaeten.has(k.prioritaet))
        .filter((k) => !verantwortlich || k.verantwortlich === verantwortlich)
        .filter((k) => k.email)
        .map((kunde) => ({ bereich: b.id, kunde })),
    )
  }, [state, bereiche, prioritaeten, verantwortlich])

  function toggleBereich(id: KundeBereich) {
    setBereiche((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePrioritaet(p: Prioritaet) {
    setPrioritaeten((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  async function entwerfen() {
    if (!ziel.trim()) return
    setEntwerfeLaeuft(true)
    setEntwerfeFehler('')
    try {
      const entwurf = await draftCampaign(ziel)
      setBetreff(entwurf.betreff)
      setText(entwurf.text)
    } catch (err) {
      setEntwerfeFehler(err instanceof Error ? err.message : 'Entwurf konnte nicht erstellt werden.')
    } finally {
      setEntwerfeLaeuft(false)
    }
  }

  async function senden() {
    if (empfaenger.length === 0 || !betreff.trim() || !text.trim()) return
    if (!confirm(`Kampagne wirklich an ${empfaenger.length} Empfänger senden?`)) return

    setSendeLaeuft(true)
    const initial: Record<string, Versandstatus> = {}
    empfaenger.forEach((e) => { initial[e.kunde.id] = 'offen' })
    setVersand(initial)

    for (const e of empfaenger) {
      const personalisiert = applyMailVorlage({ id: '', name: '', betreff, text }, e.kunde)
      try {
        await sendEmail(e.kunde.email, personalisiert.betreff, personalisiert.text, undefined, {
          toName: e.kunde.ansprechpartner,
          kundeBereich: e.bereich,
          kundeId: e.kunde.id,
          kundeName: e.kunde.firma,
        })
        setVersand((v) => ({ ...v, [e.kunde.id]: 'gesendet' }))
      } catch {
        setVersand((v) => ({ ...v, [e.kunde.id]: 'fehler' }))
      }
      await new Promise((r) => setTimeout(r, 400))
    }
    setSendeLaeuft(false)
  }

  const versandGestartet = Object.keys(versand).length > 0
  const gesendetCount = Object.values(versand).filter((s) => s === 'gesendet').length
  const fehlerCount = Object.values(versand).filter((s) => s === 'fehler').length

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-800">Kampagnen</h1>
        <p className="text-sm text-slate-500">Segment-E-Mail an eine ausgewählte Kontaktliste über mehrere Bereiche hinweg, z. B. ein zweiwöchentlicher Newsletter.</p>
      </div>

      {!isEmailGatewayConfigured ? (
        <Card className="flex items-start gap-2 p-4 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          Postfach noch nicht verbunden — sobald die Zugangsdaten als Supabase-Secrets hinterlegt sind, kann hier direkt aus dem CRM versendet werden.
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-1">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Segment</h3>
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-medium text-slate-500">Bereiche</p>
              <div className="space-y-1.5">
                {KUNDEN_BEREICHE.map((b) => (
                  <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                    <input type="checkbox" className="rounded" checked={bereiche.has(b.id)} onChange={() => toggleBereich(b.id)} />
                    {b.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <p className="mb-1.5 text-xs font-medium text-slate-500">Priorität</p>
              <div className="flex gap-3">
                {PRIORITAETEN.map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-sm text-slate-600">
                    <input type="checkbox" className="rounded" checked={prioritaeten.has(p)} onChange={() => togglePrioritaet(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Verantwortlich">
              <select className={inputClass} value={verantwortlich} onChange={(e) => setVerantwortlich(e.target.value)}>
                <option value="">Alle</option>
                {MITARBEITER.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <p className="mt-3 text-sm font-medium text-slate-800">{empfaenger.length} Empfänger</p>
            <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {empfaenger.map((e) => (
                <div key={e.kunde.id} className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="truncate">{e.kunde.firma} <span className="text-slate-400">· {kundeBereichLabel(e.bereich)}</span></span>
                  {versand[e.kunde.id] === 'gesendet' && <CheckCircle2 size={13} className="flex-shrink-0 text-emerald-500" />}
                  {versand[e.kunde.id] === 'fehler' && <XCircle size={13} className="flex-shrink-0 text-rose-500" />}
                  {versand[e.kunde.id] === 'offen' && <Loader2 size={13} className="flex-shrink-0 animate-spin text-slate-400" />}
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Entwurf</h3>
            <Field label="Ziel/Thema (für KI-Entwurf, optional)">
              <div className="flex gap-2">
                <input className={inputClass} value={ziel} onChange={(e) => setZiel(e.target.value)} placeholder="z. B. zweiwöchentlicher Newsletter über neue Immobilienangebote" />
                <SecondaryButton onClick={entwerfen} disabled={entwerfeLaeuft || !ziel.trim()}>
                  {entwerfeLaeuft ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Entwurf
                </SecondaryButton>
              </div>
            </Field>
            {entwerfeFehler && <p className="mb-3 text-sm font-medium text-rose-600">{entwerfeFehler}</p>}

            <Field label="Betreff">
              <input className={inputClass} value={betreff} onChange={(e) => setBetreff(e.target.value)} />
            </Field>
            <Field label="Text (Platzhalter {{firma}}/{{ansprechpartner}} werden pro Empfänger ersetzt)">
              <textarea className={inputClass} rows={10} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>

            {versandGestartet && (
              <p className="mb-3 text-sm text-slate-600">
                {gesendetCount} von {empfaenger.length} gesendet{fehlerCount > 0 && `, ${fehlerCount} fehlgeschlagen`}.
              </p>
            )}

            <div className="flex justify-end">
              <PrimaryButton onClick={senden} disabled={sendeLaeuft || empfaenger.length === 0 || !betreff.trim() || !text.trim()}>
                <Send size={14} /> {sendeLaeuft ? 'Wird gesendet …' : `An ${empfaenger.length} Empfänger senden`}
              </PrimaryButton>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
