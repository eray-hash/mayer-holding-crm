// Assistent-Werkzeug „alles_durchsuchen“ (22.11.2026): Volltextsuche über das ganze CRM — Akten (Name,
// Kontakt, Verlauf, Sachverhalt, nächste Schritte), gelesene Dokumente in Kunden- und Objektakten,
// Mails (gemeinsames Postfach, eigenes privates Postfach), Gesprächsprotokolle, Objekte, To-dos,
// Wiedervorlagen, Bücher, Partner. Die Suche selbst macht die Datenbank (public.suche_alles, siehe
// scratchpad runde4/suche/volltextsuche.sql), die Anfrage baut _shared/sucheAnfrage.ts wie im CRM.
//
// Rechte: Der Assistent arbeitet mit dem Dienstschlüssel; suche_alles läuft dann ohne Zeilenregeln und
// liefert alle Treffer samt Rechte-Spalten (bereich, besitzer, bezug_*). Diese Datei bildet die Regeln
// mit rechte.ts nach — wie die übrigen Werkzeuge, und streng wie dort:
//   Akten/Protokolle/Dokumente in Akten: darfAkte (private Akten nur der Besitzer); Wiedervorlagen wie
//   wiedervorlageWerkzeuge.ts (darfBereich, private nie); Objekte und ihre Dokumente: darfObjekt;
//   Mails: eigenes privates Postfach, sonst gemeinsames Postfach, aber nicht, wenn die Mail einer Akte
//   zugeordnet ist, die er nicht sehen darf (wie mails_auflisten in index.ts); To-dos: Bereichsliste mit
//   darfBereich, eigene Liste und für ihn freigegebene Listen (wie aufgaben.ts); Bücher: Bereich
//   „buecher“; Partner: jeder aktive Mitarbeiter. Im privaten Assistenten (nurPrivat) nur eigene private
//   Akten und Objekte, eigene Mails und die eigene To-do-Liste.
// Warum nicht mit den Rechten des Mitarbeiters aufrufen? Dafür bräuchte der Assistent dessen
// Anmeldung (die hat er nicht), und den privaten Assistenten (nurPrivat) kennt die Datenbank nicht.
// Nur lesend — es wird nichts geändert, deshalb auch kein protokolliere-Eintrag.

import { alsTsquery, ausschnittText } from '../_shared/sucheAnfrage.ts'
import { adresse, darfAkte, darfBereich, darfObjekt, istEigene, type RechteMitarbeiter } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type SucheKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name?: string | null }
  protokolliere?: (text: string) => void
  heute?: string
}

export const SUCH_ARTEN = ['akte', 'objekt', 'dokument', 'mail', 'gesendet', 'protokoll', 'todo', 'wiedervorlage', 'buch', 'partner'] as const
export type SuchArt = (typeof SUCH_ARTEN)[number]

const ART_NAME: Record<SuchArt, string> = {
  akte: 'Akten',
  objekt: 'Objekte',
  dokument: 'Dokumente',
  mail: 'Empfangene Mails',
  gesendet: 'Gesendete Mails',
  protokoll: 'Gesprächsprotokolle',
  todo: 'To-dos',
  wiedervorlage: 'Wiedervorlagen',
  buch: 'Bücher',
  partner: 'Partner',
}

export const SUCHE_WERKZEUGE = [
  {
    name: 'alles_durchsuchen',
    description:
      'Volltextsuche im ganzen CRM: findet ein Wort oder einen Namen auch IN Texten — im Verlauf und Sachverhalt von Akten, im Inhalt gelesener Dokumente (Kunden- und Objektakten), in Mails (gemeinsames und eigenes Postfach, Betreff und Text), Gesprächsprotokollen, Objekten (auch Exposé-Text), To-dos, Wiedervorlagen, Büchern und Partnern. Nutze das, wenn jemand fragt „Wo stand nochmal …?“, „Wer hatte … erwähnt?“, „In welchem Dokument steht …?“ oder wenn kunden_suchen nichts findet. Liefert je Fundstelle Titel, kurze Fundstelle, Datum und die Kennungen (kunde_id, objekt_id, dokument_id, mail_id …) für kundenakte_lesen, objektakte_lesen, dokument_inhalt oder mail_lesen. Zeigt nur, was der Mitarbeiter sehen darf. Suchregeln: Wörter gelten als Wortanfang, alle müssen vorkommen; "in Anführungszeichen" = genau diese Wortfolge; -wort schließt aus; ODER zwischen zwei Begriffen.',
    input_schema: {
      type: 'object',
      properties: {
        suchbegriff: { type: 'string', description: 'Was gesucht wird, z. B. "Kaution", "Müller Ulm", "\\"Erbschein beantragt\\"", "Mietvertrag -Entwurf".' },
        arten: {
          type: 'array',
          items: { type: 'string', enum: [...SUCH_ARTEN] },
          description: 'Optional: nur diese Arten (akte, objekt, dokument, mail, gesendet, protokoll, todo, wiedervorlage, buch, partner). Leer = alle.',
        },
        je_art: { type: 'integer', description: 'Höchstens so viele Treffer je Art (Vorgabe 5, höchstens 15).' },
      },
      required: ['suchbegriff'],
    },
  },
]

