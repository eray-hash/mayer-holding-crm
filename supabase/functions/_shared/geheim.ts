// Verschlüsselung von Geheimnissen, die in der Datenbank liegen müssen (Mail-Passwörter, Microsoft-Zugänge).
//
// AES-GCM mit zufälligem 12-Byte-Vorsatz; Ergebnis = Base64 aus Vorsatz + Geheimtext. Der Schlüssel wird
// aus dem Dienst-Schlüssel des Projekts abgeleitet und liegt nirgends in der Datenbank — wird der
// Dienst-Schlüssel getauscht, sind alle so gespeicherten Geheimnisse unlesbar (Postfächer und
// Microsoft-Konten müssen dann neu verbunden werden). Der Vorsatz im Ableitungstext ("mh-postfach-v1")
// bleibt aus Verträglichkeit mit den schon gespeicherten Postfach-Passwörtern so stehen.

async function schluessel(): Promise<CryptoKey> {
  const dienst = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!dienst) throw new Error('Fehlende Konfiguration: SUPABASE_SERVICE_ROLE_KEY')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mh-postfach-v1:${dienst}`))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function zuBase64(bytes: Uint8Array): string {
  let roh = ''
  for (const b of bytes) roh += String.fromCharCode(b)
  return btoa(roh)
}

export function vonBase64(text: string): Uint8Array {
  const roh = atob(text)
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  return bytes
}

export async function verschluessele(klartext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const geheim = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await schluessel(), new TextEncoder().encode(klartext)))
  const alles = new Uint8Array(iv.length + geheim.length)
  alles.set(iv)
  alles.set(geheim, iv.length)
  return zuBase64(alles)
}

export async function entschluessele(text: string): Promise<string> {
  const alles = vonBase64(text)
  const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: alles.slice(0, 12) }, await schluessel(), alles.slice(12))
  return new TextDecoder().decode(klar)
}

/** Zufällige Kennung (URL-sicher), z. B. für Anmelde-Vorgänge. */
export function zufallsKennung(bytes = 32): string {
  return zuBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
