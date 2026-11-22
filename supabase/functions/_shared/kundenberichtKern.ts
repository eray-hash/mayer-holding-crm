// Statusbericht an den Kunden („Stand Ihres Projekts“, 22.11.2026): gemeinsamer Kern für das CRM
// (src/lib/kundenbericht.ts, Fenster KundenberichtModal), den wöchentlichen Hinweis des Servers
// (email-gateway/kundenbericht.ts) und das Werkzeug statusbericht_entwurf des Assistenten
// (telegram-gateway/kundenberichtWerkzeug.ts). Bewusst ohne Importe und ohne Deno- oder
// Browser-Funktionen, damit alle drei Stellen genau denselben Text bauen.
//
// Anlass: Hasans Vorlage für einen wöchentlichen Statusbericht (diese Woche erledigt, nächste Schritte,
// offene Punkte und fehlende Unterlagen, Ampel). Daraus entstand die Projekt-Checkliste; dies ist der
// Bericht, der an den Kunden geht.
//
// Was in den Bericht darf (der Kunde liest ihn — nichts Internes):
//  - Der Verlauf der Akte (activities) ist fast immer intern („Per Telegram von … abgelegt“, Notizen,
//    Auswertungen). Er wird NIE wörtlich übernommen. Erkannt wird nur „E-Mail … zugeordnet: „Betreff““
//    (= Mail des Kunden ist eingegangen), und auch das nur, wenn sie nicht von einem Kollegen kam.
//  - Eingegangene Unterlagen: was der Kunde über einen Hochlade-Link geschickt hat (mit Namen der
//    angeforderten Unterlage), die Selbstauskunft und — nur als Zahl — weitere abgelegte Unterlagen.
//  - Gesendete Mails an den Kunden: Datum und Betreff (die hat der Kunde ja bekommen).
//  - Wiedervorlagen: Ihre Titel sind Arbeitsanweisungen für uns („Kostenvoranschlag nachfassen“,
//    „Geldeingang prüfen“). Deshalb gilt eine feste Liste (WV_FUER_KUNDEN): Nur Wiedervorlagen aus dem
//    Regel-Katalog, die dort stehen, erscheinen — umformuliert für den Kunden, entweder als „nächster
//    Schritt“ (wir tun etwas) oder als „brauchen wir von Ihnen“. Von Hand angelegte Wiedervorlagen und
//    interne Regeln (nachfassen, Geldeingang, Vermittler, Empfehlung, Vorbereitung) bleiben draußen;
//    die Zahl steht in den Hinweisen für den Mitarbeiter. Erledigte Wiedervorlagen zählen nur, wenn sie
//    wirklich erledigt wurden — nicht, wenn die Datenbank sie wegen „Stand geändert“ geschlossen hat.
//  - „Nächste Schritte“ der Akte (Freitext): Zeilen mit Namen von Kollegen (außer dem Ansprechpartner),
//    mit Euro-Beträgen oder Wörtern wie „intern“, „Provision“, „Vermittler“ fallen weg (Hinweis dazu).
//  - Beträge nur aus Rechnungen, die verschickt sind, und aus Kostenvoranschlägen, die der Kunde
//    nachweislich kennt (angenommen/bezahlt, oder es gibt das PDF und danach eine Mail an ihn, deren
//    Betreff „Angebot“ oder „Kostenvoranschlag“ enthält).
//  - Termine nur, wenn der Kunde selbst als Gast eingetragen ist (sonst sind es meist interne Erinnerungen
//    wie „… anrufen“), und nur künftige.
//  - Namen: nur der Ansprechpartner (Verantwortlicher der Akte) als Gruß.
//  - Ampel für den Kunden: Gelb, wenn wir etwas von ihm brauchen, sonst Grün. Rot setzt nur der
//    Mitarbeiter von Hand (die interne Ampel der Checkliste — z. B. „Wiedervorlage überfällig“ — ist
//    unsere Sache und gehört nicht in den Bericht).

// ---------------------------------------------------------------------------------------------
// Eingabe

export type BerichtAkte = {
  id: string
  bereich: string
  firma?: string | null
  ansprechpartner?: string | null
  email?: string | null
  verantwortlich?: string | null
  status?: string | null
  naechsteSchritte?: string | null
  dienstleistungen?: string[] | null
  activities?: { date?: string | null; text?: string | null; user?: string | null }[] | null
  dokumente?: { id?: string; name?: string | null; datum?: string | null }[] | null
  unterlagenAnforderungen?: BerichtAnforderung[] | null
  unterlagenCheckliste?: Record<string, boolean> | null
  /** Zeitpunkt, an dem die Selbstauskunft eingereicht wurde. */
  selbstauskunftAm?: string | null
}

export type BerichtAnforderung = {
  datum?: string | null
  art?: string | null
  punkte?: string[] | null
  weitere?: string | null
  token?: string | null
  eingang?: { punkt: string; datum: string; name?: string; dokumentId?: string }[] | null
}

export type BerichtWiedervorlage = { regel?: string | null; titel: string; faellig: string; quelle?: string | null; erledigtAm?: string | null; erledigtGrund?: string | null }
export type BerichtMail = { id?: string; betreff: string; gesendetAm: string }
export type BerichtTermin = { beginn: string; ganztags?: boolean | null; gast?: boolean }
export type BerichtKv = { id: string; beschreibung?: string | null; status: string; datum?: string | null; betrag?: number | null; mitPdf?: boolean; geaendertAm?: string | null }
export type BerichtRechnung = { nummer: string; datum?: string | null; brutto?: number | null; status?: string | null; versendetAm?: string | null; bezahltAm?: string | null }