export function istSucheWerkzeug(name: string): boolean {
  return SUCHE_WERKZEUGE.some((w) => w.name === name)
}

/** Eine Zeile aus suche_alles. */
export type SuchTreffer = {
  art: string
  id: string
  titel: string | null
  untertitel: string | null
  ausschnitt: string | null
  ziel: string | null
  datum: string | null
  rang: number | null
  bereich: string | null
  besitzer: string | null
  bezug_art: string | null
  bezug_id: string | null
  bezug_besitzer: string | null
}

function akteVon(t: SuchTreffer) {
  return { id: t.bezug_id, bereich: t.bereich, verantwortlich_email: t.bezug_besitzer }
}

/**
 * Darf der Mitarbeiter diesen Treffer sehen? freigegeben = Besitzer, deren To-do-Liste für ihn
 * freigegeben ist (todo_freigaben, kleingeschrieben).
 */
export function darfTreffer(m: RechteMitarbeiter, t: SuchTreffer, freigegeben: ReadonlySet<string> = new Set()): boolean {
  const nurPrivat = m.nurPrivat === true
  switch (t.art) {
    case 'akte':
    case 'protokoll':
      return darfAkte(m, akteVon(t))
    case 'wiedervorlage':
      // wie darfWv in wiedervorlageWerkzeuge.ts: nur über den Bereich, private Akten nie
      return darfBereich(m, t.bereich)
    case 'objekt':
      return darfObjekt(m, { privat_besitzer: t.bezug_besitzer })
    case 'dokument':
      if (t.bezug_art === 'objekt') return darfObjekt(m, { privat_besitzer: t.bezug_besitzer })
      if (t.bezug_art === 'akte') return darfAkte(m, akteVon(t))
      return false
    case 'mail':
    case 'gesendet': {
      if (adresse(t.besitzer)) return istEigene(m, t.besitzer)
      if (nurPrivat) return false
      // gemeinsames Postfach: ohne Zuordnung für alle, sonst nur mit Recht an der Akte
      if (!t.bezug_id || !t.bereich) return true
      return darfAkte(m, akteVon(t))
    }
    case 'todo': {
      if (t.bereich) return darfBereich(m, t.bereich)
      const besitzer = adresse(t.besitzer)
      if (!besitzer) return false
      if (istEigene(m, besitzer)) return true
      return !nurPrivat && freigegeben.has(besitzer)
    }
    case 'buch':
      return darfBereich(m, 'buecher')
    case 'partner':
      return !nurPrivat
    default:
      return false
  }
}

