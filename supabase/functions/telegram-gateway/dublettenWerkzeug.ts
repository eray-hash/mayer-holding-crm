// Assistent-Werkzeug dubletten_finden (22.11.2026): listet mögliche doppelte Kundenakten und Objekte —
// nur lesen. Zusammengeführt wird weiter allein mit kunden_zusammenfuehren (pflegeWerkzeuge.ts, nur
// Geschäftsführung, mit Bestätigung); bei Akten in verschiedenen Bereichen zuerst kunde_bereich_wechseln.
// Erkennung: _shared/dublettenKern.ts, Laden: _shared/dublettenLaden.ts (dieselbe Liste wie die Seite
// „Dubletten“ im CRM, auf der man auch „keine Dublette“ merken kann).
//
// Der Assistent arbeitet mit vollen Datenbankrechten: Jeder sieht nur Gruppen aus Akten, die er sehen darf
// (darfAkte), Objekte nur mit Immobilien-Rechten; private Kontakte und private Objekte prüft der Kern nie.

import { beschraenkeGruppen, type DublettenGruppe, gruppenText } from '../_shared/dublettenKern.ts'
import { findeDublettenInDb } from '../_shared/dublettenLaden.ts'
import { bereichName, darfAkte, darfObjekte, type RechteMitarbeiter, siehtAlleBereiche } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

export type DublettenKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
}

export const DUBLETTEN_WERKZEUGE = [
  {
    name: 'dubletten_finden',
    description:
      'Sucht mögliche doppelte Kundenakten (gleicher Name auch mit anderer Rechtsform, Umlauten oder Wortfolge, gleiche E-Mail-Adresse oder gleiche Firmen-Mailendung nach dem @, gleiche oder abgeschnittene Telefonnummer, gleiche Anschrift) und doppelte Objekte (gleiche Adresse oder Bezeichnung). Nur lesen, ändert nichts. Für Fragen wie „Haben wir doppelte Akten?“ oder „Gibt es Müller zweimal?“. Liefert je Gruppe Punkte, Gründe und die IDs. Zusammenführen danach nur mit kunden_zusammenfuehren (mit Bestätigung); liegen die Akten in verschiedenen Bereichen, erst eine mit kunde_bereich_wechseln verschieben. „Keine Dublette“ merkt man auf der Seite Dubletten im CRM.',
    input_schema: {
      type: 'object',
      properties: {
        art: { type: 'string', enum: ['kunden', 'objekte', 'alle'], description: 'Vorgabe alle.' },
        kunde_id: { type: 'string', description: 'Nur Gruppen, in denen diese Akte vorkommt.' },
        bereich: { type: 'string', description: 'Nur Gruppen mit mindestens einer Akte aus diesem Bereich (z. B. beratung, immobilienkunden, erben).' },
        max: { type: 'integer', minimum: 1, maximum: 30, description: 'Höchstens so viele Gruppen je Art (Vorgabe 10).' },
      },
    },
  },
]

export function istDublettenWerkzeug(name: string): boolean {
  return name === 'dubletten_finden'
}

function akteZeile(z: Zeile | undefined, id: string): string {
  if (!z) return `kunde_id=${id}`
  const firma = String(z.firma ?? '').trim() || 'ohne Namen'
  const ap = String(z.ansprechpartner ?? '').trim()
  const kontakt = [z.email, z.telefon].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ')
  return `${firma}${ap && ap !== firma ? ` (${ap})` : ''}, ${bereichName(z.bereich)}${kontakt ? `, ${kontakt}` : ''}, kunde_id=${id}`
}

function objektZeile(z: Zeile | undefined, id: string): string {
  if (!z) return `objekt_id=${id}`
  return `${String(z.bezeichnung ?? '').trim() || 'ohne Bezeichnung'}${z.adresse ? `, ${String(z.adresse).trim()}` : ''}, objekt_id=${id}`
}

