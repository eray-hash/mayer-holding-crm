// „Neu im CRM“ (23.11.2026) — gemeinsamer Kern für die Seite /neuigkeiten (src/pages/neuigkeiten/Neuigkeiten.tsx),
// die Hinweise „Neu: …“ neben neuen Knöpfen (src/components/NeuHinweis.tsx), den wöchentlichen Tipp per Telegram
// (email-gateway/neuigkeitenTipp.ts) und das Assistent-Werkzeug (telegram-gateway/neuigkeitenWerkzeug.ts).
//
// Tabellen (SQL: scratchpad runde5/neuigkeiten/neuigkeiten.sql):
// - neuigkeiten: id (Text, sprechend, z. B. 'gespraechs-app'), datum, titel, text, bereiche[], link, telegram_beispiel,
//   rang (kleiner = wichtiger), aktiv.
// - neuigkeiten_gelesen: (email, schluessel) — schluessel = id einer Neuigkeit oder 'hinweis:<name>' für einen
//   weggeklickten Hinweis neben einem Knopf.
// - neuigkeiten_einstellung: je Mitarbeiter telegram_tipp (keine Zeile = an), schwerpunkte[], letzte_woche,
//   gesendete_tipps[].
//
// Reine Funktionen ohne Datenbank — Browser und Server nutzen dieselbe Datei.

export type Neuigkeit = {
  id: string
  datum: string
  titel: string
  text: string
  bereiche: string[]
  link: string | null
  telegram_beispiel: string | null
  rang: number
  aktiv: boolean
}

export type NeuigkeitPerson = {
  rolle?: string | null
  ist_admin?: boolean | null
  bereiche?: string[] | null
}

export const NEUIGKEIT_SPALTEN = 'id, datum, titel, text, bereiche, link, telegram_beispiel, rang, aktiv'

/** Schlüssel-Vorsatz für weggeklickte Hinweise neben Knöpfen (neuigkeiten_gelesen.schluessel). */
export const HINWEIS_VORSATZ = 'hinweis:'

/** Gruppen auf der Seite, in dieser Reihenfolge. 'alle' und 'geschaeftsfuehrung' sind keine Bereiche im Sinne
 *  der Rechte, sondern Zielgruppen. Die übrigen Kennungen sind die von mitarbeiter.bereiche. */
export const NEUIGKEIT_GRUPPEN: { id: string; label: string }[] = [
  { id: 'alle', label: 'Für alle' },
  { id: 'geschaeftsfuehrung', label: 'Geschäftsführung' },
  { id: 'immobilien', label: 'Immobilien' },
  { id: 'beratung', label: 'Unternehmensberatung' },
  { id: 'erben', label: 'Erben' },
  { id: 'betriebsuebergabe', label: 'Betriebsübergabe' },
  { id: 'betriebsformen', label: 'Betriebsformen' },
  { id: 'akademie', label: 'Akademie' },
  { id: 'finanzierungen', label: 'Finanzierungen' },
  { id: 'buecher', label: 'Bücher & Verlag' },
]

const ZIELGRUPPEN = new Set(['alle', 'geschaeftsfuehrung'])

export function gruppenName(id: string): string {
  return NEUIGKEIT_GRUPPEN.find((g) => g.id === id)?.label ?? id
}

export function istGeschaeftsfuehrung(p: NeuigkeitPerson | null | undefined): boolean {
  return !!p && (p.rolle === 'geschaeftsfuehrung' || p.ist_admin === true)
}

/** Gilt die Neuigkeit für diese Person? 'alle' immer; 'geschaeftsfuehrung' nur für Geschäftsführung und Admins;
 *  sonst ein gemeinsamer Bereich (Geschäftsführung und Admins haben alle Bereiche, wie darf_bereich). */
export function istRelevant(n: Pick<Neuigkeit, 'bereiche'>, p: NeuigkeitPerson | null | undefined): boolean {
  const ziel = Array.isArray(n.bereiche) ? n.bereiche : []
  if (ziel.length === 0 || ziel.includes('alle')) return true
  const gf = istGeschaeftsfuehrung(p)
  if (ziel.includes('geschaeftsfuehrung') && gf) return true
  const fachlich = ziel.filter((b) => !ZIELGRUPPEN.has(b))
  if (fachlich.length === 0) return false
  if (gf) return true
  const eigene = new Set(((p?.bereiche ?? []) as string[]).map((b) => (b === 'immobilienkunden' ? 'immobilien' : b)))
  return fachlich.some((b) => eigene.has(b))
}

