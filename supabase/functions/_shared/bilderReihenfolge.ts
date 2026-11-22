// Reihenfolge, Titelbild und Angaben je Foto einer Objektakte (Spalte objekte.bilder_reihenfolge, 22.11.2026).
// Gemeinsamer, reiner Kern für das CRM (src/components/ObjektBilderVerwalten.tsx, src/lib/exposeBilder.ts)
// und den Assistenten (telegram-gateway/fotoWerkzeuge.ts, Exposé in exposeWerkzeuge.ts) — ohne Datenbank,
// ohne Browser, damit es sich ohne Netz prüfen lässt.
//
// Form der Spalte: eine Liste von Einträgen in Anzeigereihenfolge, der erste ist das Titelbild:
//   [{ "id": "dok_…", "drehung": 90, "im_expose": false, "beschriftung": "Küche" }, …]
// - id: Kennung des Dokuments im Ordner „Bilder“ von objekte.dokumente.
// - drehung (optional): zusätzliche Drehung im Uhrzeigersinn (0/90/180/270) — AUF die Anzeige, wie der
//   Browser das Foto ohnehin zeigt (Ausrichtungs-Angabe der Kamera schon berücksichtigt). Deshalb wird
//   die Kamera-Angabe hier nie als Drehung gespeichert, sonst wäre das Foto doppelt gedreht.
// - im_expose (optional): false = Foto bleibt in der Akte, kommt aber nicht ins Exposé.
// - beschriftung (optional): kurzer Text zum Foto (z. B. „Wohnzimmer“).
// Auch eine schlichte Liste von Kennungen (["dok_1", "dok_2"]) wird gelesen.
//
// Regeln beim Lesen: Kennungen, die es im Ordner nicht (mehr) gibt (gelöscht, verschoben), werden
// übergangen. Fotos des Ordners ohne Eintrag folgen hinten, in der Reihenfolge des Ordners. Ohne jede
// Angabe gilt also die bisherige Ordner-Reihenfolge.

export type Drehung = 0 | 90 | 180 | 270

export type BildEintrag = {
  id: string
  drehung?: Drehung
  im_expose?: boolean
  beschriftung?: string
}

/** Höchstzahl der Einträge (eine Objektakte mit mehr Fotos ist nicht zu erwarten). */
export const MAX_EINTRAEGE = 300
export const MAX_BESCHRIFTUNG = 120

/** Grad → 0/90/180/270 (auch -90, 450 …); alles andere → 0. */
export function normaleDrehung(wert: unknown): Drehung {
  const n = typeof wert === 'number' ? wert : typeof wert === 'string' && wert.trim() !== '' ? Number(wert) : NaN
  if (!Number.isFinite(n) || Math.round(n) % 90 !== 0) return 0
  return ((((Math.round(n) % 360) + 360) % 360) as Drehung)
}

function sauberText(wert: unknown): string {
  return typeof wert === 'string' ? wert.replace(/\s+/g, ' ').trim().slice(0, MAX_BESCHRIFTUNG) : ''
}

/** Ein Eintrag ohne leere Angaben (Vorgaben werden nicht gespeichert). */
export function sauberEintrag(e: BildEintrag): BildEintrag {
  const aus: BildEintrag = { id: e.id }
  const d = normaleDrehung(e.drehung)
  if (d) aus.drehung = d
  if (e.im_expose === false) aus.im_expose = false
  const b = sauberText(e.beschriftung)
  if (b) aus.beschriftung = b
  return aus
}

/** Liest die Spalte tolerant: Liste von Einträgen oder Kennungen; doppelte Kennungen zählen einmal (die erste). */
export function leseReihenfolge(roh: unknown): BildEintrag[] {
  const liste = Array.isArray(roh) ? roh : []
  const gesehen = new Set<string>()
  const aus: BildEintrag[] = []
  for (const x of liste) {
    const id = typeof x === 'string' ? x.trim() : x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? String((x as { id: string }).id).trim() : ''
    if (!id || gesehen.has(id)) continue
    gesehen.add(id)
    aus.push(typeof x === 'string' ? { id } : sauberEintrag({ ...(x as BildEintrag), id }))
    if (aus.length >= MAX_EINTRAEGE) break
  }
  return aus
}

export type GeordnetesBild<T> = { dok: T; eintrag: BildEintrag }

/** Alle Fotos des Ordners in Anzeigereihenfolge (das erste = Titelbild), jedes mit seinem Eintrag. */
export function ordneBilder<T extends { id: string }>(bilder: T[], roh: unknown): GeordnetesBild<T>[] {
  const nachId = new Map(bilder.map((b) => [b.id, b]))
  const aus: GeordnetesBild<T>[] = []
  const drin = new Set<string>()
  for (const e of leseReihenfolge(roh)) {
    const dok = nachId.get(e.id)
    if (!dok) continue
    aus.push({ dok, eintrag: e })
    drin.add(e.id)
  }
  for (const b of bilder) if (!drin.has(b.id)) aus.push({ dok: b, eintrag: { id: b.id } })
  return aus
}

export type ExposeAuswahl<T> = { dok: T; drehung: Drehung; beschriftung: string }

/** Fotos fürs Exposé: Anzeigereihenfolge ohne die mit im_expose=false, höchstens `max`. Das erste wird Titelbild. */
export function exposeBilderAuswahl<T extends { id: string }>(bilder: T[], roh: unknown, max: number): ExposeAuswahl<T>[] {
  const grenze = Math.max(0, Math.floor(Number.isFinite(max) ? max : 0))
  return ordneBilder(bilder, roh)
    .filter((g) => g.eintrag.im_expose !== false)
    .slice(0, grenze)
    .map((g) => ({ dok: g.dok, drehung: normaleDrehung(g.eintrag.drehung), beschriftung: g.eintrag.beschriftung ?? '' }))
}

