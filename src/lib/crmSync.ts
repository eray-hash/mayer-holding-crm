// Kunden/Mandanten (alle sechs Bereiche), Immobilien-Objekte, Gesprächsprotokolle, Objekt-
// Vorschläge, Vorlagen (alle sieben Bereiche), Rechnungen, Konzepte, Verträge, Objekt-
// Finanzierungen, Projekte/Kanban, Fonds-Investoren(-Dokumente), importierte Dokumente,
// Mail-Vorlagen und Notizen laufen über eine echte, geteilte Datenbank statt nur über den lokalen
// Browser-Speicher — Voraussetzung dafür, dass mehrere Mitarbeiter (und ein einzelner Mitarbeiter
// auf mehreren Geräten) dieselben Daten sehen. Vorher lief nur der erste Block darüber; der Rest
// lag ausschließlich in localStorage und war für jedes Gerät isoliert — ein Mitarbeiter, der auf
// einem anderen Rechner ein Projekt/eine Rechnung/eine Vorlage anlegte, war für alle Kollegen
// unsichtbar. Das wurde am 2026-11-02 im Rahmen eines vollständigen Audits vor Kundenübergabe
// behoben (siehe Projektnotizen).
//
// Strategie: nach jedem Dispatch wird per Objekt-Referenz-Vergleich ermittelt, welche Einträge sich
// geändert haben (der Reducer gibt für geänderte Einträge immer ein neues Objekt zurück,
// unveränderte Einträge behalten dieselbe Referenz) und nur die geänderten Zeilen werden per Upsert
// geschrieben — kein manuelles Nachpflegen pro Action-Typ nötig. Echte Löschungen (eine id
// verschwindet ganz aus allen zugehörigen Arrays) werden separat erkannt und per DELETE
// nachvollzogen — sonst blieben gelöschte Zeilen für immer in der DB liegen und tauchten nach dem
// nächsten Hydrate wieder auf.
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { setMitarbeiterListe } from '../data/constants'
import type { AppData } from '../context/AppContext'
import type {
  Bereich,
  Kunde,
  KundeBereich,
  Objekt,
  Protokoll,
  ObjektVorschlag,
  Vorlage,
  Rechnung,
  Konzept,
  Beratungsvertrag,
  Finanzierung,
  FondsInvestor,
  FondsDokument,
  ImportiertesDokument,
  MailVorlage,
  Notiz,
  Abwesenheit,
} from '../types'
import type { Projekt } from '../types/project'

export { isSupabaseConfigured }

const KUNDE_KEYS: { bereich: KundeBereich; key: keyof AppData }[] = [
  { bereich: 'beratung', key: 'kunden' },
  { bereich: 'erben', key: 'erbenMandanten' },
  { bereich: 'betriebsuebergabe', key: 'betriebsuebergabeMandanten' },
  { bereich: 'betriebsformen', key: 'betriebsformenMandanten' },
  { bereich: 'akademie', key: 'akademieTeilnehmer' },
  { bereich: 'finanzierungen', key: 'finanzierungenMandanten' },
]

// Vorlagen: eine Tabelle über alle sieben Bereiche hinweg (bereich ist nur eine Spalte), analog zu
// "kunden" — anders als die übrigen neuen Collections unten, die je ein eigenes AppData-Feld 1:1 auf
// eine eigene Tabelle abbilden.
const VORLAGEN_KEYS: { bereich: Bereich; key: keyof AppData }[] = [
  { bereich: 'beratung', key: 'vorlagenBeratung' },
  { bereich: 'immobilien', key: 'vorlagenImmobilien' },
  { bereich: 'erben', key: 'vorlagenErben' },
  { bereich: 'betriebsuebergabe', key: 'vorlagenBetriebsuebergabe' },
  { bereich: 'betriebsformen', key: 'vorlagenBetriebsformen' },
  { bereich: 'akademie', key: 'vorlagenAkademie' },
  { bereich: 'finanzierungen', key: 'vorlagenFinanzierungen' },
]

function diffById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  if (prev === next) return []
  const prevMap = new Map(prev.map((x) => [x.id, x]))
  return next.filter((x) => prevMap.get(x.id) !== x)
}

