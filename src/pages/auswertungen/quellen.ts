// Die Datenquellen der Seite „Auswertungen": je Quelle eine Feldliste in einfachem Deutsch, die
// Datensätze aus dem App-Zustand und fertige Vorlagen. Der App-Zustand enthält nur, was der angemeldete
// Mitarbeiter sehen darf (Bereichsrechte setzt die Datenbank durch) — hier wird nichts nachgeladen.

import type { AppData } from '../../context/AppContext'
import type { Bereich, Kunde, KundeBereich, Objekt, ObjektAbrechnung, ToDoEintrag } from '../../types'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../../data/kundenBereiche'
import { istSammelakte } from '../../data/sammelakten'
import { getStatusMap } from '../../data/statusNetworks'
import { gruppeLabel, mahnstufeLabel } from '../../data/constants'
import { angezeigterStatus } from '../../lib/rechnungen'
import { today } from '../../lib/dates'
import { alsIsoDatum } from '../../lib/pivot'
import type { Datensatz, Einstellung, Feld } from '../../lib/pivot'
import { rechneObjektAbrechnung } from '../../lib/objektAbrechnungRechnung'

export type QuelleId = 'kunden' | 'rechnungen' | 'verbindlichkeiten' | 'objekte' | 'zeiten' | 'todos' | 'abrechnung' | 'kontoauszuege' | 'datei'

export const QUELLEN: { id: QuelleId; label: string; beschreibung: string }[] = [
  { id: 'kunden', label: 'Kunden und Kontakte', beschreibung: 'Alle Bereiche außer „Privat", ohne die beiden Sammelakten. „Angelegt am" ist der erste Eintrag im Verlauf.' },
  { id: 'rechnungen', label: 'Rechnungen', beschreibung: 'Ausgangsrechnungen an Kunden.' },
  { id: 'verbindlichkeiten', label: 'Verbindlichkeiten', beschreibung: 'Rechnungen von Lieferanten an uns.' },
  { id: 'objekte', label: 'Objekte', beschreibung: 'Immobilien-Objekte. „Angelegt am" ist der erste Eintrag im Verlauf.' },
  { id: 'zeiten', label: 'Zeiterfassung', beschreibung: 'Erfasste Arbeitszeit.' },
  { id: 'todos', label: 'To-dos', beschreibung: 'Aufgaben aus den To-do-Listen, die du sehen kannst.' },
  { id: 'abrechnung', label: 'Abrechnung je Objekt', beschreibung: 'Zeit, Zeitkosten und Provisionsanteil je Objekt und Person, wie im Reiter „Abrechnung".' },
  { id: 'kontoauszuege', label: 'Kontoauszüge', beschreibung: 'Buchungen aus gespeicherten Kontoauszug-Auswertungen der Akten.' },
  { id: 'datei', label: 'Eigene Datei', beschreibung: 'Excel- oder CSV-Datei von deinem Gerät. Sie wird nicht hochgeladen.' },
]

export type Vorlage = { name: string; einstellung: Einstellung }

export type QuellenDaten = {
  felder: Feld[]
  daten: Datensatz[]
  /** Feld für den Zeitraum-Filter (fehlt = kein Zeitraum). */
  hauptdatum?: string
  /** Felder, die in der Liste unter einer Zelle und in der Excel-Datei immer mitkommen. */
  kernFelder: string[]
  vorlagen: Vorlage[]
}

const PRIO = ['Hoch', 'Mittel', 'Niedrig']
const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

const leer = (e: Partial<Einstellung>): Einstellung => ({ zeilen: [], spalten: [], berechnung: 'anzahl', filter: [], ...e })

function kundenName(k: Kunde): string {
  return (k.firma || k.ansprechpartner || '').trim() || 'Ohne Namen'
}

/** Ältester Eintrag im Verlauf — Kunden und Objekte haben kein eigenes Anlagedatum. */
function erstesDatum(activities: { date: string }[] | undefined): string | null {
  let erstes: string | undefined
  for (const a of activities ?? []) {
    const iso = alsIsoDatum(a.date)
    if (iso && (!erstes || iso < erstes)) erstes = iso
  }
  return erstes ?? null
}

const BEREICH_LABEL = (b: Bereich | undefined): string => (!b ? 'Eigene Liste' : b === 'immobilien' ? 'Immobilien' : kundeBereichLabel(b as KundeBereich))

// ── Kunden und Kontakte ──────────────────────────────────────────────────────────────────────────

