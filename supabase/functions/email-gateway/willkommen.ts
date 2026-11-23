// Automatische Willkommensnachricht (Projekt-Checkliste Stufe 4, 20.11.2026).
//
// Die Datenbank merkt Nachrichten in `willkommen_nachrichten` vor (Auslöser wk_kunden, nur wenn der
// Schalter in `willkommen_einstellung` an ist). Diese Datei verschickt fällige Nachrichten:
//  - per Zeitplan (Aktion willkommen_versand, alle 5 Minuten) alle fälligen, solange der Schalter an ist;
//  - auf Knopfdruck eines Mitarbeiters („Jetzt senden“) eine einzelne.
// Jede Nachricht enthält einen Link zur Hochlade-Seite (/formular/unterlagen/:token); dafür wird wie
// beim „Unterlagen anfordern“ in der Akte eine Anforderung in kunden.unterlagen_anforderungen angelegt.
// Doppelt verschickt wird nie: Eine Nachricht wird vor dem Senden auf „gesendet“ gesetzt (nur wenn sie
// noch „geplant“ ist) und bei einem Fehler auf „fehler“.

export const WILLKOMMEN_VORLAGE_ID = 'mv-willkommen-auto'
const ERSATZ_BETREFF = 'Willkommen bei der Mayer Holding'
const ERSATZ_TEXT = `Guten Tag {{ansprechpartner}},

vielen Dank für Ihr Vertrauen und das Gespräch mit uns. Wir freuen uns, Sie bei Ihrem Anliegen zu begleiten.

{{ansprechpartner_satz}}
Bei Fragen antworten Sie einfach auf diese E-Mail.

Damit wir uns gut vorbereiten können, schicken Sie uns bitte Ihre Unterlagen über diesen Link. Das geht ohne Anmeldung:
{{link}}
Der Link ist 60 Tage gültig.

Mit freundlichen Grüßen
{{gruss}}
Mayer Holding`

const VERLOREN = new Set(['verloren', 'nicht_qualifiziert', 'abgebrochen'])
const ADRESSE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** 32 Zufallsbytes, base64url ohne Auffüllung (43 Zeichen) — wie neueKennung() im Browser. */
export function neuesToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function hochladeLink(basis: string, token: string): string {
  const b = basis.endsWith('/') ? basis : basis + '/'
  return `${b}#/formular/unterlagen/${token}`
}

/** Tagesdatum in Deutschland (JJJJ-MM-TT). */
export function heuteBerlin(jetzt = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt)
}

/** Setzt die Platzhalter ein; eine Zeile, die nur aus einem leeren Platzhalter bestand, fällt weg. */
export function fuelleWillkommen(text: string, w: { ansprechpartner: string; berater?: string; link: string }): string {
  const berater = (w.berater ?? '').trim()
  const werte: Record<string, string> = {
    ansprechpartner: w.ansprechpartner.trim() || 'Damen und Herren',
    firma: w.ansprechpartner.trim(),
    ansprechpartner_satz: berater ? `Ihr persönlicher Ansprechpartner ist ${berater}.` : '',
    berater: berater || 'Ihr Team der Mayer Holding',
    gruss: berater || 'Ihr Team der Mayer Holding',
    link: w.link,
  }
  return text
    .split('\n')
    .flatMap((zeile) => {
      const leer = /^\s*\{\{\s*([a-z_]+)\s*\}\}\s*$/.exec(zeile)
      if (leer && werte[leer[1]] === '') return []
      return [zeile.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, name: string) => (name in werte ? werte[name] : m))]
    })
    .join('\n')
}

type Absenden = (to: string, subject: string, text: string, html?: string) => Promise<void>

export type VersandErgebnis = { gesendet: number; uebersprungen: number; fehler: number; meldungen: string[] }

// deno-lint-ignore no-explicit-any
type Admin = any

