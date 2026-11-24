// Rechnungen im Assistenten ausstellen, versenden und das Follow-up nennen (24.11.2026).
//
// Anlass: Hasan bat in Telegram, „die Rechnung mit den 5000 Euro netto“ zu erstellen; der Assistent konnte Rechnungen nur
// erfassen (rechnung_erfassen) und baute mit dokument_erstellen einen „Rechnungsentwurf“ mit erfundenem Layout.
//
// Werkzeuge:
//  - rechnung_erstellen: echte Rechnung wie im CRM — Nummer nach dem Schema der Geschäftsführung
//    (_shared/rechnungsnummerKern.ts: Kürzel je Kunde + laufende Nummer, z. B. LSA-001), PDF auf dem Holding-Briefbogen
//    (_shared/rechnungHoldingPdf.ts), Ablage als Dokument in der Akte (dokumentErstellen.ts legeAb, wie andere
//    Assistent-Dokumente) und Eintrag in der Tabelle rechnungen genau wie RechnungFormular.tsx (Status „Entwurf“,
//    Positionen, Steuersatz, Leistungszeitraum, Anschrift, dokument). Danach die nächsten Follow-up-Schritte.
//  - rechnung_versenden: bereitet die Mail an den Kunden mit dem PDF (und, wenn das Modul E-Rechnung an ist, der
//    XRechnung als zweitem Anhang — wie der Versand im CRM) vor, OHNE zu senden. Gesendet wird über den vorhandenen
//    Ablauf mail_senden in index.ts (nur nach ausdrücklichem Ja in der nächsten Nachricht). Nach dem tatsächlichen
//    Versand setzt fuehreMailSchrittAus über rechnungNachVersand den Status auf „Versendet“ (wie der Dialog „Rechnung
//    senden“ im CRM) — dadurch legt die Datenbank die Wiedervorlage „Geldeingang prüfen“ an und das Mahnwesen zählt die
//    Rechnung. Die Abschlussnachricht nennt die nächsten Follow-up-Schritte (folgeNachVersand).
//  - followup_naechste_schritte: dieselben Schritte jederzeit für eine Akte (_shared/followupKern.ts).
//
// Rechte wie rechnung_erfassen: Zeilenregel rechnungen = darf_bereich('beratung') (darfRechnungen) plus die Akte
// (darfAkte; private Akten anderer gibt es nicht, private Kontakte bekommen keine Holding-Rechnung).
// ZUGFeRD (XML im PDF) gibt es bewusst nicht: Dafür müsste das PDF PDF/A-3 sein (eingebettete Schriften, XMP), das kann
// der Briefbogen mit den Standardschriften nicht. Die XRechnung geht wie im CRM als eigene XML-Datei mit.

import { alleZeilen } from '../_shared/alleZeilen.ts'
import { erzeugeXRechnung, pruefeXRechnung } from '../_shared/eRechnung/erzeugen.ts'
import { eRechnungAktiv } from '../_shared/eRechnung/modul.ts'
import { folgeText, ladeFolgeDaten, berechneFolgeSchritte } from '../_shared/followupKern.ts'
import { erzeugeHoldingRechnungPdf } from '../_shared/rechnungHoldingPdf.ts'
import {
  type AkteFuerRechnung,
  anschriftFuer,
  anschriftZeilen,
  deDatum,
  empfaengerZeilen,
  euro,
  hatPlzOrt,
  istIsoDatum,
  leistungText,
  lesePositionen,
  neueId,
  plusTage,
  rechnungDateiname,
  rundeCent,
  summeAusPositionen,
  UST_VORGABE,
  xRechnungDateiname,
  xRechnungEingabe,
  ZAHLUNGSZIEL_TAGE,
} from '../_shared/rechnungAusstellenKern.ts'
import { kuerzelFuer, naechsteNummerFuerKuerzel } from '../_shared/rechnungsnummerKern.ts'
import { type DokumentKontext, ladeZiel, legeAb } from './dokumentErstellen.ts'
import { darfAkte, darfBereich, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type RechnungMailEmpfaenger = { kunde_id: string; bereich: string; name: string; firma: string; email: string; status: string }
export type RechnungAnhang = { eimer: string; pfad: string; dateiname: string; typ: string }
export type RechnungBezug = { id: string; nummer: string; kunde_id: string }
/** Passt auf MailEntwurf in index.ts (mail_anfrage), mit Anhang und Rechnungsbezug. */
export type RechnungMailEntwurf = { id: string; betreff: string; text: string; empfaenger: RechnungMailEmpfaenger[]; z: string; anhaenge: RechnungAnhang[]; rechnung: RechnungBezug }

export type RechnungErstellenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; email?: string | null }
  protokolliere: (text: string) => void
  heute: string
  /** Legt den vorbereiteten Versand als offene Mail-Anfrage ab (state.mail_anfrage), die mail_senden nach dem Ja sendet. */
  merkeMailEntwurf?: (e: RechnungMailEntwurf) => void
  /** Fertiger Mailtext für einen Empfänger (Anrede, Gruß) — mailText aus index.ts. */
  mailText?: (text: string, e: RechnungMailEmpfaenger) => string
}

const EIMER = 'kunden-dokumente'
/** Ohne Zahlungsfrist: Prüftag für Wiedervorlage/Mahnwesen = Rechnungsdatum + 30 Tage (Verzug nach § 286 Abs. 3 BGB). */
const OHNE_FRIST_PRUEFTAGE = 30
const SQL_FEHLT = 'Nicht erstellt: Für das neue Rechnungsnummern-Schema fehlt noch die Datenbank-Spalte kunden.rechnungs_kuerzel (Datei supabase/sql/2026-11-24_rechnungsnummer.sql ist noch nicht ausgeführt). Sag dem Mitarbeiter, dass Eray das kurz einspielen muss; bis dahin geht die Rechnung nur im CRM.'

