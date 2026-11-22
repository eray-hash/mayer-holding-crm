// Assistent-Werkzeug „Was fehlt noch in der Objektakte?“ (22.11.2026). Prüfliste und Gewichte stehen im
// gemeinsamen Kern _shared/objektVollstaendigkeit.ts (dieselbe Rechnung wie im CRM: Ring in der Objektliste,
// Kasten „Was fehlt noch“ in der Objektakte).
//
// - Ein Objekt (objekt_id): Prozent, Stand und jeder fehlende Punkt mit „wo eintragen“ und wie es über den
//   Assistenten geht.
// - Mehrere Objekte: „meine“ (Vorgabe; verantwortlich oder privater Besitzer), ein Kollege oder alle, die
//   der Mitarbeiter sehen darf — nur Objekte, denen etwas fehlt, wichtigste Stände zuerst.
// - Wochenhinweis montags (email-gateway/objektLueckenHinweis.ts) für den Fragenden an- oder abschalten
//   (Tabelle objekt_luecken_hinweis, keine Zeile = an).
//
// Nur Lesen, außer der eigenen Einstellung. Der Assistent arbeitet mit vollen Datenbankrechten, deshalb gelten
// hier die Zeilenregeln über rechte.ts: Objekte der Holding nur mit Immobilien-Rechten, private Objekte nur
// ihr Besitzer (für alle anderen gibt es sie nicht).

import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import {
  eingabeAusZeile, fehlendKurz, istUnvollstaendig, type Phase, pruefeVollstaendigkeit, VOLLSTAENDIGKEIT_SPALTEN, type Vollstaendigkeit,
} from '../_shared/objektVollstaendigkeit.ts'
import { OBJEKT_STATUS, objektStatus } from './objektakte.ts'
import { adresse, darfObjekt, darfObjekte, istEigene, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type LueckenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const HINWEIS_TABELLE = 'objekt_luecken_hinweis'

export const LUECKEN_WERKZEUGE = [
  {
    name: 'objekt_luecken',
    description:
      'Zeigt, was in Objektakten noch fehlt (Kaufpreis, Adresse mit PLZ, Fläche, Eigentümer-Kontakt, Fotos und Titelbild, Exposé-Text und -PDF, Energieausweis, Grundbuch, Nummern des Inserats, Unterlagen im Interessenten-Portal …) mit Prozent je Objekt und wo man es einträgt. ' +
      'Was zählt, hängt vom Stand ab: in der Akquise nur Eckdaten, in der Vermarktung alles, was Interessenten sehen. ' +
      'Mit objekt_id für ein Objekt (ausführlich), ohne für eine Liste: Vorgabe „meine Objekte“. Für „Was fehlt bei meinen Objekten?“, „Ist das Objekt X vollständig?“, „Welche Objekte in Vermarktung sind unvollständig?“. ' +
      'Mit wochenhinweis=true/false schaltet der Mitarbeiter seinen Montags-Hinweis per Telegram an oder ab.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string', description: 'Ein bestimmtes Objekt (ID aus objekte_suchen).' },
        wer: { type: 'string', description: 'Für die Liste: "ich" (Vorgabe), Name oder Vorname eines Kollegen (z. B. "Quirin") oder "alle".' },
        nur_aktive: { type: 'boolean', description: 'true = nur Objekte in Vorbereitung und Vermarktung.' },
        wochenhinweis: { type: 'boolean', description: 'Nur wenn der Mitarbeiter es ausdrücklich will: true = Montags-Hinweis an, false = aus.' },
      },
    },
  },
]

export function istLueckenWerkzeug(name: string): boolean {
  return LUECKEN_WERKZEUGE.some((w) => w.name === name)
}

/** Reihenfolge der Liste: was gerade vermarktet wird, zuerst. */
const PHASE_RANG: Record<Phase, number> = { vermarktung: 0, vorbereitung: 1, verkauf: 2, akquise: 3, ende: 9 }
const HOECHSTENS = 30