/** Drehung eines Fotos laut Reihenfolge (0, wenn nichts vermerkt). */
export function drehungVon(roh: unknown, id: string): Drehung {
  return normaleDrehung(leseReihenfolge(roh).find((e) => e.id === id)?.drehung)
}

/** Die zu speichernde Liste: genau ein Eintrag je Foto des Ordners, in Anzeigereihenfolge. */
export function vollstaendig<T extends { id: string }>(bilder: T[], roh: unknown): BildEintrag[] {
  return ordneBilder(bilder, roh).map((g) => sauberEintrag(g.eintrag))
}

/**
 * Neue Reihenfolge aus einer Liste von Kennungen; die Angaben je Foto (Drehung, Beschriftung, im Exposé)
 * kommen aus `frisch` (dem gerade gelesenen Stand), damit eine gleichzeitige Änderung eines Kollegen an
 * einem anderen Foto nicht verloren geht. Nicht genannte Fotos folgen hinten in ihrer bisherigen Reihenfolge.
 */
export function neueReihenfolge<T extends { id: string }>(bilder: T[], frisch: unknown, ids: string[]): BildEintrag[] {
  const bisher = ordneBilder(bilder, frisch)
  const nachId = new Map(bisher.map((g) => [g.dok.id, g.eintrag]))
  const aus: BildEintrag[] = []
  const drin = new Set<string>()
  for (const roh of ids) {
    const id = String(roh ?? '').trim()
    const e = nachId.get(id)
    if (!e || drin.has(id)) continue
    aus.push(sauberEintrag(e))
    drin.add(id)
  }
  for (const g of bisher) if (!drin.has(g.dok.id)) aus.push(sauberEintrag(g.eintrag))
  return aus
}

/** Setzt ein Foto an die erste Stelle (Titelbild). */
export function alsTitelbild<T extends { id: string }>(bilder: T[], frisch: unknown, id: string): BildEintrag[] {
  return neueReihenfolge(bilder, frisch, [id])
}

/** Verschiebt ein Foto um `um` Plätze (−1 = nach vorn). */
export function verschiebe<T extends { id: string }>(bilder: T[], frisch: unknown, id: string, um: number): BildEintrag[] {
  const ids = ordneBilder(bilder, frisch).map((g) => g.dok.id)
  const i = ids.indexOf(id)
  const j = i + Math.trunc(um)
  if (i < 0 || j < 0 || j >= ids.length || i === j) return vollstaendig(bilder, frisch)
  const [x] = ids.splice(i, 1)
  ids.splice(j, 0, x)
  return neueReihenfolge(bilder, frisch, ids)
}

/** Ändert die Angaben eines Fotos (nur die übergebenen); die Reihenfolge bleibt. */
export function aendereEintrag<T extends { id: string }>(bilder: T[], frisch: unknown, id: string, patch: Partial<Omit<BildEintrag, 'id'>>): BildEintrag[] {
  return ordneBilder(bilder, frisch).map((g) => (g.dok.id === id ? sauberEintrag({ ...g.eintrag, ...patch, id }) : sauberEintrag(g.eintrag)))
}

/** Dreht ein Foto um 90° weiter im Uhrzeigersinn (oder um `grad`). */
export function dreheWeiter<T extends { id: string }>(bilder: T[], frisch: unknown, id: string, grad = 90): BildEintrag[] {
  return aendereEintrag(bilder, frisch, id, { drehung: normaleDrehung(drehungVon(frisch, id) + grad) })
}

/** Hängt neue Fotos hinten an (z. B. nach einem Hochladen), in der übergebenen Reihenfolge. */
export function haengeAn<T extends { id: string }>(bilder: T[], frisch: unknown, neueIds: string[]): BildEintrag[] {
  const neu = new Set(neueIds)
  const ids = [...ordneBilder(bilder, frisch).map((g) => g.dok.id).filter((id) => !neu.has(id)), ...neueIds]
  return neueReihenfolge(bilder, frisch, ids)
}

/** Grad im Uhrzeigersinn, um die eine Ausrichtungs-Angabe (EXIF 1/3/6/8) ein Foto dreht; gespiegelte Werte → nächstliegende Drehung. */
export function gradAusAusrichtung(ausrichtung: number): Drehung {
  switch (ausrichtung) {
    case 3:
    case 4:
      return 180
    case 6:
    case 5:
      return 90
    case 8:
    case 7:
      return 270
    default:
      return 0
  }
}

/** Ausrichtungs-Angabe (1/3/6/8) für eine Gesamtdrehung im Uhrzeigersinn. */
export function ausrichtungAusGrad(grad: number): 1 | 3 | 6 | 8 {
  const d = normaleDrehung(grad)
  return d === 90 ? 6 : d === 180 ? 3 : d === 270 ? 8 : 1
}

/** Kamera-Ausrichtung plus zusätzliche Drehung → Ausrichtung, mit der das Foto gezeichnet wird. */
export function kombiniereAusrichtung(ausrichtung: number, drehung: number): 1 | 3 | 6 | 8 {
  return ausrichtungAusGrad(gradAusAusrichtung(ausrichtung) + normaleDrehung(drehung))
}
