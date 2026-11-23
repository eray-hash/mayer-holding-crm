// Tägliche Nachfrage „Zu Akte X fehlen Telefon und E-Mail – weißt du sie?“ (Runde 6, 23.11.2026) — vom Minutentakt
// (Aktion termin_erinnerungen in index.ts) gerufen, ohne offenes Browserfenster und ohne KI.
//
// - Werktags beim ersten Takt zwischen 10:30 und 11:59 Uhr Berliner Zeit (nach Morgen-Übersicht, Tagesablauf und
//   Objekt-Wochenhinweis). Außerhalb des Fensters ohne Datenbankzugriff.
// - Akten: laufende Akten der Holding ganz ohne Telefon und E-Mail (_shared/kontaktLuecken.ts), keine privaten,
//   keine Sammelakten, keine im Endstand. Empfänger ist der Verantwortliche der Akte (Name wie in /aufgaben über
//   ordneZu), nur wenn er den Bereich sehen darf.
// - Wenig Lärm: je Person höchstens EINE Nachricht am Tag mit höchstens 3 Akten; dieselbe Akte frühestens nach
//   30 Tagen wieder (Tabelle kontakt_nachfragen). Ist nichts offen, kommt nichts.
// - Die Frage geht über den Assistenten (telegram-gateway intern 'rueckfrage', art 'mitteilung', wie die Nachfrage
//   nach Kundenterminen) in seinen Gesprächsverlauf — so versteht er die Antwort (Text oder Sprachnachricht) und trägt
//   sie mit kunde_aendern ein. Die Kennungen der Akten stehen im Feld „von“ der Systemmeldung.
// - Schalter (assistent_hinweis_einstellung.kontakt_nachfrage): 'aus' (Vorgabe) | 'superuser' (Probelauf nur an Eray,
//   mit „ginge an …“) | 'alle'. Je Mitarbeiter abschaltbar (assistent_hinweise.kontakt_nachfrage, „Kontakt-Nachfrage aus“).
// - Wirft nie.

import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { darfBereichPerson, KONTAKT_SPALTEN, type KontaktLuecke, type KontaktZeile, kontaktLuecken, NACHFRAGE_HOECHSTENS, nachfrageText } from '../_shared/kontaktLuecken.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { beanspruche, ladeEinstellungen, ladeModus, ladeTeam, offeneEmpfaenger, type Person } from './assistentHinweise.ts'
import type { Frage } from './nachTermin.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type KontaktNachfrageErgebnis = { gelaufen: boolean; gefragt: number; fehler: string[] }

export const NACHFRAGE_TABELLE = 'kontakt_nachfragen'
export const WIEDER_NACH_TAGEN = 30
const AB_MINUTEN = 10 * 60 + 30
const BIS_STUNDE = 12

/** Werktag zwischen 10:30 und 11:59 Uhr Berliner Zeit? */
export function imNachfrageFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  const minuten = b.stunde * 60 + b.minute
  return b.wochentag >= 1 && b.wochentag <= 5 && minuten >= AB_MINUTEN && b.stunde < BIS_STUNDE
}

type Gefragt = { kunde_id: string; gefragt_am: string; anzahl: number | null; probe: boolean | null }

/** Lücken je Verantwortlichem (nur Personen mit Telegram, die den Bereich sehen dürfen). */
export function verteile(luecken: KontaktLuecke[], team: Person[]): Map<string, KontaktLuecke[]> {
  const namen = personenNamen(team.map((p) => p.name))
  const jePerson = new Map<string, KontaktLuecke[]>()
  for (const l of luecken) {
    const zustaendig = ordneZu(l.verantwortlich, namen).personen
    for (const p of team) {
      if (!zustaendig.includes(p.name) && l.verantwortlich.toLowerCase() !== p.name.toLowerCase()) continue
      if (!darfBereichPerson(p, l.bereich)) continue
      jePerson.set(p.email, [...(jePerson.get(p.email) ?? []), l])
    }
  }
  return jePerson
}