function kundeToRow(bereich: KundeBereich, k: Kunde) {
  return {
    id: k.id,
    bereich,
    firma: k.firma,
    ansprechpartner: k.ansprechpartner,
    email: k.email,
    telefon: k.telefon,
    prioritaet: k.prioritaet,
    status: k.status,
    follow_up: k.followUp,
    verantwortlich: k.verantwortlich,
    letzte_aktivitaet: k.letzteAktivitaet,
    activities: k.activities,
    unterlagen_checkliste: k.unterlagenCheckliste ?? null,
    signaturen: k.signaturen ?? null,
    kaeuferprofil: k.kaeuferprofil ?? null,
    selbstauskunft: k.selbstauskunft ?? null,
    dokumente: k.dokumente ?? null,
  }
}

function rowToKunde(row: any): Kunde {
  return {
    id: row.id,
    firma: row.firma,
    ansprechpartner: row.ansprechpartner,
    email: row.email,
    telefon: row.telefon,
    prioritaet: row.prioritaet,
    status: row.status,
    followUp: row.follow_up,
    verantwortlich: row.verantwortlich,
    letzteAktivitaet: row.letzte_aktivitaet,
    activities: row.activities ?? [],
    unterlagenCheckliste: row.unterlagen_checkliste ?? undefined,
    signaturen: row.signaturen ?? undefined,
    kaeuferprofil: row.kaeuferprofil ?? undefined,
    selbstauskunft: row.selbstauskunft ?? undefined,
    dokumente: row.dokumente ?? undefined,
  }
}

function objektToRow(o: Objekt) {
  return {
    id: o.id,
    bezeichnung: o.bezeichnung,
    adresse: o.adresse,
    gruppe: o.gruppe,
    typ: o.typ,
    kaufpreis: o.kaufpreis,
    prioritaet: o.prioritaet,
    status: o.status,
    follow_up: o.followUp,
    verantwortlich: o.verantwortlich,
    activities: o.activities,
    dokumente: o.dokumente,
    quelle: o.quelle ?? null,
    immo_radar_link: o.immoRadarLink ?? null,
    lukrativitaet: o.lukrativitaet ?? null,
    zugewiesener_kunde: o.zugewiesenerKunde ?? null,
    eigentuemer: o.eigentuemer ?? null,
  }
}

function rowToObjekt(row: any): Objekt {
  return {
    id: row.id,
    bezeichnung: row.bezeichnung,
    adresse: row.adresse,
    gruppe: row.gruppe,
    typ: row.typ,
    kaufpreis: Number(row.kaufpreis),
    prioritaet: row.prioritaet,
    status: row.status,
    followUp: row.follow_up,
    verantwortlich: row.verantwortlich,
    activities: row.activities ?? [],
    dokumente: row.dokumente ?? {},
    quelle: row.quelle ?? undefined,
    immoRadarLink: row.immo_radar_link ?? undefined,
    lukrativitaet: row.lukrativitaet ?? undefined,
    zugewiesenerKunde: row.zugewiesener_kunde ?? undefined,
    eigentuemer: row.eigentuemer ?? undefined,
  }
}

function protokollToRow(p: Protokoll) {
  return {
    id: p.id,
    bereich: p.bereich,
    kunde_id: p.kundeId,
    datum: p.datum,
    teilnehmer: p.teilnehmer,
    betreff: p.betreff,
    text: p.text,
    kernthemen: p.kernthemen ?? null,
    vereinbarungen: p.vereinbarungen ?? null,
    offene_punkte: p.offenePunkte ?? null,
    stimmung: p.stimmung ?? null,
    ki_zusammenfassung: p.kiZusammenfassung ?? null,
  }
}

function rowToProtokoll(row: any): Protokoll {
  return {
    id: row.id,
    bereich: row.bereich,
    kundeId: row.kunde_id,
    datum: row.datum,
    teilnehmer: row.teilnehmer,
    betreff: row.betreff,
    text: row.text,
    kernthemen: row.kernthemen ?? undefined,
    vereinbarungen: row.vereinbarungen ?? undefined,
    offenePunkte: row.offene_punkte ?? undefined,
    stimmung: row.stimmung ?? undefined,
    kiZusammenfassung: row.ki_zusammenfassung ?? undefined,
  }
}

function vorschlagToRow(v: ObjektVorschlag) {
  return {
    id: v.id,
    objekt_id: v.objektId,
    kunde_bereich: v.kundeBereich,
    kunde_id: v.kundeId,
    kunde_name: v.kundeName,
    steuer_begruendung: v.steuerBegruendung,
    status: v.status,
    erstellt_am: v.erstelltAm,
    erstellt_von: v.erstelltVon,
    beantwortet_am: v.beantwortetAm ?? null,
  }
}

