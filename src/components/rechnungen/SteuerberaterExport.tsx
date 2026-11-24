// „Export für Steuerberater“ (22.11.2026): Monat oder Quartal wählen, Anzahl/Summen und offene Punkte
// sehen, ZIP-Datei herunterladen mit
//   - EXTF_Buchungsstapel_<Zeitraum>.csv (DATEV-Format zum Einlesen),
//   - Rechnungsausgangsbuch/Rechnungseingangsbuch (lesbar, für Steuerberater ohne DATEV),
//   - Personenkonten.csv und Hinweise.txt,
//   - allen Rechnungs-PDFs (gespeichert in der Akte; fehlt eines, wird es wie im Detailfenster erzeugt)
//   - und allen Belegen der Eingangsrechnungen (eigener Beleg, sonst die Anhänge der Original-Mail).
// Rechenkern: supabase/functions/_shared/datevExport.ts (auch vom Assistenten genutzt, Werkzeug
// export_steuerberater_status). Einstellungen (Berater-/Mandantennummer, Kontenrahmen, Kontenzuordnung)
// in der Tabelle steuerberater_einstellung — ändern darf nur die Geschäftsführung (Regel in der Datenbank).
// Feste Debitoren-/Kreditorennummern in steuerberater_personenkonten, vergeben beim Export.
// Hintergrund: Entscheidungsvorlage Buchhaltungsprogramm vom 20.11.2026 („Übergabe-Datei im CRM“).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, FileArchive, Info, Settings } from 'lucide-react'
import { Modal, PrimaryButton, SecondaryButton, Field, inputClass } from '../ui'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { alleZeilen } from '../../lib/alleZeilen'
import { fmtEURCent, today } from '../../lib/dates'
import { herunterladen } from '../../lib/briefe'
import { bezahlteSumme } from '../../lib/rechnungen'
import { erzeugeRechnungPdf } from '../../lib/rechnungPdf'
import { brauchtDateiLink, holeAnhangUrl } from '../../lib/emailGateway'
import { erzeugeKundenDownloadUrl } from '../../lib/kundenDokumenteStorage'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { akteName, findeAkte } from '../KostenvoranschlaegeSection'
import { empfaengerZeilen, useRechnungAktionen } from './aktionen'
import {
  ausgangsrechnungPfad,
  eindeutigerPfad,
  eingangsbelegPfad,
  einstellungAlsZeile,
  einstellungAusZeile,
  erstelleExportDateien,
  kontenFuer,
  monatsZeitraum,
  MONATSNAMEN,
  ordnePersonenkontenZu,
  pruefeEinstellung,
  pruefeExport,
  quartalsZeitraum,
  SONST,
  STANDARD_EINSTELLUNG,
  STANDARD_KONTEN,
  VERBINDLICHKEIT_KATEGORIEN,
  vormonat,
  type AusgangsRechnung,
  type Eingangsbeleg,
  type Kontenrahmen,
  type Personenkonto,
  type SteuerberaterEinstellung,
  type Warnung,
  type Zeitraum,
} from '../../../supabase/functions/_shared/datevExport.ts'
import { erstelleZip, type ZipEintrag } from '../../../supabase/functions/_shared/zipSchreiber.ts'
import type { AppData } from '../../context/AppContext'
import type { Dokument, Rechnung, Verbindlichkeit } from '../../types'

type MailAnhang = { filename: string; contentType?: string; url?: string }

