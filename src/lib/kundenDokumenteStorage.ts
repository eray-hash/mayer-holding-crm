// Echte Datei-Speicherung für Kunden-/Mandanten-Dokumente im privaten Supabase-Storage-Bucket
// "kunden-dokumente" — Pendant zu objektDokumenteStorage.ts für Objekte. Bewusst privat statt
// öffentlich: Schufa-Auskünfte, Ausweiskopien, Gehaltsnachweise etc. enthalten echte
// personenbezogene/finanzielle Daten. `Dokument.url` speichert deshalb den Storage-Pfad, nicht
// direkt eine aufrufbare URL — eine zeitlich begrenzte Signed URL wird erst bei Bedarf (Klick zum
// Öffnen) erzeugt, siehe erzeugeKundenDownloadUrl(). Ältere Kunden-Dokumente aus zugeordneten
// E-Mail-Anhängen haben weiterhin eine direkte https-URL im öffentlichen "email-anhaenge"-Bucket —
// beide Formen bleiben gültig, siehe dokumentOeffnen() in DokumenteSection.tsx.
import { supabase } from './supabaseClient'
import { uid } from './dates'

const BUCKET = 'kunden-dokumente'

function formatiereGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function ladeKundenDokumentHoch(
  kundeId: string,
  file: File,
): Promise<{ pfad: string; groesse: string }> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const pfad = `${kundeId}/${uid('dok')}_${file.name}`
  const { error } = await supabase.storage.from(BUCKET).upload(pfad, file, { contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  return { pfad, groesse: formatiereGroesse(file.size) }
}

export async function erzeugeKundenDownloadUrl(pfad: string): Promise<string> {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pfad, 60 * 10)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

export async function loescheKundenDokument(pfad: string): Promise<void> {
  if (!supabase) return
  await supabase.storage.from(BUCKET).remove([pfad])
}