function rowToVorschlag(row: any): ObjektVorschlag {
  return {
    id: row.id,
    objektId: row.objekt_id,
    kundeBereich: row.kunde_bereich,
    kundeId: row.kunde_id,
    kundeName: row.kunde_name,
    steuerBegruendung: row.steuer_begruendung,
    status: row.status,
    erstelltAm: row.erstellt_am,
    erstelltVon: row.erstellt_von,
    beantwortetAm: row.beantwortet_am ?? undefined,
  }
}

function vorlageToRow(bereich: Bereich, v: Vorlage) {
  return {
    id: v.id,
    bereich,
    kategorie: v.kategorie,
    name: v.name,
    typ: v.typ,
    zuletzt_geaendert: v.zuletztGeaendert,
    text: v.text,
    formular_pfad: v.formularPfad ?? null,
  }
}

function rowToVorlage(row: any): Vorlage {
  return {
    id: row.id,
    kategorie: row.kategorie,
    name: row.name,
    typ: row.typ,
    zuletztGeaendert: row.zuletzt_geaendert,
    text: row.text,
    formularPfad: row.formular_pfad ?? undefined,
  }
}

function rechnungToRow(r: Rechnung) {
  return {
    id: r.id,
    nummer: r.nummer,
    kunde_id: r.kundeId,
    datum: r.datum,
    betrag_netto: r.betragNetto,
    betrag_brutto: r.betragBrutto,
    status: r.status,
    zahlungsziel: r.zahlungsziel,
    mahnstufe: r.mahnstufe ?? null,
  }
}

function rowToRechnung(row: any): Rechnung {
  return {
    id: row.id,
    nummer: row.nummer,
    kundeId: row.kunde_id,
    datum: row.datum,
    betragNetto: Number(row.betrag_netto),
    betragBrutto: Number(row.betrag_brutto),
    status: row.status,
    zahlungsziel: row.zahlungsziel,
    mahnstufe: row.mahnstufe ?? undefined,
  }
}

function konzeptToRow(k: Konzept) {
  return { id: k.id, kunde_id: k.kundeId, datum: k.datum, titel: k.titel, version: k.version, status: k.status }
}

function rowToKonzept(row: any): Konzept {
  return { id: row.id, kundeId: row.kunde_id, datum: row.datum, titel: row.titel, version: row.version, status: row.status }
}

function vertragToRow(v: Beratungsvertrag) {
  return { id: v.id, kunde_id: v.kundeId, vertragsnr: v.vertragsnr, datum: v.datum, laufzeit: v.laufzeit, volumen: v.volumen, datei: v.datei }
}

function rowToVertrag(row: any): Beratungsvertrag {
  return {
    id: row.id,
    kundeId: row.kunde_id,
    vertragsnr: row.vertragsnr,
    datum: row.datum,
    laufzeit: row.laufzeit,
    volumen: Number(row.volumen),
    datei: row.datei,
  }
}

// Tabellenname bewusst "objekt_finanzierungen" statt "finanzierungen", um Verwechslung mit dem
// gleichnamigen Geschäftsbereich "Finanzierungen" (eigene kunden-Zeilen) zu vermeiden.
function objektFinanzierungToRow(f: Finanzierung) {
  return {
    id: f.id,
    objekt_id: f.objektId,
    bank: f.bank,
    darlehenssumme: f.darlehenssumme,
    zinssatz: f.zinssatz,
    laufzeit: f.laufzeit,
    status: f.status,
    ansprechpartner: f.ansprechpartner,
  }
}

function rowToObjektFinanzierung(row: any): Finanzierung {
  return {
    id: row.id,
    objektId: row.objekt_id,
    bank: row.bank,
    darlehenssumme: Number(row.darlehenssumme),
    zinssatz: Number(row.zinssatz),
    laufzeit: row.laufzeit,
    status: row.status,
    ansprechpartner: row.ansprechpartner,
  }
}

// Meilensteine/Aufgaben bleiben verschachtelt als JSONB (analog zu kunden.activities) — keine
// eigenen Tabellen nötig, da sie nie unabhängig vom übergeordneten Projekt gelesen/geschrieben werden.
function projektToRow(p: Projekt) {
  return {
    id: p.id,
    bereich: p.bereich,
    name: p.name,
    kind: p.kind,
    status: p.status,
    prioritaet: p.prioritaet,
    verantwortlich: p.verantwortlich,
    aktuelle_aufgabe: p.aktuelleAufgabe,
    verknuepft_kunde_id: p.verknuepftKundeId ?? null,
    verknuepft_objekt_id: p.verknuepftObjektId ?? null,
    meilensteine: p.meilensteine,
  }
}