/** Knopf für die Kopfzeile der Rechnungen- bzw. Verbindlichkeiten-Seite. */
export function SteuerberaterExportKnopf() {
  const [offen, setOffen] = useState(false)
  return (
    <>
      <SecondaryButton onClick={() => setOffen(true)}>
        <FileArchive size={15} /> Export für Steuerberater
      </SecondaryButton>
      {offen && <SteuerberaterExport onClose={() => setOffen(false)} />}
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Daten aus dem CRM → vereinheitlicht für den Rechenkern

function alsAusgang(state: AppData, r: Rechnung): AusgangsRechnung {
  const akte = findeAkte(state, r.kundeId)
  return {
    id: r.id,
    nummer: r.nummer,
    datum: r.datum,
    kundeId: r.kundeId,
    kundeName: akte ? akteName(akte.kunde) : '',
    netto: Number(r.betragNetto) || 0,
    brutto: Number(r.betragBrutto) || 0,
    ustSatz: r.ustSatz ?? null,
    status: r.status,
    leistung: r.leistungBezeichnung,
    bezahltAm: r.bezahltAm,
    gezahlt: bezahlteSumme(r),
    hatPdf: !!r.dokument,
  }
}

function alsEingang(v: Verbindlichkeit, mailAnhaenge: Map<string, MailAnhang[]>): Eingangsbeleg {
  return {
    id: v.id,
    lieferant: (v.lieferant ?? '').trim(),
    rechnungsnummer: v.rechnungsnummer?.trim() || undefined,
    datum: v.datum,
    netto: v.betragNetto ?? null,
    brutto: v.betragBrutto ?? null,
    kategorie: v.kategorie?.trim() || undefined,
    status: v.status,
    bezahltAm: v.bezahltAm,
    quelle: v.quelle,
    geprueft: !!v.geprueft,
    hatBeleg: !!v.beleg?.url,
    hatMailAnhang: !!v.quellEmailId && (mailAnhaenge.get(v.quellEmailId) ?? []).some((a) => !!a.url),
  }
}

/** Datei des Rechnungs-PDFs in den Dokumenten der Akte (oder einer anderen Akte / der Datenbank). */
async function findeRechnungsDokument(state: AppData, dok: NonNullable<Rechnung['dokument']>): Promise<Dokument | undefined> {
  let datei = findeAkte(state, dok.kundeId)?.kunde.dokumente?.find((d) => d.id === dok.dokumentId)
  if (!datei) {
    for (const b of KUNDEN_BEREICHE) {
      for (const k of b.get(state)) {
        datei = k.dokumente?.find((d) => d.id === dok.dokumentId)
        if (datei) return datei
      }
    }
  }
  if (!datei && supabase) {
    const { data } = await supabase.from('kunden').select('dokumente').contains('dokumente', [{ id: dok.dokumentId }]).limit(1)
    const liste = Array.isArray(data?.[0]?.dokumente) ? (data![0].dokumente as Dokument[]) : []
    datei = liste.find((d) => d.id === dok.dokumentId)
  }
  return datei
}

/** Kurz gültige Adresse einer gespeicherten Datei (Speicherpfad, Ablage-Kennung oder schon eine Adresse). */
async function dateiAdresse(url: string): Promise<string> {
  if (brauchtDateiLink(url)) return holeAnhangUrl(url)
  if (url.startsWith('http')) return url
  return erzeugeKundenDownloadUrl(url)
}

async function ladeBytes(url: string): Promise<Uint8Array> {
  const antwort = await fetch(await dateiAdresse(url))
  if (!antwort.ok) throw new Error(`Abruf fehlgeschlagen (${antwort.status})`)
  return new Uint8Array(await antwort.arrayBuffer())
}

/** Führt Aufgaben mit höchstens `n` gleichzeitig aus. */
async function nacheinander<T>(aufgaben: (() => Promise<T>)[], n: number): Promise<T[]> {
  const aus: T[] = new Array(aufgaben.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, aufgaben.length) }, async () => {
      while (i < aufgaben.length) {
        const meine = i++
        aus[meine] = await aufgaben[meine]()
      }
    }),
  )
  return aus
}

type PersonenkontoZeile = { art: 'debitor' | 'kreditor'; schluessel: string; nummer: number; name: string | null }

async function ladePersonenkonten(): Promise<Personenkonto[]> {
  if (!supabase) throw new Error('Keine Datenbank verbunden.')
  const db = supabase
  // Seitenweise: Die Datenbank liefert höchstens 1000 Zeilen je Abfrage (ein `.limit(20000)` hilft nicht) — sonst
  // gälten bekannte Konten ab dem 1001. als neu und das Anlegen scheiterte an doppelten Nummern.
  const { data, error } = await alleZeilen<PersonenkontoZeile>(() => db.from('steuerberater_personenkonten').select('id, art, schluessel, nummer, name'))
  if (error) throw new Error(error.message)
  return ((data ?? []) as PersonenkontoZeile[]).map((z) => ({ art: z.art, schluessel: z.schluessel, nummer: Number(z.nummer), name: z.name ?? undefined }))
}

