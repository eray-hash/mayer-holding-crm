import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BarChart3, Download, FileSpreadsheet, LayoutTemplate, RefreshCw, Upload } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Card, EmptyState, inputClass } from '../../components/ui'
import { supabase } from '../../lib/supabaseClient'
import { today } from '../../lib/dates'
import { bereinige, berechnePivot, ergebnisInEuro, filterInWorten, wertBeschriftung } from '../../lib/pivot'
import type { Einstellung, Feld } from '../../lib/pivot'
import { baueAuswertungsMappe, ladeMappeHerunter } from '../../lib/pivotExport'
import { leseTabellenDatei, type GeleseneTabelle } from '../../lib/tabellenDatei'
import { QUELLEN, abhaengigkeiten, baueQuelle, type KontoauszugZeile, type QuelleId, type Zusatzdaten } from './quellen'
import { Baukasten } from './Baukasten'
import { DetailListe, ErgebnisTabelle, type Auswahl } from './ErgebnisTabelle'

// Seite „Auswertungen": Kreuztabellen über CRM-Daten und eigene Excel-/CSV-Dateien. Für alle
// Mitarbeiter — sichtbar ist nur, was der App-Zustand enthält (die Datenbank liefert nur freigegebene
// Bereiche), Kontoauszüge kommen mit den Rechten des Angemeldeten aus der Datenbank. Gerechnet wird
// im Browser; nichts wird gespeichert außer der letzten Einstellung je Quelle (im Browser).

const SPEICHER = 'mh-auswertungen-v1'

function lies<T>(schluessel: string): T | undefined {
  try {
    const roh = window.localStorage.getItem(`${SPEICHER}:${schluessel}`)
    return roh ? (JSON.parse(roh) as T) : undefined
  } catch {
    return undefined
  }
}

function schreibe(schluessel: string, wert: unknown) {
  try {
    window.localStorage.setItem(`${SPEICHER}:${schluessel}`, JSON.stringify(wert))
  } catch {
    // Ohne Browser-Speicher (privates Fenster o. Ä.) wird die Einstellung nur nicht gemerkt.
  }
}

type Konto = { stand: 'nie' | 'fertig' | 'fehler'; zeilen: KontoauszugZeile[]; fehler?: string }
type Datei = { name: string; tabellen: GeleseneTabelle[]; blatt: number }

const LEERE_EINSTELLUNG: Einstellung = { zeilen: [], spalten: [], berechnung: 'anzahl', filter: [] }

