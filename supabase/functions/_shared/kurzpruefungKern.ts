// Vorab-Kurzprüfung eines Immobilienobjekts (Papiervorlage Version 1 vom 14.04.26) — gemeinsamer Kern für das CRM
// (src/components/ObjektKurzpruefungBlatt.tsx, gleiche Zeilen) und den Assistenten (telegram-gateway/
// kurzpruefungWerkzeug.ts, Runde 6 vom 23.11.2026). Gespeichert wird in objekte.kurzpruefung, genau im Format des
// Browsers (Typ ObjektKurzpruefung in src/types/index.ts).
//
// Anlass: Bei 0 von 42 Objekten war die Kurzprüfung ausgefüllt — sie ging nur im Browser, das Team arbeitet fast nur
// per Telegram. Der Assistent fragt die Punkte jetzt der Reihe nach ab (PUNKTE), ein Punkt nach dem anderen.

/** Die Zeilen der Papiervorlage; jede hat die drei Spalten „Ist“, „Marktwert“ und „unser Ergebnis“. */
export const KURZPRUEFUNG_ZEILEN: readonly { id: string; label: string }[] = [
  { id: 'preis', label: 'Preis' },
  { id: 'preisProQm', label: 'Preis pro m²' },
  { id: 'lageMikro', label: 'Lage – unmittelbare Umgebung' },
  { id: 'lageMakro', label: 'Lage – Stadt/Region (A, B, C, D)' },
  { id: 'baujahr', label: 'Baujahr' },
  { id: 'zustand', label: 'Zustand' },
  { id: 'sanierung', label: 'Anstehende Sanierung' },
  { id: 'mieteProQm', label: 'Miete pro m²' },
  { id: 'vermietungsstand', label: 'Vermietungsstand' },
  { id: 'rendite', label: 'Rendite' },
  { id: 'kaufpreisfaktor', label: 'Kaufpreisfaktor' },
  { id: 'vermarktbarkeit', label: 'Vermarktbarkeit' },
  { id: 'sonstiges', label: 'Sonstiges' },
  { id: 'investorensicht', label: 'Investorensicht' },
]

export type KurzpruefungZelle = { ist: string; marktwert: string; ergebnis: string }

/** Wie ObjektKurzpruefung in src/types/index.ts. */
export type Kurzpruefung = {
  datum?: string
  zeilen: Record<string, KurzpruefungZelle>
  provisionProzent: string
  provisionBetrag: string
  verkaeuferBekannt: string
  direktesMandat: string
  offeneFragen: string
  gruendeDagegen: string[]
  gruendeDafuer: string[]
  prio?: 'A' | 'B' | 'C'
  prioBegruendung: string
  zeiterfordernis: string
  naechsteSchritte: string[]
}

export type ListenFeld = 'gruendeDagegen' | 'gruendeDafuer' | 'naechsteSchritte'
export type TextFeld = 'provisionProzent' | 'provisionBetrag' | 'verkaeuferBekannt' | 'direktesMandat' | 'offeneFragen' | 'prioBegruendung' | 'zeiterfordernis'

/** Ein Abfragepunkt: eine Zeile der Tabelle (drei Spalten), ein Textfeld, eine Liste (bis 4 Einträge) oder die Prio. */
export type Punkt =
  | { id: string; art: 'zeile'; frage: string }
  | { id: TextFeld; art: 'text'; frage: string }
  | { id: ListenFeld; art: 'liste'; frage: string }
  | { id: 'prio'; art: 'prio'; frage: string }

/** Reihenfolge der Abfrage — wie das Blatt von oben nach unten. */
export const PUNKTE: readonly Punkt[] = [
  ...KURZPRUEFUNG_ZEILEN.map((z) => ({ id: z.id, art: 'zeile' as const, frage: `${z.label}: Ist, Marktwert und unser Ergebnis?` })),
  { id: 'provisionProzent', art: 'text', frage: 'Provision in Prozent?' },
  { id: 'provisionBetrag', art: 'text', frage: 'Provision als Betrag in Euro?' },
  { id: 'verkaeuferBekannt', art: 'text', frage: 'Ist der Verkäufer bekannt (ja / nein / über wen)?' },
  { id: 'direktesMandat', art: 'text', frage: 'Direktes Mandat (ja / nein)?' },
  { id: 'offeneFragen', art: 'text', frage: 'Offene Fragen?' },
  { id: 'gruendeDagegen', art: 'liste', frage: 'Gründe gegen die Auftragsannahme (Probleme), bis zu vier?' },
  { id: 'gruendeDafuer', art: 'liste', frage: 'Gründe dafür (Vorteile), bis zu vier?' },
  { id: 'prio', art: 'prio', frage: 'Einstufung A, B oder C?' },
  { id: 'prioBegruendung', art: 'text', frage: 'Warum diese Einstufung?' },
  { id: 'zeiterfordernis', art: 'text', frage: 'Zeiterfordernis, grob (z. B. 20 Stunden über 6 Wochen)?' },
  { id: 'naechsteSchritte', art: 'liste', frage: 'Nächste Schritte, bis zu vier?' },
]

