// Statuswechsel vorschlagen (Runde 6, 23.11.2026) — gemeinsamer Kern ohne Datenbank.
//
// Anlass (Nutzungsauswertung 23.11.2026): 1 Statuswechsel in 348 Verlaufseinträgen. Das Team arbeitet fast nur über
// Telegram und setzt den Status nie von Hand — damit laufen statusabhängige Abläufe (Willkommen, Wiedervorlagen,
// Portal) leer. Aus Ereignissen wird deshalb ein Vorschlag abgeleitet, den der Verantwortliche per Knopf bestätigt
// (email-gateway/statusVorschlag.ts schickt, telegram-gateway/bitteBestaetigenWerkzeug.ts führt aus).
//
// Regeln:
//  - Nur Status, die es im Statusnetz der Akte gibt (Kopie der Hauptpfade aus src/data/statusNetworks.ts — geprüft in
//    src/data/statusVorschlag.test.ts), und nur vorwärts auf dem Hauptpfad: Steht die Akte schon auf dem Ziel oder
//    dahinter, auf einem Nebenstatus (Wiedervorlage, Verloren …) oder am Ende, gibt es keinen Vorschlag.
//  - Ereignis → Ziel je Statusnetz (fehlt ein Eintrag, gibt es in diesem Netz keinen Vorschlag):
//      termin   (Termin mit dieser Akte eingetragen)        → Terminstatus des Bereichs
//      vertrag  (Vertrag/Vollmacht in der Akte abgelegt)    → unterschrieben (nur Unternehmensberatung)
//      angebot  (Kostenvoranschlag/Angebot erstellt)        → angebot (nur Unternehmensberatung)
//      antwort  (erste Antwort des Kunden per Mail)         → Erstkontakt
//  - Private Kontakte folgen wie im CRM dem Netz ihrer Art (kunden.privat_art), sonst dem schlichten Privat-Netz.
//
// Bewusst ohne Deno- oder Browser-Funktionen.

export type StatusEreignis = 'termin' | 'vertrag' | 'angebot' | 'antwort'

/** Hauptpfade je Statusnetz — wie src/data/statusNetworks.ts (*_HAUPTPFAD). */
export const HAUPTPFADE: Record<string, readonly string[]> = {
  beratung: ['lead', 'erstkontakt', 'termin', 'durchgefuehrt', 'konzept', 'angebot', 'unterschrieben', 'aktives_mandat', 'rechnung_gestellt', 'abgeschlossen'],
  erben: ['erstkontakt', 'bedarfsanalyse', 'unterlagen_angefordert', 'konzept_erstellt', 'beratungsgespraech', 'umsetzung', 'abgeschlossen'],
  betriebsuebergabe: ['erstkontakt', 'bedarfsanalyse', 'unternehmensbewertung', 'nachfolgekonzept', 'nachfolgersuche', 'verhandlung', 'notartermin', 'abgeschlossen'],
  betriebsformen: ['erstkontakt', 'bedarfsanalyse', 'konzept_erstellt', 'beratungsgespraech', 'umsetzung', 'handelsregister', 'abgeschlossen'],
  akademie: ['interessent', 'anmeldung_eingegangen', 'platz_bestaetigt', 'kurs_laeuft', 'abgeschlossen'],
  finanzierungen: ['interessent', 'risikoprofil_erstellt', 'beratungsgespraech', 'zeichnung_eingegangen', 'kapital_eingezahlt', 'abgeschlossen'],
  privat: ['neu', 'in_kontakt', 'termin_vereinbart', 'erledigt'],
  immobilienkunden: ['interessent', 'besichtigung', 'angebot', 'verhandlung', 'abgeschlossen'],
}

/** Bezeichnungen der Status, die als Ziel vorkommen oder häufig der Ausgangspunkt sind — wie im CRM. */
export const STATUS_NAMEN: Record<string, Record<string, string>> = {
  beratung: {
    lead: 'Lead / Neuanfrage',
    erstkontakt: 'Erstkontakt hergestellt',
    termin: 'Erstgespräch terminiert',
    durchgefuehrt: 'Erstgespräch durchgeführt',
    konzept: 'Konzeptvorstellung',
    angebot: 'Angebot / Beratungsvertrag versendet',
    unterschrieben: 'Beratungsvertrag unterschrieben',
    aktives_mandat: 'Aktives Mandat / laufende Beratung',
    rechnung_gestellt: 'Leistung erbracht / Rechnung gestellt',
    abgeschlossen: 'Abgeschlossen',
  },
  erben: { erstkontakt: 'Erstkontakt', bedarfsanalyse: 'Bedarfsanalyse / Erstgespräch' },
  betriebsuebergabe: { erstkontakt: 'Erstkontakt', bedarfsanalyse: 'Bedarfsanalyse / Erstgespräch' },
  betriebsformen: { erstkontakt: 'Erstkontakt' },
  akademie: { interessent: 'Interessent' },
  finanzierungen: { interessent: 'Interessent' },
  privat: { neu: 'Neu', in_kontakt: 'In Kontakt', termin_vereinbart: 'Termin vereinbart', erledigt: 'Erledigt' },
  immobilienkunden: { interessent: 'Interessent / Erstkontakt', besichtigung: 'Besichtigung vereinbart', angebot: 'Angebot abgegeben' },
}