function rowToProjekt(row: any): Projekt {
  return {
    id: row.id,
    bereich: row.bereich,
    name: row.name,
    kind: row.kind,
    status: row.status,
    prioritaet: row.prioritaet,
    verantwortlich: row.verantwortlich,
    aktuelleAufgabe: row.aktuelle_aufgabe ?? null,
    verknuepftKundeId: row.verknuepft_kunde_id ?? undefined,
    verknuepftObjektId: row.verknuepft_objekt_id ?? undefined,
    meilensteine: row.meilensteine ?? [],
  }
}

function fondsInvestorToRow(f: FondsInvestor) {
  return {
    id: f.id,
    name: f.name,
    email: f.email,
    telefon: f.telefon,
    seit: f.seit,
    zeichnungen: f.zeichnungen,
    ausschuettungen: f.ausschuettungen,
    dokumente: f.dokumente,
  }
}

function rowToFondsInvestor(row: any): FondsInvestor {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    telefon: row.telefon,
    seit: row.seit,
    zeichnungen: row.zeichnungen ?? [],
    ausschuettungen: row.ausschuettungen ?? [],
    dokumente: row.dokumente ?? [],
  }
}

function fondsDokumentAllgemeinToRow(d: FondsDokument) {
  return { id: d.id, name: d.name, kategorie: d.kategorie, datum: d.datum, groesse: d.groesse }
}

function rowToFondsDokumentAllgemein(row: any): FondsDokument {
  return { id: row.id, name: row.name, kategorie: row.kategorie, datum: row.datum, groesse: row.groesse }
}

function importDokToRow(d: ImportiertesDokument) {
  return {
    id: d.id,
    dateiname: d.dateiname,
    hochgeladen_am: d.hochgeladenAm,
    vorschau_data_url: d.vorschauDataUrl ?? null,
    erkannter_text: d.erkannterText,
    vorschlag: d.vorschlag ?? null,
    zugewiesen: d.zugewiesen ?? null,
  }
}

function rowToImportDok(row: any): ImportiertesDokument {
  return {
    id: row.id,
    dateiname: row.dateiname,
    hochgeladenAm: row.hochgeladen_am,
    vorschauDataUrl: row.vorschau_data_url ?? undefined,
    erkannterText: row.erkannter_text,
    vorschlag: row.vorschlag ?? undefined,
    zugewiesen: row.zugewiesen ?? undefined,
  }
}

function mailVorlageToRow(m: MailVorlage) {
  return { id: m.id, name: m.name, betreff: m.betreff, text: m.text }
}

function rowToMailVorlage(row: any): MailVorlage {
  return { id: row.id, name: row.name, betreff: row.betreff, text: row.text }
}

function notizToRow(n: Notiz) {
  return { id: n.id, text: n.text, erstellt_am: n.erstelltAm, faelligkeits_datum: n.faelligkeitsDatum ?? null, erledigt: n.erledigt }
}

function rowToNotiz(row: any): Notiz {
  return {
    id: row.id,
    text: row.text,
    erstelltAm: row.erstellt_am,
    faelligkeitsDatum: row.faelligkeits_datum ?? undefined,
    erledigt: row.erledigt,
  }
}

function abwesenheitToRow(a: Abwesenheit) {
  return { id: a.id, mitarbeiter_name: a.mitarbeiterName, von: a.von, bis: a.bis }
}

function rowToAbwesenheit(row: any): Abwesenheit {
  return { id: row.id, mitarbeiterName: row.mitarbeiter_name, von: row.von, bis: row.bis }
}

function logFehler(kontext: string, error: { message: string } | null) {
  if (error) console.error(`Supabase-Sync fehlgeschlagen (${kontext}):`, error.message)
}

