// Seite „Umsatzziele“ (/ziele, 24.11.2026, Wunsch der Geschäftsführung): Monatsziel (Vorgabe 50.000 € netto:
// KI 10.000, Immobilien 15.000, Beratung & Privat 25.000) gegen das Ist — täglich, nicht erst am Monatsende.
// Gesamtstand, Balken je Sparte, Soll bis heute mit Rückstand/Vorsprung, Hochrechnung, nötiger Umsatz je Werktag,
// Trichter je Sparte bzw. Abteilung (?bereich=…) und — für die Geschäftsführung — das Soll ändern.
// Die Zahlen rechnet der Server (lib/umsatzziele.ts → email-gateway/umsatzZiel.ts → _shared/umsatzZielKern.ts).
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pencil, Target } from 'lucide-react'
import { Card, EmptyState, inputClass, PrimaryButton, SecondaryButton } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { today } from '../../lib/dates'
import {
  AKTEN_BEREICH_NAME, ladeUmsatzziel, speichereSoll,
  type SpartenStand, type Trichter, type UmsatzzielAntwort, type Werte,
} from '../../lib/umsatzziele'
import { monatName, monatVon, plusMonate } from '../../lib/umsatzvorschau'

const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const quote = (q: number | undefined) => (q === undefined ? '–' : `${Math.round(q * 100)} %`)

function Balken({ w, gross = false }: { w: Werte; gross?: boolean }) {
  const basis = Math.max(w.soll, w.hochrechnung, 1)
  const teil = (n: number) => `${Math.max(0, Math.min(100, (n / basis) * 100))}%`
  const h = gross ? 'h-5' : 'h-3'
  return (
    <div>
      <div className={`relative ${h} overflow-hidden rounded-full bg-slate-100`} role="img" aria-label={`Ist ${euro(w.bezahlt)}, offen ${euro(w.offen)}, erwartet ${euro(w.erwartet)}, Soll ${euro(w.soll)}`}>
        <div className="absolute inset-y-0 left-0 bg-accent-600" style={{ width: teil(w.bezahlt) }} />
        <div className="absolute inset-y-0 bg-accent-300" style={{ left: teil(w.bezahlt), width: teil(w.offen) }} />
        <div className="absolute inset-y-0 bg-amber-300" style={{ left: teil(w.bezahlt + w.offen), width: teil(w.erwartet) }} />
        {w.sollBisHeute > 0 && w.sollBisHeute < w.soll && <div className="absolute inset-y-0 w-0.5 bg-slate-800" style={{ left: teil(w.sollBisHeute) }} title={`Soll bis heute ${euro(w.sollBisHeute)}`} />}
        {w.soll < basis && <div className="absolute inset-y-0 w-0.5 bg-rose-600" style={{ left: teil(w.soll) }} title={`Soll ${euro(w.soll)}`} />}
      </div>
    </div>
  )
}

function Legende() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent-600" /> Ist (bezahlt)</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent-300" /> Rechnung gestellt, offen</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" /> erwartet (Angebote × Chance, Provision)</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-slate-800" /> Soll bis heute</span>
    </div>
  )
}

function Abstand({ w, lage }: { w: Werte; lage: string }) {
  if (lage === 'kommend') return <span className="text-slate-500">Monat hat noch nicht begonnen</span>
  if (w.abstand < 0) return <span className="font-medium text-rose-700">Rückstand {euro(-w.abstand)}</span>
  return <span className="font-medium text-emerald-700">Vorsprung {euro(w.abstand)}</span>
}

