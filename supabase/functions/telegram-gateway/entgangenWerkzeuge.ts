// Assistent-Werkzeuge „Entgangene Klienten“ (24.11.2026, Wunsch der Geschäftsführung):
//   als_entgangen_markieren — Akte auf „verloren“ setzen, mit Grund (feste Kategorie), Notiz und entgangenem
//                             Betrag; schreibt kunden.verloren wie der Dialog im CRM. Ohne erkennbaren Grund
//                             wird nichts geändert, der Assistent soll nachfragen.
//   entgangene_klienten     — Auswertung (je Grund, Phase, Vermittler, Bereich) und Liste, Filter Zeitraum/Bereich/
//                             Grund; auf Wunsch die Akten, die zu entgehen drohen („Warum verlieren wir Kunden?“).
// Regeln und Texte: _shared/entgangenKern.ts (dieselben wie die Seite /entgangen im CRM).
//
// Rechte: Der Assistent arbeitet mit vollen Datenbankrechten, deshalb gilt hier rechte.ts wie die Zeilenregel kunden:
// nur freigegebene Bereiche; private Kontakte und Sammelakten gehören nicht dazu.

import {
  auswertungText,
  baueVerloren,
  drohGrundText,
  drohtZuEntgehen,
  ENTGANGEN_GRUENDE,
  type EntgangenEintrag,
  euroText,
  deDatum,
  grundLabel,
  imZeitraum,
  leseGrund,
  leseVerloren,
  letzteAktivitaet,
  chanceProzent,
  phaseStufe,
  vermittlerName,
  verlaufTextMarkiert,
  wertAusChance,
  werteAus,
  zeitraumBeginn,
} from '../_shared/entgangenKern.ts'
import { leseDeutscheZahl } from '../_shared/umsatzKern.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { bereichName, darfAkte, darfBereich, istFremdePrivatakte, istPrivat, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type EntgangenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Bezeichnung eines Status dieser Akte (Statusnetz wie in index.ts). */
  statusName: (akte: Zeile, status: string) => string
}

const GRUENDE_TEXT = ENTGANGEN_GRUENDE.map((g) => `${g.id} („${g.label}“)`).join(', ')

export const ENTGANGEN_WERKZEUGE = [
  {
    name: 'als_entgangen_markieren',
    description:
      `Markiert eine Kundenakte als entgangen: Status „verloren“ plus Grund, Notiz und entgangener Betrag — für „X ist abgesprungen“, „X hat kein Interesse mehr“, „Setz X auf verloren“. Der Grund ist Pflicht und eine dieser Kategorien: ${GRUENDE_TEXT}. Nennt der Mitarbeiter keinen Grund, frag ihn danach (Kategorien zur Auswahl nennen), bevor du das Werkzeug aufrufst — rate nie. Der Betrag wird aus der erwarteten Umsatz-Schätzung der Akte vorbelegt, wenn er keinen nennt. Steht die Akte schon auf verloren, wird der Grund ersetzt.`,
    input_schema: {
      type: 'object',
      properties: {
        kunde_id: { type: 'string', description: 'Die Akte (mit kunden_suchen ermitteln).' },
        grund: { type: 'string', enum: ENTGANGEN_GRUENDE.map((g) => g.id), description: 'Kategorie des Grunds.' },
        notiz: { type: 'string', description: 'Ein, zwei Sätze, was passiert ist (in den Worten des Mitarbeiters).' },
        betrag: { type: 'number', description: 'Optional: entgangener Betrag netto in Euro; ohne Angabe die Umsatz-Schätzung der Akte.' },
      },
      required: ['kunde_id', 'grund'],
    },
  },
  {
    name: 'entgangene_klienten',
    description:
      'Auswertung der entgangenen Klienten: Anzahl und entgangener Betrag je Grund, je Phase („wo verlieren wir sie?“), je Vermittler und je Bereich, dazu die Liste mit Grund, Notiz, Phase, Betrag, Datum und kunde_id. Für „Warum verlieren wir Kunden?“, „Wen haben wir dieses Jahr verloren?“, „Wie viel ist uns durch zu hohe Preise entgangen?“. Mit drohend: true zusätzlich die offenen Akten, die zu entgehen drohen (lange Funkstille, niedrige Chance, Rechnung lange überfällig).',
    input_schema: {
      type: 'object',
      properties: {
        zeitraum: { type: 'string', enum: ['alle', '30', '90', '365', 'jahr'], description: 'alle (Vorgabe), letzte 30/90/365 Tage oder dieses Jahr.' },
        von: { type: 'string', description: 'Optional: ab Datum JJJJ-MM-TT (geht vor zeitraum).' },
        bis: { type: 'string', description: 'Optional: bis Datum JJJJ-MM-TT.' },
        bereich: { type: 'string', description: 'Optional: nur dieser Bereich, z. B. "beratung", "erben", "immobilien".' },
        grund: { type: 'string', description: 'Optional: nur dieser Grund (Kennung oder Bezeichnung).' },
        drohend: { type: 'boolean', description: 'true = auch die Akten zeigen, die zu entgehen drohen.' },
        anzahl: { type: 'integer', minimum: 1, maximum: 80, description: 'Wie viele Akten je Liste (Vorgabe 20).' },
      },
    },
  },
]

