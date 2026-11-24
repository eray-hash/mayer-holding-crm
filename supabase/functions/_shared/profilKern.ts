// Profil-Vollständigkeit der Mitarbeiter (Runde 5, 22.11.2026).
//
// Anlass: Kein Makler hatte eine Telefonnummer in „Mein Profil“ — die automatischen Immobilien-Mails
// (mail_vorlagen mv-immo-*, Platzhalter {{Makler-Telefon}}) ließen die Telefonzeile weg, der
// Kundenbereich zeigte keine Nummer, das Exposé keinen Telefon-Eintrag im Kasten „Ihr Ansprechpartner“.
//
// Gemeinsamer, reiner Kern für Oberfläche (Mein Profil, Heute), Telegram-Assistent (profilWerkzeuge.ts)
// und Server (kundenPortal.ts, exposeWerkzeuge.ts). Keine Deno-Importe — das Frontend importiert diese
// Datei direkt (wie aufgabenKern.ts).
//
// Daten:
//  - mitarbeiter.telefon / signatur_html (bestehend, eigene Zeile über update_my_profil bzw. Dienstschlüssel)
//  - mitarbeiter_profil (neu, id = mitarbeiter.id): mobil, position, profil_nachfrage, telefon_gefragt_am —
//    bewusst eigene Tabelle, keine neuen Spalten auf mitarbeiter (dort bräuchte jede Spalte GRANT SELECT).
//  - abteilung_eintraege id 'firmen_kontakt': { an, telefon, name } — Ersatz-Telefon, wenn ein Mitarbeiter
//    keine Nummer hat. Dieselbe Regel steckt in der Datenbank-Funktion firmen_telefon() (Mail-Platzhalter).

// deno-lint-ignore no-explicit-any
type Supa = any

export const FIRMEN_KONTAKT_ID = 'firmen_kontakt'
export const FIRMEN_TELEFON_STANDARD = '0176 209 671 39'
export const FIRMEN_NAME_STANDARD = 'Andreas Mayer Holding'

export type FirmenKontakt = { an: boolean; telefon: string; name: string }

/** Liest die Einstellungszeile (daten) robust; fehlt sie, gelten die Vorgaben. */
export function firmenKontaktAus(daten: unknown): FirmenKontakt {
  const d = daten && typeof daten === 'object' ? (daten as Record<string, unknown>) : {}
  const telefon = typeof d.telefon === 'string' && d.telefon.trim() ? d.telefon.trim() : FIRMEN_TELEFON_STANDARD
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : FIRMEN_NAME_STANDARD
  return { an: d.an !== false, telefon, name }
}

/** Die Ersatznummer, die eingesetzt wird — '' wenn der Ersatz abgeschaltet ist. */
export function firmenTelefonAus(k: FirmenKontakt): string {
  return k.an ? k.telefon : ''
}

export async function ladeFirmenKontakt(supabase: Supa): Promise<FirmenKontakt> {
  try {
    const { data } = await supabase.from('abteilung_eintraege').select('daten').eq('id', FIRMEN_KONTAKT_ID).maybeSingle()
    return firmenKontaktAus(data?.daten)
  } catch {
    return firmenKontaktAus(null)
  }
}

const sauber = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')

/** Wirksame Telefonnummer: eigene Nummer → Mobil → Firmennummer (falls an) → ''. */
export function wirksamesTelefon(telefon: unknown, mobil: unknown, firma: FirmenKontakt | null): string {
  return sauber(telefon) || sauber(mobil) || (firma ? firmenTelefonAus(firma) : '')
}

/**
 * Telefonnummer für Kunden-Ausgaben (Kundenbereich, Exposé) eines Mitarbeiters, gesucht nach id, E-Mail
 * oder Name (nur aktive). Unbekannter Mitarbeiter → Firmennummer. Dienstschlüssel-Client erwartet.
 */
export async function telefonFuerMitarbeiter(
  supabase: Supa,
  wer: { id?: string | null; email?: string | null; name?: string | null; telefon?: string | null },
  o: { fuerExpose?: boolean } = {},
): Promise<string> {
  const firma = await ladeFirmenKontakt(supabase)
  let id = sauber(wer.id)
  let telefon = sauber(wer.telefon)
  // Fürs Exposé wird der Mitarbeiter immer gesucht: Seine Einstellung „Telefonnummer im Exposé zeigen“ zählt.
  if (!id || !telefon || o.fuerExpose) {
    const { data } = await supabase.from('mitarbeiter').select('id, name, email, telefon').eq('aktiv', true)
    const alle = (data ?? []) as { id?: string; name?: string; email?: string; telefon?: string | null }[]
    const mail = sauber(wer.email).toLowerCase()
    const name = sauber(wer.name).toLowerCase()
    const m =
      (id && alle.find((x) => String(x.id) === id)) ||
      (mail && alle.find((x) => sauber(x.email).toLowerCase() === mail)) ||
      (name && alle.find((x) => sauber(x.name).toLowerCase() === name)) ||
      null
    if (m) {
      id = String(m.id)
      telefon = telefon || sauber(m.telefon)
    }
  }
  if (o.fuerExpose && id) {
    const { data } = await supabase.from('mitarbeiter_profil').select('*').eq('id', id).maybeSingle()
    // Ausgeschaltet: Firmennummer statt der eigenen (wie im Browser, src/lib/meinProfilZusatz.ts useExposeTelefon).
    if (data && (data as { telefon_im_expose?: boolean }).telefon_im_expose === false) return wirksamesTelefon('', '', firma)
  }
  if (telefon) return telefon
  let mobil = ''
  if (id) {
    const { data } = await supabase.from('mitarbeiter_profil').select('mobil').eq('id', id).maybeSingle()
    mobil = sauber(data?.mobil)
  }
  return wirksamesTelefon('', mobil, firma)
}