/** Stand im Ablauf (im Browser aus den Statusnetzen; ohne Angabe fehlt die Zeile). */
export type BerichtStand = { label: string; schritt?: number; schritte?: number; abgeschlossen?: boolean }

export type BerichtDaten = {
  akte: BerichtAkte
  wiedervorlagen: BerichtWiedervorlage[]
  mails: BerichtMail[]
  termine: BerichtTermin[]
  kvs: BerichtKv[]
  rechnungen: BerichtRechnung[]
  /** Namen aller aktiven Mitarbeiter (für den Filter „keine Namen von Kollegen“). */
  team: string[]
  /** Datum (JJJJ-MM-TT) des letzten Berichts laut kundenbericht_einstellung. */
  letzterVersand?: string | null
  /** Was sich nicht laden ließ (für den Mitarbeiter). */
  fehler: string[]
}

export type BerichtEingabe = BerichtDaten & {
  /** JJJJ-MM-TT, Berliner Datum. */
  heute: string
  /** Erster Tag des Berichtszeitraums (JJJJ-MM-TT, eingeschlossen). */
  seit: string
  stand?: BerichtStand
}

// ---------------------------------------------------------------------------------------------
// Ergebnis

export type KundenAmpel = 'gruen' | 'gelb' | 'rot'

export type Kundenbericht = {
  betreff: string
  anrede: string
  einleitung: string
  ampel: KundenAmpel
  ampelText: string
  /** „Ihr Vorgang steht derzeit bei …“ — leer, wenn der Stand nicht eindeutig ist. */
  stand: string
  erledigt: string[]
  naechste: string[]
  vonIhnen: string[]
  /** Angeforderte, noch fehlende Unterlagen (Namen wie in der Anforderung) — für den neuen Hochlade-Link. */
  fehlendePunkte: string[]
  schluss: string
  /** Name unter dem Gruß (Ansprechpartner) — leer = „Ihr Team der Mayer Holding“. */
  gruss: string
  seit: string
  heute: string
  /** Nur für den Mitarbeiter, nie im Bericht. */
  hinweise: string[]
}

