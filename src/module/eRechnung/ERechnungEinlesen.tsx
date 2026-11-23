// Modul E-Rechnung: Knopf „E-Rechnung einlesen“ auf der Seite Verbindlichkeiten. Datei wählen (.xml oder
// ZUGFeRD-PDF) → Angaben werden genau aus der Datei gelesen (ohne KI) → Vorschau → „Übernehmen“ legt die
// Verbindlichkeit an (wie „Neue Verbindlichkeit“) und speichert die Datei als Beleg (wie „Beleg hochladen“).
import { useRef, useState } from 'react'
import { AlertTriangle, FileInput } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Modal, PrimaryButton, SecondaryButton } from '../../components/ui'
import { fmtDate, fmtEURCent, today, uid } from '../../lib/dates'
import { ladeKundenDokumentHoch } from '../../lib/kundenDokumenteStorage'
import type { Verbindlichkeit } from '../../types'
import { useModulAktiv } from '../modulSchalter'
import { eRechnungKurz, eRechnungsXmlAusDatei, leseERechnung, MODUL_E_RECHNUNG, type ERechnungDaten, type ERechnungPartei } from './kern'

const gleich = (a?: string, b?: string) => (a ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === (b ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Schon vorhanden: gleiche Rechnungsnummer und gleicher Lieferant (Name oder E-Mail-Adresse). */
export function findeDoppelte(liste: Verbindlichkeit[], d: Pick<ERechnungDaten, 'verkaeufer' | 'nummer'>): Verbindlichkeit | undefined {
  if (!d.nummer.trim()) return undefined
  const mail = d.verkaeufer.email?.trim()
  return liste.find((v) => gleich(v.rechnungsnummer, d.nummer) && (gleich(v.lieferant, d.verkaeufer.name) || (!!mail && gleich(v.lieferantEmail, mail))))
}

const anschrift = (p: ERechnungPartei) => [p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')

export function ERechnungEinlesenKnopf({ nurLesen, onAngelegt }: { nurLesen: boolean; onAngelegt: (id: string) => void }) {
  const aktiv = useModulAktiv(MODUL_E_RECHNUNG)
  const { state, dispatch } = useApp()
  const dateiRef = useRef<HTMLInputElement>(null)
  const [liest, setLiest] = useState(false)
  const [datei, setDatei] = useState<File | null>(null)
  const [daten, setDaten] = useState<ERechnungDaten | null>(null)
  const [fehler, setFehler] = useState('')
  const [speichert, setSpeichert] = useState(false)
  if (!aktiv || nurLesen) return null

  function schliessen() {
    setDatei(null)
    setDaten(null)
    setFehler('')
    setSpeichert(false)
  }

  async function gewaehlt(f: File) {
    setFehler('')
    setDaten(null)
    setDatei(f)
    setLiest(true)
    try {
      const xml = await eRechnungsXmlAusDatei(new Uint8Array(await f.arrayBuffer()), f.name)
      if (!xml) {
        setFehler(
          /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
            ? 'In dieser PDF steckt keine E-Rechnung. Nur PDFs im Format ZUGFeRD bzw. Factur-X enthalten die Rechnungsangaben zum Einlesen. Eine gewöhnliche PDF bitte über „Neue Verbindlichkeit“ erfassen und als Beleg hochladen.'
            : 'Diese Datei ist keine E-Rechnung. Eingelesen werden XRechnung-Dateien (.xml) und ZUGFeRD-PDFs.',
        )
        return
      }
      setDaten(leseERechnung(xml))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Die Datei ließ sich nicht lesen.')
    } finally {
      setLiest(false)
      if (dateiRef.current) dateiRef.current.value = ''
    }
  }

  const doppelt = daten ? findeDoppelte(state.verbindlichkeiten, daten) : undefined

  async function uebernehmen() {
    if (!daten || !datei || doppelt) return
    setFehler('')
    setSpeichert(true)
    try {
      const { pfad } = await ladeKundenDokumentHoch('verbindlichkeiten', datei)
      const id = uid('verb')
      const neu: Verbindlichkeit = {
        id,
        status: 'offen',
        quelle: 'manuell',
        lieferant: daten.verkaeufer.name.trim() || 'Unbekannter Lieferant',
        lieferantEmail: daten.verkaeufer.email?.trim() || undefined,
        rechnungsnummer: daten.nummer.trim() || undefined,
        datum: daten.datum || today(),
        betragNetto: daten.netto,
        betragBrutto: daten.brutto,
        zahlungsziel: daten.faellig || undefined,
        notiz: eRechnungKurz(daten),
        geprueft: true,
        beleg: { name: datei.name, url: pfad, typ: datei.type || (/\.xml$/i.test(datei.name) ? 'application/xml' : undefined) },
      }
      dispatch({ type: 'ADD_VERBINDLICHKEIT', verbindlichkeit: neu })
      schliessen()
      onAngelegt(id)
    } catch (e) {
      setSpeichert(false)
      setFehler(`Die Datei ließ sich nicht als Beleg speichern${e instanceof Error && e.message ? ` (${e.message})` : ''}. Es wurde nichts angelegt — bitte noch einmal versuchen.`)
    }
  }

  const offen = !!datei && !liest

  return (
    <>
      <input ref={dateiRef} type="file" className="hidden" accept=".xml,.pdf,application/xml,text/xml,application/pdf" onChange={(e) => e.target.files?.[0] && gewaehlt(e.target.files[0])} />
      <SecondaryButton onClick={() => dateiRef.current?.click()} disabled={liest}>
        <FileInput size={15} /> {liest ? 'Wird gelesen …' : 'E-Rechnung einlesen'}
      </SecondaryButton>

      {offen && (
        <Modal open onClose={schliessen} title={daten ? `E-Rechnung von ${daten.verkaeufer.name || 'unbekanntem Absender'}` : 'E-Rechnung einlesen'} width="max-w-2xl">
          {!daten ? (
            <>
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>{fehler || 'Die Datei ließ sich nicht lesen.'}</span>
              </div>
              <div className="flex justify-end gap-2">
                <SecondaryButton onClick={schliessen}>Schließen</SecondaryButton>
                <PrimaryButton onClick={() => dateiRef.current?.click()}>Andere Datei wählen</PrimaryButton>
              </div>
            </>
          ) : (
            <Vorschau daten={daten} datei={datei} doppelt={doppelt} fehler={fehler} speichert={speichert} onUebernehmen={uebernehmen} onAbbrechen={schliessen} />
          )}
        </Modal>
      )}
    </>
  )
}

function Vorschau({
  daten,
  datei,
  doppelt,
  fehler,
  speichert,
  onUebernehmen,
  onAbbrechen,
}: {
  daten: ERechnungDaten
  datei: File
  doppelt?: Verbindlichkeit
  fehler: string
  speichert: boolean
  onUebernehmen: () => void
  onAbbrechen: () => void
}) {
  const v = daten.verkaeufer
  const fremdeWaehrung = daten.waehrung && daten.waehrung.toUpperCase() !== 'EUR'
  const betrag = (n: number) => (fremdeWaehrung ? `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${daten.waehrung}` : fmtEURCent(n))
  return (
    <>
      {daten.art === 'Gutschrift' && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Achtung, das ist eine Gutschrift</span> — keine Rechnung zum Bezahlen. Hier bekommt Mayer Holding Geld zurück bzw. verrechnet. Bitte prüfen, ob sie wirklich als Verbindlichkeit eingetragen werden soll.
          </span>
        </div>
      )}
      {fremdeWaehrung && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Die Beträge sind in {daten.waehrung}, nicht in Euro. Sie werden so übernommen, wie sie in der Rechnung stehen.</p>
      )}

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Lieferant</div>
          <div className="font-medium text-slate-800">{v.name || '–'}</div>
          {anschrift(v) && <div className="text-slate-600">{anschrift(v)}</div>}
          {v.email && <div className="text-slate-500">{v.email}</div>}
          {(v.ustId || v.steuernummer) && <div className="text-xs text-slate-400">{v.ustId ? `USt-IdNr. ${v.ustId}` : `Steuernummer ${v.steuernummer}`}</div>}
        </div>
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{daten.art}</div>
          <Zeile label="Nummer" wert={daten.nummer || '–'} />
          <Zeile label="Datum" wert={daten.datum ? fmtDate(daten.datum) : '–'} />
          <Zeile label="Fällig am" wert={daten.faellig ? fmtDate(daten.faellig) : 'nicht angegeben'} />
          <Zeile label="IBAN" wert={daten.iban || 'nicht angegeben'} />
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-slate-200 p-3 text-sm">
        <Zeile label="Netto" wert={betrag(daten.netto)} />
        <Zeile label="Umsatzsteuer" wert={betrag(daten.steuer)} />
        <Zeile label="Brutto" wert={betrag(daten.brutto)} fett />
        {Math.abs(daten.zahlbetrag - daten.brutto) > 0.005 && <Zeile label="Noch zu zahlen" wert={betrag(daten.zahlbetrag)} fett />}
        {daten.zahlungsbedingungen && <p className="mt-1 text-xs text-slate-500">{daten.zahlungsbedingungen}</p>}
      </div>

      {daten.positionen.length > 0 && (
        <div className="mb-3 rounded-lg border border-slate-200 p-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Positionen ({daten.positionen.length})</div>
          <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
            {daten.positionen.map((p, i) => (
              <div key={i} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="mr-1 text-slate-400">{i + 1}.</span>
                  <span className="text-slate-700">{p.bezeichnung || '–'}</span>
                  <div className="text-xs text-slate-400">
                    {p.menge.toLocaleString('de-DE')} {p.einheit} × {betrag(p.einzelpreis)}
                  </div>
                </div>
                <div className="whitespace-nowrap font-medium text-slate-700">{betrag(p.netto)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {daten.hinweise.length > 0 && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          {daten.hinweise.map((h, i) => <p key={i} className="whitespace-pre-line">{h}</p>)}
        </div>
      )}

      <p className="mb-3 text-xs text-slate-500">Die Datei „{datei.name}“ wird als Beleg gespeichert. Die Angaben stehen maschinenlesbar in der Datei und werden genau übernommen.</p>

      {doppelt && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Diese Rechnung ist schon eingetragen: {doppelt.lieferant}, Nr. {doppelt.rechnungsnummer} vom {fmtDate(doppelt.datum)}
            {doppelt.betragBrutto !== undefined ? ` über ${fmtEURCent(doppelt.betragBrutto)}` : ''}. Sie wird nicht doppelt angelegt.
          </span>
        </div>
      )}
      {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={onAbbrechen}>{doppelt ? 'Schließen' : 'Abbrechen'}</SecondaryButton>
        {!doppelt && (
          <PrimaryButton onClick={onUebernehmen} disabled={speichert}>
            {speichert ? 'Wird gespeichert …' : 'Übernehmen'}
          </PrimaryButton>
        )}
      </div>
    </>
  )
}

function Zeile({ label, wert, fett }: { label: string; wert: string; fett?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${fett ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{wert}</span>
    </div>
  )
}
