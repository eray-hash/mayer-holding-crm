// Assistent-Werkzeug: eine Gesprächsaufnahme auf mehrere Akten verteilen (24.11.2026). Anlass: eine Sprachnotiz der
// Geschäftsführung, in der rund 30 Kunden nacheinander durchgegangen werden. Die Arbeit macht email-gateway
// (gespraechVerteilen.ts, Aktionen gespraech_verteilen_vorschlag und gespraech_verteilen); dieses Werkzeug holt den
// Vorschlag, zeigt ihn kurz je Kunde, lässt unsichere Zuordnungen vom Mitarbeiter klären und übernimmt erst nach
// seinem Ja (bestaetigt=true). Unsichere Zuordnungen ohne ausdrückliche Angabe werden nie verteilt.

import { BEREICH_NAME, kurzText, NEUANLAGE_BEREICHE, type VerteilAbschnitt, type VerteilTreffer, type VerteilVorschlag } from '../_shared/gespraechVerteilenKern.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type AufnahmeVerteilenKontext = {
  supabase: Supa
  mitarbeiter: { name: string; email?: string | null; nurPrivat?: boolean | null }
  protokolliere: (text: string) => void
  /** email-gateway aufrufen (callEmailGateway in index.ts) — wirft mit der Fehlermeldung des Servers. */
  // deno-lint-ignore no-explicit-any
  rufeEmailGateway: (action: string, body: Record<string, unknown>) => Promise<any>
}

export const AUFNAHME_VERTEILEN_WERKZEUGE = [
  {
    name: 'aufnahme_verteilen',
    description:
      'Verteilt eine Gesprächsaufnahme oder Sprachnotiz aus der App „Mayer Gespräch“, in der mehrere Kunden nacheinander besprochen werden, auf die einzelnen Akten: je Kunde Gesprächsprotokoll (nur sein Teil), Verlaufseintrag, Wiedervorlagen, To-dos, Chance und erwarteter Umsatz; fehlende Akten werden neu angelegt. ' +
      'Erster Aufruf ohne bestaetigt: Vorschlag je Kunde mit zugeordneter Akte — zeig ihn dem Mitarbeiter kurz (Name → Akte, Stand in einem Halbsatz). Bei „unsicher“ oder „keine Akte“ frag ihn, welche Akte gemeint ist bzw. ob eine neue angelegt werden soll. ' +
      'Erst nach seinem Ja erneut mit bestaetigt=true aufrufen; Korrekturen und alle Antworten auf deine Rückfragen in zuordnung (unsichere Abschnitte werden nur mit ausdrücklicher kunde_id verteilt). ' +
      'Ohne aufnahme_id gilt die letzte fertige eigene Aufnahme. Wiederholbar: schon Verteiltes wird nicht doppelt angelegt.',
    input_schema: {
      type: 'object',
      properties: {
        aufnahme_id: { type: 'string', description: 'Optional: Kennung der Aufnahme. Ohne = die letzte fertige eigene Aufnahme.' },
        bestaetigt: { type: 'boolean', description: 'true = der Mitarbeiter hat den Vorschlag gesehen und will verteilen.' },
        neu_berechnen: { type: 'boolean', description: 'true = den Vorschlag neu von der KI erstellen lassen (nur auf Wunsch).' },
        nur: { type: 'array', items: { type: 'number' }, description: 'Optional: nur diese Abschnitt-Nummern verteilen.' },
        zuordnung: {
          type: 'array',
          description: 'Korrekturen je Abschnitt (nr aus dem Vorschlag). Ohne Eintrag gilt der Vorschlag, außer er ist unsicher.',
          items: {
            type: 'object',
            properties: {
              nr: { type: 'number' },
              kunde_id: { type: 'string', description: 'Diese Akte nehmen (aus der Auswahl oder aus kunden_suchen).' },
              neue_akte_bereich: { type: 'string', enum: [...NEUANLAGE_BEREICHE, 'privat'], description: 'Neue Akte in diesem Bereich anlegen.' },
              neue_akte_name: { type: 'string', description: 'Name bzw. Firma der neuen Akte (sonst der genannte Name).' },
              ueberspringen: { type: 'boolean', description: 'Diesen Abschnitt nicht verteilen.' },
            },
            required: ['nr'],
          },
        },
      },
    },
  },
]

export function istAufnahmeVerteilenWerkzeug(name: string): boolean {
  return AUFNAHME_VERTEILEN_WERKZEUGE.some((w) => w.name === name)
}

type Ansicht = VerteilAbschnitt & {
  treffer: VerteilTreffer[]
  vorschlag: VerteilVorschlag
  erledigt?: { kundeId: string; name: string; link: string; extern?: boolean }
}

