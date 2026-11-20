// Prüfung von Speicherpfaden, bevor der Server sie mit dem Dienstschlüssel liest (Prüfung vom
// 20.11.2026). Hintergrund: Die Verweise auf Dateien (kunden.dokumente[].url, objekte.dokumente[].url)
// schreibt auch der Browser. supabase-js setzt einen Pfad nur in die Adresse ein, und fetch löst
// "../" (auch als %2e%2e) auf — ein Eintrag wie "../../../../rest/v1/mitarbeiter" hätte so mit dem
// Dienstschlüssel andere Eimer, Tabellen oder Konten gelesen. Deshalb:
//  - nur bekannte Eimer;
//  - kein "." oder ".." als Pfadteil, kein führender "/", keine Zeichen ? # \ % und keine Steuerzeichen;
//  - fremde Internetadressen werden nie abgerufen, nur der eigene Speicher (gleicher Ursprung).

export const ERLAUBTE_EIMER = ['kunden-dokumente', 'email-anhaenge', 'postfach-anhaenge', 'objekt-dokumente', 'briefboegen'] as const

/** Ist der Pfad (bereits dekodiert) als Speicherpfad unbedenklich? */
export function istSichererPfad(pfad: string): boolean {
  if (typeof pfad !== 'string' || !pfad || pfad.length > 1024) return false
  if (pfad.startsWith('/') || /[?#\\%]/.test(pfad)) return false
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(pfad)) return false
  return pfad.split('/').every((teil) => teil !== '' && teil !== '.' && teil !== '..')
}

/** Wirft, wenn Eimer oder Pfad nicht unbedenklich sind; sonst den Pfad. */
export function pruefeSpeicherPfad(eimer: string, pfad: string): string {
  if (!(ERLAUBTE_EIMER as readonly string[]).includes(eimer) || !istSichererPfad(pfad)) {
    throw new Error('Der Verweis auf diese Datei ist ungültig. Sie lässt sich nicht laden.')
  }
  return pfad
}

/**
 * Zerlegt eine Adresse des eigenen Speichers (…/storage/v1/object/{public|sign|authenticated}/eimer/pfad)
 * in Eimer und dekodierten Pfad. null bei fremdem Ursprung, unbekanntem Eimer oder bedenklichem Pfad.
 */
export function eigenerSpeicher(url: string, basisUrl = Deno.env.get('SUPABASE_URL') ?? ''): { eimer: string; pfad: string } | null {
  let u: URL
  let basis: URL
  try {
    u = new URL(url)
    basis = new URL(basisUrl)
  } catch {
    return null
  }
  if (u.origin !== basis.origin) return null
  // Rohpfad (vor dem Auflösen von %2e%2e) prüfen: URL normalisiert "/../" bereits.
  const roh = String(url).slice(u.origin.length).split(/[?#]/)[0]
  const m = roh.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/)
  if (!m) return null
  let pfad: string
  try {
    pfad = decodeURIComponent(m[2])
  } catch {
    return null
  }
  if (!(ERLAUBTE_EIMER as readonly string[]).includes(m[1]) || !istSichererPfad(pfad)) return null
  return { eimer: m[1], pfad }
}
