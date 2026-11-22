// Assistent-Werkzeuge für Chance und erwarteten Umsatz einer Akte (22.11.2026):
//   chance_setzen              — Chance (bestätigt), erwarteten Umsatz netto und Monat eintragen oder den
//                                gespeicherten Vorschlag übernehmen (kunden.auftrag_chance);
//   chance_vorschlaege_zeigen  — die Vorschläge (kunden.chance_vorschlag) der freigegebenen Akten zeigen,
//                                auf Wunsch vorher nach den festen Regeln neu berechnen.
// Regeln und Form: _shared/chanceKern.ts (dieselben wie im CRM und in email-gateway/chanceVorschlag.ts).
// Nur bestätigte Werte in auftrag_chance zählen in der Umsatzvorschau (umsatz_vorschau, /auswertungen/umsatz).
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten, deshalb gilt hier rechte.ts wie die
// Zeilenregel kunden: nur freigegebene Bereiche, private Kontakte und Sammelakten haben keine Chance.

import {
  ladeChanceGrundlagen, leseGespeicherteChance, leseVorschlag, regelVorschlaegeFuer, type GespeicherteChance, vorschlagKurz,
} from '../_shared/chanceKern.ts'
import { euro, leseDeutscheZahl, monatName, monatVon, plusMonate } from '../_shared/umsatzKern.ts'
import { bereichIdVon, bereichName, darfAkte, darfBereich, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

// deno-lint-ignore no-explicit-any
type Supa = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type ChanceKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const CHANCE_WERKZEUGE = [
  {
    name: 'chance_setzen',
    description:
      'Trägt für eine Kundenakte die Chance auf den Auftrag (Prozent), den erwarteten Umsatz netto und den erwarteten Monat ein — als vom Mitarbeiter bestätigt. Erst dann zählt die Akte in der Umsatzvorschau. Für „Setz die Chance bei X auf 40 %“, „Bei X erwarten wir 5.000 € im Januar“, „Übernimm den Vorschlag für X“ (dann vorschlag_uebernehmen: true; einzelne Werte dürfen zusätzlich genannt werden und gehen vor). Nicht genannte Werte bleiben, wie sie sind.',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (mit kunden_suchen oder chance_vorschlaege_zeigen ermitteln).' },
        chance: { type: 'integer', minimum: 0, maximum: 100, description: 'Chance in Prozent.' },
        umsatz: { type: 'number', description: 'Erwarteter Umsatz netto in Euro; 0 = keinen Umsatz eintragen bzw. löschen.' },
        monat: { type: 'string', description: 'Erwarteter Monat, z. B. "2027-01" oder "Januar 2027".' },
        begruendung: { type: 'string', description: 'Optional: kurzer Grund.' },
        vorschlag_uebernehmen: { type: 'boolean', description: 'true = den gespeicherten Vorschlag der Akte übernehmen.' },
      },
      required: ['kunde_id'],
    },
  },
  {
    name: 'chance_vorschlaege_zeigen',
    description:
      'Zeigt die Vorschläge für Chance, erwarteten Umsatz und Monat der Akten (vom CRM berechnet, noch nicht bestätigt), die größten zuerst, mit kunde_id zum Übernehmen über chance_setzen. Für „Welche Vorschläge gibt es?“, „Was schlägt das CRM für Akte X vor?“, „Welche Akten haben noch keine Chance?“. neu_berechnen: true rechnet vorher nach den festen Regeln neu (ohne die gründlichere Prüfung durch den Assistenten — die gibt es im CRM in der Wochenbesprechung).',
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Optional: nur diese Akte.' },
        bereich: { type: 'string', description: 'Optional: nur dieser Bereich, z. B. "beratung", "erben", "finanzierungen".' },
        alle: { type: 'boolean', description: 'true = auch Akten, deren Chance schon bestätigt ist.' },
        neu_berechnen: { type: 'boolean', description: 'true = Vorschläge vorher nach den festen Regeln neu berechnen und speichern.' },
        anzahl: { type: 'integer', minimum: 1, maximum: 80, description: 'Wie viele zeigen (Vorgabe 25).' },
      },
    },
  },
]