export async function fuehreDublettenWerkzeugAus(name: string, input: Zeile, ctx: DublettenKontext): Promise<string> {
  if (name !== 'dubletten_finden') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter } = ctx
  const art = input.art === 'kunden' || input.art === 'objekte' ? input.art : 'alle'
  const max = Math.max(1, Math.min(30, Number(input.max) || 10))
  const kundeId = typeof input.kunde_id === 'string' ? input.kunde_id.trim() : ''
  let bereich = typeof input.bereich === 'string' ? input.bereich.trim() : ''
  if (bereich === 'immobilien') bereich = 'immobilienkunden'
  const mitObjekten = (art === 'objekte' || art === 'alle') && darfObjekte(mitarbeiter) && !kundeId && !bereich
  const mitKunden = art === 'kunden' || art === 'alle'

  let lage
  try {
    lage = await findeDublettenInDb(supabase, { kunden: mitKunden, objekte: mitObjekten })
  } catch (e) {
    return `Fehler: Die Akten ließen sich nicht laden (${(e as Error).message}).`
  }

  // Nur Akten, die der Mitarbeiter sehen darf; Punkte und Gründe nur aus Paaren sichtbarer Akten.
  const sichtbar = (id: string) => {
    const z = lage.akten.get(id)
    return !!z && darfAkte(mitarbeiter, { id, bereich: z.bereich, verantwortlich_email: z.verantwortlich_email })
  }
  const kunden: DublettenGruppe[] = beschraenkeGruppen(lage.kunden, sichtbar, (id) => String(lage.akten.get(id)?.bereich ?? '')).filter(
    (g) => (!kundeId || g.ids.includes(kundeId)) && (!bereich || g.ids.some((id) => lage.akten.get(id)?.bereich === bereich)),
  )

  const teile: string[] = []
  if (mitKunden) {
    if (kunden.length === 0) teile.push(kundeId ? 'Zu dieser Akte gibt es keine mögliche Dublette.' : 'Keine möglichen doppelten Kundenakten gefunden.')
    else {
      const ueber = kunden.filter((g) => g.bereichsuebergreifend).length
      teile.push(`Mögliche doppelte Kundenakten: ${kunden.length} Gruppe(n)${ueber > 0 ? `, davon ${ueber} über verschiedene Bereiche` : ''}.${kunden.length > max ? ` Die ersten ${max}:` : ''}`)
      kunden.slice(0, max).forEach((g, i) => {
        const akten = g.ids.map((id) => `   - ${akteZeile(lage.akten.get(id), id)}`).join('\n')
        const weiter = g.bereichsuebergreifend
          ? 'Verschiedene Bereiche: vielleicht bewusst getrennt; sonst erst eine mit kunde_bereich_wechseln in den anderen Bereich holen, dann zusammenführen.'
          : siehtAlleBereiche(mitarbeiter)
            ? 'Zusammenführen mit kunden_zusammenfuehren (erst nach Bestätigung).'
            : 'Zusammenführen kann nur die Geschäftsführung.'
        teile.push(`${i + 1}. ${gruppenText(g)}\n${akten}\n   ${weiter}`)
      })
    }
  }
  if (mitObjekten) {
    if (lage.objekte.length === 0) teile.push('Keine möglichen doppelten Objekte gefunden.')
    else {
      teile.push(`Mögliche doppelte Objekte: ${lage.objekte.length} Gruppe(n)${lage.objekte.length > max ? `, die ersten ${max}` : ''}. Zusammenführen von Objekten gibt es nicht; vergleichen auf der Seite Dubletten.`)
      lage.objekte.slice(0, max).forEach((g, i) => {
        teile.push(`${i + 1}. ${gruppenText(g)}\n${g.ids.map((id) => `   - ${objektZeile(lage.objektZeilen.get(id), id)}`).join('\n')}`)
      })
    }
  } else if (art === 'objekte') {
    teile.push(darfObjekte(mitarbeiter) ? 'Objekte nur ohne kunde_id und bereich.' : 'Objekte darfst du nicht sehen (Bereich Immobilien nicht freigegeben).')
  }
  if (siehtAlleBereiche(mitarbeiter)) teile.push('Nebeneinander vergleichen, zusammenführen oder als „keine Dublette“ merken geht auch auf der Seite Dubletten im CRM.')
  return teile.join('\n')
}