/** Erste bekannte Gruppe der Neuigkeit — dort steht sie auf der Seite. */
export function hauptGruppe(n: Pick<Neuigkeit, 'bereiche'>): string {
  const ziel = Array.isArray(n.bereiche) ? n.bereiche : []
  for (const g of NEUIGKEIT_GRUPPEN) if (ziel[0] === g.id) return g.id
  return NEUIGKEIT_GRUPPEN.find((g) => ziel.includes(g.id))?.id ?? 'alle'
}

/** Reihenfolge: zuerst, was zu den eigenen Schwerpunkten passt, dann nach Rang, dann die neueste zuerst. */
export function sortiereNeuigkeiten<T extends Pick<Neuigkeit, 'bereiche' | 'rang' | 'datum' | 'id'>>(liste: T[], schwerpunkte: string[] = []): T[] {
  const sp = new Set(schwerpunkte)
  const passt = (n: T) => (sp.size > 0 && (n.bereiche ?? []).some((b) => sp.has(b)) ? 0 : 1)
  return [...liste].sort((a, b) =>
    passt(a) - passt(b) ||
    (Number(a.rang) || 0) - (Number(b.rang) || 0) ||
    String(b.datum).localeCompare(String(a.datum)) ||
    a.id.localeCompare(b.id)
  )
}

/** Adresse im CRM aus link: Seiten ('/partner') über das # der Seite, die Gesprächs-App ('./gespraech/') direkt. */
export function crmAdresse(basis: string, link: string | null | undefined): string {
  const b = basis.endsWith('/') ? basis : `${basis}/`
  const l = String(link ?? '').trim()
  if (!l) return `${b}#/neuigkeiten`
  if (/^https?:\/\//i.test(l)) return l
  if (l.startsWith('./')) return `${b}${l.slice(2)}`
  return `${b}#${l.startsWith('/') ? l : `/${l}`}`
}

/** Die Telegram-Nachricht „Tipp der Woche“ (reiner Text, Telegram ohne Formatierung). */
export function tippText(n: Pick<Neuigkeit, 'titel' | 'text' | 'link' | 'telegram_beispiel'>, basis: string, weitere: number): string {
  const zeilen = [
    `Tipp der Woche aus dem CRM: ${n.titel}`,
    '',
    n.text.trim(),
  ]
  if (n.telegram_beispiel && n.telegram_beispiel.trim()) zeilen.push('', `Hier bei mir geht es auch, zum Beispiel: „${n.telegram_beispiel.trim()}“`)
  if (n.link) zeilen.push('', `Im CRM: ${crmAdresse(basis, n.link)}`)
  zeilen.push(
    '',
    weitere > 0
      ? `Noch ${weitere === 1 ? 'eine weitere Neuigkeit' : `${weitere} weitere Neuigkeiten`} für dich: ${crmAdresse(basis, '/neuigkeiten')}`
      : `Alle Neuigkeiten: ${crmAdresse(basis, '/neuigkeiten')}`,
    'Diesen Tipp abschalten: auf der Seite „Neu im CRM“ den Haken entfernen oder mir „Tipp der Woche aus“ schreiben.',
  )
  return zeilen.join('\n')
}

/** Zeile aus der Datenbank in eine Neuigkeit (fehlende Felder mit Vorgaben). */
export function neuigkeitAusZeile(z: Record<string, unknown>): Neuigkeit {
  return {
    id: String(z.id ?? ''),
    datum: String(z.datum ?? '').slice(0, 10),
    titel: String(z.titel ?? ''),
    text: String(z.text ?? ''),
    bereiche: Array.isArray(z.bereiche) ? (z.bereiche as unknown[]).map(String) : [],
    link: typeof z.link === 'string' && z.link.trim() ? z.link.trim() : null,
    telegram_beispiel: typeof z.telegram_beispiel === 'string' && z.telegram_beispiel.trim() ? z.telegram_beispiel.trim() : null,
    rang: Number.isFinite(Number(z.rang)) ? Number(z.rang) : 50,
    aktiv: z.aktiv !== false,
  }
}
