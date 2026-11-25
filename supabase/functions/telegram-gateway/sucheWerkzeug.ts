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
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { type DateiKandidat, dateinameAusUrl, findeDateien, guete, inhaltSchluessel, isoTag, suchWoerter, tagVerschieben, zeitraumAusText } from '../_shared/dateiSucheKern.ts'
import { heuteBerlin } from '../_shared/heuteBerlin.ts'
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
  {
    name: 'datei_finden',
    description:
      'Findet hochgeladene Dateien über einen UNGEFÄHREN Namen — in allen Kunden- und Objektakten, in Ungeklärte Eingänge und in Unterlagen des Hauses, soweit der Mitarbeiter sie sehen darf. Verzeiht Tippfehler, Umlaute (ä/ae, ß/ss), Wortteile und zusammengesetzte Wörter („Übersichtsliste“ findet auch „Liste Beträge …“), sucht im Anzeigenamen, im ursprünglichen Dateinamen, im Ordner/der Art und in der Kurzfassung des Inhalts; Wörter wie „Liste“, „Tabelle“, „Foto“ passen auch zur Dateiart. ' +
      'Nimm es immer, wenn jemand eine Datei sucht, die er oder ein Kollege hochgeladen/geschickt hat („die Übersichtsliste von gestern“, „wo ist die Exceltabelle zu …“, „schick mir nochmal die Datei …“) — auch wenn alles_durchsuchen oder die Akte nichts gefunden hat. Mit Zeitraum („gestern“, „letzte Woche hochgeladen“) über hochgeladen_ab/hochgeladen_bis oder tage_zurueck; ohne Suchbegriff liefert es alle Dateien des Zeitraums. ' +
      'Liefert je Treffer dokument_id und kunde_id bzw. objekt_id für dokument_inhalt, datei_senden, datei_verschieben, datei_umbenennen. Nenne bei unsicheren Treffern („ähnlich“) die zwei, drei besten und frag, welche gemeint ist.',
    input_schema: {
      type: 'object',
      properties: {
        suchbegriff: { type: 'string', description: 'Name oder Teile davon, so wie gesagt, z. B. "Übersichtsliste Objekte", "Mitvertrag Teckstr" (Tippfehler sind in Ordnung). Leer = alle Dateien im Zeitraum.' },
        hochgeladen_ab: { type: 'string', description: 'Optional: frühester Tag des Hochladens, JJJJ-MM-TT (für „gestern“ der gestrige Tag).' },
        hochgeladen_bis: { type: 'string', description: 'Optional: spätester Tag des Hochladens, JJJJ-MM-TT.' },
        tage_zurueck: { type: 'integer', description: 'Optional statt ab/bis: nur Dateien der letzten so vielen Tage (1 = heute und gestern).' },
        wo: { type: 'string', enum: ['alle', 'akten', 'objekte', 'ungeklaert', 'intern'], description: 'Optional: nur Kundenakten, nur Objekte, nur Ungeklärte Eingänge oder nur Unterlagen des Hauses. Vorgabe alle.' },
        kunde_id: { type: 'string', description: 'Optional: nur in dieser Kundenakte.' },
        objekt_id: { type: 'string', description: 'Optional: nur in dieser Objektakte.' },
        anzahl: { type: 'integer', description: 'Höchstens so viele Treffer (Vorgabe 8, höchstens 20).' },
      },
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
  if (treffer.length === 0) return `Keine Treffer für „${suchbegriff}“ (gesucht in allem, was der Mitarbeiter sehen darf). Sucht er eine hochgeladene Datei über ihren (ungefähren) Namen, nimm datei_finden.`
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
  if (name === 'datei_finden') return await dateiFinden(input ?? {}, k)
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


// ---------- datei_finden ----------

type DokEintrag = { id?: string; name?: string; typ?: string; url?: string; datum?: string; kategorie?: string; art?: string }
type KundeZeile = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null; dokumente: unknown }
type ObjektZeile = { id: string; bezeichnung: string | null; adresse: string | null; privat_besitzer: string | null; dokumente: unknown }

const SAMMEL_NAME: Record<string, string> = { k_intern_holding: 'Unterlagen des Hauses', k_eingang_ungeklaert: 'Ungeklärte Eingänge' }

function aktenName(k: KundeZeile): string {
  if (SAMMEL_NAME[k.id]) return SAMMEL_NAME[k.id]
  const firma = String(k.firma ?? '').trim()
  const ap = String(k.ansprechpartner ?? '').trim()
  return ap && ap !== firma ? `${firma} (${ap})` : firma || ap || k.id
}

function objektName(o: ObjektZeile): string {
  return [o.bezeichnung, o.adresse].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ') || o.id
}

function alsDok(x: unknown): DokEintrag | null {
  return x && typeof x === 'object' ? (x as DokEintrag) : null
}

/** Zeitraum aus den Angaben (ab/bis, tage_zurueck) oder aus Wörtern wie „gestern“ im Suchbegriff. */
export function zeitraumAus(input: Record<string, unknown>, suchbegriff: string, heute: string): { ab: string | null; bis: string | null } {
  const ab = isoTag(input.hochgeladen_ab)
  const bis = isoTag(input.hochgeladen_bis)
  if (ab || bis) return { ab, bis }
  const tage = Math.round(Number(input.tage_zurueck))
  if (Number.isFinite(tage) && tage > 0) return { ab: tagVerschieben(heute, -Math.min(tage, 3650)), bis: heute }
  return zeitraumAusText(suchbegriff, heute) ?? { ab: null, bis: null }
}

async function dateiFinden(input: Record<string, unknown>, k: SucheKontext): Promise<string> {
  const m = k.mitarbeiter
  const heute = k.heute && /^\d{4}-\d{2}-\d{2}$/.test(k.heute) ? k.heute : heuteBerlin()
  const suchbegriff = String(input.suchbegriff ?? '').trim()
  const { ab, bis } = zeitraumAus(input, suchbegriff, heute)
  if (suchWoerter(suchbegriff).length === 0 && !ab && !bis) return 'Fehler: Bitte einen (ungefähren) Dateinamen oder einen Zeitraum angeben.'
  const wo = String(input.wo ?? 'alle')
  const nurKunde = String(input.kunde_id ?? '').trim()
  const nurObjekt = String(input.objekt_id ?? '').trim()
  const anzahl = Math.min(20, Math.max(1, Math.round(Number(input.anzahl) || 8)))

  const mitAkten = !nurObjekt && wo !== 'objekte'
  const mitObjekten = !nurKunde && (wo === 'alle' || wo === 'objekte')
  const [akten, objekte, inhalte] = await Promise.all([
    mitAkten ? alleZeilen<KundeZeile>(() => k.supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email, dokumente')) : Promise.resolve({ data: [] as KundeZeile[], error: null }),
    mitObjekten ? alleZeilen<ObjektZeile>(() => k.supabase.from('objekte').select('id, bezeichnung, adresse, privat_besitzer, dokumente')) : Promise.resolve({ data: [] as ObjektZeile[], error: null }),
    alleZeilen<{ schluessel: string; zusammenfassung: string | null }>(() => k.supabase.from('dokument_inhalte').select('schluessel, zusammenfassung').eq('status', 'gelesen'), { ordnung: 'schluessel' }),
  ])
  if (akten.error) return `Fehler: Die Akten konnten nicht gelesen werden (${akten.error.message}).`
  if (objekte.error) return `Fehler: Die Objekte konnten nicht gelesen werden (${objekte.error.message}).`
  // Ohne Kurzfassungen geht die Suche trotzdem (nur über Namen).
  const kurz = new Map<string, string>()
  for (const z of inhalte.data ?? []) if (z?.schluessel && z.zusammenfassung) kurz.set(z.schluessel, z.zusammenfassung)

  const kandidaten: DateiKandidat[] = []
  for (const a of akten.data ?? []) {
    if (nurKunde && a.id !== nurKunde) continue
    if (wo === 'ungeklaert' && a.id !== 'k_eingang_ungeklaert') continue
    if (wo === 'intern' && a.id !== 'k_intern_holding') continue
    if (!darfAkte(m, a)) continue
    const doks = Array.isArray(a.dokumente) ? a.dokumente : []
    for (const x of doks) {
      const d = alsDok(x)
      if (!d?.id) continue
      kandidaten.push({
        dokument_id: d.id,
        name: String(d.name ?? ''),
        dateiname: dateinameAusUrl(d.url),
        typ: d.typ,
        ordner: d.kategorie ?? d.art,
        datum: d.datum ?? null,
        kurzinhalt: d.url ? kurz.get(inhaltSchluessel(d.url)) ?? null : null,
        ort_art: 'akte',
        ort_id: a.id,
        ort_name: aktenName(a),
      })
    }
  }
  for (const o of objekte.data ?? []) {
    if (nurObjekt && o.id !== nurObjekt) continue
    if (!darfObjekt(m, o)) continue
    const ordner = o.dokumente && typeof o.dokumente === 'object' && !Array.isArray(o.dokumente) ? (o.dokumente as Record<string, unknown>) : {}
    for (const [ordnerName, liste] of Object.entries(ordner)) {
      for (const x of Array.isArray(liste) ? liste : []) {
        const d = alsDok(x)
        if (!d?.id) continue
        kandidaten.push({
          dokument_id: d.id,
          name: String(d.name ?? ''),
          dateiname: dateinameAusUrl(d.url),
          typ: d.typ,
          ordner: ordnerName,
          datum: d.datum ?? null,
          kurzinhalt: d.url ? kurz.get(inhaltSchluessel(d.url)) ?? null : null,
          ort_art: 'objekt',
          ort_id: o.id,
          ort_name: objektName(o),
        })
      }
    }
  }
  if ((nurKunde || nurObjekt) && kandidaten.length === 0) return 'In dieser Akte gibt es keine Dateien, die der Mitarbeiter sehen darf (oder die Kennung stimmt nicht).'

  const zeitraumText = ab || bis ? ` hochgeladen ${ab && bis && ab === bis ? `am ${deDatum(ab)}` : [ab ? `ab ${deDatum(ab)}` : '', bis ? `bis ${deDatum(bis)}` : ''].filter(Boolean).join(' ')}` : ''
  const treffer = findeDateien(suchbegriff, kandidaten, { ab, bis })
  if (treffer.length === 0) {
    const hinweis = [`Keine Datei passt zu „${suchbegriff || '(ohne Namen)'}“${zeitraumText} (gesucht in ${kandidaten.length} Dateien, die der Mitarbeiter sehen darf).`]
    // Mit Zeitraum: zeigen, was in dem Zeitraum überhaupt hochgeladen wurde — oft ist es doch dabei.
    if (suchbegriff && (ab || bis)) {
      const imZeitraum = findeDateien('', kandidaten, { ab, bis }).slice(0, 8)
      if (imZeitraum.length) hinweis.push('', `Im Zeitraum hochgeladen (${imZeitraum.length}${imZeitraum.length === 8 ? '+' : ''}):`, ...imZeitraum.map(zeile))
    }
    hinweis.push('', 'Weitere Wege: ohne Zeitraum noch einmal suchen, alles_durchsuchen für Wörter im Inhalt, unzugeordnete_dateien für Telegram-Dateien, die noch in keiner Akte liegen.')
    return hinweis.join('\n')
  }
  const gezeigt = treffer.slice(0, anzahl)
  const kopf = suchbegriff ? `Dateien zu „${suchbegriff}“${zeitraumText}` : `Dateien${zeitraumText}`
  return [
    `${kopf} (${treffer.length > anzahl ? `${anzahl} von ${treffer.length}` : treffer.length}, beste zuerst; nur, was der Mitarbeiter sehen darf):`,
    ...gezeigt.map(zeile),
    '',
    'Weiter: dokument_inhalt (dokument_id + kunde_id oder objekt_id), datei_senden, datei_verschieben, datei_umbenennen.',
  ].join('\n')
}

function zeile(t: ReturnType<typeof findeDateien>[number]): string {
  const kennung = t.ort_art === 'objekt' ? `objekt_id=${t.ort_id}` : `kunde_id=${t.ort_id}`
  const tag = isoTag(t.datum)
  const teile = [tag ? deDatum(tag) : '', t.ordner && t.ort_art === 'objekt' ? `Ordner ${t.ordner}` : ''].filter(Boolean).join(', ')
  const wie = t.gefunden_in.length ? ` — ${guete(t.punkte)} (${t.gefunden_in.join(', ')})` : ''
  const knapp = t.knapp_daneben ? ' — Datum knapp außerhalb des Zeitraums' : ''
  const inhalt = t.kurzinhalt ? `\n  Inhalt: ${kuerze(t.kurzinhalt, 160)}` : ''
  return `- „${t.name || t.dateiname || 'ohne Namen'}“${teile ? ` (${teile})` : ''} in ${t.ort_art === 'objekt' ? 'Objekt' : 'Akte'} ${t.ort_name} [dokument_id=${t.dokument_id}, ${kennung}]${wie}${knapp}${inhalt}`
}