/** Verschickt eine einzelne vorgemerkte Nachricht (Zeile aus willkommen_nachrichten). */
// deno-lint-ignore no-explicit-any
async function versendeEine(admin: Admin, zeile: any, absenden: Absenden, basis: string, vorlage: { betreff: string; text: string }): Promise<'gesendet' | 'uebersprungen' | 'fehler'> {
  const { data: k } = await admin
    .from('kunden')
    .select('id, bereich, status, email, firma, ansprechpartner, verantwortlich')
    .eq('id', zeile.kunde_id)
    .maybeSingle()
  const setze = (felder: Record<string, unknown>) => admin.from('willkommen_nachrichten').update(felder).eq('id', zeile.id)
  if (!k) {
    await setze({ status: 'abgebrochen', grund: 'Akte gibt es nicht mehr' })
    return 'uebersprungen'
  }
  if (VERLOREN.has(String(k.status))) {
    await setze({ status: 'abgebrochen', grund: 'Fall ist nicht mehr offen' })
    return 'uebersprungen'
  }
  const an = String(k.email ?? '').trim()
  if (!ADRESSE.test(an)) {
    await setze({ status: 'ohne_adresse', grund: 'Keine gültige E-Mail-Adresse in der Akte' })
    return 'uebersprungen'
  }
  // Erst beanspruchen, dann senden: so geht dieselbe Nachricht nie zweimal raus.
  const { data: beansprucht } = await admin
    .from('willkommen_nachrichten')
    .update({ status: 'gesendet', gesendet_am: new Date().toISOString(), an })
    .eq('id', zeile.id)
    .eq('status', 'geplant')
    .select('id')
  if (!beansprucht || beansprucht.length === 0) return 'uebersprungen'

  const name = String(k.ansprechpartner || k.firma || '').trim()
  const berater = String(k.verantwortlich ?? '').trim()
  const token = neuesToken()
  const link = hochladeLink(basis, token)
  const text = fuelleWillkommen(vorlage.text, { ansprechpartner: name, berater, link })
  const betreff = fuelleWillkommen(vorlage.betreff, { ansprechpartner: name, berater, link })
  const heute = heuteBerlin()

  // Die Anforderung muss stehen, bevor der Kunde den Link öffnen kann.
  const { data: frisch } = await admin.from('kunden').select('unterlagen_anforderungen').eq('id', k.id).maybeSingle()
  const alteAnf = Array.isArray(frisch?.unterlagen_anforderungen) ? frisch.unterlagen_anforderungen : []
  const anforderung = {
    id: `kanf_${crypto.randomUUID().slice(0, 11)}`,
    datum: heute,
    an,
    anName: name || undefined,
    von: berater || 'Mayer Holding',
    punkte: [],
    art: 'anforderung',
    token,
  }
  const { error: anfFehler } = await admin.from('kunden').update({ unterlagen_anforderungen: [anforderung, ...alteAnf] }).eq('id', k.id)
  if (anfFehler) {
    // Nichts ging raus: gesendet_am wieder leeren (wie beim Versandfehler), sonst steht „fehler“ mit Sendezeit da.
    await setze({ status: 'fehler', gesendet_am: null, grund: `Link zum Hochladen ließ sich nicht anlegen: ${anfFehler.message}` })
    return 'fehler'
  }

  try {
    await absenden(an, betreff, text)
  } catch (err) {
    await setze({ status: 'fehler', gesendet_am: null, grund: `Versand fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` })
    return 'fehler'
  }

  await admin.from('gesendete_emails').insert({
    an,
    an_name: name || an,
    betreff,
    text,
    kunde_bereich: k.bereich,
    kunde_id: k.id,
    kunde_name: name || null,
    von: Deno.env.get('SMTP_USER') ?? null,
    quelle: 'willkommen',
  })
  const { data: nachher } = await admin.from('kunden').select('activities').eq('id', k.id).maybeSingle()
  const verlauf = Array.isArray(nachher?.activities) ? nachher.activities : []
  await admin
    .from('kunden')
    .update({
      activities: [
        { id: crypto.randomUUID(), date: heute, text: `Willkommensnachricht automatisch gesendet an ${an}, mit Link zum Hochladen von Unterlagen`, user: 'automatisch' },
        ...verlauf,
      ],
      letzte_aktivitaet: heute,
    })
    .eq('id', k.id)
  return 'gesendet'
}

async function ladeVorlage(admin: Admin): Promise<{ betreff: string; text: string }> {
  const { data } = await admin.from('mail_vorlagen').select('betreff, text').eq('id', WILLKOMMEN_VORLAGE_ID).maybeSingle()
  return { betreff: data?.betreff?.trim() || ERSATZ_BETREFF, text: data?.text?.trim() ? data.text : ERSATZ_TEXT }
}

/**
 * Verschickt fällige Nachrichten. Ohne kundeId: alle fälligen (höchstens 20 je Lauf), nur wenn der Schalter an ist.
 * Mit kundeId („Jetzt senden“): nur diese, sofort — auch bei ausgeschaltetem Schalter, weil ein Mitarbeiter es auslöst.
 */
export async function versendeWillkommen(admin: Admin, absenden: Absenden, opts: { kundeId?: string } = {}): Promise<VersandErgebnis> {
  const ergebnis: VersandErgebnis = { gesendet: 0, uebersprungen: 0, fehler: 0, meldungen: [] }
  const { data: e } = await admin.from('willkommen_einstellung').select('aktiv, link_basis').eq('id', 1).maybeSingle()
  if (!opts.kundeId && !e?.aktiv) {
    ergebnis.meldungen.push('Automatische Willkommensnachricht ist ausgeschaltet.')
    return ergebnis
  }
  const basis = String(e?.link_basis || 'https://eray-hash.github.io/mayer-holding-crm/')
  let abfrage = admin.from('willkommen_nachrichten').select('*').eq('status', 'geplant')
  abfrage = opts.kundeId ? abfrage.eq('kunde_id', opts.kundeId) : abfrage.lte('senden_ab', new Date().toISOString()).order('senden_ab', { ascending: true }).limit(20)
  const { data: zeilen, error } = await abfrage
  if (error) throw new Error(`Vorgemerkte Willkommensnachrichten ließen sich nicht lesen: ${error.message}`)
  if (!zeilen || zeilen.length === 0) {
    if (opts.kundeId) ergebnis.meldungen.push('Für diese Akte ist keine Willkommensnachricht vorgemerkt.')
    return ergebnis
  }
  const vorlage = await ladeVorlage(admin)
  for (const z of zeilen) {
    const r = await versendeEine(admin, z, absenden, basis, vorlage)
    if (r === 'gesendet') ergebnis.gesendet++
    else if (r === 'fehler') ergebnis.fehler++
    else ergebnis.uebersprungen++
  }
  return ergebnis
}
