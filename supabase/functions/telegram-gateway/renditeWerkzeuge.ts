// Assistent-Werkzeuge zum Rendite- und Kaufpreis-Check eines Objekts (22.11.2026). Anlass: Die Geschäftsführung
// hatte zum „Boarding House Remstal“ die Einschätzung einer fremden KI eingefügt (2.100 €/m² gegenüber
// 2.800–3.000 €/m² vor Ort, Pacht 12,50–15,50 €/m² → 7–9 % brutto) und will diese Prüfung im CRM und per Telegram.
//
//  - rendite_rechnen: rechnet mit dem Kern _shared/renditeKern.ts (dieselben Zahlen wie der Reiter „Rendite“ der
//    Objektakte). Eingaben: gespeicherte Eingaben des Objekts, sonst Vorschlag aus der Akte (vorschlagAusObjekt),
//    darüber die Angaben aus dem Gespräch. Speichert Eingaben und Ergebnis in objekte.rendite (nur diese Spalte,
//    frisch gelesen und zusammengeführt — Marktvergleich und Prüfsteine bleiben). Auf Wunsch startet es den
//    „Vergleich vor Ort“ (email-gateway rendite_marktvergleich, im Hintergrund über ctx.starteMarktvergleich) und
//    legt eine Zusammenfassung als PDF in die Objektakte (Ordner „Kostenaufstellung“, über dokument_erstellen).
//  - rendite_pruefstein: hakt einen Prüfstein ab (Genehmigung, Brandschutz, Möblierung, Miet-/Pachtvertrag,
//    Instandhaltungsstau) oder setzt ihn zurück, mit Notiz.
//
// Der Assistent arbeitet mit vollen Datenbankrechten; die Zeilenregeln bildet objektAblage.ts (rechte.ts) nach:
// Objekte der Holding nur mit Rechten für Immobilien, private Objekte nur ihr Besitzer.

import {
  berechneRendite,
  type Bundesland,
  GRUNDERWERBSTEUER,
  leseRenditeStand,
  leseZahl,
  mischeRenditeStand,
  type MieteArt,
  PRUEFSTEINE,
  type RenditeEingaben,
  type RenditeStand,
  renditeBericht,
  renditeKurzfassung,
  vorschlagAusObjekt,
} from '../_shared/renditeKern.ts'
import { fuehreDokumentWerkzeugAus } from './dokumentErstellen.ts'
import { ladeObjektMitRechten, objektAnzeige } from './objektAblage.ts'
import type { RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type RenditeKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; id?: string | null; email?: string | null }
  protokolliere: (text: string) => void
  heute: string
  /** Startet „Vergleich vor Ort prüfen“ im Hintergrund (email-gateway, Aktion rendite_marktvergleich mit
   *  imHintergrund und imAuftragVon). null = gestartet, sonst der Fehlertext. Fehlt er, gibt es keinen Marktvergleich. */
  starteMarktvergleich?: (objektId: string) => Promise<string | null>
}

/** Marktdaten gelten so lange als aktuell, danach weist die Antwort auf das Alter hin. */
const MARKT_AKTUELL_TAGE = 30

const SPALTEN = 'id, bezeichnung, adresse, kaufpreis, verkaufsdaten, kurzpruefung, bewertung, activities, rendite, privat_besitzer'

const ZAHL = { type: ['number', 'string'] }