// ---------------------------------------------------------------------------------------------
// Fenster

type Art = 'monat' | 'quartal'

export function SteuerberaterExport({ onClose }: { onClose: () => void }) {
  const { state, nutzer } = useRechnungAktionen()
  const { mitarbeiter, ansichtAls } = useAuth()
  const darfEinstellen = !ansichtAls && (mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin)

  const start = vormonat(today())
  const [art, setArt] = useState<Art>('monat')
  const [jahr, setJahr] = useState(Number(start.von.slice(0, 4)))
  const [monat, setMonat] = useState(Number(start.von.slice(5, 7)))
  const [quartal, setQuartal] = useState(Math.ceil(Number(start.von.slice(5, 7)) / 3))
  const zeitraum: Zeitraum = art === 'monat' ? monatsZeitraum(jahr, monat) : quartalsZeitraum(jahr, quartal)

  const [einstellung, setEinstellung] = useState<SteuerberaterEinstellung>({ ...STANDARD_EINSTELLUNG })
  const [einstellungFehler, setEinstellungFehler] = useState('')
  const [einstellungenOffen, setEinstellungenOffen] = useState(false)
  const [mailAnhaenge, setMailAnhaenge] = useState<Map<string, MailAnhang[]>>(new Map())
  const [alleWarnungen, setAlleWarnungen] = useState(false)
  const [laeuft, setLaeuft] = useState(false)
  const [fortschritt, setFortschritt] = useState('')
  const [fehler, setFehler] = useState('')
  const [ergebnis, setErgebnis] = useState<{ datei: string; zusatz: Warnung[] } | null>(null)

  // Einstellungen laden
  useEffect(() => {
    let aktiv = true
    if (!supabase) return
    supabase
      .from('steuerberater_einstellung')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv) return
        if (error) setEinstellungFehler('Die Einstellungen für den Export sind noch nicht eingerichtet — es gelten die Vorgaben.')
        else setEinstellung(einstellungAusZeile(data))
      })
    return () => {
      aktiv = false
    }
  }, [])

  // Anhänge der Original-Mails für Eingangsrechnungen ohne eigenen Beleg
  const mailIds = useMemo(
    () =>
      [...new Set(state.verbindlichkeiten.filter((v) => v.datum >= zeitraum.von && v.datum <= zeitraum.bis && !v.beleg?.url && v.quellEmailId).map((v) => v.quellEmailId!))].sort(),
    [state.verbindlichkeiten, zeitraum.von, zeitraum.bis],
  )
  const mailIdsSchluessel = mailIds.join('|')
  useEffect(() => {
    let aktiv = true
    if (!supabase || !mailIds.length) return
    supabase
      .from('eingegangene_emails')
      .select('message_id, anhaenge')
      .in('message_id', mailIds)
      .then(({ data }) => {
        if (!aktiv) return
        const m = new Map<string, MailAnhang[]>()
        for (const z of (data ?? []) as { message_id: string; anhaenge: unknown }[]) {
          if (!m.has(z.message_id)) m.set(z.message_id, Array.isArray(z.anhaenge) ? (z.anhaenge as MailAnhang[]) : [])
        }
        setMailAnhaenge((alt) => new Map([...alt, ...m]))
      })
    return () => {
      aktiv = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailIdsSchluessel])

  const pruefung = useMemo(
    () => pruefeExport(state.rechnungen.map((r) => alsAusgang(state, r)), state.verbindlichkeiten.map((v) => alsEingang(v, mailAnhaenge)), einstellung, zeitraum),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, mailAnhaenge, einstellung, zeitraum.kurz],
  )
  const fehlt = pruefung.warnungen.filter((w) => w.schwere === 'fehlt')
  const hinweise = pruefung.warnungen.filter((w) => w.schwere === 'hinweis')
  const leer = pruefung.rechnungen.length === 0 && pruefung.belege.length === 0

  async function exportieren() {
    setFehler('')
    setErgebnis(null)
    setLaeuft(true)
    const zusatz: Warnung[] = []
    try {
      // 1) Feste Debitoren-/Kreditorennummern: Bestand frisch laden, neue vergeben und speichern.
      setFortschritt('Kontonummern werden vergeben …')
      let konten: Personenkonto[] = []
      let gespeichert = false
      for (let versuch = 0; versuch < 3 && !gespeichert; versuch++) {
        let bestand: Personenkonto[]
        try {
          bestand = await ladePersonenkonten()
        } catch {
          konten = ordnePersonenkontenZu([], pruefung.rechnungen, pruefung.belege).alle
          zusatz.push({ art: 'einstellung', schwere: 'fehlt', text: 'Die Debitoren-/Kreditorennummern ließen sich nicht speichern — beim nächsten Export können sie anders lauten. Bitte Fundament IT Bescheid geben.' })
          break
        }
        const { neu, alle } = ordnePersonenkontenZu(bestand, pruefung.rechnungen, pruefung.belege)
        konten = alle
        if (!neu.length) {
          gespeichert = true
          break
        }
        const { error } = await supabase!
          .from('steuerberater_personenkonten')
          .insert(neu.map((k) => ({ art: k.art, schluessel: k.schluessel, nummer: k.nummer, name: k.name ?? null, angelegt_von: nutzer.name })))
        if (!error) gespeichert = true
        else if (error.code !== '23505' || versuch === 2) throw new Error(`Die Kontonummern ließen sich nicht speichern (${error.message}).`)
        // 23505 = jemand hat gleichzeitig exportiert → Bestand neu laden und noch einmal.
      }

      // 2) Belegdateien sammeln
      const vergeben = new Set<string>()
      const eintraege: ZipEintrag[] = []
      const dateien: { rechnungen: Record<string, string[]>; belege: Record<string, string[]> } = { rechnungen: {}, belege: {} }
      const aufgaben: (() => Promise<void>)[] = []
      let fertig = 0
      const gesamt = pruefung.rechnungen.length + pruefung.belege.length
      const weiter = () => setFortschritt(`Belege werden geladen … ${++fertig} von ${gesamt}`)

      for (const ar of pruefung.rechnungen) {
        const r = state.rechnungen.find((x) => x.id === ar.id)!
        const pfad = eindeutigerPfad(ausgangsrechnungPfad(ar), vergeben)
        aufgaben.push(async () => {
          let inhalt: Uint8Array | undefined
          if (r.dokument) {
            try {
              const datei = await findeRechnungsDokument(state, r.dokument)
              if (!datei?.url) throw new Error('nicht gefunden')
              inhalt = await ladeBytes(datei.url)
            } catch {
              zusatz.push({ art: 'datei_fehler', schwere: 'fehlt', id: r.id, bezug: 'rechnung', text: `Rechnung ${r.nummer}: das gespeicherte PDF ließ sich nicht laden — es wurde nachträglich erzeugt.` })
            }
          }
          if (!inhalt) {
            try {
              const blob = erzeugeRechnungPdf(r, { empfaenger: empfaengerZeilen(r, findeAkte(state, r.kundeId)), absender: nutzer.name })
              inhalt = new Uint8Array(await blob.arrayBuffer())
            } catch {
              zusatz.push({ art: 'datei_fehler', schwere: 'fehlt', id: r.id, bezug: 'rechnung', text: `Rechnung ${r.nummer}: kein PDF — ließ sich weder laden noch erzeugen.` })
            }
          }
          if (inhalt) {
            eintraege.push({ name: pfad, inhalt })
            dateien.rechnungen[r.id] = [pfad]
          }
          weiter()
        })
      }

      for (const b of pruefung.belege) {
        const v = state.verbindlichkeiten.find((x) => x.id === b.id)!
        const quellen: { name: string; typ?: string; url: string }[] = v.beleg?.url
          ? [{ name: v.beleg.name, typ: v.beleg.typ, url: v.beleg.url }]
          : (mailAnhaenge.get(v.quellEmailId ?? '') ?? []).filter((a) => !!a.url).map((a) => ({ name: a.filename, typ: a.contentType, url: a.url! }))
        const pfade = quellen.map((q, i) => eindeutigerPfad(eingangsbelegPfad(b, q.name, q.typ, i + 1, quellen.length), vergeben))
        aufgaben.push(async () => {
          for (let i = 0; i < quellen.length; i++) {
            try {
              const inhalt = await ladeBytes(quellen[i].url)
              eintraege.push({ name: pfade[i], inhalt })
              ;(dateien.belege[b.id] ??= []).push(pfade[i])
            } catch {
              zusatz.push({ art: 'datei_fehler', schwere: 'fehlt', id: b.id, bezug: 'verbindlichkeit', text: `${b.lieferant || 'Eingangsrechnung'} vom ${b.datum.split('-').reverse().join('.')}: die Datei „${quellen[i].name}“ ließ sich nicht laden.` })
            }
          }
          weiter()
        })
      }
      await nacheinander(aufgaben, 4)

      // 3) Textdateien und ZIP
      setFortschritt('ZIP-Datei wird gebaut …')
      eintraege.sort((a, c) => a.name.localeCompare(c.name, 'de'))
      const text = erstelleExportDateien(pruefung, einstellung, konten, {
        erzeugtAm: new Date(),
        erstelltVon: nutzer.name,
        dateien,
        belegPfade: eintraege.map((e) => e.name),
        zusatzWarnungen: zusatz,
      })
      const zip = erstelleZip([...text.dateien, ...eintraege])
      const dateiname = `Steuerberater_${pruefung.zeitraum.kurz}.zip`
      herunterladen(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), dateiname)
      setErgebnis({ datei: dateiname, zusatz })
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Der Export ist fehlgeschlagen.')
    } finally {
      setLaeuft(false)
      setFortschritt('')
    }
  }

  const jahre = [0, 1, 2].map((d) => Number(today().slice(0, 4)) - d)
  const knopf = (aktiv: boolean) =>
    `rounded-lg border px-3 py-1.5 text-xs font-medium ${aktiv ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`
  const sichtbareFehlt = alleWarnungen ? fehlt : fehlt.slice(0, 8)
  const sichtbareHinweise = alleWarnungen ? hinweise : hinweise.slice(0, 5)

  return (
    <Modal open onClose={onClose} title="Export für Steuerberater" width="max-w-2xl">
      <p className="mb-3 text-sm text-slate-600">
        Alle Rechnungen und Eingangsrechnungen eines Monats oder Quartals als ZIP-Datei: Buchungsstapel zum Einlesen in DATEV, lesbare Listen und alle Belege.
      </p>

      {/* Zeitraum */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex gap-1.5">
          <button type="button" className={knopf(art === 'monat')} onClick={() => setArt('monat')}>Monat</button>
          <button type="button" className={knopf(art === 'quartal')} onClick={() => setArt('quartal')}>Quartal</button>
        </div>
        {art === 'monat' ? (
          <select className={`${inputClass} w-auto`} value={monat} onChange={(e) => setMonat(Number(e.target.value))} aria-label="Monat">
            {MONATSNAMEN.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
        ) : (
          <select className={`${inputClass} w-auto`} value={quartal} onChange={(e) => setQuartal(Number(e.target.value))} aria-label="Quartal">
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}. Quartal</option>)}
          </select>
        )}
        <select className={`${inputClass} w-auto`} value={jahr} onChange={(e) => setJahr(Number(e.target.value))} aria-label="Jahr">
          {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>

      {/* Zahlen */}
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-400">Ausgangsrechnungen</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-800">{pruefung.summen.rechnungen.anzahl}</div>
          <div className="text-xs text-slate-500">
            netto {fmtEURCent(pruefung.summen.rechnungen.netto)} · Umsatzsteuer {fmtEURCent(pruefung.summen.rechnungen.ust)} · brutto {fmtEURCent(pruefung.summen.rechnungen.brutto)}
          </div>
          {pruefung.entwuerfe.length > 0 && <div className="mt-1 text-xs text-slate-400">{pruefung.entwuerfe.length} Entwurf/Entwürfe gehen nicht mit</div>}
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-400">Eingangsrechnungen</div>
          <div className="mt-0.5 text-lg font-semibold text-slate-800">{pruefung.summen.belege.anzahl}</div>
          <div className="text-xs text-slate-500">
            brutto {fmtEURCent(pruefung.summen.belege.brutto)} · erkennbare Vorsteuer {fmtEURCent(pruefung.summen.belege.vorsteuer)}
          </div>
          {pruefung.summen.belege.imStapel < pruefung.summen.belege.anzahl && (
            <div className="mt-1 text-xs text-rose-600">{pruefung.summen.belege.anzahl - pruefung.summen.belege.imStapel} ohne Betrag (fehlen im Buchungsstapel)</div>
          )}
        </div>
      </div>

      {/* Offene Punkte */}
      {fehlt.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle size={15} /> Noch zu erledigen ({fehlt.length})</div>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {sichtbareFehlt.map((w, i) => <WarnungZeile key={`${w.art}-${w.id ?? i}`} w={w} onClose={onClose} />)}
          </ul>
        </div>
      )}
      {hinweise.length > 0 && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="mb-1 flex items-center gap-1.5 font-medium"><Info size={15} /> Zur Kenntnis ({hinweise.length})</div>
          <ul className="list-inside list-disc space-y-0.5 text-xs">
            {sichtbareHinweise.map((w, i) => <WarnungZeile key={`${w.art}-${w.id ?? i}`} w={w} onClose={onClose} />)}
          </ul>
        </div>
      )}
      {(fehlt.length > 8 || hinweise.length > 5) && (
        <button type="button" onClick={() => setAlleWarnungen((x) => !x)} className="mb-3 text-xs font-medium text-accent-600 hover:text-accent-700">
          {alleWarnungen ? 'Weniger zeigen' : 'Alle Punkte zeigen'}
        </button>
      )}
      {fehlt.length === 0 && !leer && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 size={15} /> Es fehlt nichts — der Export kann raus.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={exportieren} disabled={laeuft || leer || !supabase}>
          <Download size={15} /> {laeuft ? 'Wird erstellt …' : `ZIP-Datei für ${pruefung.zeitraum.bezeichnung} herunterladen`}
        </PrimaryButton>
        {leer && <span className="text-xs text-slate-500">In diesem Zeitraum gibt es keine Rechnungen und keine Eingangsrechnungen.</span>}
        {fortschritt && <span className="text-xs text-slate-500">{fortschritt}</span>}
      </div>
      {fehler && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}
      {ergebnis && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          „{ergebnis.datei}“ ist heruntergeladen. Die offenen Punkte stehen auch in der Datei „Hinweise.txt“.
          {ergebnis.zusatz.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
              {ergebnis.zusatz.map((w, i) => <li key={i}>{w.text}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Einstellungen */}
      <div className="mt-5 border-t border-slate-100 pt-3">
        <button type="button" onClick={() => setEinstellungenOffen((x) => !x)} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800">
          <Settings size={14} /> Einstellungen für den Steuerberater {einstellungenOffen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {einstellungFehler && <p className="mt-2 text-xs text-amber-700">{einstellungFehler}</p>}
        {einstellungenOffen && (
          <EinstellungenFormular
            einstellung={einstellung}
            darfAendern={darfEinstellen && !einstellungFehler}
            eigeneKategorien={state.verbindlichkeiten.map((v) => v.kategorie?.trim()).filter((k): k is string => !!k)}
            von={nutzer.name}
            onGespeichert={setEinstellung}
          />
        )}
      </div>
    </Modal>
  )
}

function WarnungZeile({ w, onClose }: { w: Warnung; onClose: () => void }) {
  if (w.bezug === 'rechnung' && w.id) {
    return (
      <li>
        {w.text}{' '}
        <Link to={`/beratung/rechnungen?rechnung=${encodeURIComponent(w.id)}`} onClick={onClose} className="font-medium underline">
          öffnen
        </Link>
      </li>
    )
  }
  return <li>{w.text}</li>
}

// ---------------------------------------------------------------------------------------------
// Einstellungen (ändern nur Geschäftsführung — die Datenbank lässt es anderen auch nicht zu)

const ERLOES_ZEILEN: { schluessel: string; label: string }[] = [
  { schluessel: '19', label: 'Erlöse mit 19 % Umsatzsteuer' },
  { schluessel: '7', label: 'Erlöse mit 7 % Umsatzsteuer' },
  { schluessel: '0', label: 'Erlöse ohne Umsatzsteuer' },
  { schluessel: SONST, label: 'Steuersatz nicht zuzuordnen' },
]

function EinstellungenFormular({
  einstellung,
  darfAendern,
  eigeneKategorien,
  von,
  onGespeichert,
}: {
  einstellung: SteuerberaterEinstellung
  darfAendern: boolean
  eigeneKategorien: string[]
  von: string
  onGespeichert: (e: SteuerberaterEinstellung) => void
}) {
  const [e, setE] = useState<SteuerberaterEinstellung>(einstellung)
  const [neueKategorie, setNeueKategorie] = useState('')
  const [meldung, setMeldung] = useState('')
  const [fehler, setFehler] = useState('')
  const [speichert, setSpeichert] = useState(false)
  useEffect(() => setE(einstellung), [einstellung])

  const std = STANDARD_KONTEN[e.kontenrahmen]
  const wirksam = kontenFuer(e)
  const kategorien = useMemo(() => {
    const liste = [...VERBINDLICHKEIT_KATEGORIEN, ...eigeneKategorien, ...Object.keys(e.aufwandskonten).filter((k) => k !== SONST)]
    const gesehen = new Set<string>()
    return liste.filter((k) => {
      const s = k.toLowerCase()
      if (gesehen.has(s)) return false
      gesehen.add(s)
      return true
    })
  }, [eigeneKategorien, e.aufwandskonten])

  /** Eigenes Konto setzen; leer oder gleich der Vorgabe = Vorgabe. */
  function setzeKonto(feld: 'erloeskonten' | 'aufwandskonten', schluessel: string, wert: string, vorgabe?: string) {
    const liste = { ...e[feld] }
    const w = wert.trim()
    if (!w || w === vorgabe) delete liste[schluessel]
    else liste[schluessel] = w
    setE({ ...e, [feld]: liste })
  }

  const pruefFehler = pruefeEinstellung(e)

  async function speichern() {
    setMeldung('')
    setFehler('')
    if (!supabase) return
    if (pruefFehler.length) return setFehler(pruefFehler[0])
    setSpeichert(true)
    const { data, error } = await supabase
      .from('steuerberater_einstellung')
      .update({ ...einstellungAlsZeile(e), geaendert_von: von, geaendert_am: new Date().toISOString() })
      .eq('id', 1)
      .select('*')
    setSpeichert(false)
    if (error) return setFehler(`Speichern fehlgeschlagen (${error.message}).`)
    if (!data || data.length === 0) return setFehler('Diese Einstellungen darf nur die Geschäftsführung ändern.')
    onGespeichert(einstellungAusZeile(data[0]))
    setMeldung('Gespeichert.')
  }

  return (
    <fieldset disabled={!darfAendern} className="mt-3">
      {!darfAendern && <p className="mb-2 text-xs text-slate-500">Nur die Geschäftsführung kann diese Angaben ändern.</p>}
      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Beraternummer (vom Steuerberater)">
          <input className={inputClass} inputMode="numeric" value={e.beraterNr ?? ''} onChange={(x) => setE({ ...e, beraterNr: x.target.value.replace(/\D/g, '') })} placeholder="z. B. 29098" />
        </Field>
        <Field label="Mandantennummer (vom Steuerberater)">
          <input className={inputClass} inputMode="numeric" value={e.mandantenNr ?? ''} onChange={(x) => setE({ ...e, mandantenNr: x.target.value.replace(/\D/g, '') })} placeholder="z. B. 55003" />
        </Field>
        <Field label="Kontenrahmen">
          <select className={inputClass} value={e.kontenrahmen} onChange={(x) => setE({ ...e, kontenrahmen: x.target.value as Kontenrahmen })}>
            <option value="SKR03">SKR 03</option>
            <option value="SKR04">SKR 04</option>
          </select>
        </Field>
        <Field label="Wirtschaftsjahr beginnt im">
          <select className={inputClass} value={e.wjBeginnMonat} onChange={(x) => setE({ ...e, wjBeginnMonat: Number(x.target.value) })}>
            {MONATSNAMEN.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
        </Field>
      </div>
      <label className="mb-1 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={e.belegInfo} onChange={(x) => setE({ ...e, belegInfo: x.target.checked })} />
        Dateinamen der Belege in den Buchungsstapel schreiben
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!e.kontenBestaetigt} onChange={(x) => setE({ ...e, kontenBestaetigt: x.target.checked })} />
        Der Steuerberater hat die Konten unten bestätigt
      </label>

      <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Die Konten sind ein Vorschlag für {e.kontenrahmen === 'SKR04' ? 'SKR 04' : 'SKR 03'}. Bitte vom Steuerberater bestätigen lassen oder seine Konten eintragen. Ein leeres Feld bedeutet: Vorschlag verwenden.
      </p>

      <div className="mb-1 text-xs font-medium text-slate-500">Erlöskonten (Ausgangsrechnungen)</div>
      <div className="mb-3 space-y-1.5">
        {ERLOES_ZEILEN.map((z) => (
          <KontoZeile key={z.schluessel} label={z.label} vorgabe={std.erloese[z.schluessel]} wert={e.erloeskonten[z.schluessel] ?? ''} onChange={(w) => setzeKonto('erloeskonten', z.schluessel, w, std.erloese[z.schluessel])} />
        ))}
      </div>

      <div className="mb-1 text-xs font-medium text-slate-500">Aufwandskonten (Eingangsrechnungen nach Kategorie)</div>
      <div className="mb-2 space-y-1.5">
        {kategorien.map((k) => (
          <KontoZeile key={k} label={k} vorgabe={std.aufwand[k] ?? wirksam.aufwand[SONST]} wert={e.aufwandskonten[k] ?? ''} onChange={(w) => setzeKonto('aufwandskonten', k, w, std.aufwand[k])} />
        ))}
        <KontoZeile label="Alles andere / ohne Kategorie" vorgabe={std.aufwand[SONST]} wert={e.aufwandskonten[SONST] ?? ''} onChange={(w) => setzeKonto('aufwandskonten', SONST, w, std.aufwand[SONST])} />
      </div>
      {darfAendern && (
        <div className="mb-3 flex gap-2">
          <input className={`${inputClass} flex-1`} value={neueKategorie} onChange={(x) => setNeueKategorie(x.target.value)} placeholder="Weitere Kategorie, z. B. Fortbildung" />
          <SecondaryButton
            onClick={() => {
              const k = neueKategorie.trim()
              if (!k) return
              setE({ ...e, aufwandskonten: { ...e.aufwandskonten, [k]: e.aufwandskonten[k] ?? wirksam.aufwand[SONST] } })
              setNeueKategorie('')
            }}
          >
            Hinzufügen
          </SecondaryButton>
        </div>
      )}
      <p className="mb-3 text-xs text-slate-500">Debitoren (Kunden) bekommen beim ersten Export feste Nummern ab 10000, Kreditoren (Lieferanten) ab 70000.</p>

      {pruefFehler.length > 0 && <p className="mb-2 text-xs text-rose-600">{pruefFehler[0]}</p>}
      {darfAendern && (
        <PrimaryButton onClick={speichern} disabled={speichert || pruefFehler.length > 0}>
          {speichert ? 'Wird gespeichert …' : 'Einstellungen speichern'}
        </PrimaryButton>
      )}
      {meldung && <p className="mt-2 text-sm text-emerald-700">{meldung}</p>}
      {fehler && <p className="mt-2 text-sm text-rose-700">{fehler}</p>}
    </fieldset>
  )
}

function KontoZeile({ label, vorgabe, wert, onChange }: { label: string; vorgabe?: string; wert: string; onChange: (w: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm text-slate-700" title={label}>{label}</span>
      <input
        className={`${inputClass} w-24 text-right`}
        inputMode="numeric"
        maxLength={4}
        value={wert}
        placeholder={vorgabe ?? ''}
        onChange={(x) => onChange(x.target.value.replace(/\D/g, ''))}
        aria-label={`Konto für ${label}`}
      />
    </div>
  )
}