// Einfache 1:1-Collections: genau ein AppData-Feld, genau eine Tabelle, keine Bereichs-Aufteilung
// (anders als Kunden/Vorlagen, die über mehrere Arrays verteilt sind, siehe oben).
const SIMPLE_SYNCS: { table: string; key: keyof AppData; label: (item: any) => string; toRow: (item: any) => Record<string, unknown> }[] = [
  { table: 'rechnungen', key: 'rechnungen', label: (r: Rechnung) => `Rechnung ${r.nummer}`, toRow: rechnungToRow },
  { table: 'konzepte', key: 'konzepte', label: (k: Konzept) => `Konzept ${k.titel}`, toRow: konzeptToRow },
  { table: 'vertraege', key: 'vertraege', label: (v: Beratungsvertrag) => `Vertrag ${v.vertragsnr}`, toRow: vertragToRow },
  { table: 'objekt_finanzierungen', key: 'finanzierungen', label: (f: Finanzierung) => `Finanzierung ${f.bank}`, toRow: objektFinanzierungToRow },
  { table: 'projekte', key: 'projekte', label: (p: Projekt) => `Projekt ${p.name}`, toRow: projektToRow },
  { table: 'fonds_investoren', key: 'fondsInvestoren', label: (f: FondsInvestor) => `Fonds-Investor ${f.name}`, toRow: fondsInvestorToRow },
  {
    table: 'fonds_dokumente_allgemein',
    key: 'fondsDokumenteAllgemein',
    label: (d: FondsDokument) => `Fonds-Dokument ${d.name}`,
    toRow: fondsDokumentAllgemeinToRow,
  },
  {
    table: 'importierte_dokumente',
    key: 'importierteDokumente',
    label: (d: ImportiertesDokument) => `Importiertes Dokument ${d.dateiname}`,
    toRow: importDokToRow,
  },
  { table: 'mail_vorlagen', key: 'mailVorlagen', label: (m: MailVorlage) => `Mail-Vorlage ${m.name}`, toRow: mailVorlageToRow },
  { table: 'notizen', key: 'notizen', label: () => 'Notiz', toRow: notizToRow },
  { table: 'abwesenheiten', key: 'abwesenheiten', label: (a: Abwesenheit) => `Abwesenheit ${a.mitarbeiterName}`, toRow: abwesenheitToRow },
]

function syncSimpleCollection(client: NonNullable<typeof supabase>, prev: AppData, next: AppData, cfg: (typeof SIMPLE_SYNCS)[number]) {
  const prevListe = prev[cfg.key] as { id: string }[]
  const nextListe = next[cfg.key] as { id: string }[]
  if (prevListe === nextListe) return

  const nextIds = new Set(nextListe.map((x) => x.id))
  const geloeschteIds = prevListe.filter((x) => !nextIds.has(x.id)).map((x) => x.id)
  if (geloeschteIds.length > 0) {
    client.from(cfg.table).delete().in('id', geloeschteIds).then(({ error }) => logFehler(`${cfg.table} löschen`, error))
  }

  for (const item of diffById(prevListe, nextListe)) {
    client.from(cfg.table).upsert(cfg.toRow(item)).then(({ error }) => logFehler(cfg.label(item), error))
  }
}

// Nach jedem Dispatch aufgerufen (außer beim initialen Hydrate selbst) — schreibt nur, was sich
// seit dem letzten Stand tatsächlich geändert hat. Läuft bewusst "fire and forget": ein CRM-Nutzer
// soll nicht auf einen Netzwerk-Roundtrip warten müssen, bevor die UI reagiert.
export function syncAfterDispatch(prev: AppData, next: AppData) {
  if (!supabase) return
  const client = supabase

  // Echte Löschungen (Pflege-Modus: "loeschen"/"merge") erkennen — wichtig: über ALLE
  // KundeBereiche hinweg vergleichen, nicht Array für Array. Ein Kunde, der nur von einem
  // Bereichs-Array ins andere verschoben wurde ("verschieben"), darf NICHT gelöscht werden — er
  // taucht dann zwar im alten Array nicht mehr auf, aber weiterhin (mit derselben id) im neuen, und
  // die kunden-Tabelle ist ohnehin ein einziges Bereich-übergreifendes Table (bereich ist nur eine
  // Spalte) — der Upsert unten mit derselben id aktualisiert dort einfach die bereich-Spalte.
  const prevKundenIds = new Set(KUNDE_KEYS.flatMap(({ key }) => (prev[key] as Kunde[]).map((k) => k.id)))
  const nextKundenIds = new Set(KUNDE_KEYS.flatMap(({ key }) => (next[key] as Kunde[]).map((k) => k.id)))
  const geloeschteKundenIds = [...prevKundenIds].filter((id) => !nextKundenIds.has(id))
  if (geloeschteKundenIds.length > 0) {
    client.from('kunden').delete().in('id', geloeschteKundenIds).then(({ error }) => logFehler('Kunde löschen', error))
  }
  for (const { bereich, key } of KUNDE_KEYS) {
    for (const k of diffById(prev[key] as Kunde[], next[key] as Kunde[])) {
      client.from('kunden').upsert(kundeToRow(bereich, k)).then(({ error }) => logFehler(`Kunde ${k.firma}`, error))
    }
  }

  // Vorlagen: dasselbe Muster wie Kunden (eine Tabelle, sieben Arrays).
  const prevVorlagenIds = new Set(VORLAGEN_KEYS.flatMap(({ key }) => (prev[key] as Vorlage[]).map((v) => v.id)))
  const nextVorlagenIds = new Set(VORLAGEN_KEYS.flatMap(({ key }) => (next[key] as Vorlage[]).map((v) => v.id)))
  const geloeschteVorlagenIds = [...prevVorlagenIds].filter((id) => !nextVorlagenIds.has(id))
  if (geloeschteVorlagenIds.length > 0) {
    client.from('vorlagen').delete().in('id', geloeschteVorlagenIds).then(({ error }) => logFehler('Vorlage löschen', error))
  }
  for (const { bereich, key } of VORLAGEN_KEYS) {
    for (const v of diffById(prev[key] as Vorlage[], next[key] as Vorlage[])) {
      client.from('vorlagen').upsert(vorlageToRow(bereich, v)).then(({ error }) => logFehler(`Vorlage ${v.name}`, error))
    }
  }

  for (const o of diffById(prev.objekte, next.objekte)) {
    client.from('objekte').upsert(objektToRow(o)).then(({ error }) => logFehler(`Objekt ${o.bezeichnung}`, error))
  }

  for (const p of diffById(prev.protokolle, next.protokolle)) {
    client.from('protokolle').upsert(protokollToRow(p)).then(({ error }) => logFehler('Protokoll', error))
  }

  for (const v of diffById(prev.objektVorschlaege, next.objektVorschlaege)) {
    client.from('objekt_vorschlaege').upsert(vorschlagToRow(v)).then(({ error }) => logFehler('Objekt-Vorschlag', error))
  }

  for (const cfg of SIMPLE_SYNCS) {
    syncSimpleCollection(client, prev, next, cfg)
  }
}

