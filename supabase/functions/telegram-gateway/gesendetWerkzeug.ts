// Werkzeug des Assistenten: gesendete Mails suchen und lesen (gesendete_mails).
//
// Anlass (Andreas Mayer, 19.11.2026): Briefe an Kunden, die über das gemeinsame Postfach
// info@amayer-holding.com aus Outlook/Webmail verschickt wurden, sah der Assistent nicht. Seit dem
// Gesendet-Abruf (email-gateway/gesendetAbruf.ts) stehen sie neben den über das CRM verschickten Mails in
// `gesendete_emails` (quelle 'postfach').
//
// Sichtbarkeit (wie gemeinsames_postfach / mail_lesen in index.ts):
// - Zeilen ohne besitzer_email (gemeinsame Postfächer): für jeden — ist die Mail einer Akte zugeordnet,
//   nur wenn deren Bereich freigegeben ist (die Sammelakten immer). Einem privaten Kontakt zugeordnete
//   Mails nur für dessen Verantwortlichen.
// - Zeilen mit besitzer_email (persönliches Postfach): nur für den Besitzer selbst.
import { darfAkte, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { datumDeutsch, VOLLTEXT_HOECHSTENS } from './mailWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type GesendetKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; email?: string | null }
}

export const GESENDET_WERKZEUGE = [
  {
    name: 'gesendete_mails',
    description:
      'Sucht und liest GESENDETE Mails: alles, was über das CRM verschickt wurde, und alles, was aus dem gemeinsamen Postfach (info@…) mit Outlook oder im Webmailer gesendet wurde, dazu die Gesendet-Mails aus dem eigenen privaten Postfach des Mitarbeiters. Nutze das, wenn jemand fragt, was einem Kunden geschrieben oder geschickt wurde, ob ein Brief/Angebot rausging, oder einen Text aus einer gesendeten Mail braucht. Ohne mail_id: Liste (höchstens 20, neueste zuerst) mit dem Anfang jeder Mail, eingrenzbar nach Kundenakte (kunde_id), Suchbegriff (Empfänger, Betreff, Text) und Zeitraum. Mit mail_id: die eine Mail vollständig. Die mail_id hier gehört nur zu diesem Werkzeug (nicht zu mail_lesen).',
    input_schema: {
      type: 'object',
      properties: {
        mail_id: { type: 'string', description: 'Kennung aus einer Liste dieses Werkzeugs, um die Mail ganz zu lesen.' },
        kunde_id: { type: 'string', description: 'Optional: nur Mails, die dieser Kundenakte zugeordnet sind (kunde_id aus kunden_suchen).' },
        suche: { type: 'string', description: 'Optional: Empfänger-Adresse, Name, Wort aus Betreff oder Text.' },
        tage: { type: 'number', description: 'Optional: wie viele Tage zurück (Standard 30, mit kunde_id oder suche 365; höchstens 3650).' },
        von: { type: 'string', description: 'Optional: ab diesem Tag (JJJJ-MM-TT oder TT.MM.JJJJ); ersetzt tage.' },
        bis: { type: 'string', description: 'Optional: bis einschließlich zu diesem Tag (JJJJ-MM-TT oder TT.MM.JJJJ).' },
        postfach: { type: 'string', enum: ['alle', 'gemeinsam', 'privat'], description: 'Optional: nur gemeinsame Postfächer oder nur das eigene private Postfach (Standard: alle, die der Mitarbeiter sehen darf).' },
      },
    },
  },
]

export function istGesendetWerkzeug(name: string): boolean {
  return name === 'gesendete_mails'
}

// ---------------------------------------------------------------------------------------------
// Reine Helfer (ohne Datenbank, siehe Tests)
// ---------------------------------------------------------------------------------------------

export type GesendetZeile = {
  id: string
  an?: string | null
  an_name?: string | null
  betreff?: string | null
  text?: string | null
  gesendet_am?: string | null
  kunde_id?: string | null
  kunde_bereich?: string | null
  kunde_name?: string | null
  besitzer_email?: string | null
  von?: string | null
  quelle?: string | null
  postfach_id?: string | null
}

export type AkteKurz = { bereich: string | null; verantwortlich_email: string | null }

/** Darf `ich` (Adresse des Mitarbeiters, klein) diese gesendete Mail sehen? `akten`: nachgeschlagene Akten zu kunde_id. */
export function darfGesendeteSehen(m: RechteMitarbeiter, ich: string, z: GesendetZeile, akten: Map<string, AkteKurz>): boolean {
  if (z.besitzer_email) return !!ich && z.besitzer_email.trim().toLowerCase() === ich
  if (!z.kunde_id) return true
  const akte = akten.get(z.kunde_id)
  const bereich = z.kunde_bereich || akte?.bereich
  // Eine nicht mehr vorhandene Akte gibt keinen Bereich preis und sperrt nichts (wie darfZuordnung).
  if (!bereich) return true
  if (bereich === 'privat') return !!ich && String(akte?.verantwortlich_email ?? '').trim().toLowerCase() === ich
  return darfAkte(m, { id: z.kunde_id, bereich })
}

