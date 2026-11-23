// Verweise auf eine Kundenakte umhängen, die kunden_zusammenfuehren (telegram-gateway/pflegeWerkzeuge.ts,
// verweiseUmhaengen) noch nicht kennt (22.11.2026). Ohne diesen Schritt gingen beim Löschen der doppelten
// Akte Daten verloren — die Datenbank löscht per Fremdschlüssel MIT (ON DELETE CASCADE): wiedervorlagen,
// unterschrift_anfragen, partner_bezug, willkommen_nachrichten, kundenbericht_einstellung; oder setzt den
// Verweis auf leer (SET NULL): kostenvoranschlaege, seminar_anmeldungen, objekt_freigaben, objekt_anfragen,
// auto_nachrichten, partner.akte_id. Ohne Fremdschlüssel blieben verwaist: besichtigungen,
// kontoauszug_auswertungen, akte_umzug, mitarbeiter.telegram_last_kunde_id.
//
// Muss VOR dem Löschen laufen (also vor dem bestätigten Aufruf von kunden_zusammenfuehren). Eindeutige
// Regeln (z. B. eine offene Wiedervorlage je Akte und Regel, ein Willkommensbrief je Akte): Hat die
// bleibende Akte den Eintrag schon, bleibt der doppelte zurück und verschwindet mit der gelöschten Akte.
// Ohne Importe, damit Telegram-Assistent und email-gateway ihn gleich nutzen können.

// deno-lint-ignore no-explicit-any
type Db = any
// deno-lint-ignore no-explicit-any
type Zeile = Record<string, any>

/** [Tabelle, Spalte mit der Akten-id, Schlüsselspalte der Zeile] */
export const WEITERE_VERWEISE: readonly [string, string, string][] = [
  ['wiedervorlagen', 'kunde_id', 'id'],
  ['unterschrift_anfragen', 'kunde_id', 'id'],
  ['partner_bezug', 'kunde_id', 'id'],
  ['willkommen_nachrichten', 'kunde_id', 'id'],
  ['kundenbericht_einstellung', 'kunde_id', 'kunde_id'],
  ['kostenvoranschlaege', 'kunde_id', 'id'],
  ['seminar_anmeldungen', 'kunde_id', 'id'],
  ['objekt_freigaben', 'kunde_id', 'id'],
  ['objekt_anfragen', 'kunde_id', 'email_id'],
  ['auto_nachrichten', 'kunde_id', 'id'],
  ['partner', 'akte_id', 'id'],
  ['besichtigungen', 'kunde_id', 'id'],
  ['kontoauszug_auswertungen', 'kunde_id', 'id'],
  ['akte_umzug', 'kunde_id', 'id'],
  ['mitarbeiter', 'telegram_last_kunde_id', 'email'],
  ['gespraech_aufnahmen', 'kunde_id', 'id'],
]

export type UmhaengeErgebnis = { umgehaengt: Record<string, number>; uebersprungen: number; fehler: string[] }

function istDoppelt(e: { code?: string } | null): boolean {
  return e?.code === '23505'
}

function fehltTabelle(e: { code?: string; message?: string } | null): boolean {
  return e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|could not find the table/i.test(e?.message ?? '')
}

/** Hängt alle Zeilen der Liste WEITERE_VERWEISE von alteId auf neueId um. */
export async function weitereVerweiseUmhaengen(db: Db, alteId: string, neueId: string): Promise<UmhaengeErgebnis> {
  const aus: UmhaengeErgebnis = { umgehaengt: {}, uebersprungen: 0, fehler: [] }
  if (!alteId || !neueId || alteId === neueId) return aus
  for (const [tabelle, spalte, schluessel] of WEITERE_VERWEISE) {
    const { data, error } = await db.from(tabelle).update({ [spalte]: neueId }).eq(spalte, alteId).select(schluessel)
    if (!error) {
      const n = Array.isArray(data) ? data.length : 0
      if (n > 0) aus.umgehaengt[tabelle] = n
      continue
    }
    if (fehltTabelle(error)) continue
    if (!istDoppelt(error)) {
      aus.fehler.push(`${tabelle}: ${error.message}`)
      continue
    }
    // Eine eindeutige Regel greift: Zeile für Zeile, Doppelte bleiben zurück.
    const zeilen: Zeile[] = []
    let letzte: string | null = null
    for (let runde = 0; runde < 100; runde++) {
      let q = db.from(tabelle).select(schluessel).eq(spalte, alteId)
      if (letzte !== null) q = q.gt(schluessel, letzte)
      const { data: seite, error: e } = await q.order(schluessel, { ascending: true }).limit(1000)
      if (e) {
        aus.fehler.push(`${tabelle}: ${e.message}`)
        break
      }
      zeilen.push(...((seite ?? []) as Zeile[]))
      if ((seite ?? []).length < 1000) break
      letzte = String((seite as Zeile[])[(seite as Zeile[]).length - 1][schluessel])
    }
    for (const z of zeilen) {
      const { error: e } = await db.from(tabelle).update({ [spalte]: neueId }).eq(schluessel, z[schluessel])
      if (!e) aus.umgehaengt[tabelle] = (aus.umgehaengt[tabelle] ?? 0) + 1
      else if (istDoppelt(e)) aus.uebersprungen++
      else aus.fehler.push(`${tabelle}: ${e.message}`)
    }
  }
  return aus
}