export const AMPEL_KUNDENTEXT: Record<KundenAmpel, string> = {
  gruen: 'Alles läuft nach Plan.',
  gelb: 'Wir warten noch auf Unterlagen oder eine Rückmeldung von Ihnen.',
  rot: 'Es gibt eine Verzögerung. Wir melden uns dazu bei Ihnen.',
}
export const AMPEL_NAME: Record<KundenAmpel, string> = { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' }

export const BETREFF_ANFANG = 'Stand Ihres Projekts'
export const CRM_BASIS_STANDARD = 'https://eray-hash.github.io/mayer-holding-crm/'
export const LINK_GUELTIG_TAGE = 60
const SONSTIGE_UNTERLAGE = 'Sonstige Unterlage'
const SELBSTAUSKUNFT = 'Selbstauskunft (ausgefüllt und unterschrieben)'

// ---------------------------------------------------------------------------------------------
// Wiedervorlagen, die der Kunde sehen darf (Regel-Kennung aus wiedervorlage_regeln → Text für ihn)

type WvText = { naechste?: string; vonIhnen?: string; erledigt?: string }
const ERSTGESPRAECH: WvText = { naechste: 'Wir melden uns bei Ihnen, um einen Termin für das Erstgespräch zu vereinbaren.', erledigt: 'Der Termin für das Erstgespräch ist vereinbart.' }
const ANRUFEN: WvText = { naechste: 'Wir melden uns telefonisch bei Ihnen.' }

export const WV_FUER_KUNDEN: Record<string, WvText> = {
  allg_unterlagen_pruefen: { naechste: 'Wir prüfen die Unterlagen, die Sie uns geschickt haben.', erledigt: 'Ihre eingegangenen Unterlagen haben wir geprüft.' },
  ber_erstgespraech: ERSTGESPRAECH,
  erb_erstgespraech: ERSTGESPRAECH,
  bue_erstgespraech: ERSTGESPRAECH,
  bfo_erstgespraech: ERSTGESPRAECH,
  fin_erstgespraech: ERSTGESPRAECH,
  ber_konzept: { naechste: 'Wir werten das Erstgespräch aus und arbeiten Ihr Konzept aus.', erledigt: 'Ihr Konzept ist ausgearbeitet.' },
  ber_konzeptvorstellung: { naechste: 'Wir vereinbaren mit Ihnen einen Termin, um Ihnen das Konzept vorzustellen.', erledigt: 'Der Termin für die Vorstellung des Konzepts ist vereinbart.' },
  ber_vertrag_zurueck: { vonIhnen: 'Die unterschriebene Beratungsvereinbarung', erledigt: 'Ihre unterschriebene Beratungsvereinbarung ist bei uns eingegangen.' },
  ber_erste_sitzung: { naechste: 'Wir vereinbaren mit Ihnen die erste Sitzung.', erledigt: 'Die erste Sitzung ist vereinbart.' },
  erb_fragebogen: { vonIhnen: 'Der ausgefüllte Mandantenfragebogen', erledigt: 'Ihr Mandantenfragebogen ist bei uns eingegangen.' },
  erb_memo: { naechste: 'Wir vereinbaren einen Termin, um das Mandantenmemo mit Ihnen zu besprechen.', erledigt: 'Der Termin für die Besprechung des Mandantenmemos ist vereinbart.' },
  erb_notar: { naechste: 'Wir geben den Entwurf an den Notar.', erledigt: 'Der Entwurf liegt beim Notar.' },
  erb_umsetzung: { naechste: 'Wir kümmern uns um den Notartermin und die Hinterlegung der Vollmachten.' },
  bue_abschluesse: { vonIhnen: 'Die Jahresabschlüsse der letzten drei Jahre', erledigt: 'Ihre Jahresabschlüsse sind bei uns eingegangen.' },
  bue_bewertung: { naechste: 'Wir stellen die Unternehmensbewertung fertig.', erledigt: 'Die Unternehmensbewertung ist fertig.' },
  bue_konzept: { naechste: 'Wir besprechen das Nachfolgekonzept mit Ihnen.', erledigt: 'Wir haben das Nachfolgekonzept mit Ihnen besprochen.' },
  bue_suche: { naechste: 'Wir holen Rückmeldungen von möglichen Käufern und Nachfolgern ein.' },
  bue_vertrag: { naechste: 'Wir prüfen den Vertragsentwurf.', erledigt: 'Den Vertragsentwurf haben wir geprüft.' },
  bue_uebergabe: { naechste: 'Wir begleiten Sie beim Übergabe-Stichtag und in der Zeit danach.' },
  bfo_vergleich: { naechste: 'Wir stellen den Rechtsformvergleich fertig.', erledigt: 'Der Rechtsformvergleich ist fertig.' },
  bfo_besprechen: { naechste: 'Wir vereinbaren einen Termin, um den Rechtsformvergleich mit Ihnen zu besprechen.', erledigt: 'Der Termin für die Besprechung des Rechtsformvergleichs ist vereinbart.' },
  bfo_vertrag: { naechste: 'Wir entwerfen den Gesellschaftsvertrag.', erledigt: 'Der Entwurf des Gesellschaftsvertrags ist fertig.' },
  bfo_stammkapital: { naechste: 'Sobald das Stammkapital eingezahlt ist, geht es mit dem Notartermin weiter.' },
  bfo_register: { naechste: 'Wir prüfen den Eintrag im Handelsregister und kümmern uns danach um Gewerbeanmeldung und Finanzamt.' },
  fin_beratung: { naechste: 'Wir vereinbaren ein Beratungsgespräch mit Ihnen.', erledigt: 'Das Beratungsgespräch ist vereinbart.' },
  fin_zeichnung: { vonIhnen: 'Das unterschriebene Beratungsprotokoll und der Zeichnungsschein', erledigt: 'Ihr unterschriebenes Beratungsprotokoll und der Zeichnungsschein sind bei uns eingegangen.' },
  aka_anrufen: ANRUFEN,
  imm_anrufen: ANRUFEN,
  aka_bestaetigen: { naechste: 'Wir bestätigen Ihre Anmeldung.', erledigt: 'Ihre Anmeldung ist bestätigt.' },
  aka_zertifikat: { naechste: 'Wir bereiten Ihr Zertifikat vor.', erledigt: 'Ihr Zertifikat ist vorbereitet.' },
  imm_finanzierung: { vonIhnen: 'Die Finanzierungsbestätigung Ihrer Bank', erledigt: 'Ihre Finanzierungsbestätigung ist bei uns eingegangen.' },
  imm_notar: { naechste: 'Wir prüfen den Entwurf des Notars.', erledigt: 'Den Entwurf des Notars haben wir geprüft.' },
}

// ---------------------------------------------------------------------------------------------
// Kleine Helfer

const ISO = /^\d{4}-\d{2}-\d{2}/

function tag(wert: string | null | undefined): string {
  const s = String(wert ?? '')
  return ISO.test(s) ? s.slice(0, 10) : ''
}

/** TT.MM.JJJJ */
export function deDatum(iso: string | null | undefined): string {
  const t = tag(iso)
  return t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}` : ''
}

/** TT.MM. */
function kurz(iso: string): string {
  const t = tag(iso)
  return t ? `${t.slice(8, 10)}.${t.slice(5, 7)}.` : ''
}

/** JJJJ-MM-TT plus n Tage (reine Kalenderrechnung). */
export function plusTage(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function euro(n: number): string {
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

const WOCHENTAG_KURZ = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']
const BERLIN_TEILE = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** „Mi., 25.11.2026, 10:00 Uhr“ (Berliner Zeit). */
function terminText(t: BerichtTermin): string {
  const d = new Date(t.beginn)
  if (Number.isNaN(d.getTime())) return ''
  const teile: Record<string, string> = {}
  for (const p of BERLIN_TEILE.formatToParts(d)) teile[p.type] = p.value
  const iso = `${teile.year}-${teile.month}-${teile.day}`
  const wt = WOCHENTAG_KURZ[new Date(`${iso}T12:00:00Z`).getUTCDay()]
  return t.ganztags ? `${wt}, ${deDatum(iso)}` : `${wt}, ${deDatum(iso)}, ${teile.hour}:${teile.minute} Uhr`
}

function imZeitraum(datum: string, seit: string, heute: string): boolean {
  return !!datum && datum >= seit && datum <= heute
}

function namenVon(akte: BerichtAkte): string {
  return String(akte.ansprechpartner ?? '').trim() || String(akte.firma ?? '').trim()
}

function ohneDoppelte(liste: string[]): string[] {
  const gesehen = new Set<string>()
  return liste.filter((z) => {
    const k = z.trim().toLowerCase()
    if (!k || gesehen.has(k)) return false
    gesehen.add(k)
    return true
  })
}

function regexSicher(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Kommt einer der Namen als ganzes Wort im Text vor? Vornamen ab drei Buchstaben zählen mit. */
function enthaeltNamen(text: string, namen: string[]): string | null {
  for (const n of namen) {
    const teile = [n, n.split(/\s+/)[0]].map((x) => x.trim()).filter((x) => x.length >= 3)
    for (const t of teile) {
      if (new RegExp(`(^|[^\\p{L}])${regexSicher(t)}($|[^\\p{L}])`, 'iu').test(text)) return n
    }
  }
  return null
}

const BETRAG = /\d[\d.,]*\s*(€|eur\b|euro\b)|€\s*\d/i
const INTERN = /\bintern|provision|vermittler|notiz|\bnicht an (den )?kunden\b/i

/** Kollegen = Team ohne den Ansprechpartner der Akte (und ohne Namen, die auch im Kundennamen stehen). */
function kollegen(d: BerichtDaten): string[] {
  const ansprech = String(d.akte.verantwortlich ?? '').trim().toLowerCase()
  const kunde = `${d.akte.firma ?? ''} ${d.akte.ansprechpartner ?? ''}`.toLowerCase()
  return d.team
    .map((n) => n.trim())
    .filter((n) => n && n.toLowerCase() !== ansprech)
    .filter((n) => {
      const vor = n.split(/\s+/)[0].toLowerCase()
      return !kunde.includes(n.toLowerCase()) && !(vor.length >= 3 && kunde.includes(vor))
    })
}

/** Status-Kennung lesbar machen, wenn es keine Bezeichnung gibt („aktives_mandat“ → „Aktives mandat“). */
export function statusLesbar(status: string | null | undefined): string {
  const s = String(status ?? '').replace(/_/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ''
}

/** Pfad der Akte im CRM (HashRouter), passend zu src/App.tsx. */
export function aktePfad(bereich: string, id: string): string {
  const basis: Record<string, string> = {
    beratung: '/beratung/kunden/',
    immobilienkunden: '/immobilien/kunden/',
    erben: '/erben/mandanten/',
    betriebsuebergabe: '/betriebsuebergabe/mandanten/',
    betriebsformen: '/betriebsformen/mandanten/',
    finanzierungen: '/finanzierungen/mandanten/',
    akademie: '/akademie/teilnehmer/',
  }
  return `${basis[bereich] ?? '/beratung/kunden/'}${encodeURIComponent(id)}`
}

/** Link auf die Akte, der das Fenster „Statusbericht“ gleich öffnet. */
export function akteLink(basis: string | null | undefined, bereich: string, id: string): string {
  const b = String(basis || CRM_BASIS_STANDARD)
  return `${b.endsWith('/') ? b : b + '/'}#${aktePfad(bereich, id)}?tab=uebersicht&statusbericht=1`
}