export type HydratedData = {
  kunden: Record<KundeBereich, Kunde[]>
  objekte: Objekt[]
  protokolle: Protokoll[]
  objektVorschlaege: ObjektVorschlag[]
  vorlagen: Record<Bereich, Vorlage[]>
  rechnungen: Rechnung[]
  konzepte: Konzept[]
  vertraege: Beratungsvertrag[]
  finanzierungen: Finanzierung[]
  projekte: Projekt[]
  fondsInvestoren: FondsInvestor[]
  fondsDokumenteAllgemein: FondsDokument[]
  importierteDokumente: ImportiertesDokument[]
  mailVorlagen: MailVorlage[]
  notizen: Notiz[]
  abwesenheiten: Abwesenheit[]
}

// Lädt den aktuellen, geteilten Stand beim Start (und kann für ein manuelles "Aktualisieren" erneut
// aufgerufen werden). Es gibt noch keine Supabase-Realtime-Anbindung — Änderungen eines anderen
// Geräts/Mitarbeiters werden beim nächsten Neuladen der Seite sichtbar, nicht live.
export async function hydrateFromSupabase(): Promise<HydratedData | null> {
  if (!supabase) return null
  const [
    kundenRes,
    objekteRes,
    protokolleRes,
    vorschlaegeRes,
    vorlagenRes,
    rechnungenRes,
    konzepteRes,
    vertraegeRes,
    finanzierungenRes,
    projekteRes,
    fondsInvestorenRes,
    fondsDokumenteRes,
    importierteDokumenteRes,
    mailVorlagenRes,
    notizenRes,
    abwesenheitenRes,
    mitarbeiterRes,
  ] = await Promise.all([
    supabase.from('kunden').select('*'),
    supabase.from('objekte').select('*'),
    supabase.from('protokolle').select('*'),
    supabase.from('objekt_vorschlaege').select('*'),
    supabase.from('vorlagen').select('*'),
    supabase.from('rechnungen').select('*'),
    supabase.from('konzepte').select('*'),
    supabase.from('vertraege').select('*'),
    supabase.from('objekt_finanzierungen').select('*'),
    supabase.from('projekte').select('*'),
    supabase.from('fonds_investoren').select('*'),
    supabase.from('fonds_dokumente_allgemein').select('*'),
    supabase.from('importierte_dokumente').select('*'),
    supabase.from('mail_vorlagen').select('*'),
    supabase.from('notizen').select('*'),
    supabase.from('abwesenheiten').select('*'),
    supabase.from('mitarbeiter').select('name').eq('aktiv', true).order('name'),
  ])
  for (const res of [
    kundenRes,
    objekteRes,
    protokolleRes,
    vorschlaegeRes,
    vorlagenRes,
    rechnungenRes,
    konzepteRes,
    vertraegeRes,
    finanzierungenRes,
    projekteRes,
    fondsInvestorenRes,
    fondsDokumenteRes,
    importierteDokumenteRes,
    mailVorlagenRes,
    notizenRes,
    abwesenheitenRes,
  ]) {
    if (res.error) throw new Error(res.error.message)
  }

  const kunden: Record<KundeBereich, Kunde[]> = {
    beratung: [],
    erben: [],
    betriebsuebergabe: [],
    betriebsformen: [],
    akademie: [],
    finanzierungen: [],
  }
  for (const row of kundenRes.data ?? []) {
    kunden[row.bereich as KundeBereich].push(rowToKunde(row))
  }

  const vorlagen: Record<Bereich, Vorlage[]> = {
    beratung: [],
    immobilien: [],
    erben: [],
    betriebsuebergabe: [],
    betriebsformen: [],
    akademie: [],
    finanzierungen: [],
  }
  for (const row of vorlagenRes.data ?? []) {
    vorlagen[row.bereich as Bereich].push(rowToVorlage(row))
  }

  // Ersetzt die anfänglichen Platzhalter-Namen durch die echte, aktive Mitarbeiter-Liste (siehe
  // constants.ts) — nicht Teil von AppData, da "Verantwortlich"-Dropdowns den Modul-Export direkt
  // importieren, nicht useApp().
  if (!mitarbeiterRes.error) {
    setMitarbeiterListe((mitarbeiterRes.data ?? []).map((m: { name: string }) => m.name))
  }

  return {
    kunden,
    objekte: (objekteRes.data ?? []).map(rowToObjekt),
    protokolle: (protokolleRes.data ?? []).map(rowToProtokoll),
    objektVorschlaege: (vorschlaegeRes.data ?? []).map(rowToVorschlag),
    vorlagen,
    rechnungen: (rechnungenRes.data ?? []).map(rowToRechnung),
    konzepte: (konzepteRes.data ?? []).map(rowToKonzept),
    vertraege: (vertraegeRes.data ?? []).map(rowToVertrag),
    finanzierungen: (finanzierungenRes.data ?? []).map(rowToObjektFinanzierung),
    projekte: (projekteRes.data ?? []).map(rowToProjekt),
    fondsInvestoren: (fondsInvestorenRes.data ?? []).map(rowToFondsInvestor),
    fondsDokumenteAllgemein: (fondsDokumenteRes.data ?? []).map(rowToFondsDokumentAllgemein),
    importierteDokumente: (importierteDokumenteRes.data ?? []).map(rowToImportDok),
    mailVorlagen: (mailVorlagenRes.data ?? []).map(rowToMailVorlage),
    notizen: (notizenRes.data ?? []).map(rowToNotiz),
    abwesenheiten: (abwesenheitenRes.data ?? []).map(rowToAbwesenheit),
  }
}

