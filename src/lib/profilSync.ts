import { supabase } from './supabaseClient'

// Schreibt telefon/signaturHtml/fotoDataUrl/buchungslink für den gerade eingeloggten Mitarbeiter in
// dessen eigene mitarbeiter-Zeile — über eine SECURITY-DEFINER-Funktion, da die normale
// mitarbeiter-UPDATE-Policy auf Geschäftsführung beschränkt ist (rolle/bereiche/ist_admin dürfen
// Mitarbeiter nicht selbst ändern) und die Funktion serverseitig garantiert nur diese vier Felder
// der eigenen Zeile anfasst, unabhängig davon, was der Client sonst übergibt.
export async function updateMyProfilRemote(
  telefon: string,
  signaturHtml: string,
  fotoDataUrl: string | undefined,
  buchungslink: string | undefined,
): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.rpc('update_my_profil', {
    p_telefon: telefon || null,
    p_signatur_html: signaturHtml || null,
    p_foto_data_url: fotoDataUrl || null,
    p_buchungslink: buchungslink || null,
  })
  if (error) throw new Error(error.message)
}