function bereichText(b: string): string {
  return BEREICH_NAME[b] ?? b
}

/** Zeile je Abschnitt für die Vorschau. */
export function vorschauZeile(a: Ansicht): string {
  const nr = `${a.nr}. ${a.name}`
  if (a.erledigt) return `${nr} — schon verteilt (Akte ${a.erledigt.name}).`
  let ziel: string
  if (a.vorschlag.art === 'akte' && a.vorschlag.sicher) {
    const t = a.treffer.find((x) => x.id === (a.vorschlag as { kundeId: string }).kundeId)
    ziel = `→ ${t?.name ?? a.vorschlag.kundeId} (${bereichText(t?.bereich ?? '')}, kunde_id=${a.vorschlag.kundeId})`
  } else if (a.treffer.length) {
    ziel = `→ unsicher, Auswahl: ${a.treffer.map((t, i) => `${String.fromCharCode(97 + i)}) ${t.name} (${bereichText(t.bereich)}, kunde_id=${t.id})`).join('; ')}`
  } else if (a.vorschlag.art === 'neu') ziel = `→ keine Akte gefunden; Vorschlag: neue Akte im Bereich ${bereichText(a.vorschlag.bereich)}`
  else ziel = '→ keine Akte gefunden'
  return `${nr} ${ziel}\n   ${kurzText(a)}${a.offeneFragen.length ? ` · offen: ${a.offeneFragen.slice(0, 2).join('; ')}` : ''}`
}

// deno-lint-ignore no-explicit-any
export function auswahlAus(abschnitte: Ansicht[], input: any): { auswahl: Record<string, unknown>[]; ausgelassen: string[] } {
  const korrektur = new Map<number, Record<string, unknown>>()
  for (const z of Array.isArray(input?.zuordnung) ? input.zuordnung : []) if (Number.isInteger(Number(z?.nr))) korrektur.set(Number(z.nr), z)
  const nur = Array.isArray(input?.nur) && input.nur.length ? new Set(input.nur.map(Number)) : null
  const auswahl: Record<string, unknown>[] = []
  const ausgelassen: string[] = []
  for (const a of abschnitte) {
    if (nur && !nur.has(a.nr)) continue
    const z = korrektur.get(a.nr)
    if (z?.ueberspringen === true) continue
    if (a.erledigt && !z) continue
    if (typeof z?.kunde_id === 'string' && z.kunde_id.trim()) {
      auswahl.push({ nr: a.nr, ziel: { kundeId: z.kunde_id.trim() } })
      continue
    }
    if (typeof z?.neue_akte_bereich === 'string' && z.neue_akte_bereich) {
      auswahl.push({ nr: a.nr, ziel: { neu: { bereich: z.neue_akte_bereich, firma: String(z.neue_akte_name ?? '').trim() || a.firma || a.name, ansprechpartner: a.person } } })
      continue
    }
    if (a.vorschlag.art === 'akte' && a.vorschlag.sicher) auswahl.push({ nr: a.nr, ziel: { kundeId: a.vorschlag.kundeId } })
    else if (a.vorschlag.art === 'neu' && a.treffer.length === 0) auswahl.push({ nr: a.nr, ziel: { neu: { bereich: a.vorschlag.bereich, firma: a.firma || a.name, ansprechpartner: a.person } } })
    else ausgelassen.push(`${a.nr}. ${a.name}`)
  }
  return { auswahl, ausgelassen }
}

// deno-lint-ignore no-explicit-any
export async function fuehreAufnahmeVerteilenAus(name: string, input: any, k: AufnahmeVerteilenKontext): Promise<string> {
  if (name !== 'aufnahme_verteilen') return `Fehler: unbekanntes Werkzeug ${name}.`
  try {
    return await verteilen(input ?? {}, k)
  } catch (e) {
    return `Fehler: ${e instanceof Error ? e.message : String(e)}`
  }
}