function kunden(state: AppData): QuellenDaten {
  const heute = today()
  const felder: Feld[] = [
    { id: 'name', label: 'Name', typ: 'text' },
    { id: 'bereich', label: 'Bereich', typ: 'text' },
    { id: 'status', label: 'Status', typ: 'text' },
    { id: 'prioritaet', label: 'Priorität', typ: 'text', reihenfolge: PRIO },
    { id: 'verantwortlich', label: 'Verantwortlich', typ: 'text' },
    { id: 'angelegt', label: 'Angelegt am', typ: 'datum' },
    { id: 'letzteAktivitaet', label: 'Letzte Aktivität', typ: 'datum' },
    { id: 'followUpDatum', label: 'Follow-up am', typ: 'datum' },
    { id: 'followUpFaellig', label: 'Follow-up fällig', typ: 'jaNein' },
    { id: 'abgeschlossen', label: 'Abgeschlossen (Endstatus)', typ: 'jaNein' },
    { id: 'dokumente', label: 'Anzahl Dokumente', typ: 'zahl' },
    { id: 'bonitaet', label: 'Bonität (Ampel)', typ: 'text', reihenfolge: ['Grün', 'Gelb', 'Rot', 'Nicht beurteilbar'] },
  ]
  const ampel: Record<string, string> = { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot', nicht_beurteilbar: 'Nicht beurteilbar' }
  const daten: Datensatz[] = []
  for (const b of KUNDEN_BEREICHE) {
    if (b.id === 'privat') continue
    const statusMap = getStatusMap(b.id)
    for (const k of b.get(state)) {
      if (istSammelakte(k.id)) continue
      const node = statusMap[k.status]
      const fu = k.followUp
      daten.push({
        _id: k.id,
        name: kundenName(k),
        bereich: b.label,
        status: node?.label ?? k.status ?? '',
        prioritaet: k.prioritaet ?? '',
        verantwortlich: k.verantwortlich ?? '',
        angelegt: erstesDatum(k.activities),
        letzteAktivitaet: alsIsoDatum(k.letzteAktivitaet) ?? null,
        followUpDatum: fu && !fu.done ? alsIsoDatum(fu.date) ?? null : null,
        followUpFaellig: !!fu && !fu.done && !!fu.date && fu.date <= heute,
        abgeschlossen: !!node?.isTerminal,
        dokumente: k.dokumente?.length ?? 0,
        bonitaet: k.bonitaet ? ampel[k.bonitaet.ampel] ?? '' : '',
      })
    }
  }
  return {
    felder,
    daten,
    hauptdatum: 'angelegt',
    kernFelder: ['name', 'bereich', 'status', 'verantwortlich'],
    vorlagen: [
      { name: 'Neue Kontakte je Bereich und Monat', einstellung: leer({ zeilen: [{ feld: 'bereich' }], spalten: [{ feld: 'angelegt', gruppierung: 'monat' }] }) },
      { name: 'Kontakte je Status und Verantwortlichem', einstellung: leer({ zeilen: [{ feld: 'status' }], spalten: [{ feld: 'verantwortlich' }] }) },
      { name: 'Fällige Follow-ups je Verantwortlichem', einstellung: leer({ zeilen: [{ feld: 'verantwortlich' }], spalten: [{ feld: 'bereich' }], filter: [{ feld: 'followUpFaellig', ohne: ['nein'] }] }) },
    ],
  }
}

// ── Rechnungen ───────────────────────────────────────────────────────────────────────────────────

function kundenNachId(state: AppData): Map<string, { kunde: Kunde; bereich: string }> {
  const m = new Map<string, { kunde: Kunde; bereich: string }>()
  for (const b of KUNDEN_BEREICHE) for (const k of b.get(state)) m.set(k.id, { kunde: k, bereich: b.label })
  return m
}

function rechnungen(state: AppData): QuellenDaten {
  const nachId = kundenNachId(state)
  const felder: Feld[] = [
    { id: 'nummer', label: 'Rechnungsnummer', typ: 'text' },
    { id: 'kunde', label: 'Kunde', typ: 'text' },
    { id: 'bereich', label: 'Bereich des Kunden', typ: 'text' },
    { id: 'datum', label: 'Rechnungsdatum', typ: 'datum' },
    { id: 'zahlungsziel', label: 'Zahlungsziel', typ: 'datum' },
    { id: 'status', label: 'Status', typ: 'text', reihenfolge: ['Entwurf', 'Versendet', 'Überfällig', 'Bezahlt'] },
    { id: 'mahnstufe', label: 'Mahnstufe', typ: 'text', reihenfolge: ['Zahlungserinnerung', '1. Mahnung', '2. Mahnung', 'Inkasso'] },
    { id: 'leistung', label: 'Leistung', typ: 'text' },
    { id: 'menge', label: 'Menge (Stunden oder Tage)', typ: 'zahl' },
    { id: 'netto', label: 'Netto', typ: 'zahl', euro: true },
    { id: 'brutto', label: 'Brutto', typ: 'zahl', euro: true },
  ]
  const daten: Datensatz[] = state.rechnungen.map((r) => {
    const k = nachId.get(r.kundeId)
    return {
      _id: r.id,
      nummer: r.nummer ?? '',
      kunde: k ? kundenName(k.kunde) : 'Unbekannter Kunde',
      bereich: k?.bereich ?? '',
      datum: alsIsoDatum(r.datum) ?? null,
      zahlungsziel: alsIsoDatum(r.zahlungsziel) ?? null,
      status: angezeigterStatus(r),
      mahnstufe: r.mahnstufe ? mahnstufeLabel(r.mahnstufe) : '',
      leistung: r.leistungBezeichnung ?? '',
      menge: typeof r.leistungMenge === 'number' ? r.leistungMenge : null,
      netto: typeof r.betragNetto === 'number' ? r.betragNetto : null,
      brutto: typeof r.betragBrutto === 'number' ? r.betragBrutto : null,
    }
  })
  return {
    felder,
    daten,
    hauptdatum: 'datum',
    kernFelder: ['nummer', 'kunde', 'datum', 'status', 'brutto'],
    vorlagen: [
      { name: 'Umsatz je Kunde und Monat', einstellung: leer({ zeilen: [{ feld: 'kunde' }], spalten: [{ feld: 'datum', gruppierung: 'monat' }], berechnung: 'summe', wert: 'netto', filter: [{ feld: 'status', ohne: ['Entwurf'] }] }) },
      { name: 'Offene und bezahlte Beträge je Status', einstellung: leer({ zeilen: [{ feld: 'status' }], spalten: [{ feld: 'datum', gruppierung: 'jahr' }], berechnung: 'summe', wert: 'brutto' }) },
      { name: 'Umsatz je Leistung und Quartal', einstellung: leer({ zeilen: [{ feld: 'leistung' }], spalten: [{ feld: 'datum', gruppierung: 'quartal' }], berechnung: 'summe', wert: 'netto', filter: [{ feld: 'status', ohne: ['Entwurf'] }] }) },
    ],
  }
}

// ── Verbindlichkeiten ────────────────────────────────────────────────────────────────────────────

function verbindlichkeiten(state: AppData): QuellenDaten {
  const heute = today()
  const felder: Feld[] = [
    { id: 'lieferant', label: 'Lieferant', typ: 'text' },
    { id: 'nummer', label: 'Rechnungsnummer', typ: 'text' },
    { id: 'datum', label: 'Datum', typ: 'datum' },
    { id: 'zahlungsziel', label: 'Zahlungsziel', typ: 'datum' },
    { id: 'status', label: 'Status', typ: 'text', reihenfolge: ['Offen', 'Überfällig', 'Bezahlt'] },
    { id: 'herkunft', label: 'Erfasst', typ: 'text' },
    { id: 'netto', label: 'Netto', typ: 'zahl', euro: true },
    { id: 'brutto', label: 'Betrag (brutto)', typ: 'zahl', euro: true },
  ]
  const daten: Datensatz[] = state.verbindlichkeiten.map((v) => {
    const ueberfaellig = v.status !== 'bezahlt' && !!v.zahlungsziel && v.zahlungsziel < heute
    return {
      _id: v.id,
      lieferant: (v.lieferant ?? '').trim(),
      nummer: v.rechnungsnummer ?? '',
      datum: alsIsoDatum(v.datum) ?? null,
      zahlungsziel: alsIsoDatum(v.zahlungsziel) ?? null,
      status: v.status === 'bezahlt' ? 'Bezahlt' : ueberfaellig || v.status === 'ueberfaellig' ? 'Überfällig' : 'Offen',
      herkunft: v.quelle === 'email-automatisch' ? 'Automatisch aus E-Mail' : 'Von Hand',
      netto: typeof v.betragNetto === 'number' ? v.betragNetto : null,
      brutto: typeof v.betragBrutto === 'number' ? v.betragBrutto : null,
    }
  })
  return {
    felder,
    daten,
    hauptdatum: 'datum',
    kernFelder: ['lieferant', 'nummer', 'datum', 'status', 'brutto'],
    vorlagen: [
      { name: 'Ausgaben je Lieferant und Monat', einstellung: leer({ zeilen: [{ feld: 'lieferant' }], spalten: [{ feld: 'datum', gruppierung: 'monat' }], berechnung: 'summe', wert: 'brutto' }) },
      { name: 'Beträge je Status', einstellung: leer({ zeilen: [{ feld: 'status' }], berechnung: 'summe', wert: 'brutto' }) },
    ],
  }
}

// ── Objekte ──────────────────────────────────────────────────────────────────────────────────────

function anzahlDokumente(o: Objekt): number {
  let n = 0
  for (const liste of Object.values(o.dokumente ?? {})) n += liste?.length ?? 0
  return n
}

function objekte(state: AppData): QuellenDaten {
  const status = getStatusMap('immobilien')
  const felder: Feld[] = [
    { id: 'bezeichnung', label: 'Objekt', typ: 'text' },
    { id: 'gruppe', label: 'Gruppe', typ: 'text' },
    { id: 'status', label: 'Status', typ: 'text' },
    { id: 'typ', label: 'Objektart', typ: 'text' },
    { id: 'objektart', label: 'Objektart laut Verkaufsdatenblatt', typ: 'text' },
    { id: 'verantwortlich', label: 'Verantwortlich', typ: 'text' },
    { id: 'prioritaet', label: 'Priorität', typ: 'text', reihenfolge: PRIO },
    { id: 'kaufpreis', label: 'Kaufpreis', typ: 'zahl', euro: true },
    { id: 'nichtOeffentlich', label: 'Nicht öffentlich angeboten', typ: 'jaNein' },
    { id: 'dokumente', label: 'Anzahl Dokumente', typ: 'zahl' },
    { id: 'herkunft', label: 'Herkunft', typ: 'text' },
    { id: 'angelegt', label: 'Angelegt am', typ: 'datum' },
  ]
  const daten: Datensatz[] = state.objekte.map((o) => ({
    _id: o.id,
    bezeichnung: (o.bezeichnung ?? '').trim() || 'Ohne Bezeichnung',
    gruppe: gruppeLabel(o.gruppe),
    status: status[o.status]?.label ?? o.status ?? '',
    typ: o.typ ?? '',
    objektart: (o.verkaufsdaten?.uebersicht?.objektart ?? '').trim(),
    verantwortlich: o.verantwortlich ?? '',
    prioritaet: o.prioritaet ?? '',
    kaufpreis: typeof o.kaufpreis === 'number' && o.kaufpreis > 0 ? o.kaufpreis : null,
    nichtOeffentlich: !!o.offMarket,
    dokumente: anzahlDokumente(o),
    herkunft: o.quelle === 'immoradar' ? 'ImmoRadar' : 'Im CRM angelegt',
    angelegt: erstesDatum(o.activities),
  }))
  return {
    felder,
    daten,
    hauptdatum: 'angelegt',
    kernFelder: ['bezeichnung', 'gruppe', 'status', 'kaufpreis'],
    vorlagen: [
      { name: 'Objekte je Gruppe und Status', einstellung: leer({ zeilen: [{ feld: 'gruppe' }], spalten: [{ feld: 'status' }] }) },
      { name: 'Kaufpreise je Objektart', einstellung: leer({ zeilen: [{ feld: 'typ' }], spalten: [{ feld: 'nichtOeffentlich' }], berechnung: 'summe', wert: 'kaufpreis' }) },
      { name: 'Objekte je Verantwortlichem und Priorität', einstellung: leer({ zeilen: [{ feld: 'verantwortlich' }], spalten: [{ feld: 'prioritaet' }] }) },
    ],
  }
}

// ── Zeiterfassung ────────────────────────────────────────────────────────────────────────────────

function wochentag(iso: string | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return WOCHENTAGE[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]
}

function zeiten(state: AppData): QuellenDaten {
  const objektName = new Map(state.objekte.map((o) => [o.id, (o.bezeichnung ?? '').trim() || 'Ohne Bezeichnung']))
  const felder: Feld[] = [
    { id: 'mitarbeiter', label: 'Mitarbeiter', typ: 'text' },
    { id: 'bezug', label: 'Objekt oder Projekt', typ: 'text' },
    { id: 'taetigkeit', label: 'Tätigkeit', typ: 'text' },
    { id: 'datum', label: 'Datum', typ: 'datum' },
    { id: 'wochentag', label: 'Wochentag', typ: 'text', reihenfolge: WOCHENTAGE },
    { id: 'stunden', label: 'Dauer in Stunden', typ: 'zahl' },
  ]
  const daten: Datensatz[] = state.zeiteintraege.map((z) => {
    const iso = alsIsoDatum(z.datum)
    return {
      _id: z.id,
      mitarbeiter: (z.mitarbeiter ?? '').trim() || 'Ohne Namen',
      bezug: z.objektId ? objektName.get(z.objektId) ?? 'Objekt nicht mehr vorhanden' : (z.bezug ?? '').trim(),
      taetigkeit: (z.taetigkeit ?? '').trim(),
      datum: iso ?? null,
      wochentag: wochentag(iso),
      stunden: Math.round(((Number(z.dauerMin) || 0) / 60) * 100) / 100,
    }
  })
  return {
    felder,
    daten,
    hauptdatum: 'datum',
    kernFelder: ['datum', 'mitarbeiter', 'bezug', 'taetigkeit', 'stunden'],
    vorlagen: [
      { name: 'Stunden je Objekt und Mitarbeiter', einstellung: leer({ zeilen: [{ feld: 'bezug' }], spalten: [{ feld: 'mitarbeiter' }], berechnung: 'summe', wert: 'stunden' }) },
      { name: 'Stunden je Mitarbeiter und Woche', einstellung: leer({ zeilen: [{ feld: 'mitarbeiter' }], spalten: [{ feld: 'datum', gruppierung: 'woche' }], berechnung: 'summe', wert: 'stunden' }) },
      { name: 'Stunden je Tätigkeit und Monat', einstellung: leer({ zeilen: [{ feld: 'taetigkeit' }], spalten: [{ feld: 'datum', gruppierung: 'monat' }], berechnung: 'summe', wert: 'stunden' }) },
    ],
  }
}

// ── To-dos ───────────────────────────────────────────────────────────────────────────────────────

/** „Geplante Zeit" ist freier Text („180 std", „90 min", „2,5 h"). Ohne Einheit: Stunden. */
export function sollStunden(text: string | undefined): number | null {
  const t = (text ?? '').trim().toLowerCase()
  if (!t) return null
  const uhr = /^(\d{1,3}):(\d{2})\s*(h|std\.?|stunden)?$/.exec(t)
  if (uhr) return Number(uhr[1]) + Number(uhr[2]) / 60
  const m = /^(\d+(?:[.,]\d+)?)\s*(min\.?|minuten|h|std\.?|stunden?|stunde)?$/.exec(t)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(n)) return null
  return m[2]?.startsWith('min') ? Math.round((n / 60) * 100) / 100 : n
}