type Zeile = Record<string, unknown> & { id: string; bezeichnung?: string | null; status?: string | null; verantwortlich?: string | null; privat_besitzer?: string | null }

function ausfuehrlich(o: Zeile, v: Vollstaendigkeit): string {
  const kopf = `Objekt ${o.bezeichnung || o.id} (objekt_id=${o.id}) — Stand: ${objektStatus(o.status)}`
  if (!v.gilt) return `${kopf}. Abgeschlossene Objekte (verkauft, Archiv, abgebrochen) werden nicht mehr auf Vollständigkeit geprüft.`
  if (v.fehlend.length === 0) return `${kopf} — ${v.prozent} % vollständig. Für diesen Stand fehlt nichts.`
  return [
    `${kopf} — ${v.prozent} % vollständig. Es fehlt (wichtigstes zuerst):`,
    ...v.fehlend.map((p) => `- ${p.titel}${p.detail ? ` (${p.detail})` : ''}. Im CRM: ${p.hinweis} Per Assistent: ${p.assistent}`),
    'Gezählt wird nur, was im aktuellen Stand wichtig ist; in der Vermarktung kommen Fotos, Exposé, Inserat und Portal dazu.',
  ].join('\n')
}

async function setzeWochenhinweis(k: LueckenKontext, an: boolean): Promise<string> {
  const email = adresse(k.mitarbeiter.email)
  if (!email) return 'Fehler: Zu deinem Zugang ist keine E-Mail-Adresse hinterlegt.'
  const { error } = await k.supabase.from(HINWEIS_TABELLE).upsert({ email, aktiv: an, geaendert_am: new Date().toISOString() }, { onConflict: 'email' })
  if (error) return `Fehler beim Speichern: ${error.message}`
  k.protokolliere(`Wochenhinweis „Was fehlt in Objektakten“ ${an ? 'eingeschaltet' : 'ausgeschaltet'}`)
  return an
    ? 'Wochenhinweis ist an: montags ab 8:30 Uhr kommt per Telegram eine kurze Liste deiner Objekte in Vorbereitung und Vermarktung, denen noch etwas fehlt — nur wenn es etwas gibt, höchstens einmal pro Woche.'
    : 'Wochenhinweis ist aus. Wieder einschalten: „Wochenhinweis Objekte an“ oder im CRM in der Objektliste.'
}

