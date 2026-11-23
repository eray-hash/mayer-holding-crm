// npx -y deno test --no-check src/data/startStatus.test.ts
// Prüft, dass der Anfangsstatus neuer Akten auf dem Server (supabase/functions/_shared/startStatus.ts)
// zu den Statusnetzen des CRM passt. Fehlt ein Status im Netz des Bereichs, zeigt die Liste des
// Bereichs die Akte ohne Status an (vor dem 23.11.2026 brach sie dabei ganz ab).
import { START_STATUS, startStatusFuer } from '../../supabase/functions/_shared/startStatus.ts'
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

const BEREICHE = ['beratung', 'erben', 'betriebsuebergabe', 'betriebsformen', 'akademie', 'finanzierungen', 'immobilienkunden', 'privat'] as const

test('Anfangsstatus je Bereich = erster Schritt des Hauptpfads im CRM', () => {
  for (const b of BEREICHE) gleich(START_STATUS[b], getHauptpfad(b)[0], b)
})

test('Anfangsstatus existiert im Statusnetz des Bereichs', () => {
  for (const b of BEREICHE) {
    if (!getStatusMap(b)[startStatusFuer(b)]) throw new Error(`${b}: ${startStatusFuer(b)} fehlt im Statusnetz`)
  }
})

test('„lead“ gibt es nur in der Beratung — deshalb darf die Lead-Erkennung es nicht überall setzen', () => {
  for (const b of BEREICHE) gleich(!!getStatusMap(b).lead, b === 'beratung', b)
})
