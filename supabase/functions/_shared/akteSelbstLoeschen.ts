// Darf ein Mitarbeiter ohne Geschäftsführungs-Rechte eine Holding-Akte selbst löschen? (Wunsch 25.11.2026:
// Ein Mitarbeiter hatte eine Testakte angelegt und konnte sie nicht wieder entfernen.)
//
// Regel — EINE Stelle für Telegram (kunde_loeschen) und CRM (LoeschenKundeButton.tsx); die Datenbank prüft dasselbe
// in darf_akte_selbst_loeschen() (supabase/sql/2026-11-25_akte_selbst_loeschen.sql):
//   - Er hat die Akte selbst angelegt: die älteste Verlaufszeile nennt ihn, oder er ist als verantwortlich eingetragen
//     (Name oder E-Mail).
//   - Die Akte ist frisch: die älteste Verlaufszeile ist höchstens 14 Tage alt (ohne Verlauf: nicht nachweisbar → nein).
//   - Es hängt nichts Kaufmännisches daran: keine Rechnungen (damit auch keine Zahlungen), keine Kostenvoranschläge,
//     keine Gesprächsprotokolle. Dokumente sind erlaubt und werden mitgelöscht.
//   - Nie die Sammelakten.
// Sonst bleibt es bei Geschäftsführung/Admin.

export const SELBST_LOESCHEN_TAGE = 14
const SAMMELAKTEN = ['k_intern_holding', 'k_eingang_ungeklaert']

export type SelbstLoeschenAkte = {
  id: string
  activities?: unknown
  verantwortlich?: string | null
  verantwortlich_email?: string | null
}

export type SelbstLoeschenAnhaenge = { rechnungen: number; kostenvoranschlaege: number; protokolle: number }

export type SelbstLoeschenErgebnis = { ok: true } | { ok: false; grund: string }

function klein(x: unknown): string {
  return String(x ?? '').trim().toLowerCase()
}

/** Älteste Verlaufszeile (nach Datum; ohne lesbares Datum die letzte der Liste, da neueste zuerst gespeichert wird). */
export function aeltesteVerlaufszeile(activities: unknown): { date?: string; user?: string } | null {
  if (!Array.isArray(activities) || activities.length === 0) return null
  const zeilen = activities.filter((a) => a && typeof a === 'object') as { date?: unknown; user?: unknown }[]
  if (zeilen.length === 0) return null
  let beste = zeilen[zeilen.length - 1]
  let besteZeit = Date.parse(String(beste.date ?? ''))
  for (const z of zeilen) {
    const t = Date.parse(String(z.date ?? ''))
    if (Number.isFinite(t) && (!Number.isFinite(besteZeit) || t < besteZeit)) {
      beste = z
      besteZeit = t
    }
  }
  return { date: beste.date ? String(beste.date) : undefined, user: beste.user ? String(beste.user) : undefined }
}

/** Nur Ersteller + Alter (ohne Anhänge) — damit das CRM den Knopf zeigen kann, bevor es die Anhänge zählt. */
export function istErstellerFrischerAkte(
  akte: SelbstLoeschenAkte,
  wer: { name?: string | null; email?: string | null },
  jetzt: Date = new Date(),
): SelbstLoeschenErgebnis {
  if (SAMMELAKTEN.includes(akte.id)) return { ok: false, grund: 'Die Sammelakten lassen sich nicht löschen.' }
  const erste = aeltesteVerlaufszeile(akte.activities)
  if (!erste) return { ok: false, grund: 'Die Akte hat keinen Verlauf, darum ist nicht nachweisbar, wer sie wann angelegt hat.' }
  const name = klein(wer.name)
  const email = klein(wer.email)
  const ersteller =
    (!!name && klein(erste.user) === name) ||
    (!!name && klein(akte.verantwortlich) === name) ||
    (!!email && klein(akte.verantwortlich_email) === email)
  if (!ersteller) return { ok: false, grund: 'Die Akte wurde nicht von dir angelegt.' }
  const t = Date.parse(String(erste.date ?? ''))
  if (!Number.isFinite(t)) return { ok: false, grund: 'Das Anlagedatum der Akte ist nicht lesbar.' }
  if (jetzt.getTime() - t > SELBST_LOESCHEN_TAGE * 24 * 60 * 60 * 1000) {
    return { ok: false, grund: `Die Akte ist älter als ${SELBST_LOESCHEN_TAGE} Tage.` }
  }
  return { ok: true }
}

/** Gesamte Regel: Ersteller, frisch und ohne Rechnungen/Kostenvoranschläge/Protokolle. */
export function darfAkteSelbstLoeschen(
  akte: SelbstLoeschenAkte,
  wer: { name?: string | null; email?: string | null },
  anhaenge: SelbstLoeschenAnhaenge,
  jetzt: Date = new Date(),
): SelbstLoeschenErgebnis {
  const basis = istErstellerFrischerAkte(akte, wer, jetzt)
  if (!basis.ok) return basis
  const daran: string[] = []
  if (anhaenge.rechnungen > 0) daran.push(`${anhaenge.rechnungen} Rechnung${anhaenge.rechnungen === 1 ? '' : 'en'}`)
  if (anhaenge.kostenvoranschlaege > 0) daran.push(`${anhaenge.kostenvoranschlaege} Kostenvoranschl${anhaenge.kostenvoranschlaege === 1 ? 'ag' : 'äge'}`)
  if (anhaenge.protokolle > 0) daran.push(`${anhaenge.protokolle} Protokoll${anhaenge.protokolle === 1 ? '' : 'e'}`)
  if (daran.length) return { ok: false, grund: `An der Akte hängen ${daran.join(', ')}.` }
  return { ok: true }
}
