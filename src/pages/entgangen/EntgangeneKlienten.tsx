// Entgangene Klienten (24.11.2026, Wunsch der Geschäftsführung): welche Klienten uns entgangen sind und warum.
// Oben die Auswertung (Anzahl und entgangener Betrag je Grund, Phase, Vermittler, Bereich; Zeitraum-Filter),
// darunter die Liste der verlorenen Akten mit „Wieder aufnehmen“ und der Abschnitt „Droht zu entgehen“
// (lange Funkstille, niedrige Chance, Rechnung lange offen) mit „Nachfassen“ und „Als entgangen markieren“.
// Regeln und Texte: supabase/functions/_shared/entgangenKern.ts (dieselben wie im Telegram-Assistenten).
// Sichtbar ist nur, was der Nutzer ohnehin sehen darf (Bereichsrechte); private Kontakte zählen nie mit.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BellRing, RotateCcw, UserX } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { darfBereich } from '../../lib/bereichsRechte'
import { useAuth } from '../../context/AuthContext'
import { useKvNutzer } from '../../components/KostenvoranschlaegeSection'
import { Card, EmptyState, inputClass } from '../../components/ui'
import { VerlorenDialog } from '../../components/VerlorenDialog'
import { KUNDEN_BEREICHE, kundeBereichLabel, kundeDetailPfad } from '../../data/kundenBereiche'
import { istSammelakte } from '../../data/sammelakten'
import { addDays, fmtDate, today } from '../../lib/dates'
import { offenerBetrag } from '../../lib/rechnungen'
import { NUR_LESEN_MELDUNG } from '../../lib/nurLesen'
import { legeWiedervorlageAn, ladeOffeneWiedervorlagen, type Wiedervorlage } from '../../lib/wiedervorlagen'
import { isSupabaseConfigured } from '../../lib/supabaseClient'
import {
  type AuswertungZeile,
  DROH_GRENZEN,
  type DrohGrund,
  drohGrundText,
  drohtZuEntgehen,
  ENTGANGEN_GRUENDE,
  type EntgangenEintrag,
  euroText,
  grundLabel,
  imZeitraum,
  kenntVerloren,
  letzteAktivitaet,
  nimmWiederAuf,
  phaseStufe,
  statusLabelFuer,
  werteAus,
  zeitraumBeginn,
} from '../../lib/entgangen'
import type { Kunde, KundeBereich } from '../../types'

type Zeitraum = 'alle' | '30' | '90' | '365' | 'jahr'
const ZEITRAEUME: { id: Zeitraum; label: string }[] = [
  { id: 'alle', label: 'Gesamter Zeitraum' },
  { id: '30', label: 'Letzte 30 Tage' },
  { id: '90', label: 'Letzte 90 Tage' },
  { id: '365', label: 'Letzte 12 Monate' },
  { id: 'jahr', label: 'Dieses Jahr' },
]

type Akte = { kunde: Kunde; bereich: KundeBereich }
type Drohend = Akte & { gruende: DrohGrund[]; letzte?: string }

const ANZAHL_DROHEND = 40