/** Datum des letzten Berichts: aus der Einstellung oder dem Verlauf („Statusbericht …“). */
export function letzterBericht(akte: Pick<BerichtAkte, 'activities'>, letzterVersand?: string | null): string | undefined {
  let neu = tag(letzterVersand) || undefined
  for (const a of akte.activities ?? []) {
    const d = tag(a.date)
    if (d && /^Statusbericht\b/.test(String(a.text ?? '')) && (!neu || d > neu)) neu = d
  }
  return neu
}

/** Erster Tag des Zeitraums: der Tag nach dem letzten Bericht, sonst die letzten sieben Tage (mit heute). */
export function standardSeit(akte: Pick<BerichtAkte, 'activities'>, letzterVersand: string | null | undefined, heute: string): string {
  const lb = letzterBericht(akte, letzterVersand)
  if (lb && lb < heute) return plusTage(lb, 1)
  return plusTage(heute, -6)
}

/** Hat der Kunde den Kostenvoranschlag nachweislich bekommen? (siehe oben) Liefert das Datum der Mail, wenn es eine gibt. */
function kvBekannt(kv: BerichtKv, mails: BerichtMail[]): { bekannt: boolean; mail?: BerichtMail } {
  if (kv.status === 'abgelehnt') return { bekannt: false }
  if (kv.status === 'angenommen' || kv.status === 'bezahlt') return { bekannt: true }
  if (!kv.mitPdf) return { bekannt: false }
  const ab = tag(kv.datum)
  const mail = [...mails]
    .sort((a, b) => a.gesendetAm.localeCompare(b.gesendetAm))
    .find((m) => /angebot|kostenvoranschlag/i.test(m.betreff) && (!ab || tag(m.gesendetAm) >= ab))
  return mail ? { bekannt: true, mail } : { bekannt: false }
}

function kvBezeichnung(kv: BerichtKv): string {
  const b = String(kv.beschreibung ?? '').trim()
  return b ? `„${b}“` : ''
}

