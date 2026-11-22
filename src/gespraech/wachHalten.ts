// Bildschirm wach halten (Screen Wake Lock), solange aufgenommen wird. Das iPhone beendet die Aufnahme,
// sobald der Bildschirm sich sperrt — deshalb wichtig. Geht die App kurz in den Hintergrund, gibt der
// Browser die Sperre frei; beim Zurückkommen wird sie neu angefordert.

type Sperre = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void }

let sperre: Sperre | null = null
let gewuenscht = false

export function wachHaltenMoeglich(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

async function anfordern(): Promise<boolean> {
  if (!wachHaltenMoeglich() || document.visibilityState !== 'visible') return false
  try {
    const wl = (navigator as Navigator & { wakeLock: { request: (art: 'screen') => Promise<Sperre> } }).wakeLock
    sperre = await wl.request('screen')
    sperre.addEventListener?.('release', () => {
      sperre = null
    })
    return true
  } catch {
    sperre = null
    return false
  }
}

function beiSichtbarkeit(): void {
  if (gewuenscht && document.visibilityState === 'visible' && !sperre) void anfordern()
}

/** true, wenn der Bildschirm jetzt wach gehalten wird. */
export async function haltWach(): Promise<boolean> {
  gewuenscht = true
  document.addEventListener('visibilitychange', beiSichtbarkeit)
  return sperre ? true : await anfordern()
}

export async function lassSchlafen(): Promise<void> {
  gewuenscht = false
  document.removeEventListener('visibilitychange', beiSichtbarkeit)
  const s = sperre
  sperre = null
  await s?.release().catch(() => undefined)
}
