// Kontoauszug abgleichen (22.11.2026): Auszug der Holding hochladen (PDF, Foto oder CSV-Export der
// Bank) → Vorschläge, welche Buchung zu welcher offenen Rechnung bzw. Verbindlichkeit gehört → die
// angehakten buchen. Abgleich: supabase/functions/_shared/zahlungsAbgleich.ts (dort die Regeln).
//
// Lesen: CSV im Browser (_shared/kontoauszugCsv.ts, ohne KI). PDF/Foto werden kurz in
// kunden-dokumente/kontoauszug-abgleich/ abgelegt, vom Server gelesen (Aktion
// kontoauszug_abgleich_auslesen) und gleich wieder gelöscht.
//
// Buchen wie „Zahlung erfassen“ (ZahlungErfassenModal in RechnungDialoge.tsx): Zahlung an
// rechnung.zahlungen anhängen, bei vollem Betrag Status Bezahlt mit Datum und ohne Mahnstufe, Vermerk
// im Verlauf der Akte. Zusätzlich zahlungen[].quelle = Fingerabdruck der Buchung, damit derselbe
// Auszug nie doppelt gebucht wird; bei Skonto gilt die Rechnung als bezahlt. Verbindlichkeiten: Status
// bezahlt, bezahlt am, Zeile mit Kennung in der Notiz.
import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Landmark, Loader2, Upload } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Modal, PrimaryButton, SecondaryButton, StatusBadge } from '../ui'
import { findeAkte, useKvNutzer } from '../KostenvoranschlaegeSection'
import { bezahlteSumme, istUnbezahlt, offenerBetrag, rundeCent, vollstaendigBezahlt } from '../../lib/rechnungen'
import { fmtDate, fmtEURCent, today, uid } from '../../lib/dates'
import { supabase } from '../../lib/supabaseClient'
import { callAuthenticated } from '../../lib/emailGateway'
import {
  gleicheAb,
  kennungenAusText,
  verbindlichkeitNotiz,
  zahlungsNotiz,
  zahlungsVermerk,
  SICHERHEIT_TEXT,
  type AbgleichBuchung,
  type AbgleichRechnung,
  type AbgleichVerbindlichkeit,
  type AbgleichVorschlag,
  type BekannteZahlung,
  type Sicherheit,
} from '../../../supabase/functions/_shared/zahlungsAbgleich.ts'
import { dekodiereText, leseKontoCsv } from '../../../supabase/functions/_shared/kontoauszugCsv.ts'
import type { ActivityEntry, Rechnung, RechnungZahlung, Verbindlichkeit } from '../../types'

/** Zahlung mit Herkunft (zahlungen ist jsonb; das Feld quelle geht beim Speichern unverändert mit). */
type ZahlungMitQuelle = RechnungZahlung & { quelle?: string }

type Auszug = { name: string; buchungen: AbgleichBuchung[]; bank?: string | null; von?: string | null; bis?: string | null; hinweis?: string }

const SICHERHEIT_FARBE: Record<Sicherheit, string> = {
  sicher: 'bg-emerald-50 text-emerald-700',
  wahrscheinlich: 'bg-sky-50 text-sky-700',
  unklar: 'bg-amber-50 text-amber-700',
}

const MAX_BYTES = 20 * 1024 * 1024

/** Knopf „Kontoauszug abgleichen“ samt Fenster — für die Seiten Rechnungen und Verbindlichkeiten. */
export function KontoauszugAbgleichKnopf() {
  const [offen, setOffen] = useState(false)
  return (
    <>
      <SecondaryButton onClick={() => setOffen(true)}>
        <Landmark size={15} /> Kontoauszug abgleichen
      </SecondaryButton>
      {offen && <KontoauszugAbgleich onClose={() => setOffen(false)} />}
    </>
  )
}