/** Vom Minutentakt gerufen. */
export async function frageNachKontakten(admin: Db, o: { frage: Frage; jetzt?: Date }): Promise<KontaktNachfrageErgebnis> {
  const jetzt = o.jetzt ?? new Date()
  const ergebnis: KontaktNachfrageErgebnis = { gelaufen: false, gefragt: 0, fehler: [] }
  if (!imNachfrageFenster(jetzt)) return ergebnis
  try {
    const modus = await ladeModus(admin, 'kontakt_nachfrage')
    if (modus === 'aus') return ergebnis
    const heute = berlinZeit(jetzt).datum
    const [team, einst] = await Promise.all([ladeTeam(admin), ladeEinstellungen(admin, 'kontakt_nachfrage')])
    const empfaenger = offeneEmpfaenger(team, einst, modus, heute)
    if (empfaenger.length === 0) return ergebnis
    ergebnis.gelaufen = true

    const { data: kunden, error: kundenFehler } = await alleZeilen(() => admin.from('kunden').select(KONTAKT_SPALTEN).neq('bereich', 'privat'))
    if (kundenFehler) throw new Error(`kunden: ${kundenFehler.message}`)
    const { data: gefragt, error: gefragtFehler } = await admin.from(NACHFRAGE_TABELLE).select('kunde_id, gefragt_am, anzahl, probe')
    if (gefragtFehler) throw new Error(`${NACHFRAGE_TABELLE}: ${gefragtFehler.message}`)
    const grenze = jetzt.getTime() - WIEDER_NACH_TAGEN * 86400000
    const vorher = new Map<string, Gefragt>()
    for (const g of (gefragt ?? []) as Gefragt[]) vorher.set(String(g.kunde_id), g)
    // Im echten Betrieb zählen Probelauf-Fragen nicht: die Verantwortlichen wurden ja noch nie gefragt.
    const kuerzlich = (id: string) => {
      const g = vorher.get(id)
      if (!g) return false
      if (modus === 'alle' && g.probe === true) return false
      return Date.parse(g.gefragt_am) > grenze
    }
    const luecken = kontaktLuecken((kunden ?? []) as KontaktZeile[], { nurOhneKontakt: true }).filter((l) => !kuerzlich(l.id))
    if (luecken.length === 0) return ergebnis
    const jePerson = verteile(luecken, team)

    // Was geht an wen? Im Probelauf bekommt jeder Superuser eine Nachricht mit bis zu 3 Akten der Kollegen.
    const auftraege: { an: Person; eintraege: (KontaktLuecke & { an?: string })[] }[] = []
    if (modus === 'alle') {
      for (const p of empfaenger) {
        const meine = jePerson.get(p.email) ?? []
        if (meine.length) auftraege.push({ an: p, eintraege: meine.slice(0, NACHFRAGE_HOECHSTENS) })
      }
    } else {
      const nameVon = new Map(team.map((p) => [p.email, p.name]))
      const gesehen = new Set<string>()
      const alle: (KontaktLuecke & { an?: string })[] = []
      for (const [email, liste] of [...jePerson.entries()].sort((a, b) => (nameVon.get(a[0]) ?? '').localeCompare(nameVon.get(b[0]) ?? '', 'de'))) {
        for (const l of liste) {
          if (gesehen.has(l.id)) continue
          gesehen.add(l.id)
          alle.push({ ...l, an: nameVon.get(email) })
        }
      }
      // Reihum: aus jeder Liste eine Akte, damit der Probelauf zeigt, was bei verschiedenen Kollegen ankäme.
      const reihum: (KontaktLuecke & { an?: string })[] = []
      const nachPerson = new Map<string, (KontaktLuecke & { an?: string })[]>()
      for (const e of alle) nachPerson.set(e.an ?? '', [...(nachPerson.get(e.an ?? '') ?? []), e])
      while (reihum.length < NACHFRAGE_HOECHSTENS && [...nachPerson.values()].some((l) => l.length)) {
        for (const l of nachPerson.values()) if (l.length && reihum.length < NACHFRAGE_HOECHSTENS) reihum.push(l.shift()!)
      }
      if (reihum.length) for (const p of empfaenger) auftraege.push({ an: p, eintraege: reihum })
    }

    for (const a of auftraege) {
      const e = einst.get(a.an.email)
      try {
        // Erst den Tag beanspruchen, dann senden: so kommt die Nachfrage nie zweimal am Tag.
        if (!(await beanspruche(admin, 'kontakt_nachfrage', a.an.email, !!e, heute))) continue
        const probe = modus !== 'alle'
        for (const l of a.eintraege) {
          const alt = vorher.get(l.id)
          await admin.from(NACHFRAGE_TABELLE).upsert(
            { kunde_id: l.id, an_email: a.an.email, gefragt_am: jetzt.toISOString(), anzahl: (alt?.anzahl ?? 0) + 1, probe },
            { onConflict: 'kunde_id' },
          )
        }
        const von = `Kontakt-Nachfrage ${a.eintraege.map((l) => l.id).join(' ')}`.slice(0, 80)
        if (await o.frage(a.an.id, nachfrageText(a.eintraege, probe), von)) ergebnis.gefragt++
        else ergebnis.fehler.push(`Kontakt-Nachfrage an ${a.an.email}: nicht zugestellt.`)
      } catch (err) {
        ergebnis.fehler.push(`Kontakt-Nachfrage an ${a.an.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    console.error('Kontakt-Nachfrage fehlgeschlagen:', err)
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}