/** Tag als JJJJ-MM-TT oder TT.MM.JJJJ → Beginn dieses Tages in Berlin (ISO), sonst null. `plusTage` verschiebt. */
export function tagBeginnBerlin(angabe: unknown, plusTage = 0): string | null {
  const s = String(angabe ?? '').trim()
  let t = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  let j: number, mo: number, d: number
  if (t) {
    j = Number(t[1])
    mo = Number(t[2])
    d = Number(t[3])
  } else {
    t = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (!t) return null
    j = Number(t[3])
    mo = Number(t[2])
    d = Number(t[1])
  }
  // Ungültige Tage (31.02.) nicht still umrechnen.
  const pruef = new Date(Date.UTC(j, mo - 1, d))
  if (pruef.getUTCFullYear() !== j || pruef.getUTCMonth() !== mo - 1 || pruef.getUTCDate() !== d) return null
  const utc = Date.UTC(j, mo - 1, d + plusTage)
  const probe = new Date(utc)
  // Abstand Berlin–UTC an diesem Tag (1 oder 2 Stunden): Berliner Uhrzeit um 00:00 UTC.
  const stunde = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(probe)) % 24
  return new Date(utc - stunde * 3600000).toISOString()
}

function kuerze(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)} … (gekürzt)` : s
}

function suchwort(roh: unknown): string {
  return String(roh ?? '').replace(/[,()%*"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

const SPALTEN = 'id, an, an_name, betreff, text, gesendet_am, kunde_id, kunde_bereich, kunde_name, besitzer_email, von, quelle, postfach_id'
const KEIN_KUNDE = 'Fehler: Es gibt keinen Kunden mit dieser kunde_id. Ermittle die richtige ID mit kunden_suchen.'

function herkunft(z: GesendetZeile): string {
  return z.quelle === 'postfach' ? 'aus dem Mail-Programm (Gesendet-Ordner)' : 'über das CRM'
}

function empfaengerText(z: GesendetZeile): string {
  const an = String(z.an ?? '')
  const name = String(z.an_name ?? '').trim()
  return name && name.toLowerCase() !== an.toLowerCase() ? `${name} <${an}>` : an
}

async function ladeAkten(supabase: Supa, zeilen: GesendetZeile[]): Promise<Map<string, AkteKurz>> {
  // Nachschlagen nur, wo der Bereich fehlt oder es um einen privaten Kontakt geht.
  const ids = [...new Set(zeilen.filter((z) => !z.besitzer_email && z.kunde_id && (!z.kunde_bereich || z.kunde_bereich === 'privat')).map((z) => String(z.kunde_id)))]
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('kunden').select('id, bereich, verantwortlich_email').in('id', ids)
  return new Map(((data ?? []) as (AkteKurz & { id: string })[]).map((k) => [k.id, { bereich: k.bereich, verantwortlich_email: k.verantwortlich_email }]))
}

// ---------------------------------------------------------------------------------------------
// Ausführen
// ---------------------------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function fuehreGesendetWerkzeugAus(name: string, input: any, k: GesendetKontext): Promise<string> {
  if (!istGesendetWerkzeug(name)) return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter } = k
  const ich = String(mitarbeiter.email ?? '').trim().toLowerCase()
  const eingabe = input ?? {}

  // Eine Mail ganz lesen.
  if (eingabe.mail_id) {
    const kennung = String(eingabe.mail_id).trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(kennung)) return 'Fehler: mail_id ist ungültig — exakt aus einer Liste von gesendete_mails übernehmen.'
    const { data, error } = await supabase.from('gesendete_emails').select(SPALTEN).eq('id', kennung).maybeSingle()
    if (error) return `Fehler beim Lesen: ${error.message}`
    const z = data as GesendetZeile | null
    // Private Mails anderer Mitarbeiter: so tun, als gäbe es sie nicht.
    if (!z || (z.besitzer_email && z.besitzer_email.trim().toLowerCase() !== ich)) return 'Fehler: Diese gesendete Mail gibt es nicht (oder sie liegt im privaten Postfach eines Kollegen).'
    const akten = await ladeAkten(supabase, [z])
    if (!darfGesendeteSehen(mitarbeiter, ich, z, akten)) {
      const bereich = z.kunde_bereich || akten.get(String(z.kunde_id))?.bereich
      // Den privaten Kontakt eines Kollegen nicht einmal andeuten: dieselbe Meldung wie bei einer unbekannten Mail.
      if (bereich === 'privat') return 'Fehler: Diese gesendete Mail gibt es nicht (oder sie liegt im privaten Postfach eines Kollegen).'
      return nichtFreigegeben(bereich, mitarbeiter.name)
    }
    const text = String(z.text ?? '')
    return JSON.stringify({
      mail_id: z.id,
      postfach: z.besitzer_email ? 'privat (nur dieser Mitarbeiter)' : 'gemeinsam',
      gesendet: datumDeutsch(z.gesendet_am),
      herkunft: herkunft(z),
      von: z.von ?? undefined,
      an: empfaengerText(z),
      betreff: z.betreff,
      akte: z.kunde_id ? { kunde_id: z.kunde_id, name: z.kunde_name } : 'keiner Akte zugeordnet',
      laenge: text.length,
      vollstaendig: text.length <= VOLLTEXT_HOECHSTENS,
      text: kuerze(text, VOLLTEXT_HOECHSTENS),
    })
  }

  // Kundenakte: erst prüfen, ob der Mitarbeiter sie sehen darf.
  const kundeId = eingabe.kunde_id ? String(eingabe.kunde_id).trim() : ''
  if (kundeId) {
    if (kundeId.length > 100 || /[\s,()"]/.test(kundeId)) return KEIN_KUNDE
    const { data: akte } = await supabase.from('kunden').select('id, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (!akte) return KEIN_KUNDE
    if (akte.bereich === 'privat') {
      if (!ich || String(akte.verantwortlich_email ?? '').trim().toLowerCase() !== ich) return KEIN_KUNDE
    } else if (!darfAkte(mitarbeiter, akte)) {
      return nichtFreigegeben(akte.bereich, mitarbeiter.name)
    }
  }

  const suche = suchwort(eingabe.suche)
  const vonIso = tagBeginnBerlin(eingabe.von)
  const bisIso = tagBeginnBerlin(eingabe.bis, 1)
  if (eingabe.von && !vonIso) return 'Fehler: "von" bitte als JJJJ-MM-TT oder TT.MM.JJJJ angeben.'
  if (eingabe.bis && !bisIso) return 'Fehler: "bis" bitte als JJJJ-MM-TT oder TT.MM.JJJJ angeben.'
  const tage = Math.min(3650, Math.max(1, Number(eingabe.tage) || (kundeId || suche ? 365 : 30)))
  const abIso = vonIso ?? new Date(Date.now() - tage * 86400000).toISOString()
  const welche = eingabe.postfach === 'gemeinsam' || eingabe.postfach === 'privat' ? eingabe.postfach : 'alle'

  const abfrage = (privat: boolean) => {
    let q = supabase.from('gesendete_emails').select(SPALTEN)
    q = privat ? q.eq('besitzer_email', ich) : q.is('besitzer_email', null)
    if (kundeId) q = q.eq('kunde_id', kundeId)
    q = q.gte('gesendet_am', abIso)
    if (bisIso) q = q.lt('gesendet_am', bisIso)
    if (suche) q = q.or(`betreff.ilike.%${suche}%,an.ilike.%${suche}%,an_name.ilike.%${suche}%,text.ilike.%${suche}%`)
    return q.order('gesendet_am', { ascending: false }).limit(40)
  }
  const [gemeinsam, privat] = await Promise.all([
    welche === 'privat' ? Promise.resolve({ data: [], error: null }) : abfrage(false),
    welche === 'gemeinsam' || !ich ? Promise.resolve({ data: [], error: null }) : abfrage(true),
  ])
  if (gemeinsam.error || privat.error) return `Fehler beim Lesen der gesendeten Mails: ${(gemeinsam.error ?? privat.error).message}`
  const alle = [...((gemeinsam.data ?? []) as GesendetZeile[]), ...((privat.data ?? []) as GesendetZeile[])]
  const akten = await ladeAkten(supabase, alle)
  const sichtbar = alle
    .filter((z) => darfGesendeteSehen(mitarbeiter, ich, z, akten))
    .sort((a, b) => Date.parse(String(b.gesendet_am ?? '')) - Date.parse(String(a.gesendet_am ?? '')))
  const liste = sichtbar.slice(0, 20)
  if (liste.length === 0) {
    const zeitraum = vonIso || bisIso ? 'im angegebenen Zeitraum' : `in den letzten ${tage} Tagen`
    return `Keine ${suche ? 'passenden ' : ''}gesendeten Mails ${kundeId ? 'zu dieser Akte ' : ''}${zeitraum}.${welche === 'privat' && !ich ? ' (Für diesen Mitarbeiter ist keine E-Mail-Adresse hinterlegt.)' : ''}`
  }
  return JSON.stringify({
    treffer: liste.map((z) => ({
      mail_id: z.id,
      gesendet: datumDeutsch(z.gesendet_am),
      an: empfaengerText(z),
      betreff: z.betreff,
      postfach: z.besitzer_email ? 'privat' : 'gemeinsam',
      herkunft: z.quelle === 'postfach' ? 'Mail-Programm' : 'CRM',
      akte: z.kunde_id ? `${z.kunde_name ?? ''} (kunde_id=${z.kunde_id})` : 'keine',
      anfang: String(z.text ?? '').replace(/\s+/g, ' ').slice(0, 200),
    })),
    hinweis: sichtbar.length > liste.length ? 'Es gibt weitere Treffer — mit Suchbegriff oder Zeitraum enger eingrenzen.' : undefined,
  })
}