/** Ziel je Ereignis und Statusnetz. Bewusst sparsam: lieber kein Vorschlag als ein schiefer. */
export const ZIEL_JE_EREIGNIS: Record<StatusEreignis, Record<string, string>> = {
  // „Erstgespräch terminiert“, „Bedarfsanalyse / Erstgespräch“, „Besichtigung vereinbart“, „Termin vereinbart“.
  termin: { beratung: 'termin', erben: 'bedarfsanalyse', betriebsuebergabe: 'bedarfsanalyse', immobilienkunden: 'besichtigung', privat: 'termin_vereinbart' },
  vertrag: { beratung: 'unterschrieben' },
  angebot: { beratung: 'angebot' },
  // In den übrigen Bereichen beginnt eine Akte schon bei „Erstkontakt“ bzw. „Interessent / Erstkontakt“.
  antwort: { beratung: 'erstkontakt', privat: 'in_kontakt' },
}

/** Netzarten, denen ein privater Kontakt folgen kann (wie telegram-gateway/index.ts PRIVAT_ARTEN). */
const PRIVAT_ARTEN = ['beratung', 'immobilienkunden', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

/** Statusnetz einer Akte (bei privaten Kontakten mit privat_art deren Bereich). */
export function statusNetzVon(k: { bereich?: string | null; privat_art?: string | null }): string {
  const bereich = String(k.bereich ?? '')
  if (bereich === 'privat' && k.privat_art && PRIVAT_ARTEN.includes(k.privat_art)) return k.privat_art
  return bereich
}

/** Bezeichnung eines Status (unbekannt → die Kennung selbst). */
export function statusName(netz: string, status: string | null | undefined): string {
  const s = String(status ?? '')
  return STATUS_NAMEN[netz]?.[s] ?? (s ? s.replace(/_/g, ' ') : 'ohne Status')
}

/** Ziel für ein Ereignis, wenn es auf dem Hauptpfad VOR dem aktuellen Status liegt — sonst null. */
export function zielFuer(netz: string, aktuell: string | null | undefined, ereignis: StatusEreignis): string | null {
  const ziel = ZIEL_JE_EREIGNIS[ereignis]?.[netz]
  const pfad = HAUPTPFADE[netz]
  if (!ziel || !pfad) return null
  const zielIndex = pfad.indexOf(ziel)
  const jetztIndex = pfad.indexOf(String(aktuell ?? ''))
  // Unbekannter oder Nebenstatus (Wiedervorlage, Verloren, Nicht qualifiziert …): nichts vorschlagen.
  if (zielIndex < 0 || jetztIndex < 0) return null
  // Letzter Schritt erreicht oder Ziel nicht weiter vorn: nie rückwärts, nie seitwärts.
  if (jetztIndex >= pfad.length - 1 || zielIndex <= jetztIndex) return null
  return ziel
}

/** Von mehreren Ereignissen das, dessen Ziel am weitesten vorn liegt. */
export function bestesZiel(netz: string, aktuell: string | null | undefined, ereignisse: readonly StatusEreignis[]): { ziel: string; ereignis: StatusEreignis } | null {
  const pfad = HAUPTPFADE[netz] ?? []
  let bestes: { ziel: string; ereignis: StatusEreignis } | null = null
  for (const e of ereignisse) {
    const ziel = zielFuer(netz, aktuell, e)
    if (ziel && (!bestes || pfad.indexOf(ziel) > pfad.indexOf(bestes.ziel))) bestes = { ziel, ereignis: e }
  }
  return bestes
}

// ---------------------------------------------------------------------------------------------
// Dokumente: Was ist ein abgelegter Vertrag, was ein Angebot?

const ENTWURF = /vorlage|muster|entwurf|konzept|handout|merkblatt|leitfaden|checkliste|kooperation/i
const BEARBEITBAR = /\.(docx?|odt|rtf|pages|txt|xlsx?|ods)$/i
const VERTRAG = /vertrag|vertraege|vereinbarung|vollmacht|auftragsbestaetigung|auftragsbestätigung|mandat/i
const ANGEBOT = /angebot|kostenvoranschlag/i
const UNTERSCHRIEBEN = /unterschrieben|unterzeichnet|gegengezeichnet/i

/**
 * Ereignis zu einem neu abgelegten Dokument (oder null). Ein Vertrag zählt nur als PDF/Scan (keine Word-Datei —
 * das ist meist der Entwurf) und nie als Vorlage, Muster oder Entwurf; online unterschriebene PDFs
 * (Quelle „unterschrift“, Name „… unterschrieben …“) zählen immer.
 */
export function dokumentEreignis(d: { name?: string | null; quelle?: string | null }): StatusEreignis | null {
  const name = String(d.name ?? '')
  if (!name) return null
  if (d.quelle === 'unterschrift' || (UNTERSCHRIEBEN.test(name) && !BEARBEITBAR.test(name))) return 'vertrag'
  if (ENTWURF.test(name)) return null
  if (VERTRAG.test(name) && !BEARBEITBAR.test(name) && !/mietvertrag|kaufvertrag/i.test(name)) return 'vertrag'
  if (ANGEBOT.test(name) && !/kooperationsangebot/i.test(name)) return 'angebot'
  return null
}
