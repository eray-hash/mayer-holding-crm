// Umsatzvorschau und Provisionen (22.11.2026) — Anbindung des CRM an den gemeinsamen Rechenkern.
// Die Regeln selbst stehen in supabase/functions/_shared/umsatzKern.ts (dort ausführlich beschrieben);
// derselbe Kern rechnet im Assistenten (Werkzeug umsatz_vorschau), damit Telegram und die Seite
// /auswertungen/umsatz dieselben Zahlen nennen. Diese Datei wandelt nur die Daten des CRM (Akten,
// Rechnungen, Kostenvoranschläge, Objekte, Abrechnungen, Freigaben) in die Eingaben des Kerns um.
// Kein Browser, keine Datenbank — reines Umformen.
import {
  berechneUmsatzvorschau,
  bereichKennung,
  type AkteEingabe,
  type AngebotEingabe,
  type ObjektEingabe,
  type RechnungEingabe,
  type UmsatzVorschau,
} from '../../supabase/functions/_shared/umsatzKern.ts'
import type { Kunde, KundeBereich, Objekt, ObjektAbrechnung, Rechnung } from '../types'
import type { Kostenvoranschlag } from './kostenvoranschlaege'

export * from '../../supabase/functions/_shared/umsatzKern.ts'

/** Freigabe-Zeile (Tabelle objekt_freigaben), nur was für die Provision gebraucht wird. */
export type FreigabeProvision = { objektId: string; provision: string; status?: string; erstelltAm?: string }

export type UmsatzQuellen = {
  heute: string
  /** Alle Akten mit ihrem Bereich (Kundenakten-Schlüssel), auch die, die der Nutzer nicht sehen darf — gefiltert wird über `darf`. */
  akten: { kunde: Kunde; bereich: KundeBereich }[]
  rechnungen: Rechnung[]
  kvs: Kostenvoranschlag[]
  objekte: Objekt[]
  abrechnungen: ObjektAbrechnung[]
  freigaben: FreigabeProvision[]
  /** Darf der Nutzer den Bereich sehen (Kundenakten-Schlüssel oder Bereichs-Kennung)? */
  darf?: (bereich: string) => boolean
}

export function akteName(k: Pick<Kunde, 'firma' | 'ansprechpartner'>): string {
  const firma = (k.firma ?? '').trim()
  const person = (k.ansprechpartner ?? '').trim()
  if (firma && person && firma !== person) return `${firma} (${person})`
  return firma || person || 'Ohne Namen'
}

export function objektName(o: Pick<Objekt, 'bezeichnung' | 'adresse'>): string {
  const b = (o.bezeichnung ?? '').trim()
  const a = (o.adresse ?? '').trim()
  return b && a && !b.includes(a) ? `${b}, ${a}` : b || a || 'Objekt ohne Bezeichnung'
}

export function rechneUmsatzvorschau(q: UmsatzQuellen): UmsatzVorschau {
  const aktenJeId = new Map(q.akten.map((a) => [a.kunde.id, a]))

  const rechnungen: RechnungEingabe[] = q.rechnungen.map((r) => {
    const a = aktenJeId.get(r.kundeId)
    const letzteFrist = [...(r.mahnungen ?? [])].reverse().find((m) => m.neueFrist)?.neueFrist
    return {
      id: r.id,
      nummer: r.nummer,
      kundeId: r.kundeId,
      bereich: a?.bereich,
      akteName: a ? akteName(a.kunde) : undefined,
      datum: r.datum,
      netto: r.betragNetto,
      brutto: r.betragBrutto,
      status: r.status,
      zahlungsziel: r.zahlungsziel,
      mahnstufe: r.mahnstufe ?? null,
      neueFrist: letzteFrist,
      zahlungen: (r.zahlungen ?? []).map((z) => ({ datum: z.datum, betrag: Number(z.betrag) || 0 })),
      bezahltAm: r.bezahltAm,
      kvId: r.kvId,
    }
  })

  const angebote: AngebotEingabe[] = q.kvs.map((kv) => ({
    id: kv.id,
    kundeId: kv.kundeId,
    bereich: kv.bereich,
    privat: !!kv.privatBesitzer || kv.bereich === 'privat',
    name: kv.name,
    beschreibung: kv.beschreibung,
    status: kv.status,
    datum: kv.datum,
    erstelltAm: kv.erstelltAm,
    betrag: kv.betrag,
    positionen: kv.positionen,
    aufschlagProzent: kv.aufschlagProzent,
    ustSatz: kv.ustSatz,
  }))

  const akten: AkteEingabe[] = q.akten
    .filter((a) => a.bereich !== 'privat')
    .map((a) => ({
      id: a.kunde.id,
      bereich: a.bereich,
      name: akteName(a.kunde),
      status: a.kunde.status,
      chance: a.kunde.auftragChance?.prozent,
      chanceBestaetigt: a.kunde.auftragChance?.bestaetigt,
    }))

  const abrechnungJeObjekt = new Map(q.abrechnungen.map((a) => [a.objektId, a]))
  const freigabenJeObjekt = new Map<string, FreigabeProvision[]>()
  for (const f of q.freigaben) freigabenJeObjekt.set(f.objektId, [...(freigabenJeObjekt.get(f.objektId) ?? []), f])

  const objekte: ObjektEingabe[] = q.objekte.map((o) => ({
    id: o.id,
    name: objektName(o),
    status: o.status,
    privat: !!o.privatBesitzer,
    kaufpreis: o.kaufpreis,
    zielpreis: o.verkaufsdaten?.kennzahlen?.zielverkaufspreis ?? o.verkaufsdaten?.kennzahlen?.kaufpreisvorstellung ?? null,
    abrechnungProvision: abrechnungJeObjekt.get(o.id)?.provision ?? null,
    kurzpruefungProzent: o.kurzpruefung?.provisionProzent,
    kurzpruefungBetrag: o.kurzpruefung?.provisionBetrag,
    freigaben: freigabenJeObjekt.get(o.id) ?? [],
  }))

  const darf = q.darf
  return berechneUmsatzvorschau(
    { heute: q.heute, rechnungen, angebote, akten, objekte },
    { darf: darf ? (b) => darf(bereichKennung(b)) : undefined },
  )
}