export const RENDITE_WERKZEUGE = [
  {
    name: 'rendite_rechnen',
    description:
      'Rendite- und Kaufpreis-Check eines Objekts (Anlageimmobilie): Kaufnebenkosten (Grunderwerbsteuer nach Bundesland, Notar/Grundbuch, Makler), Kaufpreis je m², Kaufpreisfaktor, Brutto- und Nettomietrendite, Cashflow vor Steuern, Eigenkapitalrendite, Break-even-Miete, dazu Miete ±10 % und Zins ±1 Punkt. ' +
      'Verwenden bei „Rechne mir die Rendite für …“, „Lohnt sich das Objekt?“, „Was bleibt bei 13 € Pacht übrig?“, „Ist der Preis je m² günstig?“. objekt_id mit objekte_suchen ermitteln. ' +
      'Ohne Angaben rechnet es mit den gespeicherten Eingaben des Objekts bzw. dem, was in der Akte steht (Kaufpreis, Fläche, Einheiten, Provision aus dem Verlauf); nenne nur, was der Mitarbeiter sagt oder ändert. Eine Marktmiete aus einer Einschätzung ist keine echte Miete — als Miete nur, was der Mitarbeiter als Annahme rechnen will. ' +
      'Speichert Eingaben und Ergebnis in der Objektakte (Reiter „Rendite“), außer probe=true. markt_vergleich=true startet eine Webrecherche zu Preis je m² und Miete/Pacht vor Ort (dauert ein bis zwei Minuten, Ergebnis danach in der Akte; dann noch einmal rendite_rechnen). als_pdf=true legt die Zusammenfassung als PDF in den Ordner „Kostenaufstellung“. ' +
      'Antworte danach knapp mit den wichtigsten Zahlen und nenne die Annahmen.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string', description: 'Das Objekt (ID aus objekte_suchen).' },
        kaufpreis: { ...ZAHL, description: 'Kaufpreis in Euro, z. B. 1200000 oder "1,2 Mio".' },
        flaeche: { ...ZAHL, description: 'Wohn-/Nutzfläche in m².' },
        einheiten: { type: 'number', description: 'Anzahl Einheiten (Wohnungen, Appartements).' },
        miete: { ...ZAHL, description: 'Miete bzw. Pacht netto kalt, Einheit in miete_art.' },
        miete_art: { type: 'string', enum: ['qm_monat', 'monat', 'jahr'], description: 'qm_monat = € je m² im Monat (Vorgabe), monat = € im Monat gesamt, jahr = € im Jahr gesamt.' },
        pacht: { type: 'boolean', description: 'true = es ist eine Pacht (z. B. Boarding House an einen Betreiber).' },
        bundesland: { type: 'string', enum: Object.keys(GRUNDERWERBSTEUER), description: 'Für die Grunderwerbsteuer (BW 5 %, BY 3,5 % …). Ohne Angabe aus der Postleitzahl, sonst Baden-Württemberg.' },
        grunderwerbsteuer_prozent: { ...ZAHL, description: 'Nur wenn abweichend vom Satz des Bundeslands.' },
        notar_prozent: { ...ZAHL, description: 'Notar und Grundbuch in % (Vorgabe 2).' },
        makler_prozent: { ...ZAHL, description: 'Käuferprovision in %, z. B. 3,57.' },
        zusatzkosten: { ...ZAHL, description: 'Einmalige Kosten zum Kauf in Euro (Möblierung, Renovierung).' },
        leerstand_prozent: { ...ZAHL, description: 'Mietausfall/Leerstand in % (Vorgabe 2).' },
        kosten_prozent: { ...ZAHL, description: 'Nicht umlagefähige Kosten (Verwaltung, Nebenkosten) in % der Miete (Vorgabe 3).' },
        instandhaltung_je_qm: { ...ZAHL, description: 'Instandhaltung in € je m² und Jahr (Vorgabe 10).' },
        feste_kosten_jahr: { ...ZAHL, description: 'Weitere feste Kosten des Eigentümers im Jahr in Euro (Versicherung, Erbbauzins).' },
        eigenkapital: { ...ZAHL, description: 'Eigenkapital in Euro. Mit Eigenkapital, Zins oder Tilgung wird mit Darlehen gerechnet.' },
        zins_prozent: { ...ZAHL, description: 'Sollzins in % (Vorgabe bei Finanzierung 3,8).' },
        tilgung_prozent: { ...ZAHL, description: 'Anfängliche Tilgung in % (Vorgabe bei Finanzierung 2).' },
        ohne_finanzierung: { type: 'boolean', description: 'true = gespeicherte Finanzierung entfernen und ganz aus eigenem Geld rechnen.' },
        markt_vergleich: { type: 'boolean', description: 'true = Webrecherche „Vergleich vor Ort“ starten (Preis je m², Miete/Pacht, mit Quellen).' },
        als_pdf: { type: 'boolean', description: 'true = Zusammenfassung als PDF in die Objektakte (Ordner „Kostenaufstellung“).' },
        probe: { type: 'boolean', description: 'true = nur durchrechnen („was wäre, wenn“), nichts speichern.' },
      },
      required: ['objekt_id'],
    },
  },
  {
    name: 'rendite_pruefstein',
    description:
      `Hakt einen Prüfstein des Rendite-Checks einer Objektakte ab oder setzt ihn zurück, mit kurzer Notiz („Brandschutz ist geklärt, Abnahme 2024“). Prüfsteine: ${PRUEFSTEINE.map((p) => `${p.id} (${p.titel})`).join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string', description: 'Das Objekt (ID aus objekte_suchen).' },
        pruefstein: { type: 'string', enum: PRUEFSTEINE.map((p) => p.id) },
        erledigt: { type: 'boolean', description: 'true = geklärt, false = wieder offen.' },
        notiz: { type: 'string', description: 'Optional: was geklärt wurde oder was noch fehlt.' },
      },
      required: ['objekt_id', 'pruefstein', 'erledigt'],
    },
  },
]

const NAMEN = new Set(RENDITE_WERKZEUGE.map((w) => w.name))
export function istRenditeWerkzeug(name: string): boolean {
  return NAMEN.has(name)
}

// deno-lint-ignore no-explicit-any
export async function fuehreRenditeWerkzeugAus(name: string, input: any, k: RenditeKontext): Promise<string> {
  if (name === 'rendite_rechnen') return await renditeRechnen(input ?? {}, k)
  if (name === 'rendite_pruefstein') return await pruefsteinSetzen(input ?? {}, k)
  return `Fehler: unbekanntes Werkzeug ${name}.`
}

/** Angaben aus dem Gespräch in Kern-Eingaben übersetzen. Nur gültige, angegebene Werte. */
// deno-lint-ignore no-explicit-any
export function angabenAusEingabe(input: any): { eingaben: RenditeEingaben; fehler?: string } {
  const e: RenditeEingaben = {}
  const zahl = (feld: string, ziel: keyof RenditeEingaben, min = 0, max = Number.MAX_SAFE_INTEGER): string | undefined => {
    if (input?.[feld] === undefined || input?.[feld] === null || input?.[feld] === '') return undefined
    const n = leseZahl(input[feld])
    if (n === undefined || n < min || n > max) return `Fehler: ${feld} „${input[feld]}“ ist keine gültige Zahl.`
    ;(e as Record<string, number>)[ziel] = n
    return undefined
  }
  const pruefungen: [string, keyof RenditeEingaben, number?, number?][] = [
    ['kaufpreis', 'kaufpreis', 1],
    ['flaeche', 'flaeche', 1],
    ['einheiten', 'einheiten', 1, 100_000],
    ['miete', 'miete', 0],
    ['grunderwerbsteuer_prozent', 'grunderwerbsteuerProzent', 0, 20],
    ['notar_prozent', 'notarGrundbuchProzent', 0, 20],
    ['makler_prozent', 'maklerProzent', 0, 20],
    ['zusatzkosten', 'zusatzkosten', 0],
    ['leerstand_prozent', 'leerstandProzent', 0, 100],
    ['kosten_prozent', 'bewirtschaftungProzent', 0, 100],
    ['instandhaltung_je_qm', 'instandhaltungJeQm', 0, 1000],
    ['feste_kosten_jahr', 'sonstigeKostenJahr', 0],
    ['eigenkapital', 'eigenkapital', 0],
    ['zins_prozent', 'zinsProzent', 0, 30],
    ['tilgung_prozent', 'tilgungProzent', 0, 30],
  ]
  for (const [feld, ziel, min, max] of pruefungen) {
    const f = zahl(feld, ziel, min, max)
    if (f) return { eingaben: e, fehler: f }
  }
  if (['qm_monat', 'monat', 'jahr'].includes(input?.miete_art)) e.mieteArt = input.miete_art as MieteArt
  if (typeof input?.pacht === 'boolean') e.pacht = input.pacht
  if (typeof input?.bundesland === 'string' && input.bundesland.toUpperCase() in GRUNDERWERBSTEUER) e.bundesland = input.bundesland.toUpperCase() as Bundesland
  return { eingaben: e }
}

function tageAlt(iso: string | undefined, heute: string): number | null {
  if (!iso) return null
  const t = (new Date(`${heute}T12:00:00Z`).getTime() - new Date(`${iso.slice(0, 10)}T12:00:00Z`).getTime()) / 86_400_000
  return Number.isFinite(t) ? Math.round(t) : null
}

function deDatum(iso: string | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '–'
}

/** Frisch lesen, zusammenführen, nur die Spalte rendite schreiben. */
async function speichereStand(k: RenditeKontext, objektId: string, aenderung: Partial<RenditeStand>): Promise<string | null> {
  const { data, error } = await k.supabase.from('objekte').select('rendite').eq('id', objektId).maybeSingle()
  if (error) return error.message
  const { error: fehler } = await k.supabase.from('objekte').update({ rendite: mischeRenditeStand(data?.rendite, aenderung) }).eq('id', objektId)
  return fehler ? fehler.message : null
}

// deno-lint-ignore no-explicit-any
async function renditeRechnen(input: any, k: RenditeKontext): Promise<string> {
  const o = await ladeObjektMitRechten(k, input.objekt_id, SPALTEN)
  if (typeof o === 'string') return o
  const angaben = angabenAusEingabe(input)
  if (angaben.fehler) return angaben.fehler

  const stand = leseRenditeStand(o.rendite)
  const vorschlag = vorschlagAusObjekt(o)
  const gespeichert: RenditeEingaben = { ...(stand.eingaben ?? {}) }
  if (input.ohne_finanzierung === true) {
    delete gespeichert.eigenkapital
    delete gespeichert.zinsProzent
    delete gespeichert.tilgungProzent
  }
  // Rangfolge: Angaben aus dem Gespräch vor gespeicherten Eingaben vor dem Vorschlag aus der Akte.
  const eingaben: RenditeEingaben = { ...vorschlag.eingaben, ...gespeichert, ...angaben.eingaben }
  const herkunft: RenditeStand['herkunft'] = { ...vorschlag.herkunft, ...(stand.herkunft ?? {}) }
  for (const feld of Object.keys(angaben.eingaben) as (keyof RenditeEingaben)[]) herkunft[feld] = `Angabe per Telegram (${k.mitarbeiter.name})`
  // Was es nicht mehr gibt, hat auch keine Herkunft mehr.
  for (const feld of Object.keys(herkunft) as (keyof RenditeEingaben)[]) if (eingaben[feld] === undefined) delete herkunft[feld]

  const ergebnis = berechneRendite(eingaben)
  const teile: string[] = [`Rendite-Check ${objektAnzeige(o)} (objekt_id=${o.id}):`]
  teile.push(renditeKurzfassung(ergebnis, stand.markt, eingaben))

  const markt = stand.markt
  if (markt?.status === 'fertig') {
    const alter = tageAlt(markt.stand, k.heute)
    teile.push(`Vergleich vor Ort vom ${deDatum(markt.stand)}${alter !== null && alter > MARKT_AKTUELL_TAGE ? ' (älter als ein Monat — mit markt_vergleich=true neu recherchieren)' : ''}${markt.quellen?.length ? `, ${markt.quellen.length} Quellen in der Akte` : ''}.`)
  } else if (markt?.status === 'laeuft') teile.push('Der Vergleich vor Ort läuft gerade noch.')

  const probe = input.probe === true
  if (!probe) {
    const fehler = await speichereStand(k, o.id, { eingaben, herkunft, ergebnis, berechnetAm: new Date().toISOString(), berechnetVon: k.mitarbeiter.name })
    if (fehler) teile.push(`Fehler beim Speichern in der Objektakte: ${fehler}. Die Zahlen oben stimmen trotzdem.`)
    else {
      k.protokolliere(`Rendite-Check für ${objektAnzeige(o)} gerechnet und gespeichert`)
      teile.push('Gespeichert in der Objektakte, Reiter „Rendite“.')
    }
  } else teile.push('Nur durchgerechnet, nichts gespeichert.')

  if (input.markt_vergleich === true) {
    if (!k.starteMarktvergleich) teile.push('Der Vergleich vor Ort lässt sich hier nicht starten — im CRM im Reiter „Rendite“ auf „Vergleich vor Ort prüfen“ klicken.')
    else {
      const fehler = await k.starteMarktvergleich(o.id)
      if (fehler) teile.push(`Fehler beim Start des Vergleichs vor Ort: ${fehler}`)
      else {
        k.protokolliere(`Vergleich vor Ort für ${objektAnzeige(o)} gestartet`)
        teile.push('Vergleich vor Ort gestartet (Webrecherche, etwa ein bis zwei Minuten). Das Ergebnis steht danach in der Objektakte; für die Zahlen dann noch einmal rendite_rechnen.')
      }
    }
  }

  if (input.als_pdf === true) {
    const bezeichnung = String(o.bezeichnung ?? '').trim() || 'Objekt'
    const pdf = await fuehreDokumentWerkzeugAus(
      'dokument_erstellen',
      { objekt_id: o.id, ordner: 'Kostenaufstellung', art: 'zusammenfassung', titel: `Rendite-Check ${bezeichnung}`, inhalt: renditeBericht(bezeichnung, eingaben, ergebnis, markt, stand.pruefsteine) },
      { supabase: k.supabase, mitarbeiter: k.mitarbeiter, protokolliere: k.protokolliere, heute: k.heute },
    )
    teile.push(pdf)
  }

  const offen = PRUEFSTEINE.filter((p) => !stand.pruefsteine?.[p.id]?.erledigt).map((p) => p.titel)
  if (offen.length) teile.push(`Offene Prüfsteine: ${offen.join(', ')}.`)
  return teile.join('\n')
}

// deno-lint-ignore no-explicit-any
async function pruefsteinSetzen(input: any, k: RenditeKontext): Promise<string> {
  const p = PRUEFSTEINE.find((x) => x.id === String(input.pruefstein ?? '').trim())
  if (!p) return `Fehler: Diesen Prüfstein gibt es nicht. Möglich: ${PRUEFSTEINE.map((x) => x.id).join(', ')}.`
  if (typeof input.erledigt !== 'boolean') return 'Fehler: erledigt (true oder false) fehlt.'
  const o = await ladeObjektMitRechten(k, input.objekt_id, 'id, bezeichnung, adresse, privat_besitzer')
  if (typeof o === 'string') return o
  const notiz = String(input.notiz ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  const fehler = await speichereStand(k, o.id, { pruefsteine: { [p.id]: { erledigt: input.erledigt, ...(notiz ? { notiz } : {}), am: k.heute, von: k.mitarbeiter.name } } })
  if (fehler) return `Fehler beim Speichern: ${fehler}`
  k.protokolliere(`Prüfstein „${p.titel}“ bei ${objektAnzeige(o)} ${input.erledigt ? 'abgehakt' : 'wieder geöffnet'}`)
  return `Prüfstein „${p.titel}“ bei ${objektAnzeige(o)} ${input.erledigt ? 'als geklärt abgehakt' : 'wieder auf offen gesetzt'}${notiz ? ` (Notiz: ${notiz})` : ''}. objekt_id=${o.id}`
}