function todos(state: AppData): QuellenDaten {
  const felder: Feld[] = [
    { id: 'aufgabe', label: 'Aufgabe', typ: 'text' },
    { id: 'bereich', label: 'Bereich', typ: 'text' },
    { id: 'zustaendig', label: 'Zuständig', typ: 'text' },
    { id: 'prio', label: 'Prio', typ: 'text', reihenfolge: ['A', 'B', 'C', 'D', 'E'] },
    { id: 'stand', label: 'Offen oder erledigt', typ: 'text', reihenfolge: ['offen', 'erledigt'] },
    { id: 'kundeProjekt', label: 'Kunde oder Projekt', typ: 'text' },
    { id: 'abteilung', label: 'Abteilung', typ: 'text' },
    { id: 'angelegt', label: 'Angelegt am', typ: 'datum' },
    { id: 'erledigenBis', label: 'Erledigen bis', typ: 'datum' },
    { id: 'erledigtAm', label: 'Erledigt am', typ: 'datum' },
    { id: 'sollStunden', label: 'Soll-Zeit in Stunden', typ: 'zahl' },
    { id: 'istStunden', label: 'Ist-Zeit in Stunden', typ: 'zahl' },
    { id: 'zeitkosten', label: 'Zeitkosten', typ: 'zahl', euro: true },
    { id: 'umsatzWert', label: 'Umsatzwert', typ: 'zahl', euro: true },
  ]
  const daten: Datensatz[] = state.todos.map((t: ToDoEintrag) => {
    const ist = typeof t.istZeit === 'number' && Number.isFinite(t.istZeit) ? t.istZeit : undefined
    const kosten = ist !== undefined && typeof t.stundensatz === 'number' && Number.isFinite(t.stundensatz) ? Math.round((ist / 60) * t.stundensatz * 100) / 100 : null
    return {
      _id: t.id,
      aufgabe: (t.aufgabe ?? '').trim(),
      bereich: BEREICH_LABEL(t.bereich),
      zustaendig: (t.zustaendig ?? '').trim(),
      prio: (t.prio ?? '').trim().toUpperCase(),
      stand: t.erledigtAm ? 'erledigt' : 'offen',
      kundeProjekt: (t.kundeProjekt ?? '').trim(),
      abteilung: (t.abteilung ?? '').trim(),
      angelegt: alsIsoDatum(t.erstelltAm) ?? null,
      erledigenBis: alsIsoDatum(t.erledigenBis) ?? null,
      erledigtAm: alsIsoDatum(t.erledigtAm) ?? null,
      sollStunden: sollStunden(t.geplanteZeit),
      istStunden: ist !== undefined ? Math.round((ist / 60) * 100) / 100 : null,
      zeitkosten: kosten,
      umsatzWert: typeof t.umsatzWert === 'number' ? t.umsatzWert : null,
    }
  })
  return {
    felder,
    daten,
    hauptdatum: 'angelegt',
    kernFelder: ['aufgabe', 'bereich', 'zustaendig', 'prio', 'stand'],
    vorlagen: [
      { name: 'Offene To-dos je Zuständigem', einstellung: leer({ zeilen: [{ feld: 'zustaendig' }], spalten: [{ feld: 'prio' }], filter: [{ feld: 'stand', ohne: ['erledigt'] }] }) },
      { name: 'Erledigte To-dos je Monat und Bereich', einstellung: leer({ zeilen: [{ feld: 'erledigtAm', gruppierung: 'monat' }], spalten: [{ feld: 'bereich' }], filter: [{ feld: 'stand', ohne: ['offen'] }] }) },
      { name: 'Ist-Zeit je Bereich und Zuständigem', einstellung: leer({ zeilen: [{ feld: 'bereich' }], spalten: [{ feld: 'zustaendig' }], berechnung: 'summe', wert: 'istStunden' }) },
    ],
  }
}