function deDatum(iso: string | null): string {
  if (!iso) return ''
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

function kennungen(t: SuchTreffer): string {
  const bezug = t.bezug_id ? (t.bezug_art === 'objekt' ? `objekt_id=${t.bezug_id}` : `kunde_id=${t.bezug_id}`) : ''
  switch (t.art) {
    case 'akte':
      return `kunde_id=${t.id}`
    case 'objekt':
      return `objekt_id=${t.id}`
    case 'dokument':
      return [`dokument_id=${t.id}`, bezug].filter(Boolean).join(', ')
    case 'mail':
      return [`mail_id=${t.id}`, t.besitzer ? 'eigenes Postfach' : '', bezug].filter(Boolean).join(', ')
    case 'gesendet':
      return [`gesendet_id=${t.id}`, t.besitzer ? 'eigenes Postfach' : '', bezug].filter(Boolean).join(', ')
    case 'protokoll':
      return [`protokoll_id=${t.id}`, bezug].filter(Boolean).join(', ')
    case 'todo':
      return `todo_id=${t.id}`
    case 'wiedervorlage':
      return [`wiedervorlage_id=${t.id}`, bezug].filter(Boolean).join(', ')
    case 'buch':
      return `buch_id=${t.id}`
    case 'partner':
      return `partner_id=${t.id}`
    default:
      return `id=${t.id}`
  }
}

function kuerze(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Die Ergebnis-Zeilen, gruppiert nach Art (exportiert für den Test). */
export function formatiere(suchbegriff: string, treffer: SuchTreffer[], jeArt: number): string {
  if (treffer.length === 0) return `Keine Treffer für „${suchbegriff}“ (gesucht in allem, was der Mitarbeiter sehen darf).`
  const zeilen: string[] = [`Treffer für „${suchbegriff}“ (nur, was der Mitarbeiter sehen darf):`]
  for (const art of SUCH_ARTEN) {
    const liste = treffer.filter((t) => t.art === art)
    if (liste.length === 0) continue
    const gezeigt = liste.slice(0, jeArt)
    zeilen.push('', `${ART_NAME[art]} (${liste.length > jeArt ? `${jeArt} von ${liste.length}` : liste.length}):`)
    for (const t of gezeigt) {
      const kopf = [t.titel ?? '', t.untertitel ?? '', deDatum(t.datum)].filter(Boolean).join(' · ')
      const fund = t.ausschnitt ? ` — „${kuerze(ausschnittText(t.ausschnitt), 220)}“` : ''
      zeilen.push(`- ${kuerze(kopf, 160)} [${kennungen(t)}]${fund}`)
    }
  }
  zeilen.push('', 'Weiterlesen: kundenakte_lesen (kunde_id), objektakte_lesen (objekt_id), dokument_inhalt (dokument_id + kunde_id oder objekt_id), mail_lesen (mail_id).')
  return zeilen.join('\n')
}

// deno-lint-ignore no-explicit-any
export async function fuehreSucheWerkzeugAus(name: string, input: any, k: SucheKontext): Promise<string> {
  if (name !== 'alles_durchsuchen') return `Fehler: Unbekanntes Werkzeug ${name}.`
  const suchbegriff = String(input?.suchbegriff ?? '').trim()
  const q = alsTsquery(suchbegriff)
  if (!q) return 'Fehler: Bitte einen Suchbegriff mit mindestens zwei Buchstaben angeben (nur Ausschlüsse wie -wort reichen nicht).'
  const arten = new Set<string>(
    (Array.isArray(input?.arten) ? input.arten : []).map((a: unknown) => String(a)).filter((a: string) => (SUCH_ARTEN as readonly string[]).includes(a)),
  )
  const jeArt = Math.min(15, Math.max(1, Math.round(Number(input?.je_art) || 5)))

  // Großzügig holen (je Art 60): Was der Mitarbeiter nicht sehen darf, fällt erst hier weg.
  const { data, error } = await k.supabase.rpc('suche_alles', { q, grenze: 60 })
  if (error) return `Fehler: Die Suche hat nicht geklappt (${error.message}).`
  let treffer = ((data ?? []) as SuchTreffer[]).filter((t) => arten.size === 0 || arten.has(t.art))

  // Freigegebene To-do-Listen nur nachschlagen, wenn es fremde eigene Listen unter den Treffern gibt.
  let freigegeben = new Set<string>()
  const ich = adresse(k.mitarbeiter.email)
  if (k.mitarbeiter.nurPrivat !== true && ich && treffer.some((t) => t.art === 'todo' && !t.bereich && adresse(t.besitzer) && adresse(t.besitzer) !== ich)) {
    const { data: f, error: fFehler } = await k.supabase.from('todo_freigaben').select('besitzer_email, empfaenger_email')
    if (!fFehler) {
      freigegeben = new Set(
        ((f ?? []) as { besitzer_email: string | null; empfaenger_email: string | null }[])
          .filter((z) => adresse(z.empfaenger_email) === ich)
          .map((z) => adresse(z.besitzer_email))
          .filter(Boolean),
      )
    }
  }
  treffer = treffer.filter((t) => darfTreffer(k.mitarbeiter, t, freigegeben))
  return formatiere(suchbegriff, treffer, jeArt)
}