// deno-lint-ignore no-explicit-any
export async function fuehreLueckenWerkzeugAus(name: string, input: any, k: LueckenKontext): Promise<string> {
  if (name !== 'objekt_luecken') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter } = k
  const teile: string[] = []

  if (typeof input?.wochenhinweis === 'boolean') {
    const t = await setzeWochenhinweis(k, input.wochenhinweis)
    if (t.startsWith('Fehler')) return t
    teile.push(t)
    if (!input?.objekt_id && !input?.wer && input?.nur_aktive === undefined) return t
  }

  // ---- Ein Objekt ----
  const objektId = String(input?.objekt_id ?? '').trim()
  if (objektId) {
    const { data, error } = await supabase.from('objekte').select(VOLLSTAENDIGKEIT_SPALTEN).eq('id', objektId).maybeSingle()
    if (error) return `Fehler beim Laden: ${error.message}`
    if (!data || istUnsichtbaresObjekt(mitarbeiter, data)) return 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'
    if (!darfObjekt(mitarbeiter, data)) return nichtFreigegeben('immobilien', mitarbeiter.name)
    teile.push(ausfuehrlich(data as Zeile, pruefeVollstaendigkeit(eingabeAusZeile(data))))
    return teile.join('\n\n')
  }

  // ---- Liste ----
  const { data, error } = await supabase.from('objekte').select(VOLLSTAENDIGKEIT_SPALTEN).limit(2000)
  if (error) return `Fehler beim Laden: ${error.message}`
  let objekte = ((data ?? []) as Zeile[]).filter((o) => darfObjekt(mitarbeiter, o))
  // Ohne Immobilien-Rechte bleiben nur die eigenen privaten Objekte; gibt es keine, ist der Bereich nicht freigegeben.
  if (objekte.length === 0 && mitarbeiter.nurPrivat !== true && !darfObjekte(mitarbeiter)) return nichtFreigegeben('immobilien', mitarbeiter.name)

  const gefragt = String(input?.wer ?? '').trim()
  const alle = /^(alle|alles|jeder|team)$/i.test(gefragt)
  const ich = !gefragt || /^(ich|mir|mich|meine?|selbst)$/i.test(gefragt)
  let werText = 'alle Objekte, die du sehen darfst'
  if (!alle) {
    const { data: team } = await supabase.from('mitarbeiter').select('name').eq('aktiv', true)
    const namen = personenNamen(((team ?? []) as { name: string }[]).map((t) => t.name).filter(Boolean))
    const personen = ich ? [mitarbeiter.name] : ordneZu(gefragt, namen).personen
    if (!personen.length) return `Fehler: „${gefragt}“ passt zu keinem Mitarbeiter eindeutig. Nenne den vollen Namen oder "alle".`
    objekte = objekte.filter((o) => {
      if (ich && adresse(o.privat_besitzer) && istEigene(mitarbeiter, o.privat_besitzer)) return true
      const zustaendig = ordneZu(o.verantwortlich, namen).personen
      return personen.some((p) => zustaendig.includes(p) || String(o.verantwortlich ?? '').trim().toLowerCase() === p.toLowerCase())
    })
    werText = ich ? 'deine Objekte (verantwortlich oder privat)' : `Objekte von ${personen.join(', ')}`
  }

  const bewertet = objekte
    .map((o) => ({ o, v: pruefeVollstaendigkeit(eingabeAusZeile(o)) }))
    .filter((x) => x.v.gilt)
    .filter((x) => input?.nur_aktive !== true || x.v.phase === 'vorbereitung' || x.v.phase === 'vermarktung')
  const offen = bewertet.filter((x) => istUnvollstaendig(x.v))
  offen.sort((a, b) => PHASE_RANG[a.v.phase] - PHASE_RANG[b.v.phase] || (a.v.prozent ?? 0) - (b.v.prozent ?? 0))

  const umfang = input?.nur_aktive === true ? ' in Vorbereitung und Vermarktung' : ''
  if (bewertet.length === 0) {
    teile.push(`Keine laufenden Objekte${umfang} gefunden (${werText}).`)
    return teile.join('\n\n')
  }
  if (offen.length === 0) {
    teile.push(`Alle ${bewertet.length} laufenden Objekte${umfang} sind für ihren Stand vollständig (${werText}).`)
    return teile.join('\n\n')
  }
  const schnitt = Math.round(bewertet.reduce((n, x) => n + (x.v.prozent ?? 0), 0) / bewertet.length)
  const gezeigt = offen.slice(0, HOECHSTENS)
  teile.push([
    `Unvollständige Objekte${umfang}, ${werText}: ${offen.length} von ${bewertet.length} (Durchschnitt ${schnitt} %). Für Einzelheiten zu einem Objekt objekt_luecken mit objekt_id.`,
    ...gezeigt.map(({ o, v }) => `- ${o.bezeichnung || o.id} (objekt_id=${o.id}) · ${OBJEKT_STATUS[String(o.status ?? '')] ?? objektStatus(o.status)} · ${v.prozent} % · fehlt: ${fehlendKurz(v, 5)}`),
    offen.length > HOECHSTENS ? `… und ${offen.length - HOECHSTENS} weitere (im CRM: Objektliste, Filter „unvollständig“).` : '',
  ].filter(Boolean).join('\n'))
  return teile.join('\n\n').slice(0, 16000)
}
