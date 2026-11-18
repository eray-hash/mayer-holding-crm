// Aufgaben nach Mitarbeiter: gemeinsamer Kern für die Seite „Aufgaben“ im CRM (src/pages/aufgaben)
// und das Werkzeug aufgaben_uebersicht des Assistenten (telegram-gateway). Bewusst ohne Importe und
// ohne Deno- oder Browser-Funktionen, damit beide Seiten genau dieselbe Zuordnung benutzen.
//
// Anlass: Hasan (18.11.2026) „wie kann ich sehen, welche Aufgaben wer bis wann machen muss“. Aufgaben
// liegen an drei Stellen: To-do-Listen (Bereichs- und eigene Listen), Follow-ups in Kunden- und
// Objektakten, Aufgaben in Projekten. Zuständig ist dort jeweils freier Text („Eray, Hasan, A.Mayer“),
// der hier auf die echten Mitarbeiternamen abgebildet wird.

export type AufgabenArt = 'todo' | 'followup' | 'projekt'

export type RohAufgabe = {
  id: string
  art: AufgabenArt
  titel: string
  /** Kunde, Objekt oder Projekt, zu dem die Aufgabe gehört. */
  bezug?: string
  /** Bereich als Anzeigename, z. B. „Immobilien“. */
  bereich?: string
  /** Freier Text aus dem Feld „Zuständig“ bzw. „Verantwortlich“. */
  zustaendig?: string | null
  /** Wer es ist, wenn „Zuständig“ leer ist (Besitzer der Liste, Verantwortlicher des Projekts). */
  ersatzPerson?: string | null
  /** Datum als ISO (yyyy-mm-dd) oder deutsch (TT.MM.JJJJ); anderes gilt als „ohne Datum“. */
  datum?: string | null
  /** Was das Datum bedeutet, z. B. „erledigen bis“, „Wiedervorlage“, „Follow-up“. */
  datumArt?: string
  /** Aus einer eigenen (nicht Bereichs-)To-do-Liste. */
  privat?: boolean
  /** Nur im Browser: wohin ein Klick führt. */
  pfad?: string
}

export type Lage = 'ueberfaellig' | 'heute' | 'woche' | 'spaeter' | 'ohne'

export type Aufgabe = RohAufgabe & {
  /** Die Person, unter der die Aufgabe steht (echter Mitarbeitername, OHNE_ZUSTAENDIGEN oder „Name (nicht im Team)“). */
  person: string
  /** Alle Personen der Aufgabe — bei „Eray, Hasan“ steht sie bei beiden. */
  allePersonen: string[]
  datumIso?: string
  lage: Lage
}

export const OHNE_ZUSTAENDIGEN = 'Ohne Zuständigen'
export const NICHT_IM_TEAM = '(nicht im Team)'

export const LAGE_TEXT: Record<Lage, string> = {
  ueberfaellig: 'überfällig',
  heute: 'heute fällig',
  woche: 'in den nächsten 7 Tagen',
  spaeter: 'später',
  ohne: 'ohne Datum',
}