export function EntgangeneKlienten() {
  const { state, dispatch } = useApp()
  const { mitarbeiter } = useAuth()
  const nutzer = useKvNutzer()
  const heute = today()
  const [zeitraum, setZeitraum] = useState<Zeitraum>('alle')
  const [bereichFilter, setBereichFilter] = useState<KundeBereich | ''>('')
  const [grundFilter, setGrundFilter] = useState('')
  const [mass, setMass] = useState<'anzahl' | 'betrag'>('anzahl')
  const [dialog, setDialog] = useState<Akte | null>(null)
  const [wiedervorlagen, setWiedervorlagen] = useState<Wiedervorlage[]>([])
  const [nachgefasst, setNachgefasst] = useState<Record<string, string>>({})
  const [meldung, setMeldung] = useState('')
  const [alleDrohenden, setAlleDrohenden] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let aktiv = true
    ladeOffeneWiedervorlagen().then((l) => aktiv && setWiedervorlagen(l)).catch(() => undefined)
    return () => {
      aktiv = false
    }
  }, [])

  // Alle Akten, die der Nutzer sehen darf — ohne private Kontakte und Sammelakten.
  const sichtbareBereiche = useMemo(() => KUNDEN_BEREICHE.filter((b) => b.id !== 'privat' && darfBereich(mitarbeiter, b.id)), [mitarbeiter])
  const akten: Akte[] = useMemo(
    () => sichtbareBereiche.flatMap((b) => b.get(state).filter((k) => !istSammelakte(k.id)).map((kunde) => ({ kunde, bereich: b.id }))),
    [state, sichtbareBereiche],
  )

  const von = zeitraumBeginn(zeitraum, heute)
  const verlorene = useMemo(() => {
    return akten
      .filter((a) => a.kunde.status === 'verloren')
      .map((a) => ({
        ...a,
        // Akten, die vor der Einführung ohne Grund auf „verloren“ gesetzt wurden, zählen als „Sonstiges“.
        v: a.kunde.verloren ?? { grund: 'sonstiges' as const, am: (a.kunde.letzteAktivitaet || heute).slice(0, 10), von: '' },
      }))
      .filter((a) => !bereichFilter || a.bereich === bereichFilter)
      .filter((a) => !grundFilter || a.v.grund === grundFilter)
      .sort((x, y) => y.v.am.localeCompare(x.v.am))
  }, [akten, bereichFilter, grundFilter, heute])

  const eintraege: EntgangenEintrag[] = verlorene.map((a) => ({ id: a.kunde.id, name: a.kunde.firma || a.kunde.ansprechpartner, bereich: a.bereich, verloren: a.v }))
  const auswertung = werteAus(eintraege, { von, bereichName: (b) => kundeBereichLabel(b as KundeBereich) })
  const liste = verlorene.filter((a) => imZeitraum(a.v.am, von))

  const offeneWv = useMemo(() => {
    const m = new Map<string, Wiedervorlage>()
    for (const w of wiedervorlagen) {
      const bisher = m.get(w.kundeId)
      if (!bisher || w.faellig < bisher.faellig) m.set(w.kundeId, w)
    }
    return m
  }, [wiedervorlagen])

  const drohende: Drohend[] = useMemo(() => {
    const rechnungenJeKunde = new Map<string, { status: string; zahlungsziel: string; betrag: number; nummer: string }[]>()
    for (const r of state.rechnungen) {
      const l = rechnungenJeKunde.get(r.kundeId) ?? []
      l.push({ status: r.status, zahlungsziel: r.zahlungsziel, betrag: offenerBetrag(r), nummer: r.nummer })
      rechnungenJeKunde.set(r.kundeId, l)
    }
    return akten
      .filter((a) => !bereichFilter || a.bereich === bereichFilter)
      .filter((a) => kenntVerloren(a.bereich, a.kunde))
      .map((a) => {
        const letzte = letzteAktivitaet(a.kunde.letzteAktivitaet, a.kunde.activities)
        const chance = a.kunde.auftragChance?.prozent
        const gruende = drohtZuEntgehen(
          { bereich: a.bereich, status: a.kunde.status, letzteAktivitaet: letzte, chanceProzent: Number.isFinite(chance) ? chance : undefined },
          (rechnungenJeKunde.get(a.kunde.id) ?? []).filter((r) => r.betrag > 0),
          heute,
        )
        return { ...a, gruende, letzte }
      })
      .filter((a) => a.gruende.length > 0)
      .sort((x, y) => y.gruende.length - x.gruende.length || (x.letzte ?? '').localeCompare(y.letzte ?? ''))
  }, [akten, state.rechnungen, bereichFilter, heute])

  async function nachfassen(a: Drohend) {
    if (nutzer.nurLesen) return setMeldung(NUR_LESEN_MELDUNG)
    const faellig = addDays(heute, 2)
    try {
      const wv = await legeWiedervorlageAn({
        kundeId: a.kunde.id,
        bereich: a.bereich,
        titel: 'Nachfassen – droht zu entgehen',
        notiz: a.gruende.map(drohGrundText).join('; '),
        faellig,
        verantwortlich: a.kunde.verantwortlich || undefined,
        von: nutzer.name,
      })
      setWiedervorlagen((l) => [...l, wv])
      setNachgefasst((m) => ({ ...m, [a.kunde.id]: faellig }))
      setMeldung(`Wiedervorlage „Nachfassen“ für ${a.kunde.firma || a.kunde.ansprechpartner} am ${fmtDate(faellig)} angelegt.`)
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Die Wiedervorlage ließ sich nicht anlegen.')
    }
  }

  function wiederAufnehmen(a: Akte) {
    if (nutzer.nurLesen) return setMeldung(NUR_LESEN_MELDUNG)
    if (!confirm(`${a.kunde.firma || a.kunde.ansprechpartner} wieder aufnehmen? Die Akte geht auf den Stand vor dem Verlieren zurück; der Grund bleibt im Verlauf stehen.`)) return
    const neu = nimmWiederAuf(dispatch, a.bereich, a.kunde, nutzer.name)
    if (neu) setMeldung(`${a.kunde.firma || a.kunde.ansprechpartner} ist wieder aufgenommen (${statusLabelFuer(a.bereich, a.kunde, neu)}).`)
  }

  const zeigeDrohende = alleDrohenden ? drohende : drohende.slice(0, ANZAHL_DROHEND)

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
          <UserX size={20} className="text-rose-500" /> Entgangene Klienten
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Wer uns entgangen ist, in welcher Phase und warum — und wer gerade zu entgehen droht. Eine Akte kommt hierher, wenn ihr Status auf „Verloren“ gesetzt wird.
        </p>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="min-w-[160px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Zeitraum</span>
          <select className={inputClass} value={zeitraum} onChange={(e) => setZeitraum(e.target.value as Zeitraum)}>
            {ZEITRAEUME.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </label>
        <label className="min-w-[160px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Bereich</span>
          <select className={inputClass} value={bereichFilter} onChange={(e) => setBereichFilter(e.target.value as KundeBereich | '')}>
            <option value="">Alle Bereiche</option>
            {sichtbareBereiche.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
        <label className="min-w-[160px] flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-500">Grund</span>
          <select className={inputClass} value={grundFilter} onChange={(e) => setGrundFilter(e.target.value)}>
            <option value="">Alle Gründe</option>
            {ENTGANGEN_GRUENDE.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </label>
      </Card>

      {meldung && (
        <div className="flex items-start justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <span>{meldung}</span>
          <button onClick={() => setMeldung('')} className="text-xs text-slate-500 underline">Schließen</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-xs font-medium text-slate-500">Entgangene Akten</div>
          <div className="mt-1 text-2xl font-semibold text-slate-800">{auswertung.anzahl}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-slate-500">Entgangener Betrag netto</div>
          <div className="mt-1 text-2xl font-semibold text-slate-800">{euroText(auswertung.betrag)}</div>
          {auswertung.ohneBetrag > 0 && <div className="mt-0.5 text-xs text-slate-400">{auswertung.ohneBetrag} ohne Betrag</div>}
        </Card>
      </div>

      {auswertung.anzahl > 0 && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Balken nach:</span>
            {(['anzahl', 'betrag'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMass(m)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${mass === m ? 'bg-accent-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
              >
                {m === 'anzahl' ? 'Anzahl' : 'Betrag'}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Balken titel="Warum? (je Grund)" zeilen={auswertung.jeGrund} mass={mass} />
            <Balken titel="Wo verlieren wir sie? (je Phase)" zeilen={auswertung.jePhase} mass={mass} sortiertLassen />
            <Balken titel="Je Vermittler" zeilen={auswertung.jeVermittler} mass={mass} />
            <Balken titel="Je Bereich" zeilen={auswertung.jeBereich} mass={mass} />
          </div>
        </>
      )}

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Entgangene Akten ({liste.length})</h2>
        {liste.length === 0 ? (
          <EmptyState text="Keine entgangenen Akten in diesem Zeitraum." />
        ) : (
          <div className="divide-y divide-slate-100">
            {liste.map((a) => (
              <div key={a.kunde.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <Link to={kundeDetailPfad(a.bereich, a.kunde.id)} className="font-medium text-accent-700 hover:underline">
                    {a.kunde.firma || a.kunde.ansprechpartner || 'Ohne Namen'}
                  </Link>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {kundeBereichLabel(a.bereich)} · {fmtDate(a.v.am)}{a.v.von ? ` · ${a.v.von}` : ''}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    <span className="font-medium">{grundLabel(a.v.grund)}</span>
                    {a.v.notiz && <span className="text-slate-500"> — {a.v.notiz}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span>Phase: {a.v.phaseVorher ? statusLabelFuer(a.bereich, a.kunde, a.v.phaseVorher) : phaseStufe(a.bereich, undefined).label}</span>
                    <span>Betrag: {a.v.wertNetto ? euroText(a.v.wertNetto) : '–'}</span>
                    <span>Vermittler: {a.v.vermittler || '–'}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  {!a.kunde.verloren && (
                    <button onClick={() => setDialog(a)} disabled={nutzer.nurLesen} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      Grund nachtragen
                    </button>
                  )}
                  <button
                    onClick={() => wiederAufnehmen(a)}
                    disabled={nutzer.nurLesen}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RotateCcw size={13} /> Wieder aufnehmen
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <AlertTriangle size={16} className="text-amber-500" /> Droht zu entgehen ({drohende.length})
        </h2>
        <p className="mb-3 mt-1 text-xs text-slate-500">
          Offene Akten mit mehr als {DROH_GRENZEN.stilleTage} Tagen ohne Aktivität, einer Chance von höchstens {DROH_GRENZEN.chanceMax} % oder einer Rechnung, die seit mindestens {DROH_GRENZEN.rechnungTage} Tagen über dem Zahlungsziel liegt.
        </p>
        {drohende.length === 0 ? (
          <EmptyState text="Gerade droht keine Akte zu entgehen." />
        ) : (
          <div className="divide-y divide-slate-100">
            {zeigeDrohende.map((a) => {
              const wv = offeneWv.get(a.kunde.id)
              const nachgefasstAm = nachgefasst[a.kunde.id]
              return (
                <div key={a.kunde.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <Link to={kundeDetailPfad(a.bereich, a.kunde.id)} className="font-medium text-accent-700 hover:underline">
                      {a.kunde.firma || a.kunde.ansprechpartner || 'Ohne Namen'}
                    </Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {kundeBereichLabel(a.bereich)} · {statusLabelFuer(a.bereich, a.kunde, a.kunde.status)}{a.kunde.verantwortlich ? ` · ${a.kunde.verantwortlich}` : ''}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {a.gruende.map((g) => (
                        <span key={g.art} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">{drohGrundText(g)}</span>
                      ))}
                    </div>
                    {(nachgefasstAm || wv) && (
                      <div className="mt-1 text-xs text-slate-500">Wiedervorlage offen: {nachgefasstAm ? `Nachfassen am ${fmtDate(nachgefasstAm)}` : `${wv!.titel} am ${fmtDate(wv!.faellig)}`}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      onClick={() => void nachfassen(a)}
                      disabled={nutzer.nurLesen || !!nachgefasstAm}
                      className="inline-flex items-center gap-1 rounded-lg border border-accent-200 bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent-100 disabled:opacity-50"
                      title="Wiedervorlage „Nachfassen“ in 2 Tagen anlegen"
                    >
                      <BellRing size={13} /> Nachfassen
                    </button>
                    <button
                      onClick={() => setDialog(a)}
                      disabled={nutzer.nurLesen}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Als entgangen markieren
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {drohende.length > ANZAHL_DROHEND && !alleDrohenden && (
          <button onClick={() => setAlleDrohenden(true)} className="mt-2 text-sm text-accent-700 underline">
            Alle {drohende.length} zeigen
          </button>
        )}
      </Card>

      {dialog && (
        <VerlorenDialog
          open
          bereich={dialog.bereich}
          kunde={dialog.kunde}
          onClose={() => setDialog(null)}
          onGespeichert={() => setMeldung(`${dialog.kunde.firma || dialog.kunde.ansprechpartner} ist als entgangen markiert.`)}
        />
      )}
    </div>
  )
}

function Balken({ titel, zeilen, mass, sortiertLassen }: { titel: string; zeilen: AuswertungZeile[]; mass: 'anzahl' | 'betrag'; sortiertLassen?: boolean }) {
  const reihe = sortiertLassen ? zeilen : [...zeilen].sort((a, b) => b[mass] - a[mass] || b.anzahl - a.anzahl)
  const max = Math.max(1, ...reihe.map((z) => z[mass]))
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{titel}</h3>
      <div className="space-y-2.5">
        {reihe.slice(0, 10).map((z) => (
          <div key={z.schluessel}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-slate-700" title={z.label}>{z.label}</span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {z.anzahl} · {z.betrag ? euroText(z.betrag) : '–'}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-rose-400" style={{ width: `${Math.max(z[mass] > 0 ? 3 : 0, (z[mass] / max) * 100)}%` }} />
            </div>
          </div>
        ))}
        {reihe.length > 10 && <div className="text-xs text-slate-400">… und {reihe.length - 10} weitere</div>}
      </div>
    </Card>
  )
}