export const RECHNUNG_ERSTELLEN_WERKZEUGE = [
  {
    name: 'rechnung_erstellen',
    description:
      'Stellt eine echte Ausgangsrechnung der Holding aus („Erstelle die Rechnung über 5.000 € netto für X“): vergibt die Rechnungsnummer nach dem Schema des Hauses (Kürzel des Kunden + laufende Nummer, z. B. LSA-001), erzeugt das PDF auf dem Briefbogen der Holding, legt es in der Kundenakte ab und trägt die Rechnung in die Rechnungsübersicht des CRM ein (Status Entwurf, bis sie verschickt ist). Liefert die nächsten Follow-up-Schritte mit. Rechnungen NIE mit dokument_erstellen bauen. Beträge sind Nettopreise; nichts erfinden, was der Mitarbeiter nicht gesagt hat.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (mit kunden_suchen ermitteln).' },
        positionen: {
          type: 'array',
          description: 'Die berechneten Leistungen. Ohne nähere Angabe eine Position mit menge 1, einheit Pauschal.',
          items: {
            type: 'object',
            properties: {
              bezeichnung: { type: 'string', description: 'Leistung, z. B. "Beratungsleistung laut Vereinbarung". Nur was der Mitarbeiter genannt hat oder was in der Akte steht.' },
              menge: { type: 'number', description: 'Vorgabe 1.' },
              einheit: { type: 'string', description: 'Stunde, Tag, Pauschal oder Stück (Vorgabe Pauschal).' },
              einzelpreis: { type: 'number', description: 'Einzelpreis NETTO in Euro.' },
            },
            required: ['bezeichnung', 'einzelpreis'],
          },
        },
        ust_satz: { type: 'number', description: 'Umsatzsteuer in Prozent, Vorgabe 19. Bei 0 muss der Grund in hinweis stehen.' },
        rechnungsdatum: { type: 'string', description: 'JJJJ-MM-TT, Vorgabe heute.' },
        leistungsdatum: { type: 'string', description: 'Tag der Leistung JJJJ-MM-TT, falls genannt.' },
        leistungszeitraum: { type: 'string', description: 'Statt leistungsdatum ein Zeitraum als Text, z. B. "01.11.2026 – 20.11.2026".' },
        zahlungsziel_tage: { type: 'integer', minimum: 0, maximum: 90, description: `Zahlbar binnen … Tagen, Vorgabe ${ZAHLUNGSZIEL_TAGE} (wie im CRM).` },
        ohne_zahlungsfrist: { type: 'boolean', description: 'true = „ohne Frist“: Auf Rechnung und Mail steht KEIN Zahlungsziel/„zahlbar bis“. Intern prüft das Follow-up nach 30 Tagen den Geldeingang.' },
        anschrift: { type: 'string', description: 'Nur wenn in der Akte keine Anschrift steht oder der Mitarbeiter eine andere nennt: Straße und "PLZ Ort", je Angabe eine Zeile. Wird bei leerer Akte dort gespeichert.' },
        anschreiben: { type: 'string', description: 'Optional: eigener Satz vor der Aufstellung statt "für unsere Leistungen erlauben wir uns, Ihnen Folgendes in Rechnung zu stellen:".' },
        hinweis: { type: 'string', description: 'Optional: Zusatz auf der Rechnung (z. B. Grund für 0 % Umsatzsteuer).' },
      },
      required: ['kunde_id', 'positionen'],
    },
  },
  {
    name: 'rechnung_versenden',
    description:
      'Bereitet den Versand einer Rechnung per E-Mail an den Kunden vor, mit dem Rechnungs-PDF als Anhang (und der E-Rechnung, wenn das Modul an ist) — OHNE zu senden. Zeige dem Mitarbeiter danach Empfänger, Betreff, Anhang und Text und frag, ob du so senden sollst. Erst wenn er in seiner nächsten Nachricht klar zustimmt, rufst du mail_senden auf. Nach dem Versand steht die Rechnung auf Versendet (offen) und das Follow-up läuft.',
    input_schema: {
      type: 'object',
      properties: {
        rechnung_id: { type: 'string' },
        nummer: { type: 'string', description: 'Rechnungsnummer, wenn die id nicht bekannt ist, z. B. "LSA-001".' },
        an: { type: 'string', description: 'Nur wenn der Mitarbeiter eine andere Adresse nennt als die der Akte.' },
        text: { type: 'string', description: 'Optional eigener Mailtext OHNE Anrede und Gruß (beides kommt automatisch). Ohne Angabe der Standardtext wie im CRM.' },
      },
    },
  },
  {
    name: 'rechnung_aendern',
    description:
      'Ändert eine Rechnung, die noch Entwurf ist (nicht versendet): Zahlungsfrist (z. B. „ohne Frist“), Positionen/Beträge, Umsatzsteuer, Leistungsdatum/-zeitraum, Rechnungsdatum, Hinweis, Anschreiben. Die Rechnungsnummer bleibt; das PDF in der Akte wird durch die neue Fassung ersetzt. Für „mach LSA-001 ohne Frist“ oder „ändere den Betrag auf …“. Nie eine neue Rechnung anlegen, nur weil ein Entwurf geändert werden soll. Versendete Rechnungen lassen sich nicht ändern (dann Gutschrift/Storno im CRM).',
    input_schema: {
      type: 'object',
      properties: {
        rechnung_id: { type: 'string' },
        nummer: { type: 'string', description: 'z. B. "LSA-001", wenn die id nicht bekannt ist.' },
        ohne_zahlungsfrist: { type: 'boolean', description: 'true = kein Zahlungsziel auf der Rechnung; false = wieder mit Frist (zahlungsziel_tage).' },
        zahlungsziel_tage: { type: 'integer', minimum: 0, maximum: 90 },
        positionen: { type: 'array', description: 'Nur angeben, wenn sich Positionen ändern — dann ALLE Positionen vollständig.', items: { type: 'object', properties: { bezeichnung: { type: 'string' }, menge: { type: 'number' }, einheit: { type: 'string' }, einzelpreis: { type: 'number' } }, required: ['bezeichnung', 'einzelpreis'] } },
        ust_satz: { type: 'number' },
        rechnungsdatum: { type: 'string', description: 'JJJJ-MM-TT' },
        leistungsdatum: { type: 'string' },
        leistungszeitraum: { type: 'string' },
        hinweis: { type: 'string', description: 'Leerer Text entfernt den Hinweis.' },
        anschreiben: { type: 'string' },
      },
    },
  },
  {
    name: 'followup_naechste_schritte',
    description:
      'Nennt die nächsten Follow-up-Schritte einer Akte mit Datum, berechnet aus den echten Regeln des CRM: Rechnungen (Versand, Zahlungsziel, Wiedervorlage „Geldeingang prüfen“, Zahlungserinnerung und Mahnungen nach den eingestellten Tagen), offene Wiedervorlagen, Follow-up der Akte, fehlende Unterlagen. Für „Was steht bei X als Nächstes an?“.',
    input_schema: { type: 'object', properties: { kunde_id: { type: 'string' } }, required: ['kunde_id'] },
  },
]