// deno-lint-ignore no-explicit-any
async function verteilen(input: any, k: AufnahmeVerteilenKontext): Promise<string> {
  const ich = String(k.mitarbeiter.email ?? '').trim().toLowerCase()
  if (k.mitarbeiter.nurPrivat === true) return 'Fehler: Im privaten Assistenten gibt es das Verteilen von Aufnahmen nicht — bitte im CRM-Assistenten oder in der App „Mayer Gespräch“.'
  if (!ich) return 'Fehler: Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.'
  let id = String(input.aufnahme_id ?? '').trim()
  let titel = ''
  if (!id) {
    const { data } = await k.supabase.from('gespraech_aufnahmen').select('id, titel, art, erstellt_am').eq('mitarbeiter_email', ich).eq('status', 'fertig').order('erstellt_am', { ascending: false }).limit(1)
    const z = (data ?? [])[0]
    if (!z) return 'Es gibt keine fertig ausgewertete Aufnahme von dir. Aufnahmen entstehen in der App „Mayer Gespräch“.'
    id = String(z.id)
    const tag = String(z.erstellt_am ?? '').slice(0, 10).split('-').reverse().join('.')
    titel = `${z.titel ? `„${z.titel}“` : z.art === 'notiz' ? 'Sprachnotiz' : 'Aufnahme'} vom ${tag}`
  }
  const v = await k.rufeEmailGateway('gespraech_verteilen_vorschlag', { id, imAuftragVon: ich, telegram: true, ...(input.neu_berechnen === true ? { neu: true } : {}) })
  if (v?.status === 'laeuft') return 'Der Vorschlag wird noch berechnet (lange Aufnahme). Sag dem Mitarbeiter, dass er gleich eine Nachricht bekommt, sobald er fertig ist — dann gehst du ihn mit ihm durch.'
  if (v?.status === 'fehler') return `${v.fehler ?? 'Der Vorschlag ließ sich nicht erstellen.'} Mit neu_berechnen=true lässt er sich neu erstellen.`
  const abschnitte = (Array.isArray(v?.abschnitte) ? v.abschnitte : []) as Ansicht[]
  if (abschnitte.length === 0) return v?.hinweis ?? 'In der Aufnahme waren keine einzelnen Kunden oder Vorgänge zu erkennen.'

  if (input.bestaetigt !== true) {
    const offen = abschnitte.filter((a) => !a.erledigt)
    const unsicher = offen.filter((a) => !(a.vorschlag.art === 'akte' && a.vorschlag.sicher) && !(a.vorschlag.art === 'neu' && a.treffer.length === 0))
    return [
      `Vorschlag zum Verteilen${titel ? ` der ${titel}` : ''} (aufnahme_id=${id}): ${abschnitte.length} Kunden bzw. Vorgänge${offen.length < abschnitte.length ? `, davon ${abschnitte.length - offen.length} schon verteilt` : ''}.`,
      v.hinweis ? `Hinweis: ${v.hinweis}` : '',
      ...abschnitte.map(vorschauZeile),
      unsicher.length
        ? `Unklar sind: ${unsicher.map((a) => `${a.nr}. ${a.name}`).join(', ')} — frag den Mitarbeiter, welche Akte gemeint ist (oder neue Akte / überspringen), bevor du verteilst.`
        : '',
      `Zeig das dem Mitarbeiter kompakt. Nach seinem Ja: aufnahme_verteilen mit aufnahme_id=${id}, bestaetigt=true und den Korrekturen in zuordnung.`,
    ].filter(Boolean).join('\n')
  }

  const { auswahl, ausgelassen } = auswahlAus(abschnitte, input)
  if (auswahl.length === 0) {
    return ausgelassen.length
      ? `Nichts verteilt: Bei ${ausgelassen.join(', ')} ist die Akte unklar. Frag den Mitarbeiter und gib die Antwort als kunde_id bzw. neue_akte_bereich in zuordnung mit.`
      : 'Nichts zu verteilen — alles ist schon verteilt oder übersprungen.'
  }
  const r = await k.rufeEmailGateway('gespraech_verteilen', { id, imAuftragVon: ich, auswahl: { abschnitte: auswahl } })
  const ergebnisse = (Array.isArray(r?.ergebnisse) ? r.ergebnisse : []) as { name: string; link: string; angelegt: string[]; hinweise: string[]; neu: boolean; extern: boolean }[]
  k.protokolliere(`Aufnahme ${id} auf ${ergebnisse.length} Akte(n) verteilt`)
  return [
    `Verteilt auf ${ergebnisse.length} Akte${ergebnisse.length === 1 ? '' : 'n'}:`,
    ...ergebnisse.map((e) => `- ${e.name}${e.neu ? ' (neu angelegt)' : ''}: ${e.extern ? 'schon früher verteilt, nichts doppelt angelegt' : e.angelegt.length ? e.angelegt.join(', ') : 'nichts Neues'}${e.hinweise.length ? ` — Hinweis: ${e.hinweise.join(' ')}` : ''} ${e.link}`),
    ...(Array.isArray(r?.hinweise) ? r.hinweise.map((h: string) => `Hinweis: ${h}`) : []),
    ausgelassen.length ? `Nicht verteilt, weil die Akte unklar ist: ${ausgelassen.join(', ')} — frag den Mitarbeiter danach.` : '',
  ].filter(Boolean).join('\n')
}