/** Angeforderte Unterlagen, die noch fehlen (über alle Anforderungen; was laut Checkliste oder Hochladen da ist, fehlt nicht). */
export function fehlendeUnterlagen(akte: BerichtAkte): { punkte: string[]; weitere: string[] } {
  const alle = akte.unterlagenAnforderungen ?? []
  const checkliste = akte.unterlagenCheckliste ?? {}
  const da = (punkt: string, seit: string) =>
    (punkt === SELBSTAUSKUNFT && tag(akte.selbstauskunftAm) >= tag(seit) && !!tag(akte.selbstauskunftAm)) ||
    alle.some((a) => (a.eingang ?? []).some((e) => e.punkt === punkt && tag(e.datum) >= tag(seit)))
  const punkte: string[] = []
  const weitere: string[] = []
  // Neueste zuerst — jeder Punkt nur einmal, gemessen an seiner jüngsten Anforderung.
  const sortiert = [...alle].sort((a, b) => String(b.datum ?? '').localeCompare(String(a.datum ?? '')))
  const gesehen = new Set<string>()
  for (const a of sortiert) {
    const seit = String(a.datum ?? '')
    for (const p of a.punkte ?? []) {
      if (!p || gesehen.has(p)) continue
      gesehen.add(p)
      if (checkliste[p] === true || da(p, seit)) continue
      punkte.push(p)
    }
    const w = String(a.weitere ?? '').trim()
    if (w && !gesehen.has(`weitere:${w}`)) {
      gesehen.add(`weitere:${w}`)
      if (!da(SONSTIGE_UNTERLAGE, seit)) for (const z of w.split('\n').map((x) => x.trim()).filter(Boolean)) weitere.push(z)
    }
  }
  return { punkte, weitere: ohneDoppelte(weitere) }
}

// ---------------------------------------------------------------------------------------------
// Bericht bauen

