// Gemeinsame Daten der Projekt-Checkliste und der Wochenbesprechung (20.11.2026): eine Zeile je Akte der
// freigegebenen Bereiche mit Stand, Umsatz, Ampel, Unterlagen, Willkommensnachricht und offenen Wiedervorlagen.
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { useBereichsRechte } from '../../lib/bereichsRechte'
import { ladeKostenvoranschlaege, type Kostenvoranschlag } from '../../lib/kostenvoranschlaege'
import { supabase } from '../../lib/supabaseClient'
import { jeKunde, ladeOffeneWiedervorlagen, type Wiedervorlage } from '../../lib/wiedervorlagen'
import { istSammelakte } from '../../data/sammelakten'
import { seedMailVorlagen } from '../../data/mailVorlagen'
import { today } from '../../lib/dates'
import {
  AMPEL_LABEL, berechneAmpel, offeneWiedervorlagen, standVon, umsatzVon, unterlagenVon,
  type AmpelErgebnis, type NaechsteWv, type Stand, type UnterlagenStand,
} from '../../lib/checkliste'
import type { AmpelFarbe, Kunde, KundeBereich } from '../../types'

export type Zeile = {
  kunde: Kunde
  bereich: KundeBereich
  bereichLabel: string
  stand: Stand
  umsatz: { netto: number; anzahl: number; ohneBetrag: number }
  ampel: AmpelErgebnis
  unterlagen?: UnterlagenStand
  willkommen?: string
  /** Offene Wiedervorlagen (Follow-up der Akte und Tabelle wiedervorlagen), früheste zuerst. */
  wv: NaechsteWv[]
}

export const AMPEL_PUNKT: Record<AmpelFarbe, string> = { rot: 'bg-rose-500', gelb: 'bg-amber-400', gruen: 'bg-emerald-500' }
const WILLKOMMEN_BETREFF = seedMailVorlagen.find((v) => v.id === 'mv-willkommen')?.betreff ?? 'Vielen Dank für Ihre Anfrage'

export const kurzDatum = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '')

export function Ampel({ a }: { a: AmpelErgebnis }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={a.gruende.join(' · ') || 'alles im Plan'}>
      <span className={`h-3 w-3 shrink-0 rounded-full ${AMPEL_PUNKT[a.farbe]}`} />
      <span className="text-xs text-slate-500">{AMPEL_LABEL[a.farbe]}{a.manuell ? ' (gesetzt)' : ''}</span>
    </span>
  )
}

export function StandAnzeige({ s }: { s: Stand }) {
  return (
    <div className="min-w-[130px]">
      {s.schritt && (
        <div className="mb-1 flex gap-0.5" aria-hidden>
          {Array.from({ length: s.schritte }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < s.schritt! ? 'bg-sky-600' : 'bg-slate-200'}`} />
          ))}
        </div>
      )}
      <span className="text-xs text-slate-700">
        {s.schritt ? `${s.schritt}/${s.schritte} ` : ''}
        {s.label}
      </span>
    </div>
  )
}

export function useChecklisteDaten() {
  const { state } = useApp()
  const { oeffentlicheKundenBereiche } = useBereichsRechte()
  const [kvs, setKvs] = useState<Kostenvoranschlag[]>([])
  const [willkommen, setWillkommen] = useState<Map<string, string>>(new Map())
  const [wvListe, setWvListe] = useState<Wiedervorlage[]>([])
  const wvLaden = () => ladeOffeneWiedervorlagen().then(setWvListe).catch((e) => setFehler(e instanceof Error ? e.message : 'Wiedervorlagen ließen sich nicht laden.'))
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    let aktiv = true
    wvLaden()
    ladeKostenvoranschlaege()
      .then((l) => aktiv && setKvs(l))
      .catch((e) => aktiv && setFehler(e instanceof Error ? e.message : 'Kostenvoranschläge ließen sich nicht laden.'))
    // Willkommensnachricht: gesendete Mails mit dem Betreff der Vorlage „Willkommen als Interessent“.
    supabase
      ?.from('gesendete_emails')
      .select('kunde_id, gesendet_am')
      .eq('betreff', WILLKOMMEN_BETREFF)
      .not('kunde_id', 'is', null)
      .then(({ data }) => {
        if (!aktiv || !data) return
        const m = new Map<string, string>()
        for (const r of data as { kunde_id: string; gesendet_am: string }[]) {
          const alt = m.get(r.kunde_id)
          if (!alt || r.gesendet_am < alt) m.set(r.kunde_id, r.gesendet_am)
        }
        setWillkommen(m)
      })
    return () => {
      aktiv = false
    }
  }, [])

  const heute = today()
  const kvJeKunde = useMemo(() => {
    const m = new Map<string, Kostenvoranschlag[]>()
    for (const kv of kvs) if (kv.kundeId) m.set(kv.kundeId, [...(m.get(kv.kundeId) ?? []), kv])
    return m
  }, [kvs])

  const wvJeKunde = useMemo(() => jeKunde(wvListe), [wvListe])

  const alle: Zeile[] = useMemo(() => {
    const zeilen: Zeile[] = []
    for (const b of oeffentlicheKundenBereiche) {
      for (const k of b.get(state)) {
        if (istSammelakte(k.id)) continue
        const eigeneKvs = kvJeKunde.get(k.id) ?? []
        const eigeneWv = wvJeKunde.get(k.id) ?? []
        zeilen.push({
          kunde: k,
          bereich: b.id,
          bereichLabel: b.label,
          stand: standVon(b.id, k.status),
          umsatz: umsatzVon(eigeneKvs),
          ampel: berechneAmpel(k, b.id, { heute, rechnungen: state.rechnungen, kvs: eigeneKvs, wiedervorlagen: eigeneWv }),
          unterlagen: unterlagenVon(k),
          willkommen: willkommen.get(k.id),
          wv: offeneWiedervorlagen(k, eigeneWv),
        })
      }
    }
    return zeilen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, kvJeKunde, wvJeKunde, willkommen, heute, oeffentlicheKundenBereiche.map((b) => b.id).join()])

  return { alle, kvs, wvListe, wvJeKunde, wvLaden, fehler, heute }
}