function text(w: unknown): string {
  return typeof w === 'string' ? w.trim() : w == null ? '' : String(w).trim()
}

/** Kaufpreis wie im Browser (fmtEUR: ganze Euro, deutsches Format). */
export function euroGanz(n: number): string {
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

/** Leeres Blatt wie im Browser (leer() in ObjektKurzpruefungBlatt.tsx): heutiges Datum, Kaufpreis als „Ist“. */
export function leereKurzpruefung(kaufpreis: number | null | undefined, heute: string): Kurzpruefung {
  const preis = Number(kaufpreis) > 0 ? euroGanz(Number(kaufpreis)) : ''
  return {
    datum: heute,
    zeilen: { preis: { ist: preis, marktwert: '', ergebnis: '' } },
    provisionProzent: '',
    provisionBetrag: '',
    verkaeuferBekannt: '',
    direktesMandat: '',
    offeneFragen: '',
    gruendeDagegen: ['', '', '', ''],
    gruendeDafuer: ['', '', '', ''],
    prioBegruendung: '',
    zeiterfordernis: '',
    naechsteSchritte: ['', '', '', ''],
  }
}

/** Liste immer mit genau vier Plätzen (wie im Browser). */
function vierPlaetze(l: unknown): string[] {
  const a = (Array.isArray(l) ? l : []).map(text).filter(Boolean).slice(0, 4)
  while (a.length < 4) a.push('')
  return a
}

/** Gespeicherten Wert in die volle Form bringen (fehlende Felder leer, Listen mit vier Plätzen). */
export function vervollstaendige(roh: unknown, kaufpreis: number | null | undefined, heute: string): Kurzpruefung {
  if (!roh || typeof roh !== 'object') return leereKurzpruefung(kaufpreis, heute)
  // deno-lint-ignore no-explicit-any
  const r = roh as any
  const zeilen: Record<string, KurzpruefungZelle> = {}
  for (const [id, z] of Object.entries((r.zeilen ?? {}) as Record<string, Partial<KurzpruefungZelle>>)) {
    zeilen[id] = { ist: text(z?.ist), marktwert: text(z?.marktwert), ergebnis: text(z?.ergebnis) }
  }
  const prio = r.prio === 'A' || r.prio === 'B' || r.prio === 'C' ? r.prio : undefined
  return {
    datum: text(r.datum) || undefined,
    zeilen,
    provisionProzent: text(r.provisionProzent),
    provisionBetrag: text(r.provisionBetrag),
    verkaeuferBekannt: text(r.verkaeuferBekannt),
    direktesMandat: text(r.direktesMandat),
    offeneFragen: text(r.offeneFragen),
    gruendeDagegen: vierPlaetze(r.gruendeDagegen),
    gruendeDafuer: vierPlaetze(r.gruendeDafuer),
    ...(prio ? { prio } : {}),
    prioBegruendung: text(r.prioBegruendung),
    zeiterfordernis: text(r.zeiterfordernis),
    naechsteSchritte: vierPlaetze(r.naechsteSchritte),
  }
}

/** Ist ein Punkt beantwortet? Zeile: mindestens eine Spalte außer dem vorbelegten Kaufpreis-„Ist“. */
export function beantwortet(kp: Kurzpruefung, p: Punkt): boolean {
  if (p.art === 'zeile') {
    const z = kp.zeilen[p.id]
    if (!z) return false
    return p.id === 'preis' ? !!(z.marktwert || z.ergebnis) : !!(z.ist || z.marktwert || z.ergebnis)
  }
  if (p.art === 'prio') return !!kp.prio
  if (p.art === 'liste') return kp[p.id].some(Boolean)
  return !!kp[p.id]
}

/** Offene Punkte in Reihenfolge. */
export function offenePunkte(kp: Kurzpruefung): Punkt[] {
  return PUNKTE.filter((p) => !beantwortet(kp, p))
}

/** Hat jemand die Kurzprüfung schon begonnen (mehr als das vorbelegte Datum und den Kaufpreis)? */
export function istBegonnen(roh: unknown): boolean {
  if (!roh || typeof roh !== 'object') return false
  const kp = vervollstaendige(roh, 0, '')
  return PUNKTE.some((p) => beantwortet(kp, p))
}

/** Kurzer Stand: „7 von 26 Punkten“. */
export function standText(kp: Kurzpruefung): string {
  const fertig = PUNKTE.length - offenePunkte(kp).length
  return `${fertig} von ${PUNKTE.length} Punkten`
}

export type Eingabe = { punkt: string; ist?: unknown; marktwert?: unknown; ergebnis?: unknown; wert?: unknown; liste?: unknown }

/**
 * Trägt Antworten ein (gibt ein neues Blatt zurück, verändert das alte nicht). Listen: neue Einträge kommen auf die
 * freien Plätze, höchstens vier; ersetzen=true ersetzt die Liste. Unbekannte Punkte landen in `fehler`.
 */
export function trageEin(alt: Kurzpruefung, eingaben: Eingabe[], o: { ersetzen?: boolean } = {}): { kp: Kurzpruefung; geaendert: string[]; fehler: string[] } {
  const kp: Kurzpruefung = structuredClone(alt)
  const geaendert: string[] = []
  const fehler: string[] = []
  for (const e of eingaben) {
    const id = text(e?.punkt)
    const p = PUNKTE.find((x) => x.id.toLowerCase() === id.toLowerCase())
    if (!p) {
      fehler.push(`unbekannter Punkt „${id}“`)
      continue
    }
    if (p.art === 'zeile') {
      const z = { ...(kp.zeilen[p.id] ?? { ist: '', marktwert: '', ergebnis: '' }) }
      let etwas = false
      for (const s of ['ist', 'marktwert', 'ergebnis'] as const) {
        if (e[s] === undefined || e[s] === null) continue
        z[s] = text(e[s]).slice(0, 300)
        etwas = true
      }
      // Nur „wert“ angegeben: gilt als „Ist“.
      if (!etwas && e.wert !== undefined && e.wert !== null) {
        z.ist = text(e.wert).slice(0, 300)
        etwas = true
      }
      if (etwas) {
        kp.zeilen[p.id] = z
        geaendert.push(p.id)
      }
      continue
    }
    if (p.art === 'prio') {
      const w = text(e.wert).toUpperCase()
      if (w === 'A' || w === 'B' || w === 'C') {
        kp.prio = w
        geaendert.push('prio')
      } else if (w === '' || w === '-' || w === '–') {
        delete kp.prio
        geaendert.push('prio')
      } else fehler.push(`Prio muss A, B oder C sein (nicht „${text(e.wert)}“)`)
      continue
    }
    if (p.art === 'liste') {
      const neu = (Array.isArray(e.liste) ? e.liste : e.wert !== undefined ? String(e.wert).split(/\s*;\s*|\n+/) : []).map(text).filter(Boolean)
      if (!neu.length) continue
      const basis = o.ersetzen ? [] : kp[p.id].filter(Boolean)
      kp[p.id] = vierPlaetze([...basis, ...neu])
      if (basis.length + neu.length > 4) fehler.push(`${p.id}: höchstens vier Einträge, der Rest wurde weggelassen`)
      geaendert.push(p.id)
      continue
    }
    if (e.wert === undefined || e.wert === null) continue
    kp[p.id] = text(e.wert).slice(0, 1000)
    geaendert.push(p.id)
  }
  return { kp, geaendert: [...new Set(geaendert)], fehler }
}

/** Ein Punkt in Klartext mit dem aktuellen Inhalt (für die Rückmeldung an den Mitarbeiter). */
export function punktInhalt(kp: Kurzpruefung, p: Punkt): string {
  const label = p.art === 'zeile' ? KURZPRUEFUNG_ZEILEN.find((z) => z.id === p.id)?.label ?? p.id : p.frage.replace(/\?.*$/, '').replace(/,.*$/, '')
  if (p.art === 'zeile') {
    const z = kp.zeilen[p.id]
    const t = [z?.ist && `Ist ${z.ist}`, z?.marktwert && `Marktwert ${z.marktwert}`, z?.ergebnis && `Ergebnis ${z.ergebnis}`].filter(Boolean)
    return `${label}: ${t.length ? t.join(' · ') : '—'}`
  }
  if (p.art === 'prio') return `Einstufung: ${kp.prio ?? '—'}`
  if (p.art === 'liste') {
    const l = kp[p.id].filter(Boolean)
    return `${label}: ${l.length ? l.join('; ') : '—'}`
  }
  return `${label}: ${kp[p.id] || '—'}`
}