// ── Prüfen und Lücken ───────────────────────────────────────────────────────────────────────

/** Telefonnummer prüfen und vereinheitlichen (Leerzeichen); erlaubt Ziffern, + / - ( ) und Leerzeichen. */
export function pruefeTelefon(eingabe: unknown): { ok: true; wert: string } | { ok: false; grund: string } {
  const wert = sauber(eingabe).replace(/\s+/g, ' ')
  if (!wert) return { ok: true, wert: '' }
  if (wert.length > 30 || !/^\+?[\d\s/()-]+$/.test(wert)) return { ok: false, grund: 'Das sieht nicht wie eine Telefonnummer aus.' }
  const ziffern = wert.replace(/\D/g, '').length
  if (ziffern < 6 || ziffern > 16) return { ok: false, grund: 'Die Telefonnummer hat zu wenige oder zu viele Ziffern.' }
  return { ok: true, wert }
}

/** Sucht eine Telefonnummer in einer HTML-Signatur (für „aus Signatur übernehmen“); '' wenn keine. */
export function telefonAusSignatur(html: unknown): string {
  const text = sauber(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#43;|&plus;/gi, '+')
  // Zuerst Zeilen mit Kennwort (Tel., Telefon, Mobil, Handy, Fon), dann irgendeine längere Ziffernfolge.
  const muster = [
    /(?:tel(?:efon)?|mobil|handy|fon|phone)\.?\s*[:.]?\s*(\+?\d[\d\s/()-]{4,}\d)/i,
    /(\+?\d[\d\s/()-]{6,}\d)/,
  ]
  for (const m of muster) {
    for (const zeile of text.split('\n')) {
      const treffer = zeile.match(m)
      if (!treffer) continue
      const kandidat = treffer[1].trim().replace(/\s+/g, ' ')
      // Postleitzahl, Datum oder Steuernummer ausschließen: mindestens 7 Ziffern, keine Punkte.
      if (kandidat.replace(/\D/g, '').length < 7) continue
      const p = pruefeTelefon(kandidat)
      if (p.ok && p.wert) return p.wert
    }
  }
  return ''
}

export type ProfilStand = {
  telefon?: string | null
  mobil?: string | null
  signatur?: string | null
  position?: string | null
}

export type ProfilFeld = 'telefon' | 'signatur' | 'position'
export type ProfilLuecke = { feld: ProfilFeld; titel: string; warum: string; wichtig: boolean }

/** Signatur ohne Inhalt (nur Tags/Leerraum) zählt als leer. */
function signaturLeer(html: unknown): boolean {
  return !sauber(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()
}

/** Was im Profil fehlt und warum es wichtig ist (Reihenfolge: Wichtiges zuerst). */
export function profilLuecken(p: ProfilStand, firma: FirmenKontakt | null = null): ProfilLuecke[] {
  const aus: ProfilLuecke[] = []
  if (!sauber(p.telefon) && !sauber(p.mobil)) {
    const ersatz = firma ? firmenTelefonAus(firma) : ''
    aus.push({
      feld: 'telefon',
      titel: 'Deine Telefonnummer fehlt',
      warum:
        'Sie erscheint in automatischen Mails an Interessenten, im Kundenbereich und im Exposé.' +
        (ersatz ? ` Bis du sie einträgst, steht dort die Firmennummer ${ersatz}.` : ' Bis du sie einträgst, fehlt dort die Telefonzeile.'),
      wichtig: true,
    })
  }
  if (signaturLeer(p.signatur)) {
    aus.push({ feld: 'signatur', titel: 'Deine E-Mail-Signatur fehlt', warum: 'Sie steht unter jeder Mail, die du aus dem CRM verschickst.', wichtig: true })
  }
  if (!sauber(p.position)) {
    aus.push({
      feld: 'position',
      titel: 'Deine Funktion fehlt',
      warum: 'Zum Beispiel „Immobilienberater“ — damit Kunden und Kollegen wissen, wofür du zuständig bist.',
      wichtig: false,
    })
  }
  return aus
}

/** Anteil der ausgefüllten Angaben (Telefon, Signatur, Funktion) in Prozent. */
export function profilProzent(p: ProfilStand): number {
  const fehlend = profilLuecken(p).length
  return Math.round(((3 - fehlend) / 3) * 100)
}

/** Eine Signatur aus Klartext (Telegram) als sicheres HTML: Sonderzeichen maskiert, Zeilen mit <br>. */
export function signaturAusText(text: string): string {
  const maskiert = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return maskiert
    .split(/\r?\n/)
    .map((z) => z.trimEnd())
    .join('<br>')
    .trim()
}

/** Der Wortlaut der einmaligen Nachfrage im Telegram-Assistenten. */
export const TELEFON_NACHFRAGE =
  'Mir fehlt deine Telefonnummer für Mails an Kunden — magst du sie mir schicken? Sie steht dann in den automatischen Mails an Interessenten, im Kundenbereich und im Exposé.'
