// Bereichsrechte im Assistenten. Der Assistent arbeitet mit vollen Datenbankrechten; was ein
// Mitarbeiter über ihn sehen und ändern darf, entscheidet allein diese Datei. Reine Funktionen ohne
// Datenbank, damit sie sich ohne Netz prüfen lassen.
//
// Regel (wie im CRM selbst, siehe src/App.tsx): Geschäftsführung und Admins sehen alles, alle
// anderen nur die Bereiche in mitarbeiter.bereiche. Kundenakten tragen dafür eigene Schlüssel
// (kunden.bereich, siehe src/data/kundenBereiche.ts), die nur teilweise den Bereichs-Kennungen
// entsprechen: "immobilienkunden" gehört zum Bereich "immobilien". Objekte gehören zu Immobilien.
// Die beiden Sammelakten für geschickte Dateien stehen allen offen, sonst bliebe etwas liegen.
// Private Kontakte (bereich "privat") gehören allein ihrem Besitzer (kunden.verantwortlich_email):
// Er bearbeitet sie über den Assistenten wie jede andere Akte, für alle anderen — auch Geschäftsführung
// und Admins — gibt es sie nicht. Dasselbe gilt für private Objekte (objekte.privat_besitzer).
// Wie die Zeilenregeln der Datenbank (kunden/objekte, Vergleich ohne Groß-/Kleinschreibung).

export const SAMMELAKTEN: readonly string[] = ['k_intern_holding', 'k_eingang_ungeklaert']

export const BEREICH_IDS: readonly string[] = ['beratung', 'immobilien', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen']

const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat',
}

export type RechteMitarbeiter = { name?: string | null; email?: string | null; rolle?: string | null; ist_admin?: boolean | null; bereiche?: string[] | null }

/** Was für die Rechteprüfung einer Kundenakte gebraucht wird. Ohne verantwortlich_email ist eine private Akte für niemanden sichtbar. */
export type AkteFuerRechte = { id?: string | null; bereich?: string | null; verantwortlich_email?: string | null }

/** Adresse klein und ohne Leerraum; leer, wenn keine. */
export function adresse(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase()
}

/** Ist die Adresse die des Mitarbeiters? Fehlt eine der beiden, nie. */
export function istEigene(m: RechteMitarbeiter, email: string | null | undefined): boolean {
  const ich = adresse(m.email)
  return !!ich && adresse(email) === ich
}

/** Kundenakten-Schlüssel oder Bereichs-Kennung → Bereichs-Kennung ("immobilienkunden" → "immobilien"). */
export function bereichIdVon(bereich: string | null | undefined): string {
  const b = String(bereich ?? '').trim()
  return b === 'immobilienkunden' ? 'immobilien' : b
}

export function bereichName(bereich: string | null | undefined): string {
  const id = bereichIdVon(bereich)
  return BEREICH_NAME[id] ?? (id || 'unbekannt')
}

export function siehtAlleBereiche(m: RechteMitarbeiter): boolean {
  return m.rolle === 'geschaeftsfuehrung' || m.ist_admin === true
}

/** Darf der Mitarbeiter Akten dieses Bereichs sehen und ändern? Privat nie als ganzer Bereich (dafür gilt darfAkte mit dem Besitzer). */
export function darfBereich(m: RechteMitarbeiter, bereich: string | null | undefined): boolean {
  const id = bereichIdVon(bereich)
  if (id === 'privat') return false
  if (siehtAlleBereiche(m)) return true
  return BEREICH_IDS.includes(id) && (m.bereiche ?? []).includes(id)
}

/** Darf der Mitarbeiter diese Kundenakte sehen und ändern? Die Sammelakten immer, private Akten nur ihr Besitzer. */
export function darfAkte(m: RechteMitarbeiter, akte: AkteFuerRechte): boolean {
  if (akte.id && SAMMELAKTEN.includes(akte.id)) return true
  if (istPrivat(akte)) return istEigene(m, akte.verantwortlich_email)
  return darfBereich(m, akte.bereich)
}

/** Liegt die Akte im privaten Bereich (eines beliebigen Mitarbeiters)? */
export function istPrivat(akte: { bereich?: string | null } | null | undefined): boolean {
  return bereichIdVon(akte?.bereich) === 'privat'
}

/** Private Akte eines anderen: Für den Mitarbeiter gibt es sie nicht — Werkzeuge melden „nicht gefunden", nie „nicht freigegeben". */
export function istFremdePrivatakte(m: RechteMitarbeiter, akte: AkteFuerRechte): boolean {
  return istPrivat(akte) && !darfAkte(m, akte)
}

/** Immobilien-Objekte (der Holding) gehören zum Bereich Immobilien. */
export function darfObjekte(m: RechteMitarbeiter): boolean {
  return darfBereich(m, 'immobilien')
}

/** Darf der Mitarbeiter dieses Objekt sehen? Objekte der Holding mit Immobilien-Rechten, private Objekte nur ihr Besitzer. */
export function darfObjekt(m: RechteMitarbeiter, objekt: { privat_besitzer?: string | null }): boolean {
  if (adresse(objekt.privat_besitzer)) return istEigene(m, objekt.privat_besitzer)
  return darfObjekte(m)
}

/** Die Bereiche, die der Mitarbeiter sehen darf (Kennungen, in fester Reihenfolge). */
export function freigegebeneBereiche(m: RechteMitarbeiter): string[] {
  return BEREICH_IDS.filter((b) => darfBereich(m, b))
}

/** Hat der Mitarbeiter weniger als alle Bereiche? Nur dann muss der Assistent überhaupt etwas weglassen. */
export function istEingeschraenkt(m: RechteMitarbeiter): boolean {
  return freigegebeneBereiche(m).length < BEREICH_IDS.length
}

/** Werkzeug-Ergebnis, wenn eine Akte in einem nicht freigegebenen Bereich liegt. Nennt nur den Bereich, nie Namen oder Inhalte. */
export function nichtFreigegeben(bereich: string | null | undefined, mitarbeiterName?: string | null): string {
  const wer = mitarbeiterName ? mitarbeiterName : 'diesen Mitarbeiter'
  return `Nicht freigegeben: Der Bereich ${bereichName(bereich)} ist für ${wer} nicht freigegeben. Akten, Objekte und Unterlagen aus diesem Bereich kannst du für ihn weder ansehen noch ändern. Sag ihm das so, ohne Namen oder Einzelheiten aus diesem Bereich zu nennen; Zugriff gibt die Geschäftsführung.`
}