export function istRechnungErstellenWerkzeug(name: string): boolean {
  return RECHNUNG_ERSTELLEN_WERKZEUGE.some((w) => w.name === name)
}

type Akte = AkteFuerRechnung & {
  bereich: string | null
  verantwortlich_email?: string | null
  status?: string | null
  rechnungs_kuerzel?: string | null
  dokumente?: { id: string; name: string; url?: string; typ?: string }[] | null
  activities?: unknown[] | null
  follow_up?: unknown
  unterlagen_anforderungen?: unknown
}

const AKTE_SPALTEN = 'id, bereich, status, firma, ansprechpartner, anschrift, email, immo_stammdaten, verantwortlich_email, dokumente, follow_up, unterlagen_anforderungen'
const KEIN_KUNDE = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'

function akteName(a: Pick<Akte, 'firma' | 'ansprechpartner'>): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

const spalteFehlt = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === '42703' || /rechnungs_kuerzel/.test(String(e.message ?? '')))

/** Akte laden und prüfen (Rechte, keine Sammelakte, kein privater Kontakt). */
async function ladeAkte(k: RechnungErstellenKontext, kundeId: string, mitKuerzel: boolean): Promise<Akte | string> {
  if (!kundeId) return 'Fehler: kunde_id fehlt.'
  const { data, error } = await k.supabase.from('kunden').select(mitKuerzel ? `${AKTE_SPALTEN}, rechnungs_kuerzel` : AKTE_SPALTEN).eq('id', kundeId).maybeSingle()
  if (spalteFehlt(error)) return SQL_FEHLT
  if (error) return `Fehler beim Laden der Akte: ${error.message}`
  if (!data || istFremdePrivatakte(k.mitarbeiter, data)) return KEIN_KUNDE
  if (!darfAkte(k.mitarbeiter, data)) return nichtFreigegeben(data.bereich, k.mitarbeiter.name)
  return data as Akte
}

function pruefeRechnungsAkte(a: Akte): string | null {
  if (SAMMELAKTEN.includes(a.id)) return 'Fehler: Das ist eine Sammelakte. Eine Rechnung gehört in die Akte des Kunden (kunden_suchen).'
  if (istPrivat(a)) return 'Nicht möglich: Rechnungen der Holding gehen nicht an private Kontakte. Falls der Kontakt ein Kunde der Holding ist, muss er erst in einen Bereich der Holding.'
  return null
}

/** Rechnungsnummer vergeben und die Rechnung anlegen — sicher gegen gleichzeitige Aufrufe (eindeutige Spalten + neu versuchen). */
export async function legeRechnungAn(
  supabase: Supa,
  akte: Pick<Akte, 'id' | 'firma' | 'ansprechpartner' | 'rechnungs_kuerzel'>,
  zeile: (nummer: string) => Record<string, unknown>,
): Promise<{ nummer: string; kuerzel: string; neuesKuerzel: boolean; id: string } | string> {
  let kuerzel = String(akte.rechnungs_kuerzel ?? '').trim()
  let neuesKuerzel = false
  for (let versuch = 0; versuch < 6; versuch++) {
    const { data: rechnungen, error: rFehler } = await alleZeilen(() => supabase.from('rechnungen').select('id, kunde_id, nummer'))
    if (rFehler) return `Fehler beim Lesen der Rechnungen: ${rFehler.message}`
    const liste = (rechnungen ?? []) as { kunde_id: string | null; nummer: string }[]
    if (!kuerzel) {
      const { data: kunden, error: kFehler } = await alleZeilen(() => supabase.from('kunden').select('id, rechnungs_kuerzel'))
      if (spalteFehlt(kFehler)) return SQL_FEHLT
      if (kFehler) return `Fehler beim Lesen der Kürzel: ${kFehler.message}`
      // deno-lint-ignore no-explicit-any
      const vergeben = ((kunden ?? []) as any[]).filter((x) => String(x.rechnungs_kuerzel ?? '').trim()).map((x) => ({ kunde_id: String(x.id), kuerzel: String(x.rechnungs_kuerzel) }))
      const eigen = vergeben.find((x) => x.kunde_id === akte.id)
      if (eigen) kuerzel = eigen.kuerzel
      else {
        const v = kuerzelFuer({ kunde: { ...akte, rechnungs_kuerzel: null }, kuerzel: vergeben, rechnungen: liste })
        // Nur setzen, wenn die Akte noch keins hat; scheitert es am eindeutigen Index, hat ein anderer Kunde es gerade bekommen.
        const { data: gesetzt, error: sFehler } = await supabase.from('kunden').update({ rechnungs_kuerzel: v.kuerzel }).eq('id', akte.id).is('rechnungs_kuerzel', null).select('id')
        if (spalteFehlt(sFehler)) return SQL_FEHLT
        if (sFehler?.code === '23505') continue
        if (sFehler) return `Fehler beim Speichern des Rechnungskürzels: ${sFehler.message}`
        if (!gesetzt || gesetzt.length === 0) continue // gleichzeitig vergeben → neu lesen
        kuerzel = v.kuerzel
        neuesKuerzel = true
      }
    }
    const nummer = naechsteNummerFuerKuerzel(kuerzel, liste.map((r) => r.nummer))
    const z = zeile(nummer)
    const { error } = await supabase.from('rechnungen').insert(z)
    if (error?.code === '23505') continue
    if (error) return `Fehler beim Anlegen der Rechnung: ${error.message}`
    return { nummer, kuerzel, neuesKuerzel, id: String(z.id) }
  }
  return 'Fehler: Die Rechnungsnummer ließ sich nach mehreren Versuchen nicht vergeben (gleichzeitige Rechnungen). Bitte gleich noch einmal versuchen.'
}

function dokKontext(k: RechnungErstellenKontext): DokumentKontext {
  return { supabase: k.supabase, mitarbeiter: k.mitarbeiter, protokolliere: k.protokolliere, heute: k.heute }
}

/** Folge-Schritte als Text (Rechnungen nur, wenn der Mitarbeiter sie sehen darf). */
async function folgeFuer(k: RechnungErstellenKontext, akte: Akte, versandHeute?: string): Promise<string> {
  try {
    const daten = await ladeFolgeDaten(k.supabase, akte, k.heute, darfBereich(k.mitarbeiter, 'beratung'))
    return folgeText(berechneFolgeSchritte(daten, { versandHeute }), k.heute)
  } catch (err) {
    return `(Follow-up-Schritte ließen sich nicht berechnen: ${err instanceof Error ? err.message : String(err)})`
  }
}

