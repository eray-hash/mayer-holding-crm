// Mini-Testrahmen für die reinen Module der Gesprächs-App: läuft mit `deno test` (kein vitest im Projekt),
// ohne dass der Frontend-Typcheck (tsc -b) Deno kennen muss.
type DenoTest = { test: (name: string, f: () => void | Promise<void>) => void }

export const test = (name: string, f: () => void | Promise<void>): void => {
  const d = (globalThis as unknown as { Deno?: DenoTest }).Deno
  if (d) d.test(name, f)
}

export function gleich<T>(ist: T, soll: T, text = ''): void {
  const a = JSON.stringify(ist)
  const b = JSON.stringify(soll)
  if (a !== b) throw new Error(`${text ? text + ': ' : ''}erwartet ${b}, bekommen ${a}`)
}

export function wahr(wert: unknown, text = 'erwartet wahr'): void {
  if (!wert) throw new Error(text)
}
