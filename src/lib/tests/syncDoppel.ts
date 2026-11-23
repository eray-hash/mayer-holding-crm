// Test-Doppel für zeilenSchreiben.ts: eine Datenbank im Speicher mit genau den Abfrage-Ketten, die das
// Speichern benutzt (upsert, update…eq…select, select…eq…maybeSingle, delete…in). Fehler lassen sich je
// Vorgang und Tabelle einschalten. Mini-Testrahmen wie src/gespraech/tests/hilfe.ts.

type DenoTest = { test: (name: string, f: () => void | Promise<void>) => void }

export const test = (name: string, f: () => void | Promise<void>): void => {
  const d = (globalThis as unknown as { Deno?: DenoTest }).Deno
  if (d) d.test(name, f)
}

export function gleich(ist: unknown, soll: unknown, text = ''): void {
  const a = JSON.stringify(ist)
  const b = JSON.stringify(soll)
  if (a !== b) throw new Error(`${text ? text + ': ' : ''}erwartet ${b}, bekommen ${a}`)
}

export function wahr(wert: unknown, text = 'erwartet wahr'): void {
  if (!wert) throw new Error(text)
}

export type Vorgang = 'upsert' | 'update' | 'select' | 'delete'
type Zeile = Record<string, unknown>

export class Datenbank {
  tabellen = new Map<string, Map<string, Zeile>>()
  aufrufe: { vorgang: Vorgang; tabelle: string; wert?: unknown }[] = []
  /** Liefert eine Fehlermeldung, wenn dieser Vorgang scheitern soll. */
  fehler: (vorgang: Vorgang, tabelle: string) => string | null = () => null

  tabelle(name: string): Map<string, Zeile> {
    let t = this.tabellen.get(name)
    if (!t) this.tabellen.set(name, (t = new Map()))
    return t
  }

  lege(name: string, zeile: Zeile): void {
    this.tabelle(name).set(String(zeile.id), structuredClone(zeile))
  }

  zeile(name: string, id: string): Zeile | undefined {
    return this.tabelle(name).get(id)
  }

  anzahl(vorgang: Vorgang): number {
    return this.aufrufe.filter((a) => a.vorgang === vorgang).length
  }

  client() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const db = this
    return {
      from(tabelle: string) {
        const t = db.tabelle(tabelle)
        const scheitert = (v: Vorgang) => {
          const m = db.fehler(v, tabelle)
          return m ? { message: m } : null
        }
        return {
          upsert(zeile: Zeile) {
            db.aufrufe.push({ vorgang: 'upsert', tabelle, wert: structuredClone(zeile) })
            const error = scheitert('upsert')
            if (!error) t.set(String(zeile.id), { ...(t.get(String(zeile.id)) ?? {}), ...structuredClone(zeile) })
            return Promise.resolve({ data: null, error })
          },
          update(aenderung: Zeile) {
            return {
              eq(_spalte: string, id: string) {
                return {
                  select(_spalten: string) {
                    db.aufrufe.push({ vorgang: 'update', tabelle, wert: structuredClone(aenderung) })
                    const error = scheitert('update')
                    if (error) return Promise.resolve({ data: null, error })
                    const alt = t.get(id)
                    if (!alt) return Promise.resolve({ data: [], error: null })
                    t.set(id, { ...alt, ...structuredClone(aenderung) })
                    return Promise.resolve({ data: [{ id }], error: null })
                  },
                }
              },
            }
          },
          select(spalten: string) {
            return {
              eq(_spalte: string, id: string) {
                return {
                  maybeSingle() {
                    db.aufrufe.push({ vorgang: 'select', tabelle, wert: spalten })
                    const error = scheitert('select')
                    if (error) return Promise.resolve({ data: null, error })
                    const z = t.get(id)
                    if (!z) return Promise.resolve({ data: null, error: null })
                    const felder = spalten.split(',').map((s) => s.trim())
                    return Promise.resolve({ data: Object.fromEntries(felder.map((f) => [f, structuredClone(z[f])])), error: null })
                  },
                }
              },
            }
          },
          delete() {
            return {
              in(_spalte: string, ids: string[]) {
                db.aufrufe.push({ vorgang: 'delete', tabelle, wert: ids })
                const error = scheitert('delete')
                if (!error) for (const id of ids) t.delete(id)
                return Promise.resolve({ data: null, error })
              },
            }
          },
        }
      },
    }
  }
}