// ── Abrechnung je Objekt ─────────────────────────────────────────────────────────────────────────

function abrechnung(state: AppData): QuellenDaten {
  const gespeichert = new Map<string, ObjektAbrechnung>(state.abrechnungen.map((a) => [a.objektId || a.id, a]))
  const mitZeit = new Set(state.zeiteintraege.map((z) => z.objektId).filter(Boolean))
  const felder: Feld[] = [
    { id: 'objekt', label: 'Objekt', typ: 'text' },
    { id: 'gruppe', label: 'Gruppe', typ: 'text' },
    { id: 'mitarbeiter', label: 'Mitarbeiter', typ: 'text' },
    { id: 'stunden', label: 'Stunden', typ: 'zahl' },
    { id: 'stundensatz', label: 'Stundensatz', typ: 'zahl', euro: true },
    { id: 'zeitkosten', label: 'Zeitkosten', typ: 'zahl', euro: true },
    { id: 'anteilProzent', label: 'Provisionsanteil in Prozent', typ: 'zahl' },
    { id: 'provisionsanteil', label: 'Provisionsanteil', typ: 'zahl', euro: true },
    { id: 'bleibt', label: 'Bleibt nach Zeitkosten', typ: 'zahl', euro: true },
    { id: 'provisionErfasst', label: 'Provision eingetragen', typ: 'jaNein' },
  ]
  const daten: Datensatz[] = []
  for (const o of state.objekte) {
    const a = gespeichert.get(o.id)
    if (!a && !mitZeit.has(o.id)) continue
    const erg = rechneObjektAbrechnung(o.id, state.zeiteintraege, a)
    for (const p of erg.personen) {
      daten.push({
        _id: `${o.id}|${p.name}`,
        objekt: (o.bezeichnung ?? '').trim() || 'Ohne Bezeichnung',
        gruppe: gruppeLabel(o.gruppe),
        mitarbeiter: p.name,
        stunden: Math.round((p.min / 60) * 100) / 100,
        stundensatz: p.satz ?? null,
        zeitkosten: p.kosten,
        anteilProzent: Math.round(p.anteil * 10) / 10,
        provisionsanteil: p.betrag,
        bleibt: p.betrag === null ? null : Math.round((p.betrag - (p.kosten ?? 0)) * 100) / 100,
        provisionErfasst: erg.provision !== undefined,
      })
    }
  }
  return {
    felder,
    daten,
    kernFelder: ['objekt', 'mitarbeiter', 'stunden', 'zeitkosten', 'provisionsanteil'],
    vorlagen: [
      { name: 'Stunden je Objekt und Mitarbeiter', einstellung: leer({ zeilen: [{ feld: 'objekt' }], spalten: [{ feld: 'mitarbeiter' }], berechnung: 'summe', wert: 'stunden' }) },
      { name: 'Zeitkosten je Objekt und Mitarbeiter', einstellung: leer({ zeilen: [{ feld: 'objekt' }], spalten: [{ feld: 'mitarbeiter' }], berechnung: 'summe', wert: 'zeitkosten' }) },
      { name: 'Provisionsanteile je Mitarbeiter', einstellung: leer({ zeilen: [{ feld: 'mitarbeiter' }], berechnung: 'summe', wert: 'provisionsanteil' }) },
    ],
  }
}

