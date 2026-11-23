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
  ImmoFrage,
  Zeiteintrag,
  Tagesplan,
  Wochenplan,
  Weitergabe,
  ObjektAbrechnung,
  TrefferMeldung,
  ToDoEintrag,
  ToDoFreigabe,
  Verbindlichkeit,
} from '../types'
import type { Projekt } from '../types/project'
import { alleZeilen } from './alleZeilen'
import { meldeFehler } from './fehlerMelden'
import { alsListe, fuehreListeZusammen, gleich, type ListenEintrag } from './syncZusammenfuehren'
import {
  legeAn,
  legeAnFallsNieGespeichert,
  loescheZeilen,
  merkeGeladen,
  merkeInDatenbank,
  plane,
  schreibeSpaeter,
  setzeMelder,
  warteAufSchreibvorgaenge,
  istNetzFehler,
  type Ausgang,
} from './zeilenSchreiben'

export { isSupabaseConfigured }
// Früher hier definiert; jetzt in den reinen Hilfsdateien (mit Tests), hier nur weitergereicht.
export { fuehreListeZusammen, wendeServerStandAn } from './syncZusammenfuehren'
export { schreibtGerade } from './zeilenSchreiben'

const KUNDE_KEYS: { bereich: KundeBereich; key: keyof AppData }[] = [
  { bereich: 'beratung', key: 'kunden' },
  { bereich: 'erben', key: 'erbenMandanten' },
  { bereich: 'betriebsuebergabe', key: 'betriebsuebergabeMandanten' },
  { bereich: 'betriebsformen', key: 'betriebsformenMandanten' },
  { bereich: 'akademie', key: 'akademieTeilnehmer' },
  { bereich: 'finanzierungen', key: 'finanzierungenMandanten' },
  { bereich: 'privat', key: 'privatKunden' },
  { bereich: 'immobilienkunden', key: 'immobilienKunden' },
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
    verantwortlich_email: k.verantwortlichEmail ?? null,
    // Die Art gibt es nur im privaten Bereich (Datenbank-Prüfung) — beim Übernehmen in einen Bereich leeren.
    privat_art: bereich === 'privat' ? (k.privatArt ?? null) : null,
    letzte_aktivitaet: k.letzteAktivitaet,
    activities: k.activities,
    unterlagen_checkliste: k.unterlagenCheckliste ?? null,
    signaturen: k.signaturen ?? null,
    kaeuferprofil: k.kaeuferprofil ?? null,
    immo_stammdaten: k.immoStammdaten ?? null,
    gesuche: k.gesuche ?? null,
    unterlagen_anforderungen: k.unterlagenAnforderungen ?? null,
    unternehmensbewertung: k.unternehmensbewertung ?? null,
    selbstauskunft: k.selbstauskunft ?? null,
    anschrift: k.anschrift?.trim() ? k.anschrift : null,
    // Projekt-Checkliste (20.11.2026)
    sachverhalt: k.sachverhalt?.trim() ? k.sachverhalt : null,
    branche: k.branche?.trim() ? k.branche : null,
    vermittler: k.vermittler?.name?.trim() ? k.vermittler : null,
    dienstleistungen: k.dienstleistungen?.length ? k.dienstleistungen : null,
    auftrag_chance: k.auftragChance ?? null,
    naechste_schritte: k.naechsteSchritte?.trim() ? k.naechsteSchritte : null,
    ampel_manuell: k.ampelManuell ?? null,
    seminare: k.seminare?.length ? k.seminare : null,
    dokumente: k.dokumente ?? null,
    pruef_hinweis: k.pruefHinweis ?? null,
    verknuepfte_kunden: k.verknuepfteKunden ?? null,
    // unternehmensbewertung_recherche fehlt hier bewusst: die Spalte gehört dem Server (die Recherche
    // schreibt dort Schritt für Schritt ihren Zustand). Ein Zurückschreiben aus dem Browser würde
    // einen neueren Zwischenstand mit einem älteren überschreiben und die Recherche abwürgen.
    // Nur mitschicken, wenn vorhanden: so überschreibt ein Tab mit altem Stand eine inzwischen
    // gespeicherte Analyse nicht mit "leer".
    ...(k.potenzialAnalyse ? { potenzial_analyse: k.potenzialAnalyse } : {}),
    // Gleiches Muster für die Bonitätseinschätzung (schreibt der Server, siehe bonitaet_pruefen): nur
    // mitschicken, wenn vorhanden — ein Fenster ohne Einschätzung leert die Spalte nie.
    ...(k.bonitaet ? { bonitaet: k.bonitaet } : {}),
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
    verantwortlichEmail: row.verantwortlich_email ?? undefined,
    privatArt: row.privat_art ?? undefined,
    letzteAktivitaet: row.letzte_aktivitaet,
    activities: row.activities ?? [],
    unterlagenCheckliste: row.unterlagen_checkliste ?? undefined,
    signaturen: row.signaturen ?? undefined,
    kaeuferprofil: row.kaeuferprofil ?? undefined,
    immoStammdaten: row.immo_stammdaten ?? undefined,
    gesuche: row.gesuche ?? undefined,
    unterlagenAnforderungen: row.unterlagen_anforderungen ?? undefined,
    unternehmensbewertung: row.unternehmensbewertung ?? undefined,
    selbstauskunft: row.selbstauskunft ?? undefined,
    anschrift: row.anschrift ?? undefined,
    sachverhalt: row.sachverhalt ?? undefined,
    branche: row.branche ?? undefined,
    vermittler: row.vermittler ?? undefined,
    dienstleistungen: row.dienstleistungen ?? undefined,
    auftragChance: row.auftrag_chance ?? undefined,
    naechsteSchritte: row.naechste_schritte ?? undefined,
    ampelManuell: row.ampel_manuell ?? undefined,
    seminare: row.seminare ?? undefined,
    dokumente: row.dokumente ?? undefined,
    pruefHinweis: row.pruef_hinweis ?? undefined,
    verknuepfteKunden: row.verknuepfte_kunden ?? undefined,
    unternehmensbewertungRecherche: row.unternehmensbewertung_recherche ?? undefined,
    potenzialAnalyse: row.potenzial_analyse ?? undefined,
    bonitaet: row.bonitaet ?? undefined,
    // Nur lesen: steuer_analyse gehört dem Server (siehe email-gateway "steuer_analyse_schritt").
    steuerAnalyse: row.steuer_analyse ?? undefined,
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
    off_market: o.offMarket ?? false,
    verkaufsdaten: o.verkaufsdaten ?? null,
    kurzpruefung: o.kurzpruefung ?? null,
    eigentuemer: o.eigentuemer ?? null,
    expose_text: o.exposeText ?? null,
    unterlagen_anforderungen: o.unterlagenAnforderungen ?? null,
    privat_besitzer: o.privatBesitzer ?? null,
    // `bewertung` fehlt hier mit Absicht: Die Spalte schreibt nur der Server (mehrstufiger Lauf).
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
    offMarket: row.off_market ?? false,
    verkaufsdaten: row.verkaufsdaten ?? undefined,
    kurzpruefung: row.kurzpruefung ?? undefined,
    eigentuemer: row.eigentuemer ?? undefined,
    exposeText: row.expose_text ?? undefined,
    // Nur lesen: bilder_reihenfolge fehlt in objektToRow mit Absicht (eigene Schreibwege, siehe ObjektBilderVerwalten.tsx).
    bilderReihenfolge: Array.isArray(row.bilder_reihenfolge) ? row.bilder_reihenfolge : undefined,
    bewertung: row.bewertung ?? undefined,
    unterlagenAnforderungen: row.unterlagen_anforderungen ?? undefined,
    // Nur lesen: `eigentuemer_token` fehlt in objektToRow mit Absicht (die Datenbank vergibt es).
    eigentuemerToken: row.eigentuemer_token ?? undefined,
    privatBesitzer: row.privat_besitzer ?? undefined,
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
    dauer_sekunden: p.dauerSekunden ?? null,
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
    dauerSekunden: row.dauer_sekunden ?? undefined,
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
    datei: v.datei ?? null,
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
    datei: row.datei ?? undefined,
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
    leistung_bezeichnung: r.leistungBezeichnung ?? null,
    leistung_einheit: r.leistungEinheit ?? null,
    leistung_menge: r.leistungMenge ?? null,
    positionen: r.positionen?.length ? r.positionen : null,
    ust_satz: r.ustSatz ?? null,
    leistungszeitraum: r.leistungszeitraum ?? null,
    anschrift: r.anschrift ?? null,
    hinweis: r.hinweis ?? null,
    notiz: r.notiz ?? null,
    zahlungen: r.zahlungen?.length ? r.zahlungen : null,
    mahnungen: r.mahnungen?.length ? r.mahnungen : null,
    versendet_am: r.versendetAm ?? null,
    versendet_an: r.versendetAn ?? null,
    bezahlt_am: r.bezahltAm ?? null,
    dokument: r.dokument ?? null,
    kv_id: r.kvId ?? null,
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
    leistungBezeichnung: row.leistung_bezeichnung ?? undefined,
    leistungEinheit: row.leistung_einheit ?? undefined,
    leistungMenge: row.leistung_menge != null ? Number(row.leistung_menge) : undefined,
    positionen: Array.isArray(row.positionen) && row.positionen.length ? row.positionen : undefined,
    ustSatz: row.ust_satz != null ? Number(row.ust_satz) : undefined,
    leistungszeitraum: row.leistungszeitraum ?? undefined,
    anschrift: row.anschrift ?? undefined,
    hinweis: row.hinweis ?? undefined,
    notiz: row.notiz ?? undefined,
    zahlungen: Array.isArray(row.zahlungen) && row.zahlungen.length ? row.zahlungen : undefined,
    mahnungen: Array.isArray(row.mahnungen) && row.mahnungen.length ? row.mahnungen : undefined,
    versendetAm: row.versendet_am ?? undefined,
    versendetAn: row.versendet_an ?? undefined,
    bezahltAm: row.bezahlt_am ?? undefined,
    dokument: row.dokument ?? undefined,
    kvId: row.kv_id ?? undefined,
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
    besitzer_email: p.bereich === 'privat' ? (p.besitzerEmail ?? null) : null,
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
    besitzerEmail: row.besitzer_email ?? undefined,
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

function todoToRow(t: ToDoEintrag) {
  return {
    id: t.id,
    besitzer_email: t.besitzerEmail,
    bereich: t.bereich ?? null,
    reihenfolge: t.reihenfolge ?? null,
    start_datum: t.startDatum ?? null,
    prio: t.prio ?? null,
    unter_prio: t.unterPrio ?? null,
    kunde_projekt: t.kundeProjekt ?? null,
    aufgabe: t.aufgabe,
    abteilung: t.abteilung ?? null,
    aktueller_stand: t.aktuellerStand ?? null,
    welche_fragen: t.welcheFragen ?? null,
    naechste_schritte: t.naechsteSchritte ?? null,
    zustaendig: t.zustaendig ?? null,
    geplante_zeit: t.geplanteZeit ?? null,
    ist_zeit: t.istZeit ?? null,
    umsatz_wert: t.umsatzWert ?? null,
    geplante_wiedervorlage: t.geplanteWiedervorlage ?? null,
    erledigt_am: t.erledigtAm ?? null,
    erstellt_am: t.erstelltAm,
    warten_auf: t.wartenAuf ?? null,
    erhalten_am: t.erhaltenAm ?? null,
    erledigen_bis: t.erledigenBis ?? null,
    stundensatz: t.stundensatz ?? null,
    // Erinnerungszeit nur mitschicken, wenn das Fenster sie kennt — sonst könnte ein älterer Stand im
    // Browser eine vom Assistenten gesetzte Erinnerung überschreiben. '' = bewusst gelöscht.
    ...(t.erinnernUm !== undefined ? { erinnern_um: t.erinnernUm || null } : {}),
    // prio_grund und prio_am schreibt nur der Server (automatische Priorisierung, todoPriorisierung.ts).
    prio_quelle: t.prioQuelle ?? null,
  }
}

// Arbeitsorganisation der Abteilung: vier Sammlungen in einer Tabelle (abteilung_eintraege), je Eintrag
// eine Zeile — so überschreibt die Frage des einen nie die Antwort des anderen.
function abteilungZeile(art: string) {
  return (e: { id: string }) => ({ id: e.id, art, daten: e, updated_at: new Date().toISOString() })
}

function rowToTodo(row: any): ToDoEintrag {
  return {
    id: row.id,
    besitzerEmail: row.besitzer_email,
    bereich: row.bereich ?? undefined,
    reihenfolge: row.reihenfolge ?? undefined,
    startDatum: row.start_datum ?? undefined,
    prio: row.prio ?? undefined,
    unterPrio: row.unter_prio ?? undefined,
    kundeProjekt: row.kunde_projekt ?? undefined,
    aufgabe: row.aufgabe,
    abteilung: row.abteilung ?? undefined,
    aktuellerStand: row.aktueller_stand ?? undefined,
    welcheFragen: row.welche_fragen ?? undefined,
    naechsteSchritte: row.naechste_schritte ?? undefined,
    zustaendig: row.zustaendig ?? undefined,
    geplanteZeit: row.geplante_zeit ?? undefined,
    istZeit: row.ist_zeit ?? undefined,
    umsatzWert: row.umsatz_wert ?? undefined,
    geplanteWiedervorlage: row.geplante_wiedervorlage ?? undefined,
    erledigtAm: row.erledigt_am ?? undefined,
    erstelltAm: row.erstellt_am,
    wartenAuf: row.warten_auf ?? undefined,
    erhaltenAm: row.erhalten_am ?? undefined,
    erledigenBis: row.erledigen_bis ?? undefined,
    stundensatz: row.stundensatz ?? undefined,
    erinnernUm: row.erinnern_um ?? undefined,
    erinnertAm: row.erinnert_am ?? undefined,
    prioQuelle: row.prio_quelle === 'hand' || row.prio_quelle === 'auto' ? row.prio_quelle : undefined,
    prioGrund: row.prio_grund ?? undefined,
    prioAm: row.prio_am ?? undefined,
  }
}

function todoFreigabeToRow(f: ToDoFreigabe) {
  return {
    id: f.id,
    besitzer_email: f.besitzerEmail,
    empfaenger_email: f.empfaengerEmail,
    recht: f.recht,
    erstellt_am: f.erstelltAm,
  }
}

function rowToTodoFreigabe(row: any): ToDoFreigabe {
  return {
    id: row.id,
    besitzerEmail: row.besitzer_email,
    empfaengerEmail: row.empfaenger_email,
    recht: row.recht,
    erstelltAm: row.erstellt_am,
  }
}

function verbindlichkeitToRow(v: Verbindlichkeit) {
  return {
    id: v.id,
    lieferant: v.lieferant,
    lieferant_email: v.lieferantEmail ?? null,
    rechnungsnummer: v.rechnungsnummer ?? null,
    datum: v.datum,
    betrag_netto: v.betragNetto ?? null,
    betrag_brutto: v.betragBrutto ?? null,
    zahlungsziel: v.zahlungsziel ?? null,
    status: v.status,
    notiz: v.notiz ?? null,
    quelle: v.quelle,
    quell_email_id: v.quellEmailId ?? null,
    kategorie: v.kategorie ?? null,
    bezahlt_am: v.bezahltAm ?? null,
    beleg: v.beleg ?? null,
    geprueft: v.geprueft ?? null,
  }
}

function rowToVerbindlichkeit(row: any): Verbindlichkeit {
  return {
    id: row.id,
    lieferant: row.lieferant,
    lieferantEmail: row.lieferant_email ?? undefined,
    rechnungsnummer: row.rechnungsnummer ?? undefined,
    datum: row.datum,
    betragNetto: row.betrag_netto != null ? Number(row.betrag_netto) : undefined,
    betragBrutto: row.betrag_brutto != null ? Number(row.betrag_brutto) : undefined,
    zahlungsziel: row.zahlungsziel ?? undefined,
    status: row.status,
    notiz: row.notiz ?? undefined,
    quelle: row.quelle,
    quellEmailId: row.quell_email_id ?? undefined,
    kategorie: row.kategorie ?? undefined,
    bezahltAm: row.bezahlt_am ?? undefined,
    beleg: row.beleg ?? undefined,
    geprueft: row.geprueft ?? undefined,
  }
}

// Fehler beim Speichern landen zusätzlich in app_fehler (täglicher Bericht) — früher nur in der Konsole, also für
// niemanden sichtbar. Gemeldet wird nur die Tabelle und die Datenbank-Meldung, nie Namen oder Inhalte (der
// Kontext mit Firmen-/Objektnamen bleibt in der Konsole).
setzeMelder((art, tabelle, kontext, text) => {
  if (art === 'fehler') {
    console.error(`Supabase-Sync fehlgeschlagen (${kontext}):`, text ?? '')
    meldeFehler(`Speichern in der Datenbank fehlgeschlagen (${tabelle})`, text)
  } else if (art === 'verworfen') {
    console.warn(`[crmSync] ${kontext}: in der Datenbank inzwischen gelöscht — Änderung verworfen (${tabelle})`)
    meldeFehler(`Änderung verworfen: Eintrag war inzwischen gelöscht (${tabelle})`)
  } else {
    console.error(`[crmSync] ${kontext}: zu viele Löschungen auf einmal in ${tabelle} — nichts gelöscht (${text ?? ''})`)
    meldeFehler(`Löschen gesperrt: zu viele Einträge auf einmal (${tabelle})`, text)
  }
})

function logFehler(kontext: string, error: { message: string } | null, tabelle = '') {
  if (!error) return
  console.error(`Supabase-Sync fehlgeschlagen (${kontext}):`, error.message)
  if (!istNetzFehler(error)) meldeFehler(`Speichern in der Datenbank fehlgeschlagen${tabelle ? ` (${tabelle})` : ''}`, error.message)
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
  { table: 'abteilung_eintraege', key: 'immoFragen', label: () => 'Frage an die Geschäftsführung', toRow: abteilungZeile('frage') },
  { table: 'abteilung_eintraege', key: 'zeiteintraege', label: () => 'Zeiteintrag', toRow: abteilungZeile('zeit') },
  { table: 'abteilung_eintraege', key: 'tagesplaene', label: () => 'Tagesablauf', toRow: abteilungZeile('tagesplan') },
  { table: 'abteilung_eintraege', key: 'wochenplaene', label: () => 'Wochenplan', toRow: abteilungZeile('wochenplan') },
  { table: 'abteilung_eintraege', key: 'weitergaben', label: () => 'Weitergabe', toRow: abteilungZeile('weitergabe') },
  { table: 'abteilung_eintraege', key: 'abrechnungen', label: () => 'Abrechnung', toRow: abteilungZeile('abrechnung') },
  { table: 'todos', key: 'todos', label: (t: ToDoEintrag) => `Aufgabe ${t.aufgabe}`, toRow: todoToRow },
  { table: 'todo_freigaben', key: 'todoFreigaben', label: (f: ToDoFreigabe) => `To-Do-Freigabe an ${f.empfaengerEmail}`, toRow: todoFreigabeToRow },
  { table: 'verbindlichkeiten', key: 'verbindlichkeiten', label: (v: Verbindlichkeit) => `Verbindlichkeit ${v.lieferant}`, toRow: verbindlichkeitToRow },
]

function syncSimpleCollection(client: NonNullable<typeof supabase>, prev: AppData, next: AppData, cfg: (typeof SIMPLE_SYNCS)[number]) {
  const prevListe = prev[cfg.key] as { id: string }[]
  const nextListe = next[cfg.key] as { id: string }[]
  if (prevListe === nextListe) return

  const nextIds = new Set(nextListe.map((x) => x.id))
  const geloeschteIds = prevListe.filter((x) => !nextIds.has(x.id)).map((x) => x.id)
  if (geloeschteIds.length > 0) void loescheZeilen(client, cfg.table, geloeschteIds, String(cfg.key))

  // Alle Tabellen: bei vorhandenen Zeilen nur die geänderten Felder schreiben, geänderte Listen (Meilensteine mit
  // Aufgaben, Zahlungen, Zeilen eines Tagesplans …) mit dem frischen Stand der Datenbank zusammenführen (siehe
  // zeilenSchreiben.ts). Früher galt das nur für To-dos, Verbindlichkeiten und Rechnungen; alle anderen Tabellen
  // schrieben die ganze Zeile und überschrieben, was der Server oder ein Kollege inzwischen geändert hatte
  // (z. B. per Telegram ergänzte Tagesplan-Zeilen, die Verknüpfung eines Projekts nach dem Zusammenführen).
  // abteilung_eintraege: Kennungen wie „Name|Datum“ (Tagesplan) legt auch der Server an, und `daten` ist ein
  // ganzes Datenobjekt — darum Feld für Feld zusammenführen, auch beim ersten Speichern.
  const abteilung = cfg.table === 'abteilung_eintraege'
  const vorherNachId = new Map(prevListe.map((x) => [x.id, x]))
  for (const item of diffById(prevListe, nextListe)) {
    const vorher = vorherNachId.get(item.id)
    void schreibeSpaeter(
      client,
      { tabelle: cfg.table, id: item.id, kontext: cfg.label(item), ...(abteilung ? { festeIds: true, objektFelder: ['daten'] } : {}) },
      vorher ? cfg.toRow(vorher) : undefined,
      cfg.toRow(item),
    )
  }
}

// ---------- Kundenakten: nur die eigene Änderung schreiben ----------
//
// Jedes offene CRM-Fenster hält den Stand vom Laden der Seite. Früher schrieb es bei jeder Änderung
// die ganze Akte zurück — und löschte damit, was inzwischen der Telegram-Assistent, der Zeitplan oder
// ein Kollege in dieselbe Akte gelegt hatte (echter Fall 17.11.2026: vier per Telegram abgelegte
// Sprachnachrichten verschwanden, als ein Kollege in seinem Fenster eine Mail zuordnete).
// Jetzt gilt: Geschrieben werden nur die Felder, die dieses Fenster wirklich geändert hat. Bei den
// Listen der Akte (Verlauf, Dokumente, Unterschriften) wird Eintrag für Eintrag mit dem aktuellen
// Stand der Datenbank zusammengeführt: eigene neue, geänderte und gelöschte Einträge gelten, alles
// andere bleibt so, wie es in der Datenbank steht.

// unterlagen_anforderungen: Der Server trägt dort Eingänge vom Hochlade-Link ein (kundenUnterlagen.ts).
const LISTEN_FELDER = ['activities', 'dokumente', 'signaturen', 'gesuche', 'unterlagen_anforderungen'] as const
type ListenFeld = (typeof LISTEN_FELDER)[number]

/** Was die Datenbank gegenüber dem Stand dieses Fensters zusätzlich weiß — je Liste der Akte. */
export type ServerStand = Partial<Record<ListenFeld, { neu: ListenEintrag[]; weg: string[]; frisch: ListenEintrag[] }>>

async function schreibeKunde(
  client: NonNullable<typeof supabase>,
  vorher: { bereich: KundeBereich; kunde: Kunde } | undefined,
  bereich: KundeBereich,
  kunde: Kunde,
  meldeServerStand?: (id: string, stand: ServerStand) => void,
): Promise<Ausgang> {
  const nachherZeile = kundeToRow(bereich, kunde) as Record<string, unknown>
  const kontext = `Kunde ${kunde.firma}`
  // In diesem Fenster neu angelegt: ganze Zeile schreiben.
  if (!vorher) return legeAn(client, 'kunden', kunde.id, nachherZeile, kontext)
  const vorherZeile = kundeToRow(vorher.bereich, vorher.kunde) as Record<string, unknown>
  // Nur Felder, die der neue Stand mitbringt: Ein Feld, das dieses Fenster gar nicht (mehr) kennt, wird
  // nie geleert (siehe potenzial_analyse in kundeToRow).
  const geaendert = Object.keys(nachherZeile).filter((feld) => feld !== 'id' && !gleich(vorherZeile[feld], nachherZeile[feld]))
  if (geaendert.length === 0) return 'ok'

  const aenderung: Record<string, unknown> = {}
  for (const feld of geaendert) aenderung[feld] = nachherZeile[feld] ?? null
  const listen = geaendert.filter((feld): feld is ListenFeld => (LISTEN_FELDER as readonly string[]).includes(feld))
  const stand: ServerStand = {}
  if (listen.length > 0) {
    const { data: server, error } = await client.from('kunden').select(`id, ${listen.join(', ')}`).eq('id', kunde.id).maybeSingle()
    // Ohne frischen Stand nie die eigenen ganzen Listen schreiben — das löschte früher bei einem kurzen Netz-
    // oder Datenbankfehler alles, was andere inzwischen abgelegt hatten. Am Netz gescheitert: später nachholen.
    if (error) {
      logFehler(kontext, error, 'kunden')
      return istNetzFehler(error) ? 'nachholen' : 'fehler'
    }
    // Die Akte gibt es in der Datenbank nicht: nur anlegen, wenn sie nie dort war (sonst anderswo gelöscht).
    if (!server) return legeAnFallsNieGespeichert(client, 'kunden', kunde.id, nachherZeile, kontext)
    for (const feld of listen) {
      const a = alsListe(vorherZeile[feld])
      const b = alsListe(nachherZeile[feld])
      const c = alsListe((server as unknown as Record<string, unknown>)[feld])
      if (!a || !b || !c) continue // Einträge ohne Kennung: Feld wie geändert schreiben
      const ergebnis = fuehreListeZusammen(a, b, c)
      aenderung[feld] = ergebnis.liste
      if (ergebnis.neu.length > 0 || ergebnis.weg.length > 0 || ergebnis.frisch.length > 0) stand[feld] = { neu: ergebnis.neu, weg: ergebnis.weg, frisch: ergebnis.frisch }
    }
  }
  const { data: geschrieben, error } = await client.from('kunden').update(aenderung).eq('id', kunde.id).select('id')
  if (error) {
    logFehler(kontext, error, 'kunden')
    return istNetzFehler(error) ? 'nachholen' : 'fehler'
  }
  // Nichts getroffen: Die Akte fehlt in der Datenbank — nur anlegen, wenn sie nie dort war.
  if ((geschrieben ?? []).length === 0) return legeAnFallsNieGespeichert(client, 'kunden', kunde.id, nachherZeile, kontext)
  merkeInDatenbank('kunden', [kunde.id])
  if (Object.keys(stand).length > 0) meldeServerStand?.(kunde.id, stand)
  return 'ok'
}

// Nach jedem Dispatch aufgerufen (außer beim initialen Hydrate selbst) — schreibt nur, was sich
// seit dem letzten Stand tatsächlich geändert hat. Läuft bewusst "fire and forget": ein CRM-Nutzer
// soll nicht auf einen Netzwerk-Roundtrip warten müssen, bevor die UI reagiert.
/** Was die Datenbank an einem Objekt zusätzlich wusste: der zusammengeführte Stand von Verlauf und Dokumenten. */
export type ObjektServerStand = { activities?: Objekt['activities']; dokumente?: Objekt['dokumente'] }

/**
 * Schreibt ein Objekt wie eine Kundenakte: nur die Felder, die dieses Fenster geändert hat. Verlauf und
 * Dokumente (je Ordner) werden mit dem Stand der Datenbank zusammengeführt — was der Server inzwischen
 * abgelegt hat (Mail-Zuordnung, Eigentümer-Zugang, ungeklärte Eingänge), bleibt erhalten.
 */
async function schreibeObjekt(client: NonNullable<typeof supabase>, vorher: Objekt | undefined, o: Objekt, meldeStand?: (id: string, stand: ObjektServerStand) => void): Promise<Ausgang> {
  const nachherZeile = objektToRow(o) as Record<string, unknown>
  const kontext = `Objekt ${o.bezeichnung}`
  if (!vorher) return legeAn(client, 'objekte', o.id, nachherZeile, kontext)
  const vorherZeile = objektToRow(vorher) as Record<string, unknown>
  const geaendert = Object.keys(nachherZeile).filter((feld) => feld !== 'id' && !gleich(vorherZeile[feld], nachherZeile[feld]))
  if (geaendert.length === 0) return 'ok'
  const aenderung: Record<string, unknown> = {}
  for (const feld of geaendert) aenderung[feld] = nachherZeile[feld] ?? null
  const stand: ObjektServerStand = {}
  const listen = geaendert.filter((feld) => feld === 'activities' || feld === 'dokumente')
  if (listen.length > 0) {
    const { data: server, error } = await client.from('objekte').select(`id, ${listen.join(', ')}`).eq('id', o.id).maybeSingle()
    // Ohne frischen Stand nie die eigenen ganzen Listen schreiben (siehe schreibeKunde).
    if (error) {
      logFehler(kontext, error, 'objekte')
      return istNetzFehler(error) ? 'nachholen' : 'fehler'
    }
    if (!server) return legeAnFallsNieGespeichert(client, 'objekte', o.id, nachherZeile, kontext)
    const zeile = server as unknown as Record<string, unknown>
    if (listen.includes('activities')) {
      const a = alsListe(vorher.activities)
      const b = alsListe(o.activities)
      const c = alsListe(zeile.activities)
      if (a && b && c) {
        const ergebnis = fuehreListeZusammen(a, b, c)
        aenderung.activities = ergebnis.liste
        if (ergebnis.neu.length > 0 || ergebnis.weg.length > 0 || ergebnis.frisch.length > 0) stand.activities = ergebnis.liste as Objekt['activities']
      }
    }
    if (listen.includes('dokumente')) {
      const serverOrdner = (zeile.dokumente && typeof zeile.dokumente === 'object' ? zeile.dokumente : {}) as Record<string, unknown>
      const vorherOrdner = (vorher.dokumente ?? {}) as Record<string, unknown>
      const nachherOrdner = (o.dokumente ?? {}) as Record<string, unknown>
      const zusammen: Record<string, unknown> = {}
      let abweichung = false
      for (const ordner of new Set([...Object.keys(serverOrdner), ...Object.keys(vorherOrdner), ...Object.keys(nachherOrdner)])) {
        const a = alsListe(vorherOrdner[ordner])
        const b = alsListe(nachherOrdner[ordner])
        const c = alsListe(serverOrdner[ordner])
        if (!a || !b || !c) {
          if (nachherOrdner[ordner] !== undefined) zusammen[ordner] = nachherOrdner[ordner]
          continue
        }
        const ergebnis = fuehreListeZusammen(a, b, c)
        if (ergebnis.liste.length > 0 || ordner in nachherOrdner) zusammen[ordner] = ergebnis.liste
        if (ergebnis.neu.length > 0 || ergebnis.weg.length > 0 || ergebnis.frisch.length > 0) abweichung = true
      }
      aenderung.dokumente = zusammen
      if (abweichung) stand.dokumente = zusammen as Objekt['dokumente']
    }
  }
  const { data: geschrieben, error } = await client.from('objekte').update(aenderung).eq('id', o.id).select('id')
  if (error) {
    logFehler(kontext, error, 'objekte')
    return istNetzFehler(error) ? 'nachholen' : 'fehler'
  }
  if ((geschrieben ?? []).length === 0) return legeAnFallsNieGespeichert(client, 'objekte', o.id, nachherZeile, kontext)
  merkeInDatenbank('objekte', [o.id])
  if (stand.activities || stand.dokumente) meldeStand?.(o.id, stand)
  return 'ok'
}

export function syncAfterDispatch(prev: AppData, next: AppData, meldeServerStand?: (id: string, stand: ServerStand) => void, meldeObjektStand?: (id: string, stand: ObjektServerStand) => void) {
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
  if (geloeschteKundenIds.length > 0) void loescheZeilen(client, 'kunden', geloeschteKundenIds, 'Kunde')
  // Vorheriger Stand je Akte über alle Bereiche (eine verschobene Akte steht vorher in einer anderen Liste).
  let vorherNachId: Map<string, { bereich: KundeBereich; kunde: Kunde }> | null = null
  for (const { bereich, key } of KUNDE_KEYS) {
    for (const k of diffById(prev[key] as Kunde[], next[key] as Kunde[])) {
      if (!vorherNachId) {
        vorherNachId = new Map()
        for (const alt of KUNDE_KEYS) for (const kunde of prev[alt.key] as Kunde[]) vorherNachId.set(kunde.id, { bereich: alt.bereich, kunde })
      }
      // Je Akte nacheinander; scheitert es am Netz, wird es vom letzten gespeicherten Stand aus nachgeholt.
      void plane(`kunden:${k.id}`, vorherNachId.get(k.id), { bereich, kunde: k }, (vorher, n) => schreibeKunde(client, vorher, n.bereich, n.kunde, meldeServerStand))
    }
  }

  // Vorlagen: dasselbe Muster wie Kunden (eine Tabelle, sieben Arrays) — feldweise wie alle Tabellen.
  const prevVorlagenIds = new Set(VORLAGEN_KEYS.flatMap(({ key }) => (prev[key] as Vorlage[]).map((v) => v.id)))
  const nextVorlagenIds = new Set(VORLAGEN_KEYS.flatMap(({ key }) => (next[key] as Vorlage[]).map((v) => v.id)))
  const geloeschteVorlagenIds = [...prevVorlagenIds].filter((id) => !nextVorlagenIds.has(id))
  if (geloeschteVorlagenIds.length > 0) void loescheZeilen(client, 'vorlagen', geloeschteVorlagenIds, 'Vorlage')
  let vorlagenVorher: Map<string, { bereich: Bereich; vorlage: Vorlage }> | null = null
  for (const { bereich, key } of VORLAGEN_KEYS) {
    for (const v of diffById(prev[key] as Vorlage[], next[key] as Vorlage[])) {
      if (!vorlagenVorher) {
        vorlagenVorher = new Map()
        for (const alt of VORLAGEN_KEYS) for (const vorlage of prev[alt.key] as Vorlage[]) vorlagenVorher.set(vorlage.id, { bereich: alt.bereich, vorlage })
      }
      const alt = vorlagenVorher.get(v.id)
      void schreibeSpaeter(client, { tabelle: 'vorlagen', id: v.id, kontext: `Vorlage ${v.name}` }, alt ? vorlageToRow(alt.bereich, alt.vorlage) : undefined, vorlageToRow(bereich, v))
    }
  }

  // Mayer-Objekte und private Objekte (eigene Liste, siehe privatObjekte) — gleiche Schreiblogik. Wechselt ein
  // Objekt die Liste (privat → Mayer-CRM), gilt die alte Fassung aus der anderen Liste als „vorher“.
  let objekteVorher: Map<string, Objekt> | null = null
  for (const o of [...diffById(prev.objekte, next.objekte), ...diffById(prev.privatObjekte, next.privatObjekte)]) {
    if (!objekteVorher) objekteVorher = new Map([...prev.objekte, ...prev.privatObjekte].map((x) => [x.id, x]))
    void plane(`objekte:${o.id}`, objekteVorher.get(o.id), o, (vorher, n) => schreibeObjekt(client, vorher, n, meldeObjektStand))
  }

  // Protokolle und Objekt-Vorschläge legt der Browser nur an; über denselben Weg (Kette, Nachholen).
  const protokolleVorher = new Map(prev.protokolle.map((p) => [p.id, p]))
  for (const p of diffById(prev.protokolle, next.protokolle)) {
    const alt = protokolleVorher.get(p.id)
    void schreibeSpaeter(client, { tabelle: 'protokolle', id: p.id, kontext: 'Protokoll' }, alt ? protokollToRow(alt) : undefined, protokollToRow(p))
  }

  const vorschlaegeVorher = new Map(prev.objektVorschlaege.map((v) => [v.id, v]))
  for (const v of diffById(prev.objektVorschlaege, next.objektVorschlaege)) {
    const alt = vorschlaegeVorher.get(v.id)
    void schreibeSpaeter(client, { tabelle: 'objekt_vorschlaege', id: v.id, kontext: 'Objekt-Vorschlag' }, alt ? vorschlagToRow(alt) : undefined, vorschlagToRow(v))
  }

  for (const cfg of SIMPLE_SYNCS) {
    syncSimpleCollection(client, prev, next, cfg)
  }
}

export type HydratedData = {
  kunden: Record<KundeBereich, Kunde[]>
  objekte: Objekt[]
  privatObjekte: Objekt[]
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
  immoFragen: ImmoFrage[]
  zeiteintraege: Zeiteintrag[]
  tagesplaene: Tagesplan[]
  wochenplaene: Wochenplan[]
  weitergaben: Weitergabe[]
  abrechnungen: ObjektAbrechnung[]
  trefferMeldungen: TrefferMeldung[]
  // Treffer der eigenen privaten Gesuche (art 'privat_treffer', Datenbank-Regel: nur der Besitzer). Nur lesen.
  privatTrefferMeldungen: TrefferMeldung[]
  todos: ToDoEintrag[]
  todoFreigaben: ToDoFreigabe[]
  verbindlichkeiten: Verbindlichkeit[]
}

// Lädt den aktuellen, geteilten Stand beim Start (und kann für ein manuelles "Aktualisieren" erneut
// aufgerufen werden). Es gibt noch keine Supabase-Realtime-Anbindung — Änderungen eines anderen
// Geräts/Mitarbeiters werden beim nächsten Neuladen der Seite sichtbar, nicht live.
/** Alle To-dos seitenweise: Die Datenbank liefert höchstens 1000 Zeilen je Abfrage, Hasan allein hat über 2.600
 *  (aus Microsoft To Do). Ohne Seiten fehlte in seiner Liste mehr als die Hälfte (22.11.2026). */
async function alleTodoZeilen(): Promise<{ data: unknown[] | null; error: { message: string } | null }> {
  const db = supabase
  if (!db) return { data: [], error: null }
  const { data, error } = await alleZeilen(() => db.from('todos').select('*'))
  return error ? { data: null, error } : { data, error: null }
}

export async function hydrateFromSupabase(): Promise<HydratedData | null> {
  const db = supabase
  if (!db) return null
  // Erst laufende Speichervorgänge abwarten (höchstens 8 Sekunden): Sonst lädt z. B. `neuLaden()` direkt nach
  // einer Eingabe den Stand ohne diese Eingabe, und sie verschwindet aus der Anzeige.
  await warteAufSchreibvorgaenge(8000)
  // Jede Tabelle seitenweise (alleZeilen): Die Datenbank liefert höchstens 1000 Zeilen je Abfrage, ohne Fehler —
  // Akten, Verlaufseinträge der Abteilungen (Zeiten, Ablage, Treffer) usw. wachsen darüber hinaus.
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
    todosRes,
    todoFreigabenRes,
    verbindlichkeitenRes,
    mitarbeiterRes,
    abteilungRes,
  ] = await Promise.all([
    alleZeilen(() => db.from('kunden').select('*')),
    alleZeilen(() => db.from('objekte').select('*')),
    alleZeilen(() => db.from('protokolle').select('*')),
    alleZeilen(() => db.from('objekt_vorschlaege').select('*')),
    alleZeilen(() => db.from('vorlagen').select('*')),
    alleZeilen(() => db.from('rechnungen').select('*')),
    alleZeilen(() => db.from('konzepte').select('*')),
    alleZeilen(() => db.from('vertraege').select('*')),
    alleZeilen(() => db.from('objekt_finanzierungen').select('*')),
    alleZeilen(() => db.from('projekte').select('*')),
    alleZeilen(() => db.from('fonds_investoren').select('*')),
    alleZeilen(() => db.from('fonds_dokumente_allgemein').select('*')),
    alleZeilen(() => db.from('importierte_dokumente').select('*')),
    alleZeilen(() => db.from('mail_vorlagen').select('*')),
    alleZeilen(() => db.from('notizen').select('*')),
    alleZeilen(() => db.from('abwesenheiten').select('*')),
    alleTodoZeilen(),
    alleZeilen(() => db.from('todo_freigaben').select('*')),
    alleZeilen(() => db.from('verbindlichkeiten').select('*')),
    db.from('mitarbeiter').select('name').eq('aktiv', true).order('name'),
    alleZeilen(() => db.from('abteilung_eintraege').select('id, art, daten')),
  ])
  // Fehlt diese Tabelle einmal oder antwortet sie nicht, soll deshalb nicht das ganze CRM leer bleiben.
  if (abteilungRes.error) console.error('[crmSync] abteilung_eintraege:', abteilungRes.error.message)
  const abteilung = (art: string) => ((abteilungRes.data ?? []) as { art: string; daten: unknown }[]).filter((z) => z.art === art).map((z) => z.daten)
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
    todosRes,
    todoFreigabenRes,
    verbindlichkeitenRes,
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
    privat: [],
    immobilienkunden: [],
  }
  for (const row of kundenRes.data ?? []) {
    kunden[row.bereich as KundeBereich].push(rowToKunde(row))
  }

  // Merken, welche Zeilen es in der Datenbank gibt: Fehlt eine davon später beim Speichern, wurde sie anderswo
  // gelöscht und wird nicht wieder angelegt (siehe zeilenSchreiben.ts).
  const ids = (res: { data: unknown[] | null }) => ((res.data ?? []) as { id: string }[]).map((r) => r.id)
  merkeGeladen('kunden', ids(kundenRes))
  merkeGeladen('objekte', ids(objekteRes))
  merkeGeladen('protokolle', ids(protokolleRes))
  merkeGeladen('objekt_vorschlaege', ids(vorschlaegeRes))
  merkeGeladen('vorlagen', ids(vorlagenRes))
  merkeGeladen('rechnungen', ids(rechnungenRes))
  merkeGeladen('konzepte', ids(konzepteRes))
  merkeGeladen('vertraege', ids(vertraegeRes))
  merkeGeladen('objekt_finanzierungen', ids(finanzierungenRes))
  merkeGeladen('projekte', ids(projekteRes))
  merkeGeladen('fonds_investoren', ids(fondsInvestorenRes))
  merkeGeladen('fonds_dokumente_allgemein', ids(fondsDokumenteRes))
  merkeGeladen('importierte_dokumente', ids(importierteDokumenteRes))
  merkeGeladen('mail_vorlagen', ids(mailVorlagenRes))
  merkeGeladen('notizen', ids(notizenRes))
  merkeGeladen('abwesenheiten', ids(abwesenheitenRes))
  merkeGeladen('todos', ids(todosRes))
  merkeGeladen('todo_freigaben', ids(todoFreigabenRes))
  merkeGeladen('verbindlichkeiten', ids(verbindlichkeitenRes))
  if (!abteilungRes.error) merkeGeladen('abteilung_eintraege', ids(abteilungRes))

  // 'privat' und 'immobilienkunden' haben (noch) keine eigene Vorlagen-Seite/-Tabelle — bleiben hier
  // absichtlich immer leer.
  const vorlagen: Record<Bereich, Vorlage[]> = {
    beratung: [],
    immobilien: [],
    immobilienkunden: [],
    erben: [],
    betriebsuebergabe: [],
    betriebsformen: [],
    akademie: [],
    finanzierungen: [],
    privat: [],
    buecher: [],
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
    // Private Objekte (nur die eigenen, Datenbank-Regel) in eine eigene Liste — so erscheinen sie nie in den
    // Mayer-Immobilien, der Suche oder den Auswertungen.
    objekte: (objekteRes.data ?? []).filter((r: { privat_besitzer?: string | null }) => !r.privat_besitzer).map(rowToObjekt),
    privatObjekte: (objekteRes.data ?? []).filter((r: { privat_besitzer?: string | null }) => !!r.privat_besitzer).map(rowToObjekt),
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
    immoFragen: abteilung('frage') as ImmoFrage[],
    zeiteintraege: abteilung('zeit') as Zeiteintrag[],
    tagesplaene: abteilung('tagesplan') as Tagesplan[],
    wochenplaene: abteilung('wochenplan') as Wochenplan[],
    weitergaben: abteilung('weitergabe') as Weitergabe[],
    abrechnungen: abteilung('abrechnung') as ObjektAbrechnung[],
    trefferMeldungen: abteilung('treffer') as TrefferMeldung[],
    privatTrefferMeldungen: abteilung('privat_treffer') as TrefferMeldung[],
    todos: (todosRes.data ?? []).map(rowToTodo),
    todoFreigaben: (todoFreigabenRes.data ?? []).map(rowToTodoFreigabe),
    verbindlichkeiten: (verbindlichkeitenRes.data ?? []).map(rowToVerbindlichkeit),
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
    merkeInDatenbank(table, lokaleListe.map((x) => x.id))
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
    merkeInDatenbank(table, echte.map((x) => x.id))
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
    merkeInDatenbank('vorlagen', lokaleListe.map((v) => v.id))
    result.vorlagen[bereich] = lokaleListe
  }

  return result
}