async function leseDatei(datei: File): Promise<Auszug> {
  if (datei.size > MAX_BYTES) throw new Error('Die Datei ist größer als 20 MB.')
  const name = datei.name || 'Kontoauszug'
  if (/\.(csv|txt)$/i.test(name) || datei.type === 'text/csv') {
    const e = leseKontoCsv(dekodiereText(new Uint8Array(await datei.arrayBuffer())))
    if (!e.buchungen.length) throw new Error(e.fehler ?? 'In der Datei stehen keine Buchungen.')
    return { name, buchungen: e.buchungen, von: e.von, bis: e.bis }
  }
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const pfad = `kontoauszug-abgleich/${uid('ka')}_${name.replace(/[^\w.-]+/g, '_').slice(-80)}`
  const { error } = await supabase.storage.from('kunden-dokumente').upload(pfad, datei, { contentType: datei.type || undefined })
  if (error) throw new Error(`Hochladen fehlgeschlagen: ${error.message}`)
  try {
    const data = await callAuthenticated({ action: 'kontoauszug_abgleich_auslesen', datei: { eimer: 'kunden-dokumente', pfad, name, typ: datei.type } })
    if (!data?.ok) throw new Error(String(data?.error ?? 'Der Auszug ließ sich nicht lesen.'))
    const d = data.datei ?? {}
    return { name, buchungen: Array.isArray(data.buchungen) ? data.buchungen : [], bank: d.bank, von: d.von, bis: d.bis, hinweis: d.fehler }
  } finally {
    // Bankdaten nicht liegen lassen: Die Datei wurde nur zum Lesen abgelegt.
    await supabase.storage.from('kunden-dokumente').remove([pfad]).catch(() => undefined)
  }
}