// ── Kontoauszüge ─────────────────────────────────────────────────────────────────────────────────

/** Eine Zeile der Tabelle kontoauszug_auswertungen, wie sie die Seite liest. */
export type KontoauszugZeile = {
  id: string
  kunde_id: string
  bereich: string
  titel: string | null
  erstellt_am: string
  buchungen: unknown
}

type BuchungRoh = { datum?: unknown; text?: unknown; gegenpartei?: unknown; betrag?: unknown; kategorie?: unknown; konto?: unknown; quelle?: unknown }

function kontoauszuege(state: AppData, zeilen: KontoauszugZeile[]): QuellenDaten {
  const nachId = new Map<string, Kunde>()
  for (const b of KUNDEN_BEREICHE) for (const k of b.get(state)) nachId.set(`${b.id}|${k.id}`, k)
  const felder: Feld[] = [
    { id: 'kunde', label: 'Kunde (Akte)', typ: 'text' },
    { id: 'auswertung', label: 'Auswertung', typ: 'text' },
    { id: 'bereich', label: 'Bereich', typ: 'text' },
    { id: 'datum', label: 'Buchungsdatum', typ: 'datum' },
    { id: 'kategorie', label: 'Kategorie', typ: 'text' },
    { id: 'gegenpartei', label: 'Empfänger oder Auftraggeber', typ: 'text' },
    { id: 'text', label: 'Buchungstext', typ: 'text' },
    { id: 'art', label: 'Einnahme oder Ausgabe', typ: 'text', reihenfolge: ['Einnahme', 'Ausgabe'] },
    { id: 'betrag', label: 'Betrag', typ: 'zahl', euro: true },
    { id: 'konto', label: 'Konto', typ: 'text' },
    { id: 'datei', label: 'Datei', typ: 'text' },
  ]
  const daten: Datensatz[] = []
  for (const z of zeilen) {
    // Private Akten gehören nie in die Auswertungen (wie bei „Kunden und Kontakte“).
    if (z.bereich === 'privat') continue
    const k = nachId.get(`${z.bereich}|${z.kunde_id}`)
    const kunde = k ? kundenName(k) : 'Akte nicht sichtbar'
    const bereich = (KUNDEN_BEREICHE.some((b) => b.id === z.bereich) ? kundeBereichLabel(z.bereich as KundeBereich) : z.bereich) || ''
    const titel = (z.titel ?? '').trim() || `Auswertung vom ${String(z.erstellt_am ?? '').slice(0, 10)}`
    const buchungen = Array.isArray(z.buchungen) ? (z.buchungen as BuchungRoh[]) : []
    buchungen.forEach((b, i) => {
      const betrag = typeof b.betrag === 'number' && Number.isFinite(b.betrag) ? b.betrag : null
      daten.push({
        _id: `${z.id}|${i}`,
        kunde,
        auswertung: titel,
        bereich,
        datum: typeof b.datum === 'string' ? alsIsoDatum(b.datum) ?? null : null,
        kategorie: typeof b.kategorie === 'string' ? b.kategorie : '',
        gegenpartei: typeof b.gegenpartei === 'string' ? b.gegenpartei.trim() : '',
        text: typeof b.text === 'string' ? b.text : '',
        art: betrag === null ? '' : betrag < 0 ? 'Ausgabe' : 'Einnahme',
        betrag,
        konto: typeof b.konto === 'string' ? b.konto : '',
        datei: typeof b.quelle === 'string' ? b.quelle : '',
      })
    })
  }
  return {
    felder,
    daten,
    hauptdatum: 'datum',
    kernFelder: ['kunde', 'datum', 'gegenpartei', 'kategorie', 'betrag'],
    vorlagen: [
      { name: 'Ausgaben je Kategorie und Monat', einstellung: leer({ zeilen: [{ feld: 'kategorie' }], spalten: [{ feld: 'datum', gruppierung: 'monat' }], berechnung: 'summe', wert: 'betrag', filter: [{ feld: 'art', ohne: ['Einnahme'] }] }) },
      { name: 'Einnahmen und Ausgaben je Monat', einstellung: leer({ zeilen: [{ feld: 'datum', gruppierung: 'monat' }], spalten: [{ feld: 'art' }], berechnung: 'summe', wert: 'betrag' }) },
      { name: 'Summe je Empfänger oder Auftraggeber', einstellung: leer({ zeilen: [{ feld: 'gegenpartei' }], berechnung: 'summe', wert: 'betrag' }) },
    ],
  }
}

