// Umsatzvorschau für die Geschäftsführung (22.11.2026): was schon in Rechnung gestellt ist, was offen ist,
// was aus Angeboten (nach Chance) und Immobilien-Provisionen (nach Stand des Objekts) zu erwarten ist —
// für diesen Monat, dieses Quartal und das Jahr, je Bereich und je Monat. Die Regeln stehen in
// supabase/functions/_shared/umsatzKern.ts; der Assistent rechnet mit derselben Datei (umsatz_vorschau).
// Sichtbar ist nur, was der Nutzer auch sonst sehen darf (Bereichsrechte); private Akten zählen nie.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, inputClass } from '../../components/ui'
import { darfBereich } from '../../lib/bereichsRechte'
import { useAuth } from '../../context/AuthContext'
import { ladeKostenvoranschlaege, type Kostenvoranschlag } from '../../lib/kostenvoranschlaege'
import { supabase } from '../../lib/supabaseClient'
import { today } from '../../lib/dates'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { aktePfad } from '../../components/KostenvoranschlaegeSection'
import {
  ANGEBOT_VORLAUF_MONATE, OBJEKT_STUFE_NAME, OBJEKT_STUFEN, STANDARD_PROVISION,
  bereichName, groesstePosten, jeMonat, monatName, offeneSumme, plusMonate, rechneUmsatzvorschau, summen, summenJeBereich, zeitraum,
  type FreigabeProvision, type MonatsWert, type Posten, type ZeitraumArt,
} from '../../lib/umsatzvorschau'
import type { Bereich, KundeBereich } from '../../types'