export function istChanceWerkzeug(name: string): boolean {
  return CHANCE_WERKZEUGE.some((w) => w.name === name)
}

const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember']

/** „2027-01“, „01/2027“, „1.2027“, „Januar 2027“, „Januar“ (nächstes Vorkommen ab heute) → JJJJ-MM; sonst undefined. */
export function leseMonat(roh: unknown, heute: string): string | undefined {
  const t = String(roh ?? '').trim().toLowerCase().replace('maerz', 'märz')
  if (!t) return undefined
  let m = t.match(/^(\d{4})-(\d{1,2})$/)
  if (m) return gueltig(Number(m[1]), Number(m[2]))
  m = t.match(/^(\d{1,2})[./](\d{4})$/)
  if (m) return gueltig(Number(m[2]), Number(m[1]))
  const i = MONATE.findIndex((n) => t.startsWith(n) || t.startsWith(n.slice(0, 3)))
  if (i >= 0) {
    const jahr = t.match(/(\d{4})/)
    if (jahr) return gueltig(Number(jahr[1]), i + 1)
    const aktuell = monatVon(heute)!
    const [j, mm] = aktuell.split('-').map(Number)
    return gueltig(i + 1 >= mm ? j : j + 1, i + 1)
  }
  return undefined
}

function gueltig(j: number, m: number): string | undefined {
  return j >= 2000 && j <= 2100 && m >= 1 && m <= 12 ? `${j}-${String(m).padStart(2, '0')}` : undefined
}

function akteName(a: Zeile): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

const SPALTEN = 'id, firma, ansprechpartner, bereich, status, verantwortlich_email, auftrag_chance, chance_vorschlag'

function chanceText(c: GespeicherteChance): string {
  return `Chance ${c.prozent} %${c.bestaetigt ? '' : ' (nicht bestätigt)'}, ${c.umsatzNetto ? `erwarteter Umsatz ${euro(c.umsatzNetto)} netto${c.monat ? ` im ${monatName(c.monat)}` : ''}` : 'ohne geschätzten Umsatz'}`
}