export function erstelleKundenbericht(e: BerichtEingabe): Kundenbericht {
  const { akte, heute, seit } = e
  const hinweise: string[] = [...e.fehler]
  const name = namenVon(akte)
  const gruss = String(akte.verantwortlich ?? '').trim()
  const team = kollegen(e)
  const erledigt: { datum: string; text: string }[] = []
  const naechste: string[] = []
  const vonIhnen: string[] = []
  const benutzteMails = new Set<string>()

  // Kostenvoranschläge, die der Kunde kennt
  const offeneKvs: BerichtKv[] = []
  for (const kv of e.kvs) {
    const { bekannt, mail } = kvBekannt(kv, e.mails)
    if (!bekannt) continue
    const was = kvBezeichnung(kv)
    const betrag = typeof kv.betrag === 'number' && kv.betrag > 0 ? ` über ${euro(kv.betrag)}` : ''
    if (mail) {
      if (mail.id) benutzteMails.add(mail.id)
      const d = tag(mail.gesendetAm)
      if (imZeitraum(d, seit, heute)) erledigt.push({ datum: d, text: `${kurz(d)}: Unser Angebot${was ? ` ${was}` : ''}${betrag} haben wir Ihnen geschickt.` })
    }
    if (kv.status === 'offen') offeneKvs.push(kv)
    if (kv.status === 'angenommen' && imZeitraum(tag(kv.geaendertAm), seit, heute)) {
      erledigt.push({ datum: tag(kv.geaendertAm), text: `${kurz(tag(kv.geaendertAm))}: Vielen Dank für Ihren Auftrag${was ? ` zu ${was}` : ''}${betrag}.` })
    }
  }

  // Gesendete Mails (ohne frühere Statusberichte und ohne die schon beim Angebot genannte)
  for (const m of e.mails) {
    const d = tag(m.gesendetAm)
    if (!imZeitraum(d, seit, heute) || (m.id && benutzteMails.has(m.id))) continue
    if (m.betreff.trim().startsWith(BETREFF_ANFANG)) continue
    erledigt.push({ datum: d, text: `${kurz(d)}: Wir haben Ihnen geschrieben: „${m.betreff.trim()}“.` })
  }

  // Eingegangene Mails des Kunden (nur dieses Muster aus dem Verlauf, nie andere Verlaufstexte)
  const kollegenUndTeam = [...team, String(akte.verantwortlich ?? '')].filter(Boolean)
  for (const a of akte.activities ?? []) {
    const d = tag(a.date)
    if (!imZeitraum(d, seit, heute)) continue
    const m = /^E-Mail (?:automatisch )?zugeordnet: „(.+?)[“"”]\s*(?:von (.+?))?(?:\s*\(|$)/.exec(String(a.text ?? '').trim())
    if (!m) continue
    if (m[2] && enthaeltNamen(m[2], kollegenUndTeam)) continue
    erledigt.push({ datum: d, text: `${kurz(d)}: Ihre E-Mail „${m[1].trim()}“ ist bei uns eingegangen.` })
  }

  // Eingegangene Unterlagen über Hochlade-Links
  const eingangNamen = new Set<string>()
  const jeTag = new Map<string, string[]>()
  for (const a of akte.unterlagenAnforderungen ?? []) {
    for (const ein of a.eingang ?? []) {
      if (ein.name) eingangNamen.add(ein.name)
      const d = tag(ein.datum)
      if (!imZeitraum(d, seit, heute)) continue
      jeTag.set(d, [...(jeTag.get(d) ?? []), ein.punkt === SONSTIGE_UNTERLAGE ? 'weitere Unterlagen' : ein.punkt])
    }
  }
  for (const [d, punkte] of jeTag) erledigt.push({ datum: d, text: `${kurz(d)}: Ihre Unterlagen sind eingegangen: ${ohneDoppelte(punkte).join(', ')}.` })
  const sa = tag(akte.selbstauskunftAm)
  if (imZeitraum(sa, seit, heute)) erledigt.push({ datum: sa, text: `${kurz(sa)}: Ihre Selbstauskunft ist eingegangen.` })

  // Weitere abgelegte Unterlagen nur als Zahl (Namen sind oft intern); eigene Schreiben zählen nicht.
  const eigene = /^(statusbericht|rechnung|angebot|kostenvoranschlag|mahnung|zahlungserinnerung|\d\. mahnung)/i
  const weitereDoks = (akte.dokumente ?? []).filter((dok) => imZeitraum(tag(dok.datum), seit, heute) && !eingangNamen.has(String(dok.name ?? '')) && !eigene.test(String(dok.name ?? '').trim()))
  if (weitereDoks.length > 0) {
    erledigt.push({ datum: heute, text: weitereDoks.length === 1 ? 'Eine weitere Unterlage haben wir zu Ihrem Vorgang abgelegt.' : `${weitereDoks.length} weitere Unterlagen haben wir zu Ihrem Vorgang abgelegt.` })
  }

  // Rechnungen
  for (const r of e.rechnungen) {
    const betrag = typeof r.brutto === 'number' && r.brutto > 0 ? ` über ${euro(r.brutto)}` : ''
    const v = tag(r.versendetAm)
    if (imZeitraum(v, seit, heute)) erledigt.push({ datum: v, text: `${kurz(v)}: Unsere Rechnung Nr. ${r.nummer}${betrag} haben wir Ihnen geschickt.` })
    const b = tag(r.bezahltAm)
    if (imZeitraum(b, seit, heute)) erledigt.push({ datum: b, text: `${kurz(b)}: Ihre Zahlung zu Rechnung Nr. ${r.nummer} ist eingegangen. Vielen Dank!` })
  }

  // Wiedervorlagen
  let interneOffen = 0
  for (const w of e.wiedervorlagen) {
    const text = w.regel ? WV_FUER_KUNDEN[w.regel] : undefined
    if (w.erledigtAm) {
      const d = tag(w.erledigtAm)
      const wirklich = !w.erledigtGrund || /eingegangen|erledigt/i.test(w.erledigtGrund)
      if (text?.erledigt && wirklich && imZeitraum(d, seit, heute)) erledigt.push({ datum: d, text: `${kurz(d)}: ${text.erledigt}` })
      continue
    }
    if (!text || (!text.naechste && !text.vonIhnen)) {
      interneOffen++
      continue
    }
    if (text.naechste) naechste.push(text.naechste)
    if (text.vonIhnen) vonIhnen.push(text.vonIhnen)
  }
  if (interneOffen > 0) hinweise.push(interneOffen === 1 ? 'Eine offene Wiedervorlage ist intern und steht nicht im Bericht.' : `${interneOffen} offene Wiedervorlagen sind intern und stehen nicht im Bericht.`)

  // Termine mit dem Kunden als Gast
  const kuenftig = e.termine
    .filter((t) => t.gast && tag(t.beginn) >= heute)
    .sort((a, b) => a.beginn.localeCompare(b.beginn))
  for (const t of kuenftig.slice(0, 3)) {
    const z = terminText(t)
    if (z) naechste.unshift(`Unser nächster gemeinsamer Termin: ${z}.`)
  }

  // Nächste Schritte aus der Akte (Freitext, gefiltert)
  const weggelassen: string[] = []
  for (const roh of String(akte.naechsteSchritte ?? '').split('\n')) {
    const zeile = roh.replace(/^\s*(?:[-–•*·]|\d+[.)])\s*/, '').trim()
    if (!zeile) continue
    if (BETRAG.test(zeile) || INTERN.test(zeile) || enthaeltNamen(zeile, team)) {
      weggelassen.push(zeile)
      continue
    }
    naechste.push(/[.!?]$/.test(zeile) ? zeile : `${zeile}.`)
  }
  if (weggelassen.length > 0) {
    hinweise.push(`${weggelassen.length === 1 ? 'Eine Zeile' : `${weggelassen.length} Zeilen`} aus „Nächste Schritte“ weggelassen (Namen von Kollegen, Beträge oder Internes): ${weggelassen.map((z) => `„${z.slice(0, 80)}“`).join(', ')}`)
  }

  // Was wir vom Kunden brauchen
  const fehlend = fehlendeUnterlagen(akte)
  const brauchen = ohneDoppelte([...fehlend.punkte, ...fehlend.weitere, ...vonIhnen])
  for (const kv of offeneKvs) brauchen.push(`Ihre Rückmeldung zu unserem Angebot${kvBezeichnung(kv) ? ` ${kvBezeichnung(kv)}` : ''}${tag(kv.datum) ? ` vom ${deDatum(kv.datum)}` : ''}`)

  if (!String(akte.email ?? '').trim()) hinweise.push('In der Akte steht keine E-Mail-Adresse — senden geht erst, wenn du eine einträgst (oder als PDF per Post).')

  // Stand im Ablauf
  let stand = ''
  if (e.stand?.abgeschlossen) stand = 'Ihr Vorgang ist abgeschlossen.'
  else if (e.stand?.label && e.stand.schritt) stand = `Ihr Vorgang steht derzeit bei: „${e.stand.label}“ (Schritt ${e.stand.schritt} von ${e.stand.schritte ?? '?'}).`

  const ampel: KundenAmpel = brauchen.length > 0 ? 'gelb' : 'gruen'
  const leistungen = (akte.dienstleistungen ?? []).map((x) => String(x).trim()).filter(Boolean)
  const zeitraum = seit === heute ? `heute, den ${deDatum(heute)}` : `die Zeit vom ${deDatum(seit)} bis ${deDatum(heute)}`

  return {
    betreff: `${BETREFF_ANFANG} (${deDatum(heute)})`,
    anrede: name ? `Guten Tag ${name},` : 'Guten Tag,',
    einleitung: `hier ist der aktuelle Stand Ihres Projekts${leistungen.length ? ` (${leistungen.join(', ')})` : ''} für ${zeitraum}.`,
    ampel,
    ampelText: AMPEL_KUNDENTEXT[ampel],
    stand,
    erledigt: ohneDoppelte(erledigt.sort((a, b) => a.datum.localeCompare(b.datum)).map((x) => x.text)),
    naechste: ohneDoppelte(naechste),
    vonIhnen: ohneDoppelte(brauchen),
    fehlendePunkte: fehlend.punkte,
    schluss: 'Bei Fragen antworten Sie einfach auf diese E-Mail oder rufen Sie uns an.',
    gruss,
    seit,
    heute,
    hinweise,
  }
}