// Einmalige Migration: die oben neu an Supabase angeschlossenen Collections lagen bis 2026-11-02
// ausschließlich in localStorage — ein echter Mitarbeiter kann zu diesem Zeitpunkt bereits echte
// Vorlagen/Rechnungen/Kanban-Karten/Notizen etc. in seinem Browser haben. Käme beim ersten Laden
// nach diesem Update einfach die (anfangs leere) Supabase-Tabelle zum Zug, würden diese Daten
// faktisch verschwinden (und beim nächsten localStorage-Schreiben sogar überschrieben). Darum: ist
// eine Tabelle serverseitig leer, aber lokal vorhanden, wird der lokale Stand einmalig hochgeladen
// und direkt mit angezeigt, statt verworfen zu werden.
//
// WICHTIG: "serverseitig leer" ist KEIN zuverlässiges "noch nie migriert"-Signal — eine Tabelle kann
// später aus völlig legitimen Gründen wieder leer werden (z.B. nach einer echten Löschung), und ein
// Browser mit noch länger offenem Tab/veraltetem localStorage würde dann versehentlich erneut
// hochladen (real am 2026-11-03 passiert: eine gelöschte Test-Notiz kam über eine andere Browser-
// Session zurück). Der eigentliche Schutz dagegen sitzt daher NICHT hier, sondern in
// AppContext.tsx's Hydrate-Effekt (MIGRATION_FLAG_KEY) — diese Funktion hier wird pro Browser nur
// noch einmal überhaupt aufgerufen, unabhängig vom Server-Zustand bei späteren Besuchen.
//
// fondsInvestoren/fondsDokumenteAllgemein sind bewusst NICHT dabei: die lokalen Demo-Seed-Daten
// dort sind erfundene Platzhalter-Investoren (z.B. "Dr. Michael Ostermann") — ein unberührter
// Mitarbeiter-Browser hat die noch unverändert, und die würden sonst als scheinbar echte
// Investoren-Datensätze in der Produktions-DB landen.
const SIMPLE_MIGRATIONEN: { key: keyof AppData; table: string; toRow: (item: any) => Record<string, unknown> }[] = [
  { key: 'projekte', table: 'projekte', toRow: projektToRow },
  { key: 'importierteDokumente', table: 'importierte_dokumente', toRow: importDokToRow },
  { key: 'mailVorlagen', table: 'mail_vorlagen', toRow: mailVorlageToRow },
  { key: 'notizen', table: 'notizen', toRow: notizToRow },
]