export async function fuehreChanceWerkzeugAus(name: string, input: Record<string, unknown>, ctx: ChanceKontext): Promise<string> {
  const { supabase, mitarbeiter: m, protokolliere, heute } = ctx
  if (m.nurPrivat === true) return 'Chancen und Umsätze der Holding gibt es im privaten Assistenten nicht.'

  if (name === 'chance_setzen') {
    const kundeId = String(input.kunde_id ?? '').trim()
    if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
    if (SAMMELAKTEN.includes(kundeId)) return 'Fehler: Die Sammelakten (Ungeklärte Eingänge, Intern) haben keine Chance. Nimm die echte Akte.'
    const { data: akte, error } = await supabase.from('kunden').select(SPALTEN).eq('id', kundeId).maybeSingle()
    if (error) return `Fehler beim Laden der Akte: ${error.message}`
    if (!akte || istFremdePrivatakte(m, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    if (istPrivat(akte)) return 'Fehler: Private Kontakte gehören nicht zur Holding und haben keine Chance in der Umsatzvorschau.'
    if (!darfAkte(m, akte)) return nichtFreigegeben(akte.bereich, m.name)

    const alt = leseGespeicherteChance(akte.auftrag_chance)
    const vorschlag = input.vorschlag_uebernehmen === true ? leseVorschlag(akte.chance_vorschlag) : undefined
    if (input.vorschlag_uebernehmen === true && !vorschlag) return 'Fehler: Für diese Akte ist kein Vorschlag gespeichert. Mit chance_vorschlaege_zeigen (kunde_id, neu_berechnen: true) einen berechnen.'

    const genannt = (k: string) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== ''
    let prozent: number | undefined
    if (genannt('chance')) {
      const p = Number(String(input.chance).replace('%', '').replace(',', '.'))
      if (!Number.isFinite(p) || p < 0 || p > 100) return 'Fehler: chance muss eine Zahl von 0 bis 100 sein.'
      prozent = Math.round(p)
    } else prozent = vorschlag && !(vorschlag.chanceBestaetigt && alt?.bestaetigt) ? vorschlag.prozent : alt?.prozent
    if (prozent === undefined) return 'Fehler: Die Akte hat noch keine Chance — nenne sie (chance) oder übernimm den Vorschlag (vorschlag_uebernehmen).'

    let umsatz: number | undefined
    if (genannt('umsatz')) {
      const u = typeof input.umsatz === 'number' ? input.umsatz : leseDeutscheZahl(String(input.umsatz).replace(/€|eur(o)?/gi, '')) ?? NaN
      if (!Number.isFinite(u) || u < 0) return 'Fehler: umsatz muss ein Betrag in Euro sein (0 = keiner).'
      umsatz = u > 0 ? Math.round(u * 100) / 100 : undefined
    } else umsatz = vorschlag ? (vorschlag.umsatzNetto ?? undefined) : alt?.umsatzNetto

    let monat: string | undefined
    if (genannt('monat')) {
      monat = leseMonat(input.monat, heute)
      if (!monat) return 'Fehler: monat verstehe ich nicht — bitte als JJJJ-MM, z. B. 2027-01.'
    } else monat = vorschlag && vorschlag.umsatzNetto ? (vorschlag.monat ?? undefined) : alt?.monat
    const aktuell = monatVon(heute)!
    if (umsatz && !monat) monat = plusMonate(aktuell, 2)
    if (monat && monat < aktuell) monat = aktuell

    const begruendung = genannt('begruendung')
      ? String(input.begruendung).trim().slice(0, 300)
      : vorschlag ? vorschlag.begruendung.slice(0, 300) : prozent === alt?.prozent ? alt?.begruendung : undefined
    const neu: GespeicherteChance = { prozent, bestaetigt: true, ...(begruendung ? { begruendung } : {}), von: m.name, am: new Date().toISOString() }
    if (umsatz) {
      neu.umsatzNetto = umsatz
      if (monat) neu.monat = monat
    }
    const { error: fehler } = await supabase.from('kunden').update({ auftrag_chance: neu }).eq('id', akte.id)
    if (fehler) return `Fehler beim Speichern: ${fehler.message}. Nichts wurde geändert.`
    protokolliere(`Chance der Akte ${akteName(akte)} gesetzt: ${chanceText(neu)}${vorschlag ? ' (Vorschlag übernommen)' : ''}`)

    // Hinweis, wenn ein Kostenvoranschlag mit Betrag zählt (dann zählt der statt der Schätzung).
    const { data: kvs } = await supabase.from('kostenvoranschlaege').select('betrag, status').eq('kunde_id', akte.id)
    const mitBetrag = ((kvs ?? []) as Zeile[]).filter((k) => (k.status === 'offen' || k.status === 'angenommen') && Number(k.betrag) > 0)
    const kvHinweis = mitBetrag.length && umsatz ? ' Achtung: Die Akte hat einen offenen Kostenvoranschlag mit Betrag — in der Umsatzvorschau zählt dessen Betrag, nicht die Schätzung.' : ''
    const ohneUmsatz = !umsatz && !mitBetrag.length && bereichIdVon(akte.bereich) !== 'immobilien' ? ' Ohne Umsatz zählt die Akte in der Umsatzvorschau noch nicht mit.' : ''
    return `Gespeichert für ${akteName(akte)} (${bereichName(akte.bereich)}): ${chanceText(neu)}, bestätigt von ${m.name}.${kvHinweis}${ohneUmsatz} kunde_id=${akte.id}`
  }

  if (name === 'chance_vorschlaege_zeigen') {
    const kundeId = String(input.kunde_id ?? '').trim()
    let bereich: string | undefined
    if (String(input.bereich ?? '').trim()) {
      const roh = String(input.bereich).trim().toLowerCase()
      bereich = roh === 'immobilien' ? 'immobilienkunden' : roh
      if (!darfBereich(m, bereich)) return nichtFreigegeben(bereich, m.name)
    }
    if (kundeId) {
      const { data: akte } = await supabase.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
      if (!akte || istFremdePrivatakte(m, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
      if (!darfAkte(m, akte)) return nichtFreigegeben(akte.bereich, m.name)
    }

    let neuText = ''
    if (input.neu_berechnen === true) {
      try {
        const am = new Date().toISOString()
        const g = await ladeChanceGrundlagen(supabase, { heute, kundeIds: kundeId ? [kundeId] : undefined, jetztIso: am })
        if (bereich) g.akten = g.akten.filter((a) => a.bereich === bereich)
        const { vorschlaege } = regelVorschlaegeFuer(g, (b) => darfBereich(m, b), am)
        for (const [id, v] of vorschlaege) {
          const { error } = await supabase.from('kunden').update({ chance_vorschlag: v }).eq('id', id)
          if (error) return `Fehler beim Speichern der Vorschläge: ${error.message}`
        }
        protokolliere(`${vorschlaege.size} Chance-Vorschläge nach festen Regeln neu berechnet`)
        neuText = `${vorschlaege.size} ${vorschlaege.size === 1 ? 'Vorschlag' : 'Vorschläge'} nach festen Regeln neu berechnet. `
      } catch (e) {
        return `Fehler: ${e instanceof Error ? e.message : String(e)}`
      }
    }

    // Seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage).
    const { data, error } = await alleZeilen(() => {
      let q = supabase.from('kunden').select(SPALTEN).neq('bereich', 'privat')
      if (kundeId) q = q.eq('id', kundeId)
      if (bereich) q = q.eq('bereich', bereich)
      return q
    })
    if (error) return `Fehler beim Laden: ${error.message}`
    const alle = input.alle === true
    const zeilen = ((data ?? []) as Zeile[])
      .filter((a) => !SAMMELAKTEN.includes(a.id) && darfAkte(m, a))
      .map((a) => ({ a, v: leseVorschlag(a.chance_vorschlag), c: leseGespeicherteChance(a.auftrag_chance) }))
    const ohneChance = zeilen.filter((z) => !z.c?.bestaetigt).length
    const liste = zeilen
      .filter((z) => z.v && (alle || !z.c?.bestaetigt || (!z.c.umsatzNetto && z.v.umsatzNetto)))
      .sort((x, y) => (y.v!.umsatzNetto ?? 0) * y.v!.prozent - (x.v!.umsatzNetto ?? 0) * x.v!.prozent)
    if (!liste.length) {
      return `${neuText}Keine offenen Vorschläge${bereich ? ` im Bereich ${bereichName(bereich)}` : ''}. ${ohneChance} ${ohneChance === 1 ? 'Akte hat' : 'Akten haben'} noch keine bestätigte Chance${ohneChance ? ' — mit neu_berechnen: true Vorschläge erzeugen' : ''}.`
    }
    const anzahl = Math.max(1, Math.min(80, Number(input.anzahl) || 25))
    const gewichtet = liste.reduce((s, z) => s + ((z.v!.umsatzNetto ?? 0) * z.v!.prozent) / 100, 0)
    return [
      `${neuText}${liste.length} ${liste.length === 1 ? 'Vorschlag' : 'Vorschläge'}${bereich ? ` (${bereichName(bereich)})` : ''}, zusammen ${euro(gewichtet)} nach Chance gewichtet (noch nicht bestätigt, zählt erst nach Übernehmen). Übernehmen: chance_setzen mit kunde_id und vorschlag_uebernehmen: true.`,
      ...liste.slice(0, anzahl).map(({ a, v, c }) =>
        `- ${akteName(a)} (${bereichName(a.bereich)}, Stand ${a.status ?? '?'}): ${vorschlagKurz(v!)}${v!.quelle === 'ki' ? ' (vom Assistenten geprüft)' : ''}${c?.bestaetigt ? ` — bestätigt sind schon ${c.prozent} %` : ''} — ${v!.begruendung.slice(0, 220)} (kunde_id=${a.id})`),
      liste.length > anzahl ? `… und ${liste.length - anzahl} weitere (im CRM in der Wochenbesprechung).` : '',
    ].filter(Boolean).join('\n').slice(0, 15000)
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