// deno-lint-ignore no-explicit-any
export async function fuehreRechnungErstellenWerkzeugAus(name: string, input: any, k: RechnungErstellenKontext): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k

  if (name === 'followup_naechste_schritte') {
    const akte = await ladeAkte(k, String(input?.kunde_id ?? '').trim(), false)
    if (typeof akte === 'string') return akte
    return `Nächste Follow-up-Schritte für ${akteName(akte)} (aus Wiedervorlagen, Rechnungen und Mahnregeln des CRM):\n${await folgeFuer(k, akte)}`
  }

  // Rechnungen gehören zur Unternehmensberatung (Zeilenregel darf_bereich('beratung')).
  if (!darfBereich(mitarbeiter, 'beratung')) return nichtFreigegeben('beratung', mitarbeiter.name)

  if (name === 'rechnung_erstellen') {
    const akte = await ladeAkte(k, String(input?.kunde_id ?? '').trim(), true)
    if (typeof akte === 'string') return akte
    const fehlerAkte = pruefeRechnungsAkte(akte)
    if (fehlerAkte) return fehlerAkte

    const positionen = lesePositionen(input?.positionen)
    if (typeof positionen === 'string') return positionen
    const ustRoh = input?.ust_satz === undefined || input?.ust_satz === null || input?.ust_satz === '' ? UST_VORGABE : Number(input.ust_satz)
    if (!Number.isFinite(ustRoh) || ustRoh < 0 || ustRoh > 30) return 'Fehler: ust_satz muss zwischen 0 und 30 Prozent liegen (üblich 19 oder 7).'
    const ust = rundeCent(ustRoh)
    const hinweis = String(input?.hinweis ?? '').trim().slice(0, 600)
    if (ust === 0 && !hinweis) return 'Fehler: Bei 0 % Umsatzsteuer muss der Grund auf die Rechnung (hinweis), z. B. „Steuerfrei nach § 4 Nr. … UStG“. Frag den Mitarbeiter nach dem Grund.'
    const summen = summeAusPositionen(positionen, ust)
    if (summen.brutto <= 0) return 'Fehler: Der Rechnungsbetrag muss größer als 0 € sein.'

    const datum = istIsoDatum(input?.rechnungsdatum) ? String(input.rechnungsdatum) : heute
    const ohneFrist = input?.ohne_zahlungsfrist === true
    const tage = ohneFrist ? OHNE_FRIST_PRUEFTAGE : Number.isInteger(Number(input?.zahlungsziel_tage)) && Number(input.zahlungsziel_tage) >= 0 && Number(input.zahlungsziel_tage) <= 90 ? Number(input.zahlungsziel_tage) : ZAHLUNGSZIEL_TAGE
    const zahlungsziel = plusTage(datum, tage)
    const leistung = leistungText(input?.leistungsdatum, input?.leistungszeitraum)

    const angegeben = String(input?.anschrift ?? '').trim()
    const anschrift = anschriftFuer(angegeben, akte)
    if (anschrift.length === 0 || !hatPlzOrt(anschrift)) {
      return `Nicht erstellt: In der Akte ${akteName(akte)} steht keine vollständige Anschrift (Straße und PLZ Ort) — auf einer Rechnung ist sie Pflicht. Frag den Mitarbeiter danach und ruf rechnung_erstellen mit anschrift erneut auf.`
    }
    const empfaenger = empfaengerZeilen(akte, anschrift)

    const angelegt = await legeRechnungAn(supabase, akte, (nummer) => ({
      id: neueId('r'),
      nummer,
      kunde_id: akte.id,
      datum,
      betrag_netto: summen.netto,
      betrag_brutto: summen.brutto,
      status: 'Entwurf',
      zahlungsziel,
      ohne_zahlungsfrist: ohneFrist,
      mahnstufe: null,
      leistung_bezeichnung: positionen[0].bezeichnung,
      leistung_einheit: null,
      leistung_menge: null,
      positionen,
      ust_satz: ust,
      leistungszeitraum: leistung || null,
      anschrift: anschrift.join('\n'),
      hinweis: hinweis || null,
      notiz: `Über den Assistenten erstellt von ${mitarbeiter.name}`,
      zahlungen: null,
      mahnungen: null,
      versendet_am: null,
      versendet_an: null,
      bezahlt_am: null,
      dokument: null,
      kv_id: null,
    }))
    if (typeof angelegt === 'string') return angelegt

    // PDF auf dem Briefbogen und Ablage in der Akte; scheitert das, wird die Rechnung wieder entfernt (keine Lücke im Nummernkreis).
    const rueckgaengig = async (grund: string) => {
      await supabase.from('rechnungen').delete().eq('id', angelegt.id)
      return `Nicht erstellt: ${grund} Die Rechnung wurde nicht angelegt.`
    }
    let pdf: Uint8Array
    try {
      pdf = (await erzeugeHoldingRechnungPdf({
        nummer: angelegt.nummer,
        datum,
        zahlungsziel,
        ohneFrist,
        leistungszeitraum: leistung,
        empfaenger,
        positionen,
        ustSatz: ust,
        anschreiben: String(input?.anschreiben ?? '').trim().slice(0, 1500) || undefined,
        hinweis: hinweis || undefined,
        absender: mitarbeiter.name,
      })).bytes
    } catch (err) {
      return await rueckgaengig(`Das PDF ließ sich nicht erzeugen (${err instanceof Error ? err.message : String(err)}).`)
    }
    const ziel = await ladeZiel(dokKontext(k), { kunde_id: akte.id }, 'Sonstiges')
    if (typeof ziel === 'string') return await rueckgaengig(ziel)
    const dateiName = rechnungDateiname(angelegt.nummer, datum)
    const abgelegt = await legeAb(dokKontext(k), ziel, heute, {
      bytes: pdf,
      dateiName,
      typ: 'application/pdf',
      aktivitaet: (anzeige, groesse) => `Rechnung ${angelegt.nummer} über ${euro(summen.brutto)} erstellt (Entwurf, noch nicht versendet): „${anzeige}“ (${groesse})`,
    })
    if (typeof abgelegt === 'string') return await rueckgaengig(abgelegt)
    await supabase.from('rechnungen').update({ dokument: { kundeId: akte.id, dokumentId: abgelegt.id, name: abgelegt.name } }).eq('id', angelegt.id)
    // Anschrift in der Akte nachtragen, wenn sie dort fehlte (wie „Anschrift auch in der Akte speichern“ im CRM).
    if (angegeben && !String(akte.anschrift ?? '').trim()) await supabase.from('kunden').update({ anschrift: anschriftZeilen(angegeben).join('\n') }).eq('id', akte.id)

    protokolliere(`Rechnung ${angelegt.nummer} für ${akteName(akte)} erstellt: netto ${euro(summen.netto)}, brutto ${euro(summen.brutto)} (Entwurf)`)
    const email = String(akte.email ?? '').trim()
    const folge = await folgeFuer(k, akte, angelegt.id)
    return [
      `Rechnung ${angelegt.nummer} erstellt für ${akteName(akte)} (Status Entwurf — noch NICHT an den Kunden gesendet).`,
      `${positionen.length === 1 ? `Position: ${positionen[0].bezeichnung}` : `${positionen.length} Positionen`}; netto ${euro(summen.netto)} + ${ust} % USt ${euro(summen.ust)} = brutto ${euro(summen.brutto)}. Rechnungsdatum ${deDatum(datum)}, ${ohneFrist ? `ohne Zahlungsfrist (intern Geldeingang prüfen am ${deDatum(zahlungsziel)})` : `zahlbar bis ${deDatum(zahlungsziel)}`}${leistung ? `, Leistung: ${leistung}` : ''}.`,
      `Empfänger auf der Rechnung: ${empfaenger.join(', ')}.`,
      `PDF auf dem Briefbogen der Holding in der Akte unter Dokumente: „${abgelegt.name}“. Die Rechnung steht in der Rechnungsübersicht des CRM (rechnung_id ${angelegt.id}).`,
      angelegt.neuesKuerzel ? `Neues festes Rechnungskürzel für diesen Kunden: ${angelegt.kuerzel} (alle weiteren Rechnungen: ${angelegt.kuerzel}-002, …).` : '',
      email ? `Versand: per E-Mail an ${email} möglich (rechnung_versenden, danach Bestätigung durch den Mitarbeiter).` : 'Versand: In der Akte steht keine E-Mail-Adresse — frag danach, wenn die Rechnung per E-Mail gehen soll.',
      '',
      'Nächste Schritte im Follow-up, wenn sie heute rausgeht:',
      folge,
      '',
      'Sag dem Mitarbeiter kurz Nummer, Beträge und wo das PDF liegt, nenne die Follow-up-Schritte mit Datum und biete an, die Rechnung jetzt per E-Mail an den Kunden zu schicken (und sie ihm mit datei_senden hier zu zeigen).',
    ]
      .filter((z, i, a) => z !== '' || (i > 0 && a[i - 1] !== ''))
      .join('\n')
  }

  if (name === 'rechnung_versenden') {
    const id = String(input?.rechnung_id ?? '').trim()
    const nummerRoh = String(input?.nummer ?? '').trim()
    if (!id && !nummerRoh) return 'Fehler: rechnung_id oder nummer fehlt.'
    let r: Record<string, unknown> | null = null
    if (id) r = (await supabase.from('rechnungen').select('*').eq('id', id).maybeSingle()).data
    else {
      for (const n of [...new Set([nummerRoh, nummerRoh.toUpperCase()])]) {
        const { data } = await supabase.from('rechnungen').select('*').eq('nummer', n).limit(1)
        if (data?.length) {
          r = data[0]
          break
        }
      }
    }
    if (!r) return `Es gibt keine Rechnung ${nummerRoh || id}. Die Rechnungen einer Akte stehen in kundenakte_lesen.`
    const akte = await ladeAkte(k, String(r.kunde_id ?? ''), false)
    if (typeof akte === 'string') return akte === KEIN_KUNDE ? `Es gibt keine Rechnung ${nummerRoh || id}.` : akte
    const fehlerAkte = pruefeRechnungsAkte(akte)
    if (fehlerAkte) return fehlerAkte
    const nummer = String(r.nummer)
    if (r.status === 'Bezahlt') return `Rechnung ${nummer} ist schon bezahlt — kein Versand nötig.`

    const an = String(input?.an ?? '').trim().toLowerCase() || String(akte.email ?? '').trim().toLowerCase()
    if (!an) return `Nicht vorbereitet: In der Akte ${akteName(akte)} steht keine E-Mail-Adresse. Frag den Mitarbeiter nach der Adresse und ruf rechnung_versenden mit an erneut auf.`
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(an)) return `Fehler: „${an}“ ist keine gültige E-Mail-Adresse.`

    // PDF: das abgelegte der Rechnung; fehlt es (z. B. im CRM ohne PDF angelegt), jetzt auf dem Briefbogen erzeugen und ablegen.
    const dokVerweis = r.dokument as { dokumentId?: string; name?: string } | null
    const vorhanden = (akte.dokumente ?? []).find((d) => d.id === dokVerweis?.dokumentId && d.url && !/^https?:/.test(d.url))
    let anhang: RechnungAnhang
    if (vorhanden) anhang = { eimer: EIMER, pfad: String(vorhanden.url), dateiname: vorhanden.name, typ: 'application/pdf' }
    else {
      const pos = Array.isArray(r.positionen) && r.positionen.length
        ? (r.positionen as { bezeichnung: string; menge: number; einheit: string; einzelpreis: number }[])
        : [{ bezeichnung: String(r.leistung_bezeichnung ?? '') || 'Leistung laut Vereinbarung', menge: 1, einheit: 'Pauschal', einzelpreis: Number(r.betrag_netto) }]
      const ust = r.ust_satz != null ? Number(r.ust_satz) : Math.abs(rundeCent(Number(r.betrag_netto) * 1.19) - Number(r.betrag_brutto)) < 0.011 ? 19 : 0
      if (Math.abs(summeAusPositionen(pos, ust).brutto - Number(r.betrag_brutto)) > 0.011) return `Nicht vorbereitet: Rechnung ${nummer} hat kein PDF in der Akte, und ihre Beträge lassen sich nicht sicher nachbilden. Bitte im CRM über „Senden“ verschicken.`
      const anschrift = anschriftFuer(String(r.anschrift ?? ''), akte)
      const bytes = (await erzeugeHoldingRechnungPdf({ nummer, datum: String(r.datum), zahlungsziel: String(r.zahlungsziel), ohneFrist: r.ohne_zahlungsfrist === true, leistungszeitraum: String(r.leistungszeitraum ?? ''), empfaenger: empfaengerZeilen(akte, anschrift), positionen: pos, ustSatz: ust, hinweis: String(r.hinweis ?? '') || undefined, absender: mitarbeiter.name })).bytes
      const ziel = await ladeZiel(dokKontext(k), { kunde_id: akte.id }, 'Sonstiges')
      if (typeof ziel === 'string') return ziel
      const abgelegt = await legeAb(dokKontext(k), ziel, heute, { bytes, dateiName: rechnungDateiname(nummer, String(r.datum)), typ: 'application/pdf', aktivitaet: (a, g) => `PDF zu Rechnung ${nummer} erstellt: „${a}“ (${g})` })
      if (typeof abgelegt === 'string') return abgelegt
      await supabase.from('rechnungen').update({ dokument: { kundeId: akte.id, dokumentId: abgelegt.id, name: abgelegt.name } }).eq('id', r.id)
      const { data: frisch } = await supabase.from('kunden').select('dokumente').eq('id', akte.id).maybeSingle()
      const neu = ((frisch?.dokumente ?? []) as { id: string; url?: string }[]).find((d) => d.id === abgelegt.id)
      anhang = { eimer: EIMER, pfad: String(neu?.url ?? ''), dateiname: abgelegt.name, typ: 'application/pdf' }
    }

    let eHinweis = ''
    if (await eRechnungAktiv(supabase)) {
      const fehler = await xRechnungFuer(supabase, r, akte).then((x) => (typeof x === 'string' ? x : '')).catch((e) => String(e))
      eHinweis = fehler ? `E-Rechnung (XRechnung) kann NICHT beigelegt werden: ${fehler}` : `Zweiter Anhang: E-Rechnung ${xRechnungDateiname(nummer)} (XRechnung, wie beim Versand im CRM).`
    }

    const offen = rundeCent(Number(r.betrag_brutto) - ((r.zahlungen as { betrag?: number }[] | null) ?? []).reduce((s, z) => s + (Number(z?.betrag) || 0), 0))
    const eigenerText = String(input?.text ?? '').trim()
    const text = `{{anrede}},\n\n${eigenerText || `anbei erhalten Sie unsere Rechnung Nr. ${nummer} vom ${deDatum(String(r.datum))} über ${euro(Number(r.betrag_brutto))}.\nBitte überweisen Sie den Betrag von ${euro(offen)}${r.ohne_zahlungsfrist === true ? '' : ` bis zum ${deDatum(String(r.zahlungsziel))}`} auf das in der Rechnung genannte Konto.\n\nBei Fragen zur Rechnung sind wir gerne für Sie da.`}`
    const empfaenger: RechnungMailEmpfaenger = { kunde_id: akte.id, bereich: String(akte.bereich ?? ''), name: String(akte.ansprechpartner ?? '').trim(), firma: String(akte.firma ?? '').trim(), email: an, status: String(akte.status ?? '') }
    const entwurf: RechnungMailEntwurf = { id: crypto.randomUUID().slice(0, 8), betreff: `Rechnung ${nummer}`, text, empfaenger: [empfaenger], z: new Date().toISOString(), anhaenge: [anhang], rechnung: { id: String(r.id), nummer, kunde_id: akte.id } }
    if (!k.merkeMailEntwurf) return 'Fehler: Der Mailversand ist hier nicht eingerichtet.'
    k.merkeMailEntwurf(entwurf)
    protokolliere(`Versand der Rechnung ${nummer} an ${an} vorbereitet (noch nicht gesendet)`)
    const schonGesendet = r.versendet_am ? `Achtung: Die Rechnung wurde schon am ${deDatum(String(r.versendet_am))}${r.versendet_an ? ` an ${r.versendet_an}` : ''} versendet — das wäre ein zweiter Versand.` : ''
    return [
      'NOCH NICHT GESENDET. Zeige dem Mitarbeiter jetzt Empfänger, Betreff, Anhang und den Text unten vollständig und frag, ob du so senden sollst. Erst wenn er in seiner nächsten Nachricht klar zustimmt, rufst du mail_senden auf.',
      schonGesendet,
      `Empfänger: ${empfaenger.name || empfaenger.firma} <${an}>`,
      `Betreff: ${entwurf.betreff}`,
      `Anhang: ${anhang.dateiname}`,
      eHinweis,
      'Absender ist das Postfach der Holding; der Versand steht danach in der Akte. Nach dem Versand steht die Rechnung auf Versendet (offen), und das CRM legt die Wiedervorlage zum Zahlungsziel an.',
      '-----',
      k.mailText ? k.mailText(text, empfaenger) : text.replace('{{anrede}}', empfaenger.name ? `Guten Tag ${empfaenger.name}` : 'Sehr geehrte Damen und Herren'),
      '-----',
    ]
      .filter(Boolean)
      .join('\n')
  }

  if (name === 'rechnung_aendern') {
    const r = await ladeRechnung(supabase, String(input?.rechnung_id ?? '').trim(), String(input?.nummer ?? '').trim())
    if (!r) return `Es gibt keine Rechnung ${String(input?.nummer ?? input?.rechnung_id ?? '')}. Die Rechnungen einer Akte stehen in kundenakte_lesen.`
    const akte = await ladeAkte(k, String(r.kunde_id ?? ''), false)
    if (typeof akte === 'string') return akte
    const fehlerAkte = pruefeRechnungsAkte(akte)
    if (fehlerAkte) return fehlerAkte
    const nummer = String(r.nummer)
    if (r.status !== 'Entwurf' || r.versendet_am) {
      return `Nicht geändert: Rechnung ${nummer} ist schon ${r.versendet_am ? `am ${deDatum(String(r.versendet_am))} versendet` : `im Status ${r.status}`}. Eine verschickte Rechnung darf nicht mehr verändert werden — dafür im CRM eine Gutschrift/Stornorechnung erstellen.`
    }

    const altePos = Array.isArray(r.positionen) && r.positionen.length
      ? (r.positionen as { bezeichnung: string; menge: number; einheit: string; einzelpreis: number }[])
      : [{ bezeichnung: String(r.leistung_bezeichnung ?? '') || 'Leistung laut Vereinbarung', menge: 1, einheit: 'Pauschal', einzelpreis: Number(r.betrag_netto) }]
    let positionen = altePos
    if (input?.positionen !== undefined) {
      const neu = lesePositionen(input.positionen)
      if (typeof neu === 'string') return neu
      positionen = neu
    }
    const ustRoh = input?.ust_satz === undefined || input?.ust_satz === null || input?.ust_satz === '' ? (r.ust_satz != null ? Number(r.ust_satz) : UST_VORGABE) : Number(input.ust_satz)
    if (!Number.isFinite(ustRoh) || ustRoh < 0 || ustRoh > 30) return 'Fehler: ust_satz muss zwischen 0 und 30 Prozent liegen.'
    const ust = rundeCent(ustRoh)
    const hinweis = input?.hinweis !== undefined ? String(input.hinweis ?? '').trim().slice(0, 600) : String(r.hinweis ?? '').trim()
    if (ust === 0 && !hinweis) return 'Fehler: Bei 0 % Umsatzsteuer muss der Grund auf die Rechnung (hinweis).'
    const summen = summeAusPositionen(positionen, ust)
    if (summen.brutto <= 0) return 'Fehler: Der Rechnungsbetrag muss größer als 0 € sein.'

    const datum = istIsoDatum(input?.rechnungsdatum) ? String(input.rechnungsdatum) : String(r.datum)
    const ohneFrist = typeof input?.ohne_zahlungsfrist === 'boolean' ? input.ohne_zahlungsfrist : r.ohne_zahlungsfrist === true
    const alteTage = Math.round((Date.parse(String(r.zahlungsziel)) - Date.parse(String(r.datum))) / 86400000)
    const tageEingabe = Number(input?.zahlungsziel_tage)
    const tage = ohneFrist
      ? OHNE_FRIST_PRUEFTAGE
      : Number.isInteger(tageEingabe) && tageEingabe >= 0 && tageEingabe <= 90
        ? tageEingabe
        : r.ohne_zahlungsfrist === true || !Number.isFinite(alteTage) || alteTage < 0 ? ZAHLUNGSZIEL_TAGE : alteTage
    const zahlungsziel = plusTage(datum, tage)
    const leistung = input?.leistungsdatum !== undefined || input?.leistungszeitraum !== undefined ? leistungText(input?.leistungsdatum, input?.leistungszeitraum) : String(r.leistungszeitraum ?? '')
    const anschrift = anschriftFuer(String(r.anschrift ?? ''), akte)

    let pdf: Uint8Array
    try {
      pdf = (await erzeugeHoldingRechnungPdf({
        nummer,
        datum,
        zahlungsziel,
        ohneFrist,
        leistungszeitraum: leistung,
        empfaenger: empfaengerZeilen(akte, anschrift),
        positionen,
        ustSatz: ust,
        anschreiben: String(input?.anschreiben ?? '').trim().slice(0, 1500) || undefined,
        hinweis: hinweis || undefined,
        absender: mitarbeiter.name,
      })).bytes
    } catch (err) {
      return `Nicht geändert: Das PDF ließ sich nicht erzeugen (${err instanceof Error ? err.message : String(err)}).`
    }

    // PDF ersetzen: gleiche Datei in der Akte überschreiben; fehlt sie, neu ablegen.
    const dokVerweis = r.dokument as { dokumentId?: string } | null
    const { data: frisch } = await supabase.from('kunden').select('dokumente').eq('id', akte.id).maybeSingle()
    const doks = ((frisch?.dokumente ?? []) as { id: string; url?: string; groesse?: string; datum?: string }[])
    const vorhanden = doks.find((d) => d.id === dokVerweis?.dokumentId && d.url && !/^https?:/.test(d.url))
    let dokument: { kundeId: string; dokumentId: string; name: string } | null = null
    if (vorhanden) {
      const { error: upFehler } = await supabase.storage.from(EIMER).upload(String(vorhanden.url), pdf, { upsert: true, contentType: 'application/pdf' })
      if (upFehler) return `Nicht geändert: Das neue PDF ließ sich nicht speichern (${upFehler.message}).`
      const groesse = `${Math.max(1, Math.round(pdf.length / 1024))} KB`
      const { data: nochmal } = await supabase.from('kunden').select('dokumente').eq('id', akte.id).maybeSingle()
      const liste = ((nochmal?.dokumente ?? []) as Record<string, unknown>[]).map((d) => (d.id === vorhanden.id ? { ...d, groesse, datum: heute } : d))
      await supabase.from('kunden').update({ dokumente: liste }).eq('id', akte.id)
      dokument = { kundeId: akte.id, dokumentId: vorhanden.id, name: String((liste.find((d) => d.id === vorhanden.id) as { name?: string } | undefined)?.name ?? rechnungDateiname(nummer, datum)) }
    } else {
      const ziel = await ladeZiel(dokKontext(k), { kunde_id: akte.id }, 'Sonstiges')
      if (typeof ziel === 'string') return ziel
      const abgelegt = await legeAb(dokKontext(k), ziel, heute, { bytes: pdf, dateiName: rechnungDateiname(nummer, datum), typ: 'application/pdf', aktivitaet: (a, g) => `PDF zu Rechnung ${nummer} erstellt: „${a}“ (${g})` })
      if (typeof abgelegt === 'string') return abgelegt
      dokument = { kundeId: akte.id, dokumentId: abgelegt.id, name: abgelegt.name }
    }

    const { error: uFehler } = await supabase
      .from('rechnungen')
      .update({
        datum,
        zahlungsziel,
        ohne_zahlungsfrist: ohneFrist,
        betrag_netto: summen.netto,
        betrag_brutto: summen.brutto,
        positionen,
        leistung_bezeichnung: positionen[0].bezeichnung,
        ust_satz: ust,
        leistungszeitraum: leistung || null,
        hinweis: hinweis || null,
        dokument,
      })
      .eq('id', r.id)
      .eq('status', 'Entwurf')
    if (uFehler) return `Fehler beim Speichern der Änderung: ${uFehler.message}`
    protokolliere(`Rechnung ${nummer} geändert (Entwurf): ${ohneFrist ? 'ohne Zahlungsfrist' : `zahlbar bis ${deDatum(zahlungsziel)}`}, brutto ${euro(summen.brutto)}`)
    const folge = await folgeFuer(k, akte, String(r.id))
    return [
      `Rechnung ${nummer} geändert (weiter Entwurf, Nummer unverändert, noch NICHT versendet).`,
      `Jetzt: netto ${euro(summen.netto)} + ${ust} % USt = brutto ${euro(summen.brutto)}; Rechnungsdatum ${deDatum(datum)}; ${ohneFrist ? `ohne Zahlungsfrist — auf Rechnung und Mail steht kein „zahlbar bis“ (intern Geldeingang prüfen am ${deDatum(zahlungsziel)})` : `zahlbar bis ${deDatum(zahlungsziel)}`}.`,
      `Das PDF in der Akte („${dokument?.name ?? ''}“) ist durch die neue Fassung ersetzt.`,
      '',
      'Nächste Schritte im Follow-up, wenn sie heute rausgeht:',
      folge,
      '',
      'Sag dem Mitarbeiter kurz, was geändert ist, schick ihm die neue Fassung mit datei_senden und biete den Versand an (rechnung_versenden).',
    ].join('\n')
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}

