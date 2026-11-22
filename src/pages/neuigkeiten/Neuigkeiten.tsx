// Seite „Neu im CRM“ (/neuigkeiten, 23.11.2026): alle Neuerungen der letzten Zeit in einfachen Worten — was bringt
// es mir, wo finde ich es, wie geht es per Telegram. Gruppiert nach Zielgruppe/Bereich, eigene Schwerpunkte zuerst.
// Ungelesenes ist markiert; „Gelesen“ oder „Ansehen“ vermerkt es (Tabelle neuigkeiten_gelesen). Unten die eigene
// Einstellung für den Tipp der Woche per Telegram (email-gateway/neuigkeitenTipp.ts) und die Schwerpunkte.
// ?zeige=<id> springt zu einem Eintrag (Verweis „Mehr“ aus NeuHinweis.tsx).
//
// Einträge kommen per SQL (Tabelle neuigkeiten); Regeln für „wen betrifft es“ und Reihenfolge stehen in
// supabase/functions/_shared/neuigkeitenKern.ts.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ExternalLink, Megaphone, MessageCircle, RefreshCw } from 'lucide-react'
import { Card, EmptyState, SecondaryButton } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import { markiereGelesen, speichereNeuigkeitenEinstellung, useNeuigkeiten } from '../../lib/neuigkeiten'
import {
  gruppenName,
  hauptGruppe,
  istGeschaeftsfuehrung,
  istRelevant,
  NEUIGKEIT_GRUPPEN,
  sortiereNeuigkeiten,
  type Neuigkeit,
} from '../../../supabase/functions/_shared/neuigkeitenKern.ts'

type Ansicht = 'meine' | 'alle' | string

function datumText(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}

