// Wochenhinweis „Akquise-Objekte ohne Kurzprüfung“ per Telegram (Runde 6, 23.11.2026) — vom Minutentakt
// (Aktion termin_erinnerungen in index.ts) gerufen, ohne offenes Browserfenster und ohne KI.
//
// - Montags beim ersten Takt zwischen 9:00 und 10:59 Uhr Berliner Zeit (nach dem Objekt-Wochenhinweis ab 8:30).
//   Außerhalb des Fensters ohne Datenbankzugriff; ein verpasster Montag wird nicht nachgeholt.
// - Objekte im Stand „akquise“, deren Kurzprüfung noch nicht begonnen ist (_shared/kurzpruefungKern.ts istBegonnen).
//   Empfänger: Verantwortlicher (objekte.verantwortlich über ordneZu) mit Immobilien-Rechten; private Objekte nur
//   ihr Besitzer. Ist nichts offen, kommt nichts.
// - Die Nachricht geht über den Assistenten in seinen Gesprächsverlauf (wie die Kontakt-Nachfrage), damit „fang mit
//   Geislingen an“ direkt zu kurzpruefung_ausfuellen führt.
// - Schalter assistent_hinweis_einstellung.kurzpruefung_hinweis: 'aus' (Vorgabe) | 'superuser' (Probelauf nur an
//   Eray, je Kollege ein Abschnitt „ginge an …“) | 'alle'. Je Mitarbeiter abschaltbar (assistent_hinweise.
//   kurzpruefung_hinweis, „Wochenhinweis Kurzprüfung aus“). Höchstens einmal pro Woche (kurzpruefung_woche).
// - Wirft nie.

import { ordneZu, personenNamen } from '../_shared/aufgabenKern.ts'
import { istBegonnen } from '../_shared/kurzpruefungKern.ts'
import { beanspruche, ladeEinstellungen, ladeModus, ladeTeam, offeneEmpfaenger, type Person } from './assistentHinweise.ts'
import type { Frage } from './nachTermin.ts'
import { berlinZeit } from './tagesmeldung.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type KurzpruefungHinweisErgebnis = { gelaufen: boolean; gesendet: number; fehler: string[] }

const AB_STUNDE = 9
const BIS_STUNDE = 11
const HOECHSTENS_OBJEKTE = 8

/** Montag zwischen 9:00 und 10:59 Uhr Berliner Zeit? */
export function imKurzpruefungFenster(jetzt: Date): boolean {
  const b = berlinZeit(jetzt)
  return b.wochentag === 1 && b.stunde >= AB_STUNDE && b.stunde < BIS_STUNDE
}

type ObjektZeile = { id: string; bezeichnung?: string | null; verantwortlich?: string | null; privat_besitzer?: string | null; kurzpruefung?: unknown }

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

function darfImmobilien(p: Person): boolean {
  return p.rolle === 'geschaeftsfuehrung' || p.ist_admin || p.bereiche.includes('immobilien')
}

/** Objekte ohne Kurzprüfung je Person (E-Mail → Bezeichnungen). */
export function objekteJePerson(objekte: ObjektZeile[], team: Person[]): Map<string, string[]> {
  const namen = personenNamen(team.map((p) => p.name))
  const m = new Map<string, string[]>()
  for (const o of objekte) {
    if (istBegonnen(o.kurzpruefung)) continue
    const bezeichnung = text(o.bezeichnung) || o.id
    const besitzer = text(o.privat_besitzer).toLowerCase()
    for (const p of team) {
      if (besitzer) {
        if (besitzer !== p.email) continue
      } else {
        if (!darfImmobilien(p)) continue
        const v = text(o.verantwortlich)
        if (!ordneZu(v, namen).personen.includes(p.name) && v.toLowerCase() !== p.name.toLowerCase()) continue
      }
      m.set(p.email, [...(m.get(p.email) ?? []), bezeichnung])
    }
  }
  for (const l of m.values()) l.sort((a, b) => a.localeCompare(b, 'de'))
  return m
}