/** Rechnung per id oder Nummer (genau, sonst in Großbuchstaben). */
async function ladeRechnung(supabase: Supa, id: string, nummerRoh: string): Promise<Record<string, unknown> | null> {
  if (id) return (await supabase.from('rechnungen').select('*').eq('id', id).maybeSingle()).data ?? null
  for (const n of [...new Set([nummerRoh, nummerRoh.toUpperCase()])].filter(Boolean)) {
    const { data } = await supabase.from('rechnungen').select('*').eq('nummer', n).limit(1)
    if (data?.length) return data[0]
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Versand (aufgerufen aus fuehreMailSchrittAus in index.ts)

async function xRechnungFuer(supabase: Supa, r: Record<string, unknown>, akte: Akte): Promise<{ xml: string; dateiname: string } | string> {
  const pos = Array.isArray(r.positionen) && r.positionen.length ? (r.positionen as { bezeichnung: string; menge: number; einheit: string; einzelpreis: number }[]) : null
  if (!pos) return 'Die Rechnung hat keine Positionen.'
  const ust = r.ust_satz != null ? Number(r.ust_satz) : UST_VORGABE
  const eingabe = xRechnungEingabe(
    { nummer: String(r.nummer), datum: String(r.datum), zahlungsziel: r.ohne_zahlungsfrist === true ? '' : String(r.zahlungsziel ?? ''), leistungszeitraum: String(r.leistungszeitraum ?? ''), positionen: pos, ust_satz: ust, hinweis: String(r.hinweis ?? '') },
    akte,
    empfaengerZeilen(akte, anschriftFuer(String(r.anschrift ?? ''), akte)),
  )
  const fehler = pruefeXRechnung(eingabe)
  if (fehler.length) return fehler.join(' ')
  void supabase
  return { xml: erzeugeXRechnung(eingabe), dateiname: xRechnungDateiname(String(r.nummer)) }
}

function bytesZuBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export type MailAnhangFertig = { filename: string; contentType: string; contentBase64: string }

/**
 * Anhänge eines vorbereiteten Versands laden. Ohne Anhänge: [] (normale Mails, keine Abfrage). Fehlt eine Datei, kommt
 * ein Fehlertext zurück — dann wird NICHT gesendet (eine Rechnungsmail ohne Rechnung wäre falsch).
 */
export async function versandAnhaenge(supabase: Supa, auftrag: { anhaenge?: RechnungAnhang[]; rechnung?: RechnungBezug }): Promise<MailAnhangFertig[] | string> {
  if (!auftrag.anhaenge?.length) return []
  const aus: MailAnhangFertig[] = []
  for (const a of auftrag.anhaenge) {
    const { data, error } = await supabase.storage.from(a.eimer).download(a.pfad)
    if (error || !data) return `Anhang „${a.dateiname}“ ließ sich nicht laden (${error?.message ?? 'leer'}).`
    aus.push({ filename: a.dateiname, contentType: a.typ, contentBase64: bytesZuBase64(new Uint8Array(await data.arrayBuffer())) })
  }
  if (auftrag.rechnung) {
    try {
      if (await eRechnungAktiv(supabase)) {
        const { data: r } = await supabase.from('rechnungen').select('*').eq('id', auftrag.rechnung.id).maybeSingle()
        const { data: akte } = await supabase.from('kunden').select(AKTE_SPALTEN).eq('id', auftrag.rechnung.kunde_id).maybeSingle()
        if (r && akte) {
          const x = await xRechnungFuer(supabase, r, akte as Akte)
          if (typeof x !== 'string') aus.push({ filename: x.dateiname, contentType: 'application/xml', contentBase64: bytesZuBase64(new TextEncoder().encode(x.xml)) })
        }
      }
    } catch (err) {
      console.error('XRechnung für den Versand fehlgeschlagen:', err)
    }
  }
  return aus
}

/** Nach dem tatsächlichen Versand: Status wie der Dialog „Rechnung senden“ im CRM und Vermerk in der Akte. Wirft nie. */
export async function rechnungNachVersand(supabase: Supa, r: RechnungBezug, an: string, von: string, heute: string): Promise<void> {
  try {
    const { data: z } = await supabase.from('rechnungen').select('id, status, betrag_brutto').eq('id', r.id).maybeSingle()
    if (!z) return
    await supabase.from('rechnungen').update({ status: z.status === 'Entwurf' ? 'Versendet' : z.status, versendet_am: heute, versendet_an: an }).eq('id', r.id)
    const { data: k } = await supabase.from('kunden').select('activities').eq('id', r.kunde_id).maybeSingle()
    if (k) {
      const eintrag = { id: crypto.randomUUID(), date: heute, text: `Rechnung ${r.nummer} über ${euro(Number(z.betrag_brutto))} per E-Mail an ${an} gesendet`, user: von }
      await supabase.from('kunden').update({ activities: [eintrag, ...((k.activities ?? []) as unknown[])], letzte_aktivitaet: heute }).eq('id', r.kunde_id)
    }
  } catch (err) {
    console.error(`Status nach Versand der Rechnung ${r.nummer} nicht gesetzt:`, err)
  }
}

/** Zeilen für die Abschlussnachricht nach dem Versand: Status und die nächsten Follow-up-Schritte. Wirft nie. */
export async function folgeNachVersand(supabase: Supa, r: RechnungBezug, heute: string): Promise<string> {
  try {
    const { data: akte } = await supabase.from('kunden').select('id, bereich, follow_up, unterlagen_anforderungen').eq('id', r.kunde_id).maybeSingle()
    if (!akte) return ''
    const daten = await ladeFolgeDaten(supabase, akte, heute, true)
    return `Rechnung ${r.nummer} steht jetzt auf Versendet (offen).\nNächste Schritte im Follow-up:\n${folgeText(berechneFolgeSchritte(daten), heute)}`
  } catch (err) {
    console.error('Follow-up nach Versand nicht berechnet:', err)
    return ''
  }
}