// ── Eigene Datei ─────────────────────────────────────────────────────────────────────────────────

function datei(felder: Feld[], daten: Datensatz[]): QuellenDaten {
  const erstesDatum = felder.find((f) => f.typ === 'datum')
  const ersterText = felder.find((f) => f.typ === 'text')
  const ersteZahl = felder.find((f) => f.typ === 'zahl')
  const vorlagen: Vorlage[] = []
  if (ersterText) vorlagen.push({ name: `Anzahl je ${ersterText.label}`, einstellung: leer({ zeilen: [{ feld: ersterText.id }] }) })
  if (ersterText && ersteZahl) vorlagen.push({ name: `Summe ${ersteZahl.label} je ${ersterText.label}`, einstellung: leer({ zeilen: [{ feld: ersterText.id }], berechnung: 'summe', wert: ersteZahl.id }) })
  if (erstesDatum && ersteZahl) vorlagen.push({ name: `Summe ${ersteZahl.label} je Monat`, einstellung: leer({ zeilen: [{ feld: erstesDatum.id, gruppierung: 'monat' }], berechnung: 'summe', wert: ersteZahl.id }) })
  return { felder, daten, hauptdatum: erstesDatum?.id, kernFelder: felder.slice(0, 4).map((f) => f.id), vorlagen }
}