export function istEntgangenWerkzeug(name: string): boolean {
  return ENTGANGEN_WERKZEUGE.some((w) => w.name === name)
}

function akteName(a: Zeile): string {
  const f = String(a.firma ?? '').trim()
  const p = String(a.ansprechpartner ?? '').trim()
  return f && p && f !== p ? `${f} (${p})` : f || p || 'ohne Namen'
}

const SPALTEN = 'id, firma, ansprechpartner, bereich, privat_art, status, verantwortlich, verantwortlich_email, activities, letzte_aktivitaet, auftrag_chance, vermittler, verloren'
const DATUM = /^\d{4}-\d{2}-\d{2}$/

export async function fuehreEntgangenWerkzeugAus(name: string, input: Record<string, unknown>, ctx: EntgangenKontext): Promise<string> {
  const { supabase, mitarbeiter: m, protokolliere, heute } = ctx
  if (m.nurPrivat === true) return 'Entgangene Klienten der Holding gibt es im privaten Assistenten nicht.'

  if (name === 'als_entgangen_markieren') {
    const kundeId = String(input.kunde_id ?? '').trim()
    if (!kundeId) return 'Fehler: kunde_id fehlt. Ermittle sie mit kunden_suchen.'
    if (SAMMELAKTEN.includes(kundeId)) return 'Fehler: Die Sammelakten (Ungeklärte Eingänge, Intern) sind keine Klienten.'
    const grund = leseGrund(input.grund)
    if (!grund) return `Nicht geändert: Der Grund fehlt oder passt zu keiner Kategorie. Frag den Mitarbeiter, warum der Klient abgesprungen ist, und nenne die Auswahl: ${ENTGANGEN_GRUENDE.map((g) => g.label).join('; ')}.`
    const { data: akte, error } = await supabase.from('kunden').select(SPALTEN).eq('id', kundeId).maybeSingle()
    if (error) return `Fehler beim Laden der Akte: ${error.message}`
    if (!akte || istFremdePrivatakte(m, akte)) return 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
    if (istPrivat(akte)) return 'Nicht geändert: Private Kontakte zählen nicht zu den entgangenen Klienten der Holding. Für einen privaten Kontakt nimm kunde_aendern mit Status „abgebrochen“.'
    if (!darfAkte(m, akte)) return nichtFreigegeben(akte.bereich, m.name)

    let betrag: number | undefined
    if (input.betrag !== undefined && input.betrag !== null && String(input.betrag).trim() !== '') {
      const b = typeof input.betrag === 'number' ? input.betrag : leseDeutscheZahl(String(input.betrag).replace(/€|eur(o)?/gi, '')) ?? NaN
      if (!Number.isFinite(b) || b < 0) return 'Fehler: betrag muss ein Betrag in Euro sein (oder weglassen).'
      betrag = b
    } else betrag = wertAusChance(akte.auftrag_chance)

    const schonVerloren = akte.status === 'verloren'
    const alt = leseVerloren(akte.verloren)
    const verloren = baueVerloren({
      grund,
      notiz: input.notiz,
      am: schonVerloren && alt ? alt.am : heute,
      von: m.name,
      phaseVorher: schonVerloren ? alt?.phaseVorher : akte.status,
      wertNetto: betrag,
      vermittler: vermittlerName(akte.vermittler),
    })
    const phaseName = verloren.phaseVorher ? ctx.statusName(akte, verloren.phaseVorher) : undefined
    const text = schonVerloren
      ? `Per Telegram: Grund ${alt ? 'geändert' : 'nachgetragen'} — ${verlaufTextMarkiert(verloren, phaseName)}`
      : `Per Telegram: Status ${ctx.statusName(akte, akte.status)} → ${ctx.statusName(akte, 'verloren')} — ${verlaufTextMarkiert(verloren, phaseName)}`
    const { error: fehler } = await supabase
      .from('kunden')
      .update({
        status: 'verloren',
        verloren,
        letzte_aktivitaet: heute,
        activities: [{ id: crypto.randomUUID(), date: heute, text, user: m.name }, ...(Array.isArray(akte.activities) ? akte.activities : [])],
      })
      .eq('id', akte.id)
    if (fehler) return `Fehler beim Speichern: ${fehler.message}. Nichts wurde geändert.`
    protokolliere(`${akteName(akte)} als entgangen markiert — ${grundLabel(grund)}`)
    return `Gespeichert: ${akteName(akte)} (${bereichName(akte.bereich)}) ist als entgangen markiert — Grund: ${grundLabel(grund)}${verloren.notiz ? ` (${verloren.notiz})` : ''}${phaseName ? `, verloren in Phase „${phaseName}“` : ''}${verloren.wertNetto ? `, entgangen ${euroText(verloren.wertNetto)} netto` : ''}. Wieder aufnehmen geht im CRM (Akte oder Seite „Entgangene Klienten“) oder mit kunde_aendern (Status). kunde_id=${akte.id}`
  }

  if (name === 'entgangene_klienten') {
    let bereich: string | undefined
    if (String(input.bereich ?? '').trim()) {
      const roh = String(input.bereich).trim().toLowerCase()
      bereich = roh === 'immobilien' ? 'immobilienkunden' : roh
      if (bereich === 'privat') return 'Private Kontakte zählen nicht zu den entgangenen Klienten.'
      if (!darfBereich(m, bereich)) return nichtFreigegeben(bereich, m.name)
    }
    const grund = String(input.grund ?? '').trim() ? leseGrund(input.grund) : undefined
    if (String(input.grund ?? '').trim() && !grund) return `Fehler: Grund unbekannt. Möglich: ${ENTGANGEN_GRUENDE.map((g) => g.label).join('; ')}.`
    const von = DATUM.test(String(input.von ?? '')) ? String(input.von) : zeitraumBeginn((['alle', '30', '90', '365', 'jahr'].includes(String(input.zeitraum)) ? String(input.zeitraum) : 'alle') as 'alle', heute)
    const bis = DATUM.test(String(input.bis ?? '')) ? String(input.bis) : undefined
    const anzahl = Math.max(1, Math.min(80, Number(input.anzahl) || 20))

    const { data, error } = await alleZeilen(() => {
      let q = supabase.from('kunden').select(SPALTEN).neq('bereich', 'privat')
      if (bereich) q = q.eq('bereich', bereich)
      if (input.drohend !== true) q = q.eq('status', 'verloren')
      return q
    })
    if (error) return `Fehler beim Laden: ${error.message}`
    const akten = ((data ?? []) as Zeile[]).filter((a) => !SAMMELAKTEN.includes(a.id) && darfAkte(m, a))

    const verlorene = akten
      .filter((a) => a.status === 'verloren')
      .map((a) => ({ a, v: leseVerloren(a.verloren) ?? { grund: 'sonstiges' as const, am: String(a.letzte_aktivitaet ?? heute).slice(0, 10), von: '' } }))
      .filter((x) => !grund || x.v.grund === grund)
      .sort((x, y) => y.v.am.localeCompare(x.v.am))
    const eintraege: EntgangenEintrag[] = verlorene.map((x) => ({ id: x.a.id, name: akteName(x.a), bereich: x.a.bereich, verloren: x.v }))
    const auswertung = werteAus(eintraege, { von, bis, bereichName })
    const liste = verlorene.filter((x) => imZeitraum(x.v.am, von, bis))
    const ohneGrund = liste.filter((x) => !x.a.verloren).length

    const teile: string[] = [
      `Entgangene Klienten${bereich ? ` (${bereichName(bereich)})` : ''}${grund ? ` mit Grund „${grundLabel(grund)}“` : ''}${von || bis ? `, ${von ? `ab ${deDatum(von)}` : ''}${bis ? ` bis ${deDatum(bis)}` : ''}` : ''}:`,
      auswertungText(auswertung),
    ]
    if (ohneGrund) teile.push(`(${ohneGrund} davon ohne erfassten Grund — als „Sonstiges“ gezählt.)`)
    if (liste.length) {
      teile.push('', `Liste (neueste zuerst${liste.length > anzahl ? `, ${anzahl} von ${liste.length}` : ''}):`)
      for (const { a, v } of liste.slice(0, anzahl)) {
        const phase = v.phaseVorher ? ctx.statusName(a, v.phaseVorher) : phaseStufe(a.bereich, undefined).label
        teile.push(`- ${akteName(a)} (${bereichName(a.bereich)}), ${deDatum(v.am)}: ${grundLabel(v.grund)}${v.notiz ? ` — ${v.notiz.slice(0, 200)}` : ''}; Phase ${phase}${v.wertNetto ? `; ${euroText(v.wertNetto)}` : ''}${v.vermittler ? `; Vermittler ${v.vermittler}` : ''} (kunde_id=${a.id})`)
      }
    }

    if (input.drohend === true) {
      const offen = akten.filter((a) => a.status !== 'verloren')
      const ids = offen.map((a) => a.id)
      const rechnungen = new Map<string, Zeile[]>()
      for (let i = 0; i < ids.length; i += 200) {
        const { data: r, error: rf } = await supabase.from('rechnungen').select('kunde_id, nummer, status, zahlungsziel, betrag_brutto').in('kunde_id', ids.slice(i, i + 200)).neq('status', 'Bezahlt')
        if (rf) return `Fehler beim Laden der Rechnungen: ${rf.message}`
        for (const z of (r ?? []) as Zeile[]) rechnungen.set(z.kunde_id, [...(rechnungen.get(z.kunde_id) ?? []), z])
      }
      const drohend = offen
        .map((a) => {
          const letzte = letzteAktivitaet(a.letzte_aktivitaet, a.activities)
          const gruende = drohtZuEntgehen(
            { bereich: a.bereich, status: String(a.status ?? ''), letzteAktivitaet: letzte, chanceProzent: chanceProzent(a.auftrag_chance) },
            (rechnungen.get(a.id) ?? []).map((r) => ({ status: String(r.status ?? ''), zahlungsziel: r.zahlungsziel, betrag: Number(r.betrag_brutto) || 0, nummer: r.nummer })),
            heute,
          )
          return { a, gruende, letzte: letzte ?? '' }
        })
        .filter((x) => x.gruende.length > 0)
        .sort((x, y) => y.gruende.length - x.gruende.length || x.letzte.localeCompare(y.letzte))
      teile.push('', drohend.length ? `Droht zu entgehen: ${drohend.length} ${drohend.length === 1 ? 'Akte' : 'Akten'}${drohend.length > anzahl ? ` (die ${anzahl} dringendsten)` : ''}:` : 'Droht zu entgehen: keine Akte.')
      for (const { a, gruende } of drohend.slice(0, anzahl)) {
        teile.push(`- ${akteName(a)} (${bereichName(a.bereich)}, ${ctx.statusName(a, String(a.status ?? ''))}${a.verantwortlich ? `, ${a.verantwortlich}` : ''}): ${gruende.map(drohGrundText).join('; ')} (kunde_id=${a.id})`)
      }
      if (drohend.length) teile.push('Nachfassen: wiedervorlage_anlegen; aufgeben: als_entgangen_markieren (Grund erfragen).')
    }
    return teile.join('\n').slice(0, 15000)
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
