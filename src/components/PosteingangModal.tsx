import { useState } from 'react'
import { Inbox, RefreshCw, UserPlus, Check, X, AlertTriangle } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { isEmailGatewayConfigured, syncPosteingang } from '../lib/emailGateway'
import { matchKundeByEmail, suggestKunde } from '../lib/matchKunde'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { Modal, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { uid, today, addDays, fmtDateTime } from '../lib/dates'
import { MITARBEITER } from '../data/constants'
import type { KundeBereich } from '../types'

export function PosteingangModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [bereichWahl, setBereichWahl] = useState<Record<string, KundeBereich>>({})
  const [kundeWahl, setKundeWahl] = useState<Record<string, string>>({})

  const mails = state.eingegangeneEmails.filter((e) => !e.ignoriert)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const fetched = await syncPosteingang(20)
      const emails = fetched.map((m) => {
        const vorschlagMatch = matchKundeByEmail(state, m.von) ?? suggestKunde(state, `${m.betreff} ${m.ausschnitt} ${m.vonName}`)
        return {
          id: uid('mail'),
          ...m,
          vorschlag: vorschlagMatch ? { bereich: vorschlagMatch.bereich, kundeId: vorschlagMatch.kundeId, kundeName: vorschlagMatch.kundeName } : undefined,
        }
      })
      dispatch({ type: 'ADD_EINGEGANGENE_EMAILS', emails })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Postfach konnte nicht abgerufen werden.')
    } finally {
      setLoading(false)
    }
  }

  function zuweisen(mailId: string, bereich: KundeBereich, kundeId: string) {
    const kunde = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state).find((k) => k.id === kundeId)
    if (!kunde) return
    dispatch({ type: 'ASSIGN_EINGEGANGENE_EMAIL', id: mailId, bereich, kundeId, kundeName: `${kunde.firma} (${kunde.ansprechpartner})` })
  }

  function alsNeuenKundenAnlegen(mail: (typeof mails)[number]) {
    dispatch({
      type: 'ADD_KUNDE',
      kunde: {
        id: uid('k'),
        firma: mail.vonName,
        ansprechpartner: mail.vonName,
        email: mail.von,
        telefon: '',
        prioritaet: 'Mittel',
        status: 'lead',
        followUp: { date: addDays(today(), 2), note: 'Rückmeldung auf eingegangene E-Mail geben', done: false },
        verantwortlich: MITARBEITER[0],
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: `Als Lead aus E-Mail-Posteingang angelegt: „${mail.betreff}"`, user: 'E-Mail-Posteingang' }],
      },
    })
    dispatch({ type: 'IGNORE_EINGEGANGENE_EMAIL', id: mail.id })
  }

  return (
    <Modal open={open} onClose={onClose} title="E-Mail-Posteingang (info@amayer-holding.com)" width="max-w-2xl">
      {!isEmailGatewayConfigured ? (
        <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle size={15} /> Postfach noch nicht verbunden</div>
          Sobald die echten Zugangsdaten als Supabase-Secrets hinterlegt sind (nie im Frontend-Code),
          erscheinen hier automatisch die eingehenden E-Mails und können direkt einem Kunden/Mandanten
          zugeordnet oder als neuer Lead übernommen werden.
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">Letzte E-Mails aus dem Postfach, automatischer Kunden-Vorschlag inklusive.</p>
            <SecondaryButton onClick={refresh} disabled={loading}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Postfach jetzt abrufen
            </SecondaryButton>
          </div>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="space-y-3">
            {mails.map((mail) => {
              const bereich = bereichWahl[mail.id] ?? mail.vorschlag?.bereich ?? KUNDEN_BEREICHE[0].id
              const kundenListe = KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state)
              const kundeId = kundeWahl[mail.id] ?? mail.vorschlag?.kundeId ?? kundenListe[0]?.id ?? ''
              return (
                <div key={mail.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{mail.betreff}</span>
                    <span className="text-xs text-slate-400">{fmtDateTime(mail.datum)}</span>
                  </div>
                  <div className="mb-1 text-xs text-slate-400">Von: {mail.vonName} ({mail.von})</div>
                  <p className="mb-2 text-sm text-slate-600">{mail.ausschnitt}</p>

                  {mail.zugewiesen ? (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                      <Check size={13} /> Zugewiesen: {mail.zugewiesen.kundeName}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className={`${inputClass} w-auto`}
                        value={bereich}
                        onChange={(e) => setBereichWahl((s) => ({ ...s, [mail.id]: e.target.value as KundeBereich }))}
                      >
                        {KUNDEN_BEREICHE.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                      </select>
                      <select
                        className={`${inputClass} w-auto`}
                        value={kundeId}
                        onChange={(e) => setKundeWahl((s) => ({ ...s, [mail.id]: e.target.value }))}
                      >
                        {kundenListe.length === 0 && <option value="">– keine Kunden –</option>}
                        {kundenListe.map((k) => <option key={k.id} value={k.id}>{k.firma} ({k.ansprechpartner})</option>)}
                      </select>
                      <PrimaryButton onClick={() => kundeId && zuweisen(mail.id, bereich, kundeId)} className="text-xs" disabled={!kundeId}>
                        Zuweisen
                      </PrimaryButton>
                      <SecondaryButton onClick={() => alsNeuenKundenAnlegen(mail)} className="text-xs">
                        <UserPlus size={13} /> Als neuen Lead anlegen
                      </SecondaryButton>
                      <button
                        onClick={() => dispatch({ type: 'IGNORE_EINGEGANGENE_EMAIL', id: mail.id })}
                        className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                        title="Ignorieren"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {mails.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                <Inbox className="mx-auto mb-2" size={24} />
                Keine E-Mails geladen — auf „Postfach jetzt abrufen" klicken.
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-4 flex justify-end">
        <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>
      </div>
    </Modal>
  )
}
