// Echte Datei-Speicherung für Immobilien-Objekt-Dokumente im privaten Supabase-Storage-Bucket
// "objekt-dokumente" (siehe Migration vom 2026-11-02). Bewusst privat statt öffentlich — Grundbuch,
// Mieterlisten etc. enthalten echte personenbezogene/finanzielle Daten. `Dokument.url` speichert
// deshalb nicht direkt eine aufrufbare URL, sondern den Storage-Pfad — eine echte, zeitlich
// begrenzte Signed URL wird erst bei Bedarf (Klick zum Öffnen) erzeugt, siehe erzeugeDownloadUrl().
import { supabase } from './supabaseClient'
import { uid } from './dates'

const BUCKET = 'objekt-dokumente'

function formatiereGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function ladeObjektDokumentHoch(
  objektId: string,
  file: File,
): Promise<{ pfad: string; groesse: string }> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const pfad = `${objektId}/${uid('dok')}_${file.name}`
  const { error } = await supabase.storage.from(BUCKET).upload(pfad, file, { contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  return { pfad, groesse: formatiereGroesse(file.size) }
}

export async function erzeugeDownloadUrl(pfad: string): Promise<string> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 60 * 10)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function loescheObjektDokument(pfad: string): Promise<void> {
  if (!supabase) return
  await supabase.storage.from(BUCKET).remove([pfad])
}

// Upload für das öffentliche Eigentümer-Portal (PublicEigentuemerPortal.tsx): der Eigentümer ist
// nicht als Mitarbeiter eingeloggt und hätte ohne Weiteres keine Schreibrechte auf den privaten
// Bucket. Nutzt stattdessen einen Signed-Upload-Token, den emailGateway.ts (holeObjektUploadUrl)
// serverseitig mit dem Service-Role-Key erzeugt hat — der Token selbst erlaubt den Upload für genau
// diesen einen Pfad, unabhängig von der sonst geltenden "nur Mitarbeiter"-RLS-Policy.
export async function ladeAlsEigentuemerHoch(pfad: string, token: string, file: File): Promise<{ groesse: string }> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(pfad, token, file, { contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  return { groesse: formatiereGroesse(file.size) }
}

// Liest eine Datei als reinen Base64-String (ohne "data:...;base64,"-Präfix) für die
// KI-Dokumentenklassifizierung — Claude bekommt Bilder/PDFs als Base64 übergeben, siehe
// emailGateway.ts classifyObjektDokument.
export function leseAlsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('Datei konnte nicht gelesen werden.'))
    reader.readAsDataURL(file)
  })
}