// ── Auswahl ──────────────────────────────────────────────────────────────────────────────────────

export type Zusatzdaten = {
  kontoauszuege: KontoauszugZeile[]
  datei?: { felder: Feld[]; daten: Datensatz[] }
}

/** Welche Teile des App-Zustands eine Quelle liest — neu gerechnet wird nur, wenn sich einer ändert. */
export function abhaengigkeiten(id: QuelleId, state: AppData, z: Zusatzdaten): unknown[] {
  const alleKunden = KUNDEN_BEREICHE.map((b) => b.get(state))
  switch (id) {
    case 'kunden':
      return alleKunden
    case 'rechnungen':
      return [state.rechnungen, ...alleKunden]
    case 'verbindlichkeiten':
      return [state.verbindlichkeiten]
    case 'objekte':
      return [state.objekte]
    case 'zeiten':
      return [state.zeiteintraege, state.objekte]
    case 'todos':
      return [state.todos]
    case 'abrechnung':
      return [state.abrechnungen, state.zeiteintraege, state.objekte]
    case 'kontoauszuege':
      return [z.kontoauszuege, ...alleKunden]
    case 'datei':
      return [z.datei]
  }
}

export function baueQuelle(id: QuelleId, state: AppData, z: Zusatzdaten): QuellenDaten {
  switch (id) {
    case 'kunden':
      return kunden(state)
    case 'rechnungen':
      return rechnungen(state)
    case 'verbindlichkeiten':
      return verbindlichkeiten(state)
    case 'objekte':
      return objekte(state)
    case 'zeiten':
      return zeiten(state)
    case 'todos':
      return todos(state)
    case 'abrechnung':
      return abrechnung(state)
    case 'kontoauszuege':
      return kontoauszuege(state, z.kontoauszuege)
    case 'datei':
      return z.datei ? datei(z.datei.felder, z.datei.daten) : { felder: [], daten: [], kernFelder: [], vorlagen: [] }
  }
}