export function Neuigkeiten() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const zeige = params.get('zeige') ?? ''
  const { echterMitarbeiter } = useAuth()
  const { geladen, verfuegbar, eintraege, gelesen, einstellung, ungelesen, neuLaden } = useNeuigkeiten()
  const [ansicht, setAnsicht] = useState<Ansicht>('meine')
  const [nurUngelesen, setNurUngelesen] = useState(false)
  const [laedt, setLaedt] = useState(false)
  const [meldung, setMeldung] = useState('')

  // Beim Öffnen der Seite frisch laden (neue Einträge seit dem Start des CRM).
  useEffect(() => {
    void neuLaden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const person = echterMitarbeiter ? { rolle: echterMitarbeiter.rolle, ist_admin: echterMitarbeiter.ist_admin, bereiche: echterMitarbeiter.bereiche } : null
  const gf = istGeschaeftsfuehrung(person)

  const sichtbar = useMemo(() => {
    let l = eintraege.filter((n) => n.aktiv)
    if (ansicht === 'meine') l = l.filter((n) => istRelevant(n, person))
    else if (ansicht !== 'alle') l = l.filter((n) => n.bereiche.includes(ansicht))
    if (nurUngelesen) l = l.filter((n) => !gelesen.has(n.id))
    return sortiereNeuigkeiten(l, einstellung.schwerpunkte)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eintraege, ansicht, nurUngelesen, gelesen, einstellung.schwerpunkte, echterMitarbeiter])

  // Gruppen: eigene Schwerpunkte zuerst, sonst feste Reihenfolge.
  const gruppen = useMemo(() => {
    const sp = new Set(einstellung.schwerpunkte)
    const reihenfolge = [...NEUIGKEIT_GRUPPEN].sort((a, b) => (sp.has(a.id) ? 0 : 1) - (sp.has(b.id) ? 0 : 1))
    return reihenfolge
      .map((g) => ({ id: g.id, label: g.label, eintraege: sichtbar.filter((n) => hauptGruppe(n) === g.id) }))
      .filter((g) => g.eintraege.length > 0)
  }, [sichtbar, einstellung.schwerpunkte])

  // Zum Eintrag aus ?zeige= springen, sobald er da ist.
  useEffect(() => {
    if (!zeige || !geladen) return
    const el = document.getElementById(`neuigkeit-${zeige}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [zeige, geladen, gruppen.length])

  const ungelesenSichtbar = sichtbar.filter((n) => !gelesen.has(n.id))

  function oeffne(n: Neuigkeit) {
    void markiereGelesen([n.id])
    if (!n.link) return
    if (n.link.startsWith('./') || /^https?:\/\//i.test(n.link)) window.open(n.link, '_blank', 'noopener')
    else navigate(n.link)
  }

  async function aktualisieren() {
    setLaedt(true)
    await neuLaden()
    setLaedt(false)
  }

  async function schalteTipp(an: boolean) {
    setMeldung('')
    if (!(await speichereNeuigkeitenEinstellung({ telegram_tipp: an }))) setMeldung('Nicht gespeichert.')
  }

  async function schalteSchwerpunkt(id: string) {
    setMeldung('')
    const sp = einstellung.schwerpunkte.includes(id) ? einstellung.schwerpunkte.filter((x) => x !== id) : [...einstellung.schwerpunkte, id]
    if (!(await speichereNeuigkeitenEinstellung({ schwerpunkte: sp }))) setMeldung('Nicht gespeichert.')
  }

  const auswahl: { id: Ansicht; label: string }[] = [
    { id: 'meine', label: 'Was mich betrifft' },
    { id: 'alle', label: 'Alle' },
    ...NEUIGKEIT_GRUPPEN.filter((g) => g.id !== 'alle' && (g.id !== 'geschaeftsfuehrung' || gf)).map((g) => ({ id: g.id, label: g.label })),
  ]

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <Megaphone size={20} className="text-amber-500" /> Neu im CRM
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Was in letzter Zeit dazugekommen ist – kurz erklärt: was es dir bringt, wo du es findest und wie es per Telegram geht.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ungelesenSichtbar.length > 0 && (
            <SecondaryButton onClick={() => void markiereGelesen(ungelesenSichtbar.map((n) => n.id))}>
              <Check size={14} /> Alle als gelesen markieren
            </SecondaryButton>
          )}
          <SecondaryButton onClick={() => void aktualisieren()} disabled={laedt}>
            <RefreshCw size={14} className={laedt ? 'animate-spin' : ''} /> Neu laden
          </SecondaryButton>
        </div>
      </div>

      {!isSupabaseConfigured ? (
        <EmptyState text="Neuigkeiten gibt es nur mit Anmeldung." />
      ) : !geladen ? (
        <EmptyState text="Lädt …" />
      ) : !verfuegbar ? (
        <EmptyState text="Die Neuigkeiten sind noch nicht eingerichtet." />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              value={ansicht}
              onChange={(e) => setAnsicht(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
              aria-label="Welche Neuigkeiten"
            >
              {auswahl.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={nurUngelesen} onChange={(e) => setNurUngelesen(e.target.checked)} className="h-4 w-4" />
              Nur ungelesene
            </label>
            <span className="text-xs text-slate-400">
              {ungelesen.length === 0 ? 'Du kennst alles, was dich betrifft.' : `${ungelesen.length} ungelesen für dich`}
            </span>
          </div>

          {gruppen.length === 0 ? (
            <EmptyState text={nurUngelesen ? 'Alles gelesen – hier ist nichts Neues mehr.' : 'Keine Neuigkeiten in dieser Auswahl.'} />
          ) : (
            <div className="space-y-6">
              {gruppen.map((g) => (
                <section key={g.id}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</h2>
                  <div className="space-y-3">
                    {g.eintraege.map((n) => (
                      <NeuigkeitKarte key={n.id} n={n} gelesen={gelesen.has(n.id)} hervorgehoben={n.id === zeige} onOeffnen={() => oeffne(n)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <Card className="mt-8 p-4">
            <h2 className="text-sm font-semibold text-slate-700">Tipp der Woche per Telegram</h2>
            <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={einstellung.telegram_tipp} onChange={(e) => void schalteTipp(e.target.checked)} />
              <span>
                Dienstags gegen 10 Uhr höchstens eine kurze Nachricht mit einer Neuerung, die dich betrifft und die du hier noch nicht gelesen hast.
                Beim Assistenten geht es auch: „Tipp der Woche aus“.
              </span>
            </label>
            <p className="mt-4 text-sm font-medium text-slate-700">Meine Schwerpunkte</p>
            <p className="text-xs text-slate-400">Neuigkeiten aus diesen Bereichen stehen oben und kommen zuerst als Tipp.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {NEUIGKEIT_GRUPPEN.filter((x) => x.id !== 'alle' && (x.id !== 'geschaeftsfuehrung' || gf)).map((x) => {
                const an = einstellung.schwerpunkte.includes(x.id)
                return (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => void schalteSchwerpunkt(x.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium ${an ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                    aria-pressed={an}
                  >
                    {an && <Check size={11} className="mr-1 inline" />}
                    {gruppenName(x.id)}
                  </button>
                )
              })}
            </div>
            {meldung && <p className="mt-2 text-xs text-rose-600">{meldung}</p>}
          </Card>
        </>
      )}
    </div>
  )
}

function NeuigkeitKarte({ n, gelesen, hervorgehoben, onOeffnen }: { n: Neuigkeit; gelesen: boolean; hervorgehoben: boolean; onOeffnen: () => void }) {
  return (
    <div
      id={`neuigkeit-${n.id}`}
      className={`rounded-xl border bg-white p-4 shadow-sm ${hervorgehoben ? 'border-amber-300 ring-2 ring-amber-100' : gelesen ? 'border-slate-200' : 'border-amber-200'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
          {!gelesen && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" aria-label="ungelesen" />}
          <span>{n.titel}</span>
        </h3>
        <span className="flex-shrink-0 text-xs text-slate-400">{datumText(n.datum)}</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{n.text}</p>
      {n.telegram_beispiel && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <MessageCircle size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
          <span>
            Per Telegram, zum Beispiel: <span className="font-medium text-slate-700">„{n.telegram_beispiel}“</span>
          </span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {n.link && (
          <button
            type="button"
            onClick={onOeffnen}
            className="inline-flex items-center gap-1 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100"
          >
            <ExternalLink size={12} /> Ansehen
          </button>
        )}
        {gelesen ? (
          <span className="inline-flex items-center gap-1 text-xs text-slate-400"><Check size={12} /> Gelesen</span>
        ) : (
          <button
            type="button"
            onClick={() => void markiereGelesen([n.id])}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Check size={12} /> Gelesen
          </button>
        )}
        <span className="text-[11px] text-slate-400">{n.bereiche.map(gruppenName).join(' · ')}</span>
      </div>
    </div>
  )
}