// ---------------------------------------------------------------------------------------------
// Text der Mail (und des Entwurfs im Assistenten)

export type BerichtTextAngaben = Pick<Kundenbericht, 'anrede' | 'einleitung' | 'ampel' | 'ampelText' | 'stand' | 'erledigt' | 'naechste' | 'vonIhnen' | 'schluss' | 'gruss'>

/** Mailtext. `link`: Hochlade-Link (nur wenn etwas fehlt); ohne Link fällt der Absatz weg. */
export function berichtAlsText(b: BerichtTextAngaben, link?: string): string {
  const liste = (zeilen: string[]) => zeilen.map((z) => `- ${z}`).join('\n')
  const teile: string[] = [b.anrede, b.einleitung, [`Ampel: ${AMPEL_NAME[b.ampel]} – ${b.ampelText}`, b.stand].filter(Boolean).join('\n')]
  teile.push(b.erledigt.length ? `Was seitdem passiert ist:\n${liste(b.erledigt)}` : 'Was seitdem passiert ist:\n- In diesem Zeitraum gab es keine neuen Schritte, die Sie betreffen.')
  if (b.naechste.length) teile.push(`Die nächsten Schritte:\n${liste(b.naechste)}`)
  if (b.vonIhnen.length) {
    const hochladen = link
      ? `\nSie können die Unterlagen hier hochladen, ohne Anmeldung und auch mit dem Handy:\n${link}\nDer Link ist ${LINK_GUELTIG_TAGE} Tage gültig. Bitte geben Sie ihn nicht weiter.`
      : ''
    teile.push(`Was wir noch von Ihnen brauchen:\n${liste(b.vonIhnen)}${hochladen}`)
  }
  if (b.schluss.trim()) teile.push(b.schluss.trim())
  teile.push(`Mit freundlichen Grüßen\n${b.gruss.trim() || 'Ihr Team der Mayer Holding'}\nMayer Holding`)
  return teile.filter((t) => t.trim()).join('\n\n')
}

/** Eine Zeile für Telegram: wie viel passiert ist und was fehlt. */
export function kurzfassung(b: Pick<Kundenbericht, 'erledigt' | 'naechste' | 'vonIhnen' | 'seit'>): string {
  const teile = [
    b.erledigt.length === 1 ? '1 Punkt erledigt' : `${b.erledigt.length} Punkte erledigt`,
    b.naechste.length === 1 ? '1 nächster Schritt' : `${b.naechste.length} nächste Schritte`,
    b.vonIhnen.length === 0 ? 'nichts offen beim Kunden' : b.vonIhnen.length === 1 ? '1 Punkt offen beim Kunden' : `${b.vonIhnen.length} Punkte offen beim Kunden`,
  ]
  return `Seit ${deDatum(b.seit)}: ${teile.join(', ')}.`
}

// ---------------------------------------------------------------------------------------------
// Daten laden (Browser mit Login oder Server mit Dienstschlüssel — gleiche Abfragen)

// deno-lint-ignore no-explicit-any
type Db = any

const KUNDE_SPALTEN = 'id, bereich, firma, ansprechpartner, email, verantwortlich, status, naechste_schritte, dienstleistungen, activities, dokumente, unterlagen_anforderungen, unterlagen_checkliste, sa_am:selbstauskunft->>eingereichtAm'