function SpartenKarte({ s, lage, darfAendern, tabellenDa, onSpeichern }: { s: SpartenStand; lage: string; darfAendern: boolean; tabellenDa: boolean; onSpeichern: (sparte: string, betrag: number) => Promise<void> }) {
  const [bearbeiten, setBearbeiten] = useState(false)
  const [wert, setWert] = useState(String(s.soll))
  const [fehler, setFehler] = useState('')
  const [laeuft, setLaeuft] = useState(false)
  useEffect(() => setWert(String(s.soll)), [s.soll])
  const speichern = async () => {
    const betrag = Number(wert.replace(/\./g, '').replace(',', '.'))
    setLaeuft(true)
    setFehler('')
    try {
      await onSpeichern(s.sparte, betrag)
      setBearbeiten(false)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Nicht gespeichert.')
    } finally {
      setLaeuft(false)
    }
  }
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{s.name}</h3>
          <div className="mt-0.5 text-2xl font-semibold text-slate-900">{s.prozent} %</div>
        </div>
        {darfAendern && tabellenDa && !bearbeiten && (
          <button onClick={() => setBearbeiten(true)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" title="Soll dieser Sparte für diesen Monat ändern">
            <Pencil size={13} /> Soll ändern
          </button>
        )}
      </div>
      <div className="mt-1 text-sm text-slate-600">{euro(s.bezahlt)} von {euro(s.soll)}{s.sollAusVorgabe ? <span className="text-xs text-slate-400"> (Vorgabe)</span> : null}</div>
      <div className="mt-2"><Balken w={s} /></div>
      {bearbeiten && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input className={`${inputClass} max-w-[9rem]`} inputMode="decimal" value={wert} onChange={(e) => setWert(e.target.value)} aria-label={`Soll ${s.name} in Euro`} />
          <PrimaryButton onClick={speichern} disabled={laeuft}>Speichern</PrimaryButton>
          <SecondaryButton onClick={() => { setBearbeiten(false); setWert(String(s.soll)) }}>Abbrechen</SecondaryButton>
          {fehler && <div className="w-full text-xs text-rose-700">{fehler}</div>}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Offen (Rechnung gestellt)</dt><dd className="text-right text-slate-700">{euro(s.offen)}</dd>
        <dt className="text-slate-500">Erwartet</dt><dd className="text-right text-slate-700">{euro(s.erwartet)}</dd>
        <dt className="text-slate-500">Hochrechnung</dt><dd className="text-right font-medium text-slate-800">{euro(s.hochrechnung)}</dd>
        {lage === 'laufend' && (<><dt className="text-slate-500">Soll bis heute</dt><dd className="text-right text-slate-700">{euro(s.sollBisHeute)}</dd></>)}
        {lage === 'laufend' && (<><dt className="text-slate-500">Nötig je Werktag</dt><dd className="text-right text-slate-700">{euro(s.noetigProWerktag)}</dd></>)}
      </dl>
      <div className="mt-2 text-xs"><Abstand w={s} lage={lage} /></div>
      {s.hinweis && <div className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">{s.hinweis}</div>}
      {s.geaendertVon && !s.sollAusVorgabe && <div className="mt-2 text-[11px] text-slate-400">Soll zuletzt: {s.geaendertVon}</div>}
    </Card>
  )
}

function TrichterAnsicht({ t }: { t: Trichter }) {
  const max = Math.max(1, ...t.basis.stufen.map((s) => s.anzahl), ...t.monatZahlen.stufen.map((s) => s.anzahl))
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{monatName(t.monat)}</h4>
          <ol className="space-y-1.5">
            {t.monatZahlen.stufen.map((s, i) => (
              <li key={s.id}>
                <div className="flex justify-between text-sm"><span className="text-slate-700">{s.name}</span><span className="font-medium text-slate-900">{s.anzahl}{i > 0 && s.quote !== undefined ? <span className="ml-1 text-xs font-normal text-slate-400">({quote(s.quote)})</span> : null}</span></div>
                <div className="mt-0.5 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-accent-500" style={{ width: `${(s.anzahl / max) * 100}%` }} /></div>
              </li>
            ))}
          </ol>
          <div className="mt-2 text-sm text-slate-600">Verloren: <span className="font-medium">{t.monatZahlen.verloren}</span>{t.monatZahlen.neueInvestoren !== undefined && <> · Neue Investoren: <span className="font-medium">{t.monatZahlen.neueInvestoren}</span></>}</div>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Letzte {t.basis.monate} Monate</h4>
          <table className="w-full text-sm">
            <tbody>
              {t.basis.stufen.map((s, i) => (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 text-slate-700">{s.name}</td>
                  <td className="py-1 text-right font-medium text-slate-900">{s.anzahl}</td>
                  <td className="py-1 pl-2 text-right text-xs text-slate-400">{i > 0 ? quote(s.quote) : ''}</td>
                </tr>
              ))}
              <tr><td className="py-1 text-slate-700">Verloren</td><td className="py-1 text-right font-medium text-slate-900">{t.basis.verloren}</td><td className="py-1 pl-2 text-right text-xs text-slate-400" title="verloren ÷ (verloren + Aufträge)">{t.basis.verlustquote !== undefined ? `${quote(t.basis.verlustquote)} Verlust` : ''}</td></tr>
              {t.basis.neueInvestoren !== undefined && <tr><td className="py-1 text-slate-700">Neue Investoren</td><td className="py-1 text-right font-medium text-slate-900">{t.basis.neueInvestoren}</td><td /></tr>}
            </tbody>
          </table>
          <div className="mt-2 text-sm text-slate-600">Ø Auftragswert: <span className="font-medium">{t.basis.durchschnittAuftrag ? euro(t.basis.durchschnittAuftrag) : '–'}</span></div>
        </div>
      </div>
      {t.leadsNoetig !== undefined ? (
        <div className="mt-3 rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-900">
          Für das Soll von {euro(t.soll ?? 0)} brauchen wir rund <span className="font-semibold">{t.leadsNoetig} Leads</span> im Monat (Soll ÷ (Ø Auftragswert × Abschlussquote {quote(t.basis.abschlussquote)})).
        </div>
      ) : t.hinweis ? (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{t.hinweis}</div>
      ) : null}
    </div>
  )
}

export function Umsatzziele() {
  const [params, setParams] = useSearchParams()
  const { mitarbeiter, echterMitarbeiter, ansichtAls } = useAuth()
  const aktuell = monatVon(today())!
  const monat = /^\d{4}-\d{2}$/.test(params.get('monat') ?? '') ? params.get('monat')! : aktuell
  const bereich = params.get('bereich') && params.get('bereich') !== 'privat' ? params.get('bereich')! : undefined
  const [antwort, setAntwort] = useState<UmsatzzielAntwort | null>(null)
  const [fehler, setFehler] = useState('')
  const [laden, setLaden] = useState(true)
  const [reiter, setReiter] = useState<string>('')

  const holen = (frisch = false) => {
    setLaden(true)
    setFehler('')
    ladeUmsatzziel({ monat, bereich }, frisch)
      .then((a) => setAntwort(a))
      .catch((e) => setFehler(e instanceof Error ? e.message : 'Umsatzziel ließ sich nicht laden.'))
      .finally(() => setLaden(false))
  }
  useEffect(() => holen(), [monat, bereich]) // eslint-disable-line react-hooks/exhaustive-deps

  const setze = (neu: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(neu)) if (v) p.set(k, v); else p.delete(k)
    setParams(p, { replace: true })
  }

  const u = antwort?.uebersicht
  const trichterListe = useMemo(() => {
    if (!u) return [] as { id: string; name: string; t: Trichter }[]
    const l = u.trichter.map((x) => ({ id: x.sparte, name: x.trichter.name, t: x.trichter }))
    if (u.bereich) l.unshift({ id: `b:${u.bereich.bereich}`, name: AKTEN_BEREICH_NAME[u.bereich.bereich] ?? u.bereich.bereich, t: u.bereich.trichter })
    return l
  }, [u])
  const aktiverReiter = trichterListe.find((x) => x.id === reiter) ?? trichterListe[0]
  const darfAendern = !!antwort?.darfAendern && !ansichtAls
  const wer = echterMitarbeiter?.name ?? mitarbeiter?.name ?? 'CRM'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="text-accent-600" size={22} />
          <h1 className="text-xl font-semibold text-slate-800">Umsatzziele</h1>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setze({ monat: plusMonate(monat, -1) })} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Voriger Monat"><ChevronLeft size={16} /></button>
          <span className="min-w-[9rem] text-center text-sm font-medium text-slate-700">{monatName(monat)}</span>
          <button onClick={() => setze({ monat: plusMonate(monat, 1) })} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Nächster Monat"><ChevronRight size={16} /></button>
          {monat !== aktuell && <SecondaryButton onClick={() => setze({ monat: undefined })} className="ml-1">Heute</SecondaryButton>}
        </div>
      </div>

      {fehler && <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{fehler}</Card>}
      {!u && laden && <EmptyState text="Umsatzziel wird berechnet …" />}

      {u && (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-sm text-slate-500">Ist (bezahlt) {u.stand.lage === 'laufend' ? `bis heute, Tag ${u.stand.vergangeneTage} von ${u.stand.tageImMonat}` : u.stand.lage === 'vorbei' ? '— Monat abgeschlossen' : '— Monat kommt noch'}</div>
                <div className="text-3xl font-semibold text-slate-900">{euro(u.stand.gesamt.bezahlt)} <span className="text-lg font-normal text-slate-500">von {euro(u.stand.gesamt.soll)}</span></div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-semibold text-accent-700">{u.stand.gesamt.prozent} %</div>
                <div className="text-sm"><Abstand w={u.stand.gesamt} lage={u.stand.lage} /></div>
              </div>
            </div>
            <div className="mt-3"><Balken w={u.stand.gesamt} gross /></div>
            <div className="mt-2"><Legende /></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-slate-500">Mit offenen Rechnungen</div><div className="font-medium text-slate-800">{euro(u.stand.gesamt.istPlusOffen)}</div></div>
              <div><div className="text-xs text-slate-500">Hochrechnung Monatsende</div><div className="font-medium text-slate-800">{euro(u.stand.gesamt.hochrechnung)} ({u.stand.gesamt.prozentHochrechnung} %)</div></div>
              <div><div className="text-xs text-slate-500">Soll bis heute</div><div className="font-medium text-slate-800">{euro(u.stand.gesamt.sollBisHeute)}</div></div>
              <div><div className="text-xs text-slate-500">Nötig je Werktag</div><div className="font-medium text-slate-800">{u.stand.verbleibendeWerktage > 0 ? `${euro(u.stand.gesamt.noetigProWerktag)} (${u.stand.verbleibendeWerktage} Werktage)` : '–'}</div></div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            {u.stand.sparten.map((s) => (
              <SpartenKarte key={s.sparte} s={s} lage={u.stand.lage} darfAendern={darfAendern} tabellenDa={!!antwort?.tabellenDa} onSpeichern={async (sparte, betrag) => { await speichereSoll(monat, sparte, betrag, wer); holen(true) }} />
            ))}
          </div>
          {darfAendern && !antwort?.tabellenDa && (
            <Card className="border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Die Tabellen für die Umsatzziele sind noch nicht eingerichtet — bis dahin gelten die Vorgaben (10.000 / 15.000 / 25.000 €), ändern lässt sich das Soll erst danach.</Card>
          )}

          <Card className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-800">Trichter: wie viele Leads brauchen wir?</h2>
              <div className="flex flex-wrap gap-1">
                {trichterListe.map((x) => (
                  <button key={x.id} onClick={() => setReiter(x.id)} className={`rounded-full px-3 py-1 text-xs font-medium ${aktiverReiter?.id === x.id ? 'bg-accent-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{x.name}</button>
                ))}
              </div>
            </div>
            {aktiverReiter ? <TrichterAnsicht t={aktiverReiter.t} /> : <EmptyState text="Kein Trichter." />}
          </Card>

          {darfAendern && antwort?.meldung && (
            <Card className="p-4 text-sm text-slate-600">
              <div className="mb-1 font-medium text-slate-700">So stünde es morgens in Telegram (Morgen-Übersicht der Geschäftsführung)</div>
              <div className="rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{antwort.meldung}</div>
              <div className="mt-2 text-xs">Ein- und ausschalten unter <Link to="/automatische-nachrichten" className="text-accent-600 hover:underline">Automatische Nachrichten</Link> („Umsatzziel in der Morgen-Übersicht“, Vorgabe aus).</div>
            </Card>
          )}

          <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">Wie wird gerechnet?</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Alle Beträge netto. Ist = Zahlungseingang im Monat (Teilzahlungen anteilig).</li>
              <li>Offen = Rechnungen mit Datum im Monat, verschickt, aber noch nicht (ganz) bezahlt.</li>
              <li>Erwartet = Rechnungsentwürfe, Angebote × Chance der Akte, geschätzter Umsatz der Akten × Chance und Immobilien-Provision nach Stand des Objekts — wie in der Umsatzvorschau.</li>
              <li>Soll bis heute = Soll × vergangene Tage ÷ Tage im Monat. Nötig je Werktag = (Soll − Ist − offen) ÷ verbleibende Werktage (Montag bis Freitag).</li>
              <li>Sparten: KI = Akten im Bereich KI (kommt noch); Immobilien = Immobilienkunden und Provisionen aus Objekten; Beratung &amp; Privat = alles andere. Das Soll gilt am Monatsanfang automatisch aus der Vorgabe und lässt sich je Monat ändern.</li>
              <li>Trichter: Leads = neue Akten (erster Verlaufseintrag), Erstgespräche = Akten mit Kundentermin oder Wechsel auf „Erstgespräch“, Angebote = Kostenvoranschläge, Aufträge = Auftragsstand, angenommener Kostenvoranschlag oder erste Rechnung. Hochgerechnet wird erst ab 5 Aufträgen in 12 Monaten.</li>
            </ul>
          </details>
        </>
      )}
    </div>
  )
}
