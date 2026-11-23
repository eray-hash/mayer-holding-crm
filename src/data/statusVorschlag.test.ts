// npx -y deno test --no-check src/data/statusVorschlag.test.ts
// Prüft, dass die Kopie der Statusnetze für die Statusvorschläge auf dem Server
// (supabase/functions/_shared/statusVorschlagKern.ts) zu den Statusnetzen des CRM passt: gleiche Hauptpfade,
// gleiche Bezeichnungen, und jedes Ziel eines Ereignisses gibt es im Netz des Bereichs.
import { HAUPTPFADE, STATUS_NAMEN, ZIEL_JE_EREIGNIS } from '../../supabase/functions/_shared/statusVorschlagKern.ts'
import { getHauptpfad, getStatusMap } from './statusNetworks.ts'

type DenoTest = { test: (name: string, f: () => void) => void }
const test = (name: string, f: () => void): void => {
  const d = (globalThis as unknown as { Deno?: DenoTest }).Deno
  if (d) d.test(name, f)
}
function gleich<T>(ist: T, soll: T, text = ''): void {
  const a = JSON.stringify(ist)
  const b = JSON.stringify(soll)
  if (a !== b) throw new Error(`${text ? text + ': ' : ''}erwartet ${b}, bekommen ${a}`)
}

type Netz = Parameters<typeof getHauptpfad>[0]

test('Hauptpfade der Statusvorschläge = Hauptpfade im CRM', () => {
  for (const [netz, pfad] of Object.entries(HAUPTPFADE)) gleich(pfad, getHauptpfad(netz as Netz), netz)
})

test('Bezeichnungen der Statusvorschläge = Bezeichnungen im CRM', () => {
  for (const [netz, namen] of Object.entries(STATUS_NAMEN)) {
    const karte = getStatusMap(netz as Netz)
    for (const [id, name] of Object.entries(namen)) gleich(name, karte[id]?.label, `${netz}.${id}`)
  }
})

test('Jedes Ziel eines Ereignisses gibt es im Statusnetz und hat eine Bezeichnung', () => {
  for (const [ereignis, je] of Object.entries(ZIEL_JE_EREIGNIS)) {
    for (const [netz, ziel] of Object.entries(je)) {
      if (!getStatusMap(netz as Netz)[ziel]) throw new Error(`${ereignis}: ${netz}.${ziel} fehlt im Statusnetz`)
      if (!STATUS_NAMEN[netz]?.[ziel]) throw new Error(`${ereignis}: ${netz}.${ziel} fehlt in STATUS_NAMEN`)
    }
  }
})
