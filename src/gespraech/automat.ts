// Zustandsautomat einer Aufnahme in der Gesprächs-App — rein, ohne Browser-Funktionen, damit er sich mit
// Deno prüfen lässt (src/gespraech/tests/automat.test.ts). Die Zeit kommt immer von außen (jetzt in ms),
// so ist die gemessene Dauer (ohne Pausen und Unterbrechungen) im Test genau nachrechenbar.
//
//   bereit ──einwilligung_zeigen──▶ einwilligung ──einwilligung_ok──▶ startet ──gestartet──▶ läuft
//      ▲                               │ abbrechen                      │ fehler            │ ▲
//      └───────────────────────────────┘                                ▼                   │ │ pause / weiter
//   zuruecksetzen ◀── beendet / fehler                                fehler           pausiert
//   läuft/pausiert ──unterbrechung──▶ unterbrochen ──fortsetzen──▶ startet
//   läuft/pausiert/unterbrochen ──beenden──▶ beendet
// Ungültige Übergänge lassen den Zustand unverändert (gleiches Objekt).

export type Phase = 'bereit' | 'einwilligung' | 'startet' | 'laeuft' | 'pausiert' | 'unterbrochen' | 'beendet' | 'fehler'

export type AutomatZustand = {
  phase: Phase
  /** Bereits gezählte Aufnahmezeit in ms (ohne den laufenden Abschnitt seit laeuftSeit). */
  aktivMs: number
  /** Seit wann (ms) die Aufnahme ohne Pause läuft; null, wenn nicht in Phase „läuft“. */
  laeuftSeit: number | null
  /** Grund einer Unterbrechung oder Fehlertext. */
  grund: string | null
}

export type AutomatEreignis =
  | { typ: 'einwilligung_zeigen' }
  | { typ: 'einwilligung_ok' }
  | { typ: 'abbrechen' }
  | { typ: 'gestartet'; jetzt: number }
  | { typ: 'pause'; jetzt: number }
  | { typ: 'weiter'; jetzt: number }
  | { typ: 'unterbrechung'; jetzt: number; grund: string }
  | { typ: 'fortsetzen' }
  | { typ: 'beenden'; jetzt: number }
  | { typ: 'fehler'; text: string; jetzt?: number }
  | { typ: 'zuruecksetzen' }

export const START: AutomatZustand = { phase: 'bereit', aktivMs: 0, laeuftSeit: null, grund: null }

/** Zählt die laufende Zeit bis jetzt ein und hält die Uhr an. */
function anhalten(z: AutomatZustand, jetzt: number): Pick<AutomatZustand, 'aktivMs' | 'laeuftSeit'> {
  const dazu = z.laeuftSeit === null ? 0 : Math.max(0, jetzt - z.laeuftSeit)
  return { aktivMs: z.aktivMs + dazu, laeuftSeit: null }
}

export function schritt(z: AutomatZustand, e: AutomatEreignis): AutomatZustand {
  switch (e.typ) {
    case 'einwilligung_zeigen':
      return z.phase === 'bereit' ? { ...START, phase: 'einwilligung' } : z
    case 'einwilligung_ok':
      return z.phase === 'einwilligung' ? { ...z, phase: 'startet', grund: null } : z
    case 'abbrechen':
      return z.phase === 'einwilligung' ? START : z
    case 'gestartet':
      return z.phase === 'startet' ? { ...z, phase: 'laeuft', laeuftSeit: e.jetzt, grund: null } : z
    case 'pause':
      return z.phase === 'laeuft' ? { ...z, ...anhalten(z, e.jetzt), phase: 'pausiert' } : z
    case 'weiter':
      return z.phase === 'pausiert' ? { ...z, phase: 'laeuft', laeuftSeit: e.jetzt } : z
    case 'unterbrechung':
      return z.phase === 'laeuft' || z.phase === 'pausiert' ? { ...z, ...anhalten(z, e.jetzt), phase: 'unterbrochen', grund: e.grund } : z
    case 'fortsetzen':
      return z.phase === 'unterbrochen' ? { ...z, phase: 'startet' } : z
    case 'beenden':
      return z.phase === 'laeuft' || z.phase === 'pausiert' || z.phase === 'unterbrochen' ? { ...z, ...anhalten(z, e.jetzt), phase: 'beendet' } : z
    case 'fehler':
      if (z.phase === 'bereit' || z.phase === 'beendet') return z
      return { ...z, ...anhalten(z, e.jetzt ?? z.laeuftSeit ?? 0), phase: z.phase === 'startet' && z.aktivMs > 0 ? 'unterbrochen' : 'fehler', grund: e.text }
    case 'zuruecksetzen':
      return z.phase === 'beendet' || z.phase === 'fehler' ? START : z
  }
}

/** Aufnahmezeit in ms bis jetzt (ohne Pausen). */
export function dauerMs(z: AutomatZustand, jetzt: number): number {
  return z.aktivMs + (z.laeuftSeit === null ? 0 : Math.max(0, jetzt - z.laeuftSeit))
}

/** Nimmt das Mikrofon gerade auf (oder ist pausiert, also noch belegt)? */
export function istAktiv(z: AutomatZustand): boolean {
  return z.phase === 'laeuft' || z.phase === 'pausiert' || z.phase === 'startet'
}

/** 00:00 bzw. 1:02:03 */
export function zeitText(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sek = s % 60
  const zwei = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${zwei(m)}:${zwei(sek)}` : `${zwei(m)}:${zwei(sek)}`
}