const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const prozent = (anteil: number) => `${Math.round(anteil * 100)} %`
const kurzEuro = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.` : n >= 1000 ? `${Math.round(n / 1000).toLocaleString('de-DE')} Tsd.` : `${Math.round(n)}`)

// Reihenfolge im gestapelten Balken (unten → oben). Farben geprüft (Farbsehschwäche, Abstand); die hellste
// hat wenig Kontrast zum Hintergrund — dafür gibt es die Tabelle unter dem Diagramm.
const REIHEN: { key: 'berechnet' | 'entwuerfe' | 'angebote' | 'provision'; label: string; farbe: string }[] = [
  { key: 'berechnet', label: 'In Rechnung gestellt', farbe: '#4338ca' },
  { key: 'entwuerfe', label: 'Rechnungsentwürfe', farbe: '#818cf8' },
  { key: 'angebote', label: 'Angebote nach Chance', farbe: '#d97706' },
  { key: 'provision', label: 'Provision nach Stand', farbe: '#0d9488' },
]

const ZEITRAEUME: ZeitraumArt[] = ['monat', 'quartal', 'jahr']
const ZEITRAUM_LABEL: Record<ZeitraumArt, string> = { monat: 'Dieser Monat', quartal: 'Dieses Quartal', jahr: 'Dieses Jahr' }

export function Umsatzvorschau() {
  const { state } = useApp()
  const navigate = useNavigate()
  const { mitarbeiter } = useAuth()
  const [kvs, setKvs] = useState<Kostenvoranschlag[]>([])
  const [freigaben, setFreigaben] = useState<FreigabeProvision[]>([])
  const [fehler, setFehler] = useState('')
  const [art, setArt] = useState<ZeitraumArt>('quartal')
  const [bereich, setBereich] = useState('')
  const [zeiger, setZeiger] = useState<number | null>(null)
  const heute = today()
  const darfImmo = darfBereich(mitarbeiter, 'immobilien')

  useEffect(() => {
    let aktiv = true
    ladeKostenvoranschlaege()
      .then((l) => aktiv && setKvs(l))
      .catch((e) => aktiv && setFehler(e instanceof Error ? e.message : 'Kostenvoranschläge ließen sich nicht laden.'))
    if (darfImmo && supabase) {
      supabase
        .from('objekt_freigaben')
        .select('objekt_id, provision, status, erstellt_am')
        .then(({ data }) => {
          if (!aktiv || !data) return
          setFreigaben((data as { objekt_id: string; provision: string; status: string; erstellt_am: string }[]).map((f) => ({ objektId: f.objekt_id, provision: f.provision, status: f.status, erstelltAm: f.erstellt_am })))
        })
    }
    return () => {
      aktiv = false
    }
  }, [darfImmo])

  const vorschau = useMemo(() => {
    const akten = KUNDEN_BEREICHE.filter((b) => b.id !== 'privat').flatMap((b) => b.get(state).map((kunde) => ({ kunde, bereich: b.id })))
    return rechneUmsatzvorschau({
      heute,
      akten,
      rechnungen: state.rechnungen,
      kvs,
      objekte: darfImmo ? state.objekte : [],
      abrechnungen: state.abrechnungen ?? [],
      freigaben,
      darf: (b) => darfBereich(mitarbeiter, b as Bereich),
    })
  }, [state, kvs, freigaben, heute, mitarbeiter, darfImmo])

  const b = bereich || undefined
  const z = zeitraum(art, heute)
  const s = summen(vorschau, z, b)
  const offen = offeneSumme(vorschau, b)
  const jeBereich = summenJeBereich(vorschau, z)
  const monate = jeMonat(vorschau, plusMonate(vorschau.aktuellerMonat, -6), plusMonate(vorschau.aktuellerMonat, 6), b)
  const maxMonat = Math.max(1, ...monate.map((m) => m.erwartet))
  const topAngebote = groesstePosten(vorschau, z, ['angebot', 'entwurf'], 10, b)
  const topObjekte = groesstePosten(vorschau, z, ['provision'], 10, b)
  const offeneListe = [...vorschau.offene].filter((o) => !b || o.bereich === b).sort((x, y) => Number(y.ueberfaellig) - Number(x.ueberfaellig) || y.offenNetto - x.offenNetto).slice(0, 10)
  const bereicheZurAuswahl = [...new Set(vorschau.posten.map((p) => p.bereich))].sort()
  const h = vorschau.hinweise

  function oeffne(p: Posten) {
    if (p.verweis.typ === 'objekt') navigate(`/immobilien/objekte/${p.verweis.id}`)
    else if (p.verweis.typ === 'rechnung') navigate('/beratung/rechnungen')
    else if (p.verweis.typ === 'akte' && p.verweis.bereich) navigate(aktePfad(p.verweis.bereich as KundeBereich, { id: p.verweis.id }))
    else navigate('/kostenvoranschlaege')
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
            <TrendingUp size={20} className="text-accent-600" /> Umsatzvorschau
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Was schon in Rechnung steht, was offen ist und was aus Angeboten und Immobilien-Provisionen zu erwarten ist. Alle Beträge netto. Du siehst nur Bereiche, die für dich freigegeben sind.
          </p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Bereich</span>
          <select className={inputClass} value={bereich} onChange={(e) => setBereich(e.target.value)}>
            <option value="">Alle Bereiche</option>
            {bereicheZurAuswahl.map((x) => (
              <option key={x} value={x}>{bereichName(x)}</option>
            ))}
          </select>
        </label>
      </div>

      {fehler && <p className="rounded-lg bg-rose-50 p-2 text-sm text-rose-600">{fehler}</p>}

      {/* Drei Zeiträume; der gewählte bestimmt Tabelle und Listen darunter. */}
      <div className="grid gap-3 md:grid-cols-4">
        {ZEITRAEUME.map((a) => {
          const zz = zeitraum(a, heute)
          const ss = summen(vorschau, zz, b)
          const gewaehlt = a === art
          return (
            <button
              key={a}
              type="button"
              onClick={() => setArt(a)}
              aria-pressed={gewaehlt}
              className={`rounded-xl border bg-white p-3 text-left shadow-sm transition ${gewaehlt ? 'border-accent-400 ring-2 ring-accent-100' : 'border-slate-200 hover:border-slate-300'}`}
            >
              <p className="text-xs text-slate-500">{ZEITRAUM_LABEL[a]} · {zz.label}</p>
              <p className="text-lg font-semibold tabular-nums text-slate-800">{euro(ss.erwartet)}</p>
              <p className="text-xs text-slate-500">davon in Rechnung {euro(ss.berechnet)}</p>
              <p className="text-xs text-slate-400">erwartet {euro(ss.entwuerfe + ss.angebote + ss.provision)} · eingegangen {euro(ss.eingegangen)}</p>
            </button>
          )
        })}
        <Card className="p-3">
          <p className="text-xs text-slate-500">Offene Rechnungen (heute)</p>
          <p className="text-lg font-semibold tabular-nums text-slate-800">{euro(offen.netto)}</p>
          <p className="text-xs text-slate-500">{offen.anzahl} {offen.anzahl === 1 ? 'Rechnung' : 'Rechnungen'}, brutto {euro(offen.brutto)}</p>
          <p className={`text-xs ${offen.anzahlUeberfaellig ? 'font-medium text-rose-600' : 'text-slate-400'}`}>
            überfällig {euro(offen.ueberfaelligNetto)} ({offen.anzahlUeberfaellig})
          </p>
        </Card>
      </div>

      {/* Zusammensetzung des gewählten Zeitraums */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-800">{z.label}: so setzt sich der erwartete Umsatz zusammen</h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Teil farbe={REIHEN[0].farbe} titel="In Rechnung gestellt" wert={s.berechnet} unten="zählt voll im Monat des Rechnungsdatums" />
          <Teil farbe={REIHEN[1].farbe} titel="Rechnungsentwürfe" wert={s.entwuerfe} unten="zählen voll, frühestens im laufenden Monat" />
          <Teil farbe={REIHEN[2].farbe} titel="Angebote nach Chance" wert={s.angebote} unten={`aus ${euro(s.angeboteUngewichtet)} ungewichtet, ${s.anzahlAngebote} ${s.anzahlAngebote === 1 ? 'Angebot' : 'Angebote'}`} />
          <Teil farbe={REIHEN[3].farbe} titel="Immobilien-Provision" wert={s.provision} unten={`aus ${euro(s.provisionUngewichtet)} ungewichtet, ${s.anzahlObjekte} ${s.anzahlObjekte === 1 ? 'Objekt' : 'Objekte'}`} />
        </div>
      </Card>

      {/* Je Monat: gestapelte Balken, sechs Monate zurück bis sechs Monate voraus */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-800">Je Monat{b ? ` · ${bereichName(b)}` : ''}</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {REIHEN.map((r) => (
            <span key={r.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.farbe }} />
              {r.label}
            </span>
          ))}
        </div>
        <div className="relative mt-4">
          {zeiger !== null && <MonatsHinweis m={monate[zeiger]} links={(zeiger + 0.5) / monate.length} />}
          <div className="flex h-48 items-end gap-1 border-b border-slate-200 sm:gap-2" onMouseLeave={() => setZeiger(null)}>
            {monate.map((m, i) => {
              const istJetzt = m.monat === vorschau.aktuellerMonat
              return (
                <div
                  key={m.monat}
                  className={`flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-t ${istJetzt ? 'bg-slate-50' : ''}`}
                  onMouseEnter={() => setZeiger(i)}
                  onFocus={() => setZeiger(i)}
                  onBlur={() => setZeiger(null)}
                  tabIndex={0}
                  aria-label={`${monatName(m.monat)}: erwartet ${euro(m.erwartet)}`}
                >
                  {m.erwartet > 0 && <span className="mb-0.5 hidden text-[10px] tabular-nums text-slate-500 sm:block">{kurzEuro(m.erwartet)}</span>}
                  <div className="flex w-full max-w-[36px] flex-col-reverse gap-[2px]" style={{ height: `${(m.erwartet / maxMonat) * 85}%` }}>
                    {REIHEN.map((r, j) => {
                      const w = m[r.key]
                      if (w <= 0) return null
                      const oben = REIHEN.slice(j + 1).every((x) => m[x.key] <= 0)
                      return <div key={r.key} className={oben ? 'rounded-t' : ''} style={{ background: r.farbe, flexGrow: w, minHeight: 2 }} />
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-1 flex gap-1 sm:gap-2">
            {monate.map((m) => (
              <span key={m.monat} className={`min-w-0 flex-1 truncate text-center text-[10px] ${m.monat === vorschau.aktuellerMonat ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
                {m.label}
              </span>
            ))}
          </div>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-accent-600">Als Tabelle</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-2 font-medium">Monat</th>
                  {REIHEN.map((r) => <th key={r.key} className="py-1 pr-2 text-right font-medium">{r.label}</th>)}
                  <th className="py-1 pr-2 text-right font-medium">Erwartet</th>
                  <th className="py-1 text-right font-medium">Eingegangen</th>
                </tr>
              </thead>
              <tbody className="tabular-nums text-slate-700">
                {monate.map((m) => (
                  <tr key={m.monat} className={`border-t border-slate-100 ${m.monat === vorschau.aktuellerMonat ? 'font-semibold' : ''}`}>
                    <td className="py-1 pr-2">{monatName(m.monat)}</td>
                    {REIHEN.map((r) => <td key={r.key} className="py-1 pr-2 text-right">{euro(m[r.key])}</td>)}
                    <td className="py-1 pr-2 text-right">{euro(m.erwartet)}</td>
                    <td className="py-1 text-right">{euro(m.eingegangen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      {/* Je Bereich im gewählten Zeitraum */}
      {!b && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-800">Je Bereich · {z.label}</h2>
          {jeBereich.length === 0 ? (
            <EmptyState text="Für diesen Zeitraum ist noch nichts erfasst oder zu erwarten." />
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1.5 pr-2 font-medium">Bereich</th>
                    <th className="py-1.5 pr-2 text-right font-medium">In Rechnung</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Entwürfe</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Angebote nach Chance</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Provision</th>
                    <th className="py-1.5 pr-2 text-right font-medium">Erwartet</th>
                    <th className="py-1.5 text-right font-medium">Eingegangen</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-slate-700">
                  {jeBereich.map((x) => (
                    <tr key={x.bereich} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setBereich(x.bereich)}>
                      <td className="py-1.5 pr-2 font-medium text-slate-800">{x.name}</td>
                      <td className="py-1.5 pr-2 text-right">{euro(x.summen.berechnet)}</td>
                      <td className="py-1.5 pr-2 text-right">{euro(x.summen.entwuerfe)}</td>
                      <td className="py-1.5 pr-2 text-right" title={`ungewichtet ${euro(x.summen.angeboteUngewichtet)}`}>{euro(x.summen.angebote)}</td>
                      <td className="py-1.5 pr-2 text-right" title={`ungewichtet ${euro(x.summen.provisionUngewichtet)}`}>{euro(x.summen.provision)}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold text-slate-800">{euro(x.summen.erwartet)}</td>
                      <td className="py-1.5 text-right">{euro(x.summen.eingegangen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <PostenListe titel={`Größte Angebote · ${z.label}`} leer="Keine offenen oder angenommenen Angebote in diesem Zeitraum." posten={topAngebote} onOeffne={oeffne} />
        {darfImmo && (!b || b === 'immobilien') && (
          <PostenListe titel={`Objekte mit erwarteter Provision · ${z.label}`} leer="Kein Objekt in einem Stand ab „Reserviert“ für diesen Zeitraum." posten={topObjekte} onOeffne={oeffne} />
        )}
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-slate-800">Offene Rechnungen</h2>
        {offeneListe.length === 0 ? (
          <EmptyState text="Keine offenen Rechnungen." />
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {offeneListe.map((o) => (
              <li key={o.id} className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 py-1.5 hover:bg-slate-50" onClick={() => navigate('/beratung/rechnungen')}>
                <span className="min-w-0">
                  <span className="font-medium text-slate-800">{o.nummer}</span> <span className="text-slate-600">{o.titel}</span>{' '}
                  <span className="text-xs text-slate-400">{bereichName(o.bereich)}</span>
                </span>
                <span className="flex items-baseline gap-3">
                  <span className={`text-xs ${o.ueberfaellig ? 'font-medium text-rose-600' : 'text-slate-500'}`}>
                    {o.ueberfaellig ? (o.tageUeberfaellig ? `seit ${o.tageUeberfaellig} Tagen überfällig` : 'überfällig') : o.frist ? `fällig ${o.frist.split('-').reverse().join('.')}` : ''}
                  </span>
                  <span className="tabular-nums text-slate-800">{euro(o.offenNetto)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4 text-sm text-slate-600">
        <h2 className="text-sm font-semibold text-slate-800">Lücken und Regeln</h2>
        {(h.angeboteOhneChance > 0 || h.aktenMitChanceOhneAngebot > 0 || h.angeboteOhneBetrag > 0 || (darfImmo && (h.objekteOhnePreis > 0 || h.objekteMitAnnahme > 0))) && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800">
            {h.angeboteOhneChance > 0 && <li>{h.angeboteOhneChance} offene {h.angeboteOhneChance === 1 ? 'Angebot hat' : 'Angebote haben'} keine Chance in der Akte und {h.angeboteOhneChance === 1 ? 'zählt' : 'zählen'} deshalb nicht mit (in der Projekt-Checkliste nachtragen).</li>}
            {h.angeboteOhneBetrag > 0 && <li>{h.angeboteOhneBetrag} {h.angeboteOhneBetrag === 1 ? 'Angebot hat' : 'Angebote haben'} keinen Betrag.</li>}
            {h.aktenMitChanceOhneAngebot > 0 && <li>{h.aktenMitChanceOhneAngebot} laufende {h.aktenMitChanceOhneAngebot === 1 ? 'Akte hat' : 'Akten haben'} eine Chance, aber weder Kostenvoranschlag mit Betrag noch geschätzten Umsatz — in der Wochenbesprechung den Vorschlag übernehmen oder einen Umsatz eintragen.</li>}
            {darfImmo && h.objekteOhnePreis > 0 && <li>{h.objekteOhnePreis} {h.objekteOhnePreis === 1 ? 'Objekt' : 'Objekte'} ab „Reserviert“ ohne Kaufpreis.</li>}
            {darfImmo && h.objekteMitAnnahme > 0 && <li>Bei {h.objekteMitAnnahme} {h.objekteMitAnnahme === 1 ? 'Objekt' : 'Objekten'} ist keine Provision hinterlegt; gerechnet mit {STANDARD_PROVISION.prozentNetto} % netto.</li>}
          </ul>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-accent-600">So wird gerechnet</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            <li>Alle Beträge netto. Rechnungen (nicht Entwurf) zählen voll im Monat des Rechnungsdatums; Zahlungseingang im Monat der Zahlung.</li>
            <li>Angebote = Kostenvoranschläge mit Stand „offen“ oder „angenommen“, die noch nicht in einer Rechnung stecken. Angenommen zählt voll, offen mit der Chance der Akte. Erwarteter Monat: Datum des Angebots + {ANGEBOT_VORLAUF_MONATE.offen} Monate (angenommen + {ANGEBOT_VORLAUF_MONATE.angenommen}), frühestens der laufende Monat. Abgeschlossene oder verlorene Akten zählen nicht.</li>
            <li>
              Provision je Objekt = Provision in Euro × Anteil nach Stand. Provision aus der Abrechnung des Objekts, sonst aus der Kurzprüfung, sonst aus der Freigabe an Interessenten (Käuferseite), sonst {STANDARD_PROVISION.prozentNetto} % netto vom Kaufpreis. „inkl. USt.“ wird auf netto zurückgerechnet.
              Ab „Verkauft“ zählt das Objekt nicht mehr hier, die Provision gehört dann als Rechnung ins CRM.
            </li>
            <li>
              Anteil und Vorlauf je Stand:{' '}
              {Object.entries(OBJEKT_STUFEN).map(([id, st]) => `${OBJEKT_STUFE_NAME[id] ?? id} ${prozent(st.anteil)}${st.monate ? ` (+${st.monate} Mon.)` : ''}`).join(' · ')}
            </li>
          </ul>
        </details>
      </Card>
    </div>
  )
}

function Teil({ farbe, titel, wert, unten }: { farbe: string; titel: string; wert: number; unten: string }) {
  return (
    <div className="rounded-lg border border-slate-100 p-3">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: farbe }} />
        {titel}
      </p>
      <p className="text-base font-semibold tabular-nums text-slate-800">{euro(wert)}</p>
      <p className="text-xs text-slate-400">{unten}</p>
    </div>
  )
}

function MonatsHinweis({ m, links }: { m: MonatsWert; links: number }) {
  return (
    <div
      className="pointer-events-none absolute -top-2 z-10 w-56 -translate-y-full rounded-lg border border-slate-200 bg-white p-2 text-xs shadow-lg"
      style={{ left: `clamp(0px, calc(${links * 100}% - 7rem), calc(100% - 14rem))` }}
    >
      <p className="mb-1 font-semibold text-slate-800">{monatName(m.monat)}</p>
      {REIHEN.map((r) => (
        <p key={r.key} className="flex items-center justify-between gap-2 text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: r.farbe }} />
            {r.label}
          </span>
          <span className="tabular-nums">{euro(m[r.key])}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between border-t border-slate-100 pt-1 font-semibold text-slate-800">
        <span>Erwartet</span>
        <span className="tabular-nums">{euro(m.erwartet)}</span>
      </p>
      <p className="flex justify-between text-slate-500">
        <span>Eingegangen</span>
        <span className="tabular-nums">{euro(m.eingegangen)}</span>
      </p>
    </div>
  )
}

function PostenListe({ titel, leer, posten, onOeffne }: { titel: string; leer: string; posten: Posten[]; onOeffne: (p: Posten) => void }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-slate-800">{titel}</h2>
      {posten.length === 0 ? (
        <EmptyState text={leer} />
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {posten.map((p) => (
            <li key={`${p.art}:${p.id}`} className="cursor-pointer py-2 hover:bg-slate-50" onClick={() => onOeffne(p)}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-slate-800">{p.titel}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{euro(p.gewichtet)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-xs text-slate-500">
                <span className="min-w-0 truncate">{p.zusatz} · {bereichName(p.bereich)}</span>
                <span className="shrink-0 tabular-nums">{p.betrag === undefined ? 'Betrag unbekannt' : `${prozent(p.anteil)} von ${euro(p.betrag)}`}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{p.warum}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