// deno-lint-ignore no-explicit-any
export function akteAusZeile(z: any): BerichtAkte {
  return {
    id: String(z.id),
    bereich: String(z.bereich ?? ''),
    firma: z.firma ?? null,
    ansprechpartner: z.ansprechpartner ?? null,
    email: z.email ?? null,
    verantwortlich: z.verantwortlich ?? null,
    status: z.status ?? null,
    naechsteSchritte: z.naechste_schritte ?? null,
    dienstleistungen: Array.isArray(z.dienstleistungen) ? z.dienstleistungen : null,
    activities: Array.isArray(z.activities) ? z.activities : [],
    dokumente: Array.isArray(z.dokumente) ? z.dokumente : [],
    unterlagenAnforderungen: Array.isArray(z.unterlagen_anforderungen) ? z.unterlagen_anforderungen : [],
    unterlagenCheckliste: z.unterlagen_checkliste && typeof z.unterlagen_checkliste === 'object' ? z.unterlagen_checkliste : null,
    selbstauskunftAm: z.sa_am ?? null,
  }
}

/**
 * Lädt alles für den Bericht einer Akte. `akte`: schon vorhandene Akte (im Browser die aus dem App-Zustand,
 * die frischer sein kann als die Datenbank) — dann wird die Zeile in `kunden` nicht gelesen.
 * Gibt null zurück, wenn es die Akte nicht gibt. Fehler einzelner Teile landen in `fehler`.
 */
export async function ladeBerichtDaten(db: Db, kundeId: string, opts: { akte?: BerichtAkte } = {}): Promise<BerichtDaten | null> {
  let akte = opts.akte
  if (!akte) {
    const { data, error } = await db.from('kunden').select(KUNDE_SPALTEN).eq('id', kundeId).maybeSingle()
    if (error) throw new Error(`Die Akte ließ sich nicht lesen: ${error.message}`)
    if (!data) return null
    akte = akteAusZeile(data)
  }
  const fehler: string[] = []
  // deno-lint-ignore no-explicit-any
  const lies = async (was: string, abfrage: PromiseLike<{ data: any; error: { message: string } | null }>): Promise<any[]> => {
    try {
      const { data, error } = await abfrage
      if (error) {
        fehler.push(`Nicht geladen: ${was} (${error.message}).`)
        return []
      }
      return Array.isArray(data) ? data : data ? [data] : []
    } catch (err) {
      fehler.push(`Nicht geladen: ${was} (${err instanceof Error ? err.message : String(err)}).`)
      return []
    }
  }
  const [wv, mails, termine, kvs, rechnungen, team, einst] = await Promise.all([
    lies('Wiedervorlagen', db.from('wiedervorlagen').select('regel, titel, faellig, quelle, erledigt_am, erledigt_grund').eq('kunde_id', kundeId).order('faellig', { ascending: true }).limit(200)),
    lies('Gesendete E-Mails', db.from('gesendete_emails').select('id, betreff, gesendet_am').eq('kunde_id', kundeId).is('besitzer_email', null).order('gesendet_am', { ascending: false }).limit(200)),
    lies('Termine', db.from('termine').select('beginn, ganztags, gast').eq('kunde_id', kundeId).order('beginn', { ascending: true }).limit(100)),
    lies('Kostenvoranschläge', db.from('kostenvoranschlaege').select('id, beschreibung, status, datum, betrag, dokument, geaendert_am').eq('kunde_id', kundeId).limit(100)),
    lies('Rechnungen', db.from('rechnungen').select('nummer, datum, betrag_brutto, status, versendet_am, bezahlt_am').eq('kunde_id', kundeId).limit(100)),
    lies('Mitarbeiter', db.from('mitarbeiter').select('name').eq('aktiv', true)),
    lies('Einstellung zum Statusbericht', db.from('kundenbericht_einstellung').select('letzter_versand').eq('kunde_id', kundeId).maybeSingle()),
  ])
  return {
    akte,
    wiedervorlagen: wv.map((w) => ({ regel: w.regel ?? null, titel: String(w.titel ?? ''), faellig: String(w.faellig ?? '').slice(0, 10), quelle: w.quelle ?? null, erledigtAm: w.erledigt_am ?? null, erledigtGrund: w.erledigt_grund ?? null })),
    mails: mails.map((m) => ({ id: m.id ? String(m.id) : undefined, betreff: String(m.betreff ?? ''), gesendetAm: String(m.gesendet_am ?? '') })),
    termine: termine.map((t) => ({ beginn: String(t.beginn ?? ''), ganztags: !!t.ganztags, gast: !!t.gast })),
    kvs: kvs.map((k) => ({
      id: String(k.id),
      beschreibung: k.beschreibung ?? null,
      status: String(k.status ?? 'offen'),
      datum: k.datum ?? null,
      betrag: k.betrag === null || k.betrag === undefined ? null : Number(k.betrag),
      mitPdf: !!(k.dokument && typeof k.dokument === 'object' && k.dokument.kundeId),
      geaendertAm: k.geaendert_am ?? null,
    })),
    rechnungen: rechnungen.map((r) => ({
      nummer: String(r.nummer ?? ''),
      datum: r.datum ?? null,
      brutto: r.betrag_brutto === null || r.betrag_brutto === undefined ? null : Number(r.betrag_brutto),
      status: r.status ?? null,
      versendetAm: r.versendet_am ?? null,
      bezahltAm: r.bezahlt_am ?? null,
    })),
    team: team.map((m) => String(m.name ?? '').trim()).filter(Boolean),
    letzterVersand: einst[0]?.letzter_versand ?? null,
    fehler,
  }
}