/** Die Nachricht an den Verantwortlichen. */
export function kurzpruefungHinweisText(objekte: string[]): string {
  const gezeigt = objekte.slice(0, HOECHSTENS_OBJEKTE)
  return [
    `Wochenhinweis Kurzprüfung — bei ${objekte.length === 1 ? 'einem deiner Objekte' : `${objekte.length} deiner Objekte`} in der Akquise fehlt noch die Vorab-Kurzprüfung:`,
    ...gezeigt.map((b) => `• ${b}`),
    objekte.length > gezeigt.length ? `… und ${objekte.length - gezeigt.length} weitere.` : '',
    '',
    `Das geht jetzt auch hier im Chat: Schreib mir zum Beispiel „Kurzprüfung für ${gezeigt[0] ?? 'Objekt X'}“, dann frage ich die Punkte der Reihe nach ab und trage sie ein.`,
    'Abschalten: schreib mir „Wochenhinweis Kurzprüfung aus“.',
  ].filter((z, i, a) => z !== '' || (a[i - 1] ?? '') !== '').join('\n')
}

/** Probelauf: alles, was an die Kollegen ginge, in einer Nachricht an den Superuser. */
export function probeText(jePerson: { name: string; objekte: string[] }[]): string {
  return [
    'Probelauf Wochenhinweis Kurzprüfung (geht noch an niemanden sonst). So käme er bei den Kollegen an:',
    ...jePerson.flatMap((p) => ['', `— ginge an ${p.name}:`, kurzpruefungHinweisText(p.objekte)]),
  ].join('\n')
}

/** Vom Minutentakt gerufen. */
export async function pruefeKurzpruefungHinweis(admin: Db, o: { frage: Frage; jetzt?: Date }): Promise<KurzpruefungHinweisErgebnis> {
  const jetzt = o.jetzt ?? new Date()
  const ergebnis: KurzpruefungHinweisErgebnis = { gelaufen: false, gesendet: 0, fehler: [] }
  if (!imKurzpruefungFenster(jetzt)) return ergebnis
  try {
    const modus = await ladeModus(admin, 'kurzpruefung_hinweis')
    if (modus === 'aus') return ergebnis
    const montag = berlinZeit(jetzt).datum
    const [team, einst] = await Promise.all([ladeTeam(admin), ladeEinstellungen(admin, 'kurzpruefung_hinweis')])
    const empfaenger = offeneEmpfaenger(team, einst, modus, montag)
    if (empfaenger.length === 0) return ergebnis
    ergebnis.gelaufen = true

    const { data, error } = await admin.from('objekte').select('id, bezeichnung, verantwortlich, privat_besitzer, kurzpruefung').eq('status', 'akquise').limit(2000)
    if (error) throw new Error(`objekte: ${error.message}`)
    const jePerson = objekteJePerson((data ?? []) as ObjektZeile[], team)
    if (jePerson.size === 0) return ergebnis

    for (const p of empfaenger) {
      let nachricht: string | null = null
      if (modus === 'alle') {
        const meine = jePerson.get(p.email) ?? []
        if (meine.length) nachricht = kurzpruefungHinweisText(meine)
      } else {
        // Probelauf: private Objekte der Kollegen gehören nicht in die Nachricht an den Superuser.
        const sichtbar = ((data ?? []) as ObjektZeile[]).filter((x) => !text(x.privat_besitzer) || text(x.privat_besitzer).toLowerCase() === p.email)
        const probe = objekteJePerson(sichtbar, team)
        const liste = team.map((t) => ({ name: t.name, objekte: probe.get(t.email) ?? [] })).filter((x) => x.objekte.length)
        if (liste.length) nachricht = probeText(liste)
      }
      if (!nachricht) continue
      try {
        if (!(await beanspruche(admin, 'kurzpruefung_hinweis', p.email, einst.has(p.email), montag))) continue
        if (await o.frage(p.id, nachricht, 'Wochenhinweis Kurzprüfung')) ergebnis.gesendet++
        else ergebnis.fehler.push(`Kurzprüfung-Hinweis an ${p.email}: nicht zugestellt.`)
      } catch (err) {
        ergebnis.fehler.push(`Kurzprüfung-Hinweis an ${p.email}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    console.error('Kurzprüfung-Hinweis fehlgeschlagen:', err)
    ergebnis.fehler.push(err instanceof Error ? err.message : String(err))
  }
  return ergebnis
}