function einfach(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Datum aus ISO oder TT.MM.JJJJ / TT.MM.JJ; alles andere → undefined. */
export function alsIso(wert: string | null | undefined): string | undefined {
  const s = String(wert ?? '').trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)
  if (de) {
    const jahr = de[3].length === 2 ? `20${de[3]}` : de[3]
    return `${jahr}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
  }
  return undefined
}

function plusTage(iso: string, tage: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

export function lageVon(datumIso: string | undefined, heute: string): Lage {
  if (!datumIso) return 'ohne'
  if (datumIso < heute) return 'ueberfaellig'
  if (datumIso === heute) return 'heute'
  if (datumIso <= plusTage(heute, 7)) return 'woche'
  return 'spaeter'
}

/** Nur echte Personen: das Sammelkonto „Mayer Holding“ und Testzugänge zählen nicht. */
export function personenNamen(namen: string[]): string[] {
  return [...new Set(namen.map((n) => n.trim()).filter((n) => n && !/holding/i.test(n) && !/^test\b/i.test(n)))]
}

/**
 * Bildet freien Text („Eray, Hasan, A.Mayer“, „Quirin“, „Hr. Süslü“) auf Mitarbeiternamen ab.
 * Ein Teil passt zu einer Person, wenn er ihr ganzer Name, ihr Vorname, ihr Nachname oder
 * „Initiale.Nachname“ ist — und zu genau einer Person. Was nicht eindeutig passt, kommt in `unbekannt`.
 */
export function ordneZu(text: string | null | undefined, namen: string[]): { personen: string[]; unbekannt: string[] } {
  const personen: string[] = []
  const unbekannt: string[] = []
  const teile = String(text ?? '')
    .split(/[,;/&+\n]|\s+und\s+/i)
    .map((t) => t.trim())
    .filter(Boolean)
  for (const teil of teile) {
    const t = einfach(teil).replace(/^(herr|hr|frau|fr)\.? /, '')
    if (!t) continue
    const passend = namen.filter((name) => {
      const n = einfach(name)
      const woerter = n.split(' ')
      const vor = woerter[0]
      const nach = woerter[woerter.length - 1]
      if (t === n || t === vor || (woerter.length > 1 && t === nach)) return true
      const initial = t.match(/^([a-z])\.? ?([a-z]+)$/)
      return !!initial && woerter.length > 1 && initial[1] === vor[0] && initial[2] === nach
    })
    if (passend.length === 1) {
      if (!personen.includes(passend[0])) personen.push(passend[0])
    } else unbekannt.push(teil)
  }
  return { personen, unbekannt }
}

/**
 * Ordnet jede Aufgabe ihren Personen zu. Eine Aufgabe mit mehreren Zuständigen erscheint bei jedem
 * von ihnen (`person` ist dann jeweils ein anderer Name, `allePersonen` gleich).
 */
export function ordneAufgabenZu(roh: RohAufgabe[], alleNamen: string[], heute: string): Aufgabe[] {
  const namen = personenNamen(alleNamen)
  const out: Aufgabe[] = []
  for (const a of roh) {
    let { personen, unbekannt } = ordneZu(a.zustaendig, namen)
    if (personen.length === 0 && unbekannt.length === 0 && a.ersatzPerson) ({ personen, unbekannt } = ordneZu(a.ersatzPerson, namen))
    const ziele = [...personen, ...unbekannt.map((u) => `${u} ${NICHT_IM_TEAM}`)]
    if (ziele.length === 0) ziele.push(OHNE_ZUSTAENDIGEN)
    const datumIso = alsIso(a.datum)
    const lage = lageVon(datumIso, heute)
    for (const person of ziele) out.push({ ...a, person, allePersonen: ziele, datumIso, lage })
  }
  return out
}

const LAGE_RANG: Record<Lage, number> = { ueberfaellig: 0, heute: 1, woche: 2, spaeter: 3, ohne: 4 }

/** Fällige zuerst, dann nach Datum, Aufgaben ohne Datum zuletzt. */
export function sortiereAufgaben(liste: Aufgabe[]): Aufgabe[] {
  return [...liste].sort((a, b) => LAGE_RANG[a.lage] - LAGE_RANG[b.lage] || (a.datumIso ?? '9999').localeCompare(b.datumIso ?? '9999') || a.titel.localeCompare(b.titel, 'de'))
}

/**
 * Gruppiert nach Person: echte Mitarbeiter alphabetisch, danach „nicht im Team“, zuletzt
 * „Ohne Zuständigen“.
 */
export function nachPerson(liste: Aufgabe[]): { person: string; aufgaben: Aufgabe[]; ueberfaellig: number; heute: number }[] {
  const gruppen = new Map<string, Aufgabe[]>()
  for (const a of liste) gruppen.set(a.person, [...(gruppen.get(a.person) ?? []), a])
  const rang = (p: string) => (p === OHNE_ZUSTAENDIGEN ? 2 : p.endsWith(NICHT_IM_TEAM) ? 1 : 0)
  return [...gruppen.entries()]
    .sort(([a], [b]) => rang(a) - rang(b) || a.localeCompare(b, 'de'))
    .map(([person, aufgaben]) => ({
      person,
      aufgaben: sortiereAufgaben(aufgaben),
      ueberfaellig: aufgaben.filter((x) => x.lage === 'ueberfaellig').length,
      heute: aufgaben.filter((x) => x.lage === 'heute').length,
    }))
}