export function Auswertungen() {
  const { state } = useApp()
  const [quelle, setQuelle] = useState<QuelleId>(() => {
    const q = lies<QuelleId>('quelle')
    return q && QUELLEN.some((x) => x.id === q) && q !== 'datei' ? q : 'kunden'
  })
  const [konto, setKonto] = useState<Konto>({ stand: 'nie', zeilen: [] })
  const [datei, setDatei] = useState<Datei | null>(null)
  const [dateiFehler, setDateiFehler] = useState<string | null>(null)
  const [dateiLaedt, setDateiLaedt] = useState(false)
  const [einstellungen, setEinstellungen] = useState<Record<string, Einstellung>>({})
  const [auswahl, setAuswahl] = useState<Auswahl | null>(null)

  // ── Kontoauszüge: erst laden, wenn die Quelle gewählt wird (mit den Rechten des Angemeldeten) ──
  useEffect(() => {
    if (quelle !== 'kontoauszuege' || konto.stand !== 'nie' || !supabase) return
    let abgebrochen = false
    supabase
      .from('kontoauszug_auswertungen')
      .select('id, kunde_id, bereich, titel, erstellt_am, buchungen')
      .order('erstellt_am', { ascending: false })
      .then(({ data, error }) => {
        if (abgebrochen) return
        if (error) setKonto({ stand: 'fehler', zeilen: [], fehler: `Die Kontoauszüge konnten nicht geladen werden: ${error.message}` })
        else setKonto({ stand: 'fertig', zeilen: (data ?? []) as KontoauszugZeile[] })
      })
    return () => {
      abgebrochen = true
    }
  }, [quelle, konto.stand])
  const kontoFehler = !supabase ? 'Ohne Verbindung zur Datenbank gibt es keine gespeicherten Kontoauszüge.' : konto.stand === 'fehler' ? konto.fehler : undefined

  const tabelle = datei ? datei.tabellen[datei.blatt] : undefined
  const zusatz: Zusatzdaten = useMemo(() => ({ kontoauszuege: konto.zeilen, datei: tabelle ? { felder: tabelle.felder, daten: tabelle.daten } : undefined }), [konto.zeilen, tabelle])
  // Neu gerechnet wird nur, wenn sich die Teile des Zustands ändern, die diese Quelle liest (höchstens zehn).
  const [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9] = abhaengigkeiten(quelle, state, zusatz)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const qd = useMemo(() => baueQuelle(quelle, state, zusatz), [quelle, d0, d1, d2, d3, d4, d5, d6, d7, d8, d9])

  // Gemerkt wird je Quelle; bei eigenen Dateien je Spaltenaufbau, damit eine andere Datei nicht die
  // Einstellung einer fremden erbt.
  const speicherSchluessel = quelle === 'datei' ? `datei:${qd.felder.map((f) => f.label).join('|').slice(0, 400)}` : quelle
  const gemerkt = useMemo(() => lies<Einstellung>(speicherSchluessel), [speicherSchluessel])
  const roh = einstellungen[speicherSchluessel] ?? gemerkt ?? qd.vorlagen[0]?.einstellung ?? LEERE_EINSTELLUNG
  const einstellung = useMemo(() => bereinige(roh, qd.felder), [roh, qd.felder])
  const verzoegert = useDeferredValue(einstellung)
  const ergebnis = useMemo(() => berechnePivot(qd.daten, qd.felder, verzoegert, qd.hauptdatum), [qd, verzoegert])
  const euro = ergebnisInEuro(verzoegert, qd.felder)

  // Die angeklickte Zelle gilt nur für dieses Ergebnis.
  const [auswahlFuer, setAuswahlFuer] = useState(ergebnis)
  if (auswahlFuer !== ergebnis) {
    setAuswahlFuer(ergebnis)
    if (auswahl) setAuswahl(null)
  }

  function aendere(neu: Einstellung) {
    setEinstellungen((alt) => ({ ...alt, [speicherSchluessel]: neu }))
    schreibe(speicherSchluessel, neu)
  }

  function waehleQuelle(q: QuelleId) {
    setQuelle(q)
    setAuswahl(null)
    if (q !== 'datei') schreibe('quelle', q)
  }

  async function dateiGewaehlt(file: File | undefined) {
    if (!file) return
    setDateiFehler(null)
    setDateiLaedt(true)
    try {
      const tabellen = leseTabellenDatei(await file.arrayBuffer(), file.name)
      if (!tabellen.length) {
        setDateiFehler('In der Datei wurde keine Tabelle gefunden.')
        setDatei(null)
      } else {
        setDatei({ name: file.name, tabellen, blatt: 0 })
      }
    } catch {
      setDateiFehler('Die Datei konnte nicht gelesen werden. Bitte eine Excel-Datei (.xlsx, .xls) oder eine CSV-Datei wählen.')
      setDatei(null)
    } finally {
      setDateiLaedt(false)
    }
  }

  // Spalten für die Liste unter einer Zelle und für das Blatt „Daten".
  const datenFelder: Feld[] = useMemo(() => {
    const ids = new Set<string>(qd.kernFelder)
    for (const w of [...verzoegert.zeilen, ...verzoegert.spalten]) ids.add(w.feld)
    if (verzoegert.berechnung !== 'anzahl' && verzoegert.wert) ids.add(verzoegert.wert)
    for (const f of verzoegert.filter) ids.add(f.feld)
    if (qd.hauptdatum) ids.add(qd.hauptdatum)
    const kern = qd.kernFelder.map((id) => qd.felder.find((f) => f.id === id)).filter((f): f is Feld => !!f)
    return [...kern, ...qd.felder.filter((f) => ids.has(f.id) && !qd.kernFelder.includes(f.id))]
  }, [qd, verzoegert])

  function exportiere() {
    const q = QUELLEN.find((x) => x.id === quelle)!
    const name = quelle === 'datei' && datei ? `${q.label} „${datei.name}“` : q.label
    const wb = baueAuswertungsMappe({
      quelle: name,
      felder: qd.felder,
      einstellung: verzoegert,
      ergebnis,
      filterText: filterInWorten(verzoegert, qd.felder, qd.daten, qd.hauptdatum),
      datenFelder,
      erstellt: new Date(),
    })
    const datei_ = `Auswertung ${q.label} ${today()}.xlsx`.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_')
    ladeMappeHerunter(wb, datei_)
  }

  const quelleInfo = QUELLEN.find((x) => x.id === quelle)!
  const laedt = quelle === 'kontoauszuege' && konto.stand === 'nie' && !kontoFehler
  const ohneDaten = !laedt && !(quelle === 'kontoauszuege' && kontoFehler) && qd.daten.length === 0

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800">
          <BarChart3 size={20} className="text-accent-600" /> Auswertungen
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Daten nach Belieben zusammenfassen – wie eine Pivottabelle in Excel. Du siehst nur, was du auch sonst im CRM sehen darfst. Gerechnet wird in deinem Browser.
        </p>
      </div>

      {/* Quelle */}
      <Card className="p-4">
        <span className="mb-2 block text-xs font-medium text-slate-500">Was möchtest du auswerten?</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Quelle">
          {QUELLEN.map((q) => (
            <button
              key={q.id}
              type="button"
              role="radio"
              aria-checked={quelle === q.id}
              onClick={() => waehleQuelle(q.id)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                quelle === q.id ? 'border-accent-300 bg-accent-50 text-accent-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {quelleInfo.beschreibung}
          {!laedt && qd.felder.length > 0 && ` ${qd.daten.length.toLocaleString('de-DE')} ${qd.daten.length === 1 ? 'Datensatz' : 'Datensätze'}.`}
        </p>

        {quelle === 'kontoauszuege' && konto.stand === 'fertig' && (
          <button type="button" onClick={() => setKonto({ stand: 'nie', zeilen: [] })} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-600 hover:underline">
            <RefreshCw size={12} /> Neu laden
          </button>
        )}

        {quelle === 'datei' && (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Upload size={14} /> {datei ? 'Andere Datei wählen' : 'Datei wählen'}
                <input
                  type="file"
                  className="sr-only"
                  accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={(ev) => {
                    void dateiGewaehlt(ev.target.files?.[0])
                    ev.target.value = ''
                  }}
                />
              </label>
              {datei && (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-slate-600">
                  <FileSpreadsheet size={14} className="flex-none text-emerald-600" />
                  <span className="truncate">{datei.name}</span>
                </span>
              )}
              {dateiLaedt && <span className="text-sm text-slate-400">Wird gelesen …</span>}
            </div>
            {datei && datei.tabellen.length > 1 && (
              <label className="block max-w-xs">
                <span className="mb-1 block text-xs font-medium text-slate-500">Tabellenblatt</span>
                <select className={inputClass} value={datei.blatt} onChange={(ev) => setDatei({ ...datei, blatt: Number(ev.target.value) })}>
                  {datei.tabellen.map((t, i) => (
                    <option key={i} value={i}>
                      {t.blatt}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tabelle && (
              <p className="text-xs text-slate-500">
                Überschriften aus Zeile {tabelle.kopfZeile}. Erkannt: {tabelle.felder.map((f) => `${f.label} (${f.typ === 'zahl' ? (f.euro ? 'Betrag' : 'Zahl') : f.typ === 'datum' ? 'Datum' : 'Text'})`).join(', ')}.
              </p>
            )}
            {dateiFehler && <p className="text-sm text-rose-600">{dateiFehler}</p>}
          </div>
        )}
      </Card>

      {laedt && <EmptyState text="Kontoauszüge werden geladen …" />}
      {quelle === 'kontoauszuege' && kontoFehler && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{kontoFehler}</p>}
      {ohneDaten && (
        <EmptyState
          text={
            quelle === 'datei'
              ? datei
                ? 'Dieses Tabellenblatt enthält unter der Überschrift keine Daten.'
                : 'Wähle oben eine Excel- oder CSV-Datei. Sie bleibt auf deinem Gerät.'
              : quelle === 'kontoauszuege'
                ? 'Es gibt noch keine gespeicherten Kontoauszug-Auswertungen, die du sehen darfst.'
                : 'In dieser Quelle gibt es keine Daten, die du sehen darfst.'
          }
        />
      )}

      {!laedt && !ohneDaten && !(quelle === 'kontoauszuege' && kontoFehler) && (
        <>
          {qd.vorlagen.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                <LayoutTemplate size={13} /> Vorlagen:
              </span>
              {qd.vorlagen.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => aendere(v.einstellung)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}

          <Card className="p-4">
            <Baukasten felder={qd.felder} daten={qd.daten} hauptdatum={qd.hauptdatum} einstellung={einstellung} onChange={aendere} />
          </Card>

          <Card className="min-w-0 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-700">{wertBeschriftung(verzoegert, qd.felder)}</h2>
                <p className="text-xs text-slate-500">
                  {ergebnis.datensaetze.length.toLocaleString('de-DE')} von {qd.daten.length.toLocaleString('de-DE')} Datensätzen
                  {ergebnis.datensaetze.length > 0 ? ' · Auf eine Zahl tippen zeigt die Datensätze dazu.' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={exportiere}
                disabled={ergebnis.datensaetze.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Download size={14} /> Als Excel-Datei
              </button>
            </div>

            {ergebnis.datensaetze.length === 0 ? (
              <EmptyState text="Mit diesen Filtern bleibt nichts übrig." />
            ) : (
              <ErgebnisTabelle ergebnis={ergebnis} einstellung={verzoegert} felder={qd.felder} euro={euro} auswahl={auswahl} onAuswahl={setAuswahl} />
            )}
            {auswahl && (
              <DetailListe ergebnis={ergebnis} auswahl={auswahl} felder={qd.felder} spaltenIds={datenFelder.map((f) => f.id)} onClose={() => setAuswahl(null)} />
            )}
            <p className="mt-3 text-xs text-slate-400">Die Tabelle lässt sich in Excel über Einfügen → PivotTable weiter auswerten (Blatt „Daten“).</p>
          </Card>
        </>
      )}
    </div>
  )
}