export async function migriereLokaleDatenFallsLeer(hydrated: HydratedData, lokal: Partial<AppData>): Promise<HydratedData> {
  if (!supabase) return hydrated
  const client = supabase
  const result: HydratedData = { ...hydrated, vorlagen: { ...hydrated.vorlagen } }

  for (const { key, table, toRow } of SIMPLE_MIGRATIONEN) {
    const serverListe = (result as any)[key] as { id: string }[]
    const lokaleListe = (lokal as any)[key] as { id: string }[] | undefined
    if (serverListe.length > 0 || !Array.isArray(lokaleListe) || lokaleListe.length === 0) continue
    const { error } = await client.from(table).upsert(lokaleListe.map(toRow))
    if (error) {
      console.error(`Migration fehlgeschlagen (${table}):`, error.message)
      continue
    }
    ;(result as any)[key] = lokaleListe
  }

  // Rechnungen/Konzepte/Verträge/Objekt-Finanzierungen referenzieren einen Kunden bzw. ein Objekt
  // per id — die ursprünglichen Demo-Seed-Daten verweisen auf erfundene ids (z.B. "k7", "o1"), die
  // es in der echten, bereits per Supabase geteilten kunden/objekte-Tabelle nie gab. Nur Einträge
  // migrieren, deren referenzierter Kunde/Objekt tatsächlich real existiert — alles andere ist mit
  // hoher Sicherheit unangetasteter Demo-Datenmüll, kein echtes Arbeitsergebnis.
  const echteKundenIds = new Set(Object.values(result.kunden).flat().map((k) => k.id))
  const echteObjektIds = new Set(result.objekte.map((o) => o.id))

  async function migriereGefiltert<T extends { id: string }>(
    key: keyof AppData,
    table: string,
    toRow: (item: T) => Record<string, unknown>,
    gueltig: (item: T) => boolean,
  ) {
    const serverListe = (result as any)[key] as { id: string }[]
    const lokaleListe = (lokal as any)[key] as T[] | undefined
    if (serverListe.length > 0 || !Array.isArray(lokaleListe) || lokaleListe.length === 0) return
    const echte = lokaleListe.filter(gueltig)
    if (echte.length === 0) return
    const { error } = await client.from(table).upsert(echte.map(toRow))
    if (error) {
      console.error(`Migration fehlgeschlagen (${table}):`, error.message)
      return
    }
    ;(result as any)[key] = echte
  }

  await migriereGefiltert<Rechnung>('rechnungen', 'rechnungen', rechnungToRow, (r) => echteKundenIds.has(r.kundeId))
  await migriereGefiltert<Konzept>('konzepte', 'konzepte', konzeptToRow, (k) => echteKundenIds.has(k.kundeId))
  await migriereGefiltert<Beratungsvertrag>('vertraege', 'vertraege', vertragToRow, (v) => echteKundenIds.has(v.kundeId))
  await migriereGefiltert<Finanzierung>('finanzierungen', 'objekt_finanzierungen', objektFinanzierungToRow, (f) => echteObjektIds.has(f.objektId))

  for (const { bereich, key } of VORLAGEN_KEYS) {
    const serverListe = result.vorlagen[bereich]
    const lokaleListe = (lokal as any)[key] as Vorlage[] | undefined
    if (serverListe.length > 0 || !Array.isArray(lokaleListe) || lokaleListe.length === 0) continue
    const { error } = await client.from('vorlagen').upsert(lokaleListe.map((v) => vorlageToRow(bereich, v)))
    if (error) {
      console.error('Migration fehlgeschlagen (vorlagen):', error.message)
      continue
    }
    result.vorlagen[bereich] = lokaleListe
  }

  return result
}