export function KontoauszugAbgleich({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  const eingabe = useRef<HTMLInputElement>(null)
  const [auszug, setAuszug] = useState<Auszug | null>(null)
  const [liest, setLiest] = useState(false)
  const [fehler, setFehler] = useState('')
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set())
  const [meldung, setMeldung] = useState('')
  const [zeigeRest, setZeigeRest] = useState(false)
  // Vorauswahl einmal je geladenem Auszug setzen (nicht nach dem Buchen erneut).
  const [vorauswahlOffen, setVorauswahlOffen] = useState(false)

  const ergebnis = useMemo(() => {
    if (!auszug) return null
    const rechnungen: AbgleichRechnung[] = state.rechnungen
      .filter((r) => istUnbezahlt(r) && offenerBetrag(r) > 0)
      .map((r) => {
        const k = findeAkte(state, r.kundeId)?.kunde
        return { id: r.id, nummer: r.nummer, datum: r.datum, brutto: r.betragBrutto, offen: offenerBetrag(r), kundeId: r.kundeId, namen: [k?.firma ?? '', k?.ansprechpartner ?? ''].filter(Boolean) }
      })
    const verbindlichkeiten: AbgleichVerbindlichkeit[] = state.verbindlichkeiten
      .filter((v) => v.status !== 'bezahlt')
      .map((v) => ({ id: v.id, lieferant: v.lieferant, lieferantEmail: v.lieferantEmail, rechnungsnummer: v.rechnungsnummer, datum: v.datum, betrag: v.betragBrutto ?? null }))
    const bekannte: BekannteZahlung[] = []
    for (const r of state.rechnungen) {
      for (const z of (r.zahlungen ?? []) as ZahlungMitQuelle[]) bekannte.push({ art: 'rechnung', zielId: r.id, bezeichnung: `Rechnung ${r.nummer}`, datum: z.datum, betrag: z.betrag, quellen: z.quelle ? [z.quelle] : [] })
    }
    for (const v of state.verbindlichkeiten) {
      if (v.status === 'bezahlt') bekannte.push({ art: 'verbindlichkeit', zielId: v.id, bezeichnung: `Verbindlichkeit ${v.lieferant}`, datum: v.bezahltAm ?? '', betrag: v.betragBrutto ?? 0, quellen: kennungenAusText(v.notiz) })
    }
    return gleicheAb(auszug.buchungen, rechnungen, verbindlichkeiten, bekannte)
  }, [auszug, state])

  async function waehleDatei(datei: File | undefined) {
    if (!datei) return
    setFehler('')
    setMeldung('')
    setLiest(true)
    try {
      const a = await leseDatei(datei)
      setAuszug(a)
      setZeigeRest(false)
      setAuswahl(new Set<string>())
      setVorauswahlOffen(true)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err))
    } finally {
      setLiest(false)
      if (eingabe.current) eingabe.current.value = ''
    }
  }

  // Nur „sicher“ ist vorausgewählt (ohne Skonto, Überzahlung oder Verdacht auf Doppeltes) — gesetzt
  // während des Zeichnens, sobald der erste Abgleich des neuen Auszugs vorliegt.
  if (vorauswahlOffen && ergebnis) {
    setVorauswahlOffen(false)
    setAuswahl(new Set(ergebnis.vorschlaege.filter((v) => v.vorausgewaehlt).map((v) => v.id)))
  }

  function umschalten(id: string) {
    setAuswahl((alt) => {
      const neu = new Set(alt)
      if (neu.has(id)) neu.delete(id)
      else neu.add(id)
      return neu
    })
  }

  function buchen() {
    if (!ergebnis || nutzer.nurLesen) return
    const gewaehlt = ergebnis.vorschlaege.filter((v) => auswahl.has(v.id))
    // Arbeitskopien, damit zwei Buchungen auf dieselbe Rechnung aufeinander aufbauen.
    const rechnungen = new Map<string, Rechnung>()
    const verbindlichkeiten = new Map<string, Verbindlichkeit>()
    const vermerke = new Map<string, string[]>()
    let zahlungen = 0
    let bezahlt = 0
    let verb = 0
    const uebersprungen: string[] = []
    for (const v of gewaehlt) {
      for (const z of v.ziele) {
        if (z.art === 'rechnung') {
          const r = rechnungen.get(z.id) ?? state.rechnungen.find((x) => x.id === z.id)
          if (!r || r.status === 'Bezahlt') {
            uebersprungen.push(`${z.nummer} (schon bezahlt)`)
            continue
          }
          if (((r.zahlungen ?? []) as ZahlungMitQuelle[]).some((x) => x.quelle === v.fingerabdruck)) {
            uebersprungen.push(`${z.nummer} (schon gebucht)`)
            continue
          }
          const betrag = rundeCent(z.betrag)
          const nachher = rundeCent(bezahlteSumme(r) + betrag)
          const rechnerischVoll = vollstaendigBezahlt(r, nachher)
          const voll = rechnerischVoll || z.vollstaendig
          const neueZahlung: ZahlungMitQuelle = { id: uid('zahl'), datum: v.buchung.datum, betrag, notiz: zahlungsNotiz(v), erfasstVon: nutzer.name, quelle: v.fingerabdruck }
          const liste: RechnungZahlung[] = [...(r.zahlungen ?? []), neueZahlung]
          const patch: Partial<Rechnung> = voll
            ? { zahlungen: liste, status: 'Bezahlt', bezahltAm: v.buchung.datum, mahnstufe: undefined }
            : { zahlungen: liste, status: r.status === 'Entwurf' ? 'Versendet' : r.status }
          dispatch({ type: 'UPDATE_RECHNUNG', id: r.id, patch })
          rechnungen.set(r.id, { ...r, ...patch })
          zahlungen++
          if (voll) bezahlt++
          const text = zahlungsVermerk({ nummer: r.nummer, betrag, vollstaendig: voll, offenNachher: Math.max(0, rundeCent(r.betragBrutto - nachher)), skonto: voll && !rechnerischVoll ? v.skonto : undefined })
          vermerke.set(r.kundeId, [...(vermerke.get(r.kundeId) ?? []), text])
        } else {
          const alt = verbindlichkeiten.get(z.id) ?? state.verbindlichkeiten.find((x) => x.id === z.id)
          if (!alt || alt.status === 'bezahlt') {
            uebersprungen.push(`${z.name} (schon bezahlt)`)
            continue
          }
          const patch: Partial<Verbindlichkeit> = { status: 'bezahlt', bezahltAm: v.buchung.datum, notiz: verbindlichkeitNotiz(alt.notiz, v) }
          dispatch({ type: 'UPDATE_VERBINDLICHKEIT', id: alt.id, patch })
          verbindlichkeiten.set(alt.id, { ...alt, ...patch })
          verb++
        }
      }
    }
    // Ein Verlaufseintrag je Zahlung, je Akte in einem Schritt (sonst überschriebe der zweite den ersten).
    for (const [kundeId, texte] of vermerke) {
      const akte = findeAkte(state, kundeId)
      if (!akte) continue
      const neu: ActivityEntry[] = texte.map((text) => ({ id: uid('act'), date: today(), text, user: nutzer.name })).reverse()
      dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: akte.bereich, id: akte.kunde.id, patch: { letzteAktivitaet: today(), activities: [...neu, ...(akte.kunde.activities ?? [])] } })
    }
    const teile = [
      zahlungen ? `${zahlungen} ${zahlungen === 1 ? 'Zahlung' : 'Zahlungen'} erfasst${bezahlt ? ` (${bezahlt} ${bezahlt === 1 ? 'Rechnung' : 'Rechnungen'} damit bezahlt)` : ''}` : '',
      verb ? `${verb} ${verb === 1 ? 'Verbindlichkeit' : 'Verbindlichkeiten'} als bezahlt markiert` : '',
    ].filter(Boolean)
    setMeldung(`${teile.join(', ') || 'Nichts gebucht'}.${uebersprungen.length ? ` Übersprungen: ${uebersprungen.join(', ')}.` : ''}`)
    setAuswahl(new Set())
  }

  const vorschlaege = ergebnis?.vorschlaege ?? []
  const summeAuswahl = vorschlaege.filter((v) => auswahl.has(v.id)).length

  return (
    <Modal
      open
      onClose={onClose}
      title="Kontoauszug abgleichen"
      width="max-w-4xl"
      aktionen={
        vorschlaege.length > 0 && !nutzer.nurLesen ? (
          <PrimaryButton onClick={buchen} disabled={summeAuswahl === 0}>
            <CheckCircle2 size={15} /> Ausgewählte buchen{summeAuswahl ? ` (${summeAuswahl})` : ''}
          </PrimaryButton>
        ) : undefined
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input ref={eingabe} type="file" accept=".pdf,.csv,.txt,image/jpeg,image/png,image/webp,application/pdf,text/csv" className="hidden" onChange={(e) => waehleDatei(e.target.files?.[0])} />
        <SecondaryButton onClick={() => eingabe.current?.click()} disabled={liest}>
          {liest ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {auszug ? 'Anderen Auszug wählen' : 'Kontoauszug wählen'}
        </SecondaryButton>
        <span className="text-xs text-slate-500">PDF, Foto oder CSV-Export der Bank. Bei PDFs dauert das Lesen bis zu zwei Minuten; CSV geht sofort.</span>
      </div>

      {liest && <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Der Auszug wird gelesen …</p>}
      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
      {meldung && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{meldung}</p>}

      {auszug && ergebnis && (
        <>
          <p className="mb-1 text-sm text-slate-600">
            <span className="font-medium text-slate-800">{auszug.name}</span>
            {auszug.bank ? `, ${auszug.bank}` : ''}
            {auszug.von || auszug.bis ? ` (${auszug.von ? fmtDate(auszug.von) : '?'} – ${auszug.bis ? fmtDate(auszug.bis) : '?'})` : ''}: {auszug.buchungen.length} Buchungen, {vorschlaege.length} Vorschläge
            {ergebnis.schonGebucht.length ? `, ${ergebnis.schonGebucht.length} schon gebucht` : ''}.
          </p>
          {auszug.hinweis && (
            <p className="mb-3 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {auszug.hinweis}
            </p>
          )}
          <p className="mb-3 text-xs text-slate-500">Nur „Sicher“ ist vorausgewählt. Bitte die übrigen Vorschläge prüfen, bevor sie angehakt werden.</p>

          {vorschlaege.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">Keine Buchung passt zu einer offenen Rechnung oder Verbindlichkeit.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {vorschlaege.map((v) => (
                <VorschlagZeile key={v.id} v={v} an={auswahl.has(v.id)} onUmschalten={() => umschalten(v.id)} gesperrt={nutzer.nurLesen} />
              ))}
            </ul>
          )}

          {(ergebnis.schonGebucht.length > 0 || ergebnis.ohneTreffer.length > 0) && (
            <div className="mt-4">
              <button type="button" onClick={() => setZeigeRest((x) => !x)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800">
                {zeigeRest ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Übrige Buchungen ({ergebnis.schonGebucht.length} schon gebucht, {ergebnis.ohneTreffer.length} ohne passenden offenen Posten)
              </button>
              {zeigeRest && (
                <ul className="mt-2 space-y-1 text-xs text-slate-600">
                  {ergebnis.schonGebucht.map((x) => (
                    <li key={x.buchung.id} className="flex flex-wrap gap-x-2">
                      <BuchungKurz b={x.buchung} /> <span className="text-emerald-700">— {x.wo}</span>
                    </li>
                  ))}
                  {ergebnis.ohneTreffer.map((x) => (
                    <li key={x.buchung.id} className="flex flex-wrap gap-x-2">
                      <BuchungKurz b={x.buchung} /> <span className="text-slate-400">— {x.grund}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function BuchungKurz({ b }: { b: AbgleichBuchung }) {
  return (
    <span>
      {fmtDate(b.datum)} · <span className={b.betrag > 0 ? 'text-emerald-700' : 'text-slate-700'}>{b.betrag > 0 ? '+' : ''}{fmtEURCent(b.betrag)}</span>
      {b.gegenName ? ` · ${b.gegenName}` : ''}
      {b.verwendungszweck ? ` · ${b.verwendungszweck.slice(0, 80)}` : ''}
    </span>
  )
}

function VorschlagZeile({ v, an, onUmschalten, gesperrt }: { v: AbgleichVorschlag; an: boolean; onUmschalten: () => void; gesperrt: boolean }) {
  return (
    <li className={`flex gap-3 px-3 py-2.5 ${an ? 'bg-accent-50/40' : ''}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={an} onChange={onUmschalten} disabled={gesperrt} aria-label="Vorschlag buchen" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="whitespace-nowrap text-slate-500">{fmtDate(v.buchung.datum)}</span>
          <span className={`whitespace-nowrap font-semibold ${v.buchung.betrag > 0 ? 'text-emerald-700' : 'text-slate-800'}`}>
            {v.buchung.betrag > 0 ? '+' : ''}
            {fmtEURCent(v.buchung.betrag)}
          </span>
          <span className="min-w-0 truncate text-slate-700">{v.buchung.gegenName || 'ohne Namen'}</span>
          <StatusBadge label={SICHERHEIT_TEXT[v.sicherheit]} color={SICHERHEIT_FARBE[v.sicherheit]} />
          {v.skonto && <StatusBadge label="Skonto" color="bg-violet-50 text-violet-700" />}
        </div>
        {v.buchung.verwendungszweck && <div className="truncate text-xs text-slate-400">{v.buchung.verwendungszweck}</div>}
        <div className="mt-1 text-sm text-slate-700">
          →{' '}
          {v.ziele.map((z, i) => (
            <span key={z.id}>
              {i > 0 && ' + '}
              {z.art === 'rechnung' ? (
                <>
                  Rechnung <span className="font-medium">{z.nummer}</span> ({z.name}) {fmtEURCent(z.betrag)}
                  {z.vollstaendig ? ' – danach bezahlt' : ` – Teilzahlung, offen bleiben ${fmtEURCent(Math.max(0, z.offenVorher - z.betrag))}`}
                </>
              ) : (
                <>
                  Verbindlichkeit <span className="font-medium">{z.name}</span>
                  {z.nummer ? ` (${z.nummer})` : ''} – als bezahlt markieren
                </>
              )}
            </span>
          ))}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">{v.grund}</div>
        {v.hinweis && (
          <div className="mt-0.5 flex items-start gap-1 text-xs text-amber-700">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {v.hinweis}
          </div>
        )}
      </div>
    </li>
  )
}
