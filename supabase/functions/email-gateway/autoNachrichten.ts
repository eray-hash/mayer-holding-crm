// Automatische Nachrichten der Immobilien-Abteilung (21.11.2026, Eray: „vorgefertigte automatische
// Nachrichten nach bestimmten Ereignissen“).
//
// Die Datenbank merkt Nachrichten in `auto_nachrichten` vor (Auslöser an_besichtigungen und an_freigaben,
// nur wenn die Regel in `auto_nachricht_regeln` an ist, nie für private Objekte). Der Text wird dabei schon
// zusammengesetzt (Vorschau) und direkt vor dem Senden noch einmal frisch (Funktion auto_nachricht_bauen),
// damit ein verschobener Termin oder eine geänderte Vorlage stimmt. Diese Datei verschickt fällige Nachrichten:
//  - im Minutentakt (termin_erinnerungen) alle fälligen, deren Regel an ist;
//  - auf Knopfdruck eines Mitarbeiters („Jetzt senden“) eine einzelne.
// Wie bei der Willkommensnachricht: erst beanspruchen (geplant → gesendet), dann senden; bei einem Fehler
// „fehler“. So geht keine Nachricht zweimal hinaus.

type Absenden = (to: string, subject: string, text: string, html?: string) => Promise<void>

export type AutoVersandErgebnis = { gesendet: number; uebersprungen: number; fehler: number; meldungen: string[] }

// deno-lint-ignore no-explicit-any
type Admin = any

const ADRESSE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TAG_MS = 24 * 60 * 60 * 1000

/** In welchem Stand muss die Besichtigung sein, damit die Nachricht noch passt? */
const BESICHTIGUNG_STAND: Record<string, { status: string; zukunft?: boolean; hoechstensTageDanach?: number; angebot?: boolean }> = {
  immo_besichtigung_bestaetigung: { status: 'geplant', zukunft: true },
  immo_besichtigung_erinnerung: { status: 'geplant', zukunft: true },
  immo_besichtigung_danke: { status: 'durchgefuehrt', hoechstensTageDanach: 7 },
  immo_besichtigung_absage: { status: 'abgesagt' },
  immo_besichtigung_angebot: { status: '', angebot: true },
}

const STATUS_NAME: Record<string, string> = { geplant: 'geplant', durchgefuehrt: 'durchgeführt', abgesagt: 'abgesagt', nicht_erschienen: 'nicht erschienen' }

/** Passt der Anlass noch? Liefert den Grund, warum nicht — oder null. */
// deno-lint-ignore no-explicit-any
export async function pruefeAnlass(admin: Admin, zeile: any, jetzt = Date.now()): Promise<string | null> {
  if (zeile.objekt_id) {
    const { data: o } = await admin.from('objekte').select('id, privat_besitzer').eq('id', zeile.objekt_id).maybeSingle()
    if (!o) return 'Objekt gibt es nicht mehr'
    if (o.privat_besitzer) return 'Objekt ist privat'
  }
  const stand = BESICHTIGUNG_STAND[zeile.regel]
  if (stand) {
    if (!zeile.besichtigung_id) return 'Besichtigung gibt es nicht mehr'
    const { data: b } = await admin.from('besichtigungen').select('id, status, beginn, angebot').eq('id', zeile.besichtigung_id).maybeSingle()
    if (!b) return 'Besichtigung gibt es nicht mehr'
    if (stand.status && b.status !== stand.status) return `Besichtigung steht jetzt auf „${STATUS_NAME[b.status] ?? b.status}“`
    const beginn = new Date(b.beginn).getTime()
    if (stand.zukunft && !(beginn > jetzt)) return 'Termin ist schon vorbei'
    if (stand.hoechstensTageDanach && jetzt - beginn > stand.hoechstensTageDanach * TAG_MS) return 'Besichtigung liegt zu lange zurück'
    if (stand.angebot && (b.angebot === null || b.angebot === undefined)) return 'Kaufpreisangebot wurde entfernt'
    return null
  }
  if (zeile.regel === 'immo_portal_zustimmung') {
    if (!zeile.freigabe_id) return 'Zugang zum Portal gibt es nicht mehr'
    const { data: f } = await admin.from('objekt_freigaben').select('id, status, widerrufen_am').eq('id', zeile.freigabe_id).maybeSingle()
    if (!f) return 'Zugang zum Portal gibt es nicht mehr'
    if (f.status === 'widerrufen' || f.widerrufen_am) return 'Zugang zum Portal wurde beendet'
    if (f.status !== 'zugestimmt') return 'Zustimmung liegt nicht mehr vor'
    return null
  }
  return 'Unbekannte Regel'
}

const heuteBerlin = (jetzt = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(jetzt)

/** Verschickt eine einzelne vorgemerkte Nachricht (Zeile aus auto_nachrichten). */
// deno-lint-ignore no-explicit-any
async function versendeEine(admin: Admin, zeile: any, regel: any, absenden: Absenden, vonHand: boolean): Promise<'gesendet' | 'uebersprungen' | 'fehler'> {
  const setze = (felder: Record<string, unknown>) => admin.from('auto_nachrichten').update(felder).eq('id', zeile.id).eq('status', 'geplant')
  if (!regel) {
    await setze({ status: 'abgebrochen', grund: 'Regel gibt es nicht mehr' })
    return 'uebersprungen'
  }
  if (!vonHand && !regel.aktiv) {
    await setze({ status: 'abgebrochen', grund: 'Regel wurde ausgeschaltet' })
    return 'uebersprungen'
  }
  const grund = await pruefeAnlass(admin, zeile)
  if (grund) {
    await setze({ status: 'abgebrochen', grund })
    return 'uebersprungen'
  }
  // Frisch zusammensetzen: Termin, Adresse und Vorlage können sich seit dem Vormerken geändert haben.
  const { data: m, error: bauFehler } = await admin.rpc('auto_nachricht_bauen', {
    p_regel: zeile.regel,
    p_besichtigung: zeile.besichtigung_id ?? null,
    p_freigabe: zeile.freigabe_id ?? null,
  })
  if (bauFehler || !m) {
    await setze({ status: 'fehler', grund: `Nachricht ließ sich nicht zusammensetzen${bauFehler ? `: ${bauFehler.message}` : ''}` })
    return 'fehler'
  }
  if (m.privat) {
    await setze({ status: 'abgebrochen', grund: 'Objekt ist privat' })
    return 'uebersprungen'
  }
  if (m.hindernis) {
    await setze({ status: 'fehler', grund: String(m.hindernis) })
    return 'fehler'
  }
  const an = String(m.an ?? '').trim()
  if (!ADRESSE.test(an)) {
    await setze({ status: 'ohne_adresse', grund: 'Keine gültige E-Mail-Adresse beim Interessenten' })
    return 'uebersprungen'
  }
  const betreff = String(m.betreff ?? regel.titel ?? '').trim()
  const text = String(m.text ?? '')
  const anName = String(m.an_name ?? '').trim()

  // Erst beanspruchen, dann senden: so geht dieselbe Nachricht nie zweimal raus.
  const { data: beansprucht } = await admin
    .from('auto_nachrichten')
    .update({ status: 'gesendet', gesendet_am: new Date().toISOString(), an, an_name: anName || null, betreff, text, grund: null })
    .eq('id', zeile.id)
    .eq('status', 'geplant')
    .select('id')
  if (!beansprucht || beansprucht.length === 0) return 'uebersprungen'

  try {
    await absenden(an, betreff, text)
  } catch (err) {
    await admin
      .from('auto_nachrichten')
      .update({ status: 'fehler', gesendet_am: null, grund: `Versand fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}` })
      .eq('id', zeile.id)
    return 'fehler'
  }

  const kundeId = m.kunde_id ?? zeile.kunde_id ?? null
  await admin.from('gesendete_emails').insert({
    an,
    an_name: anName || an,
    betreff,
    text,
    kunde_bereich: kundeId ? 'immobilienkunden' : null,
    kunde_id: kundeId,
    kunde_name: anName || null,
    von: Deno.env.get('SMTP_USER') ?? null,
    quelle: `auto:${zeile.regel}`,
  })

  const heute = heuteBerlin()
  const eintrag = `Automatische Nachricht „${regel.titel}“ gesendet an ${an}${vonHand ? ' (von Hand ausgelöst)' : ''}`
  const objektId = m.objekt_id ?? zeile.objekt_id
  if (objektId) {
    const { data: o } = await admin.from('objekte').select('activities').eq('id', objektId).maybeSingle()
    if (o) {
      const verlauf = Array.isArray(o.activities) ? o.activities : []
      await admin.from('objekte').update({ activities: [{ id: `act_${crypto.randomUUID().slice(0, 10)}`, date: heute, text: eintrag, user: 'automatisch' }, ...verlauf] }).eq('id', objektId)
    }
  }
  if (kundeId) {
    const { data: k } = await admin.from('kunden').select('activities').eq('id', kundeId).maybeSingle()
    if (k) {
      const verlauf = Array.isArray(k.activities) ? k.activities : []
      await admin
        .from('kunden')
        .update({ activities: [{ id: crypto.randomUUID(), date: heute, text: eintrag, user: 'automatisch' }, ...verlauf], letzte_aktivitaet: heute })
        .eq('id', kundeId)
    }
  }
  return 'gesendet'
}

/**
 * Verschickt fällige Nachrichten. Ohne id: alle fälligen (höchstens 20 je Lauf); ist die Regel inzwischen
 * aus, wird die fällige Nachricht abgebrochen. Mit id („Jetzt senden“): nur diese, sofort — auch bei
 * ausgeschalteter Regel, weil ein Mitarbeiter es auslöst; der Anlass wird trotzdem geprüft.
 */
export async function versendeAutoNachrichten(admin: Admin, absenden: Absenden, opts: { id?: string } = {}): Promise<AutoVersandErgebnis> {
  const ergebnis: AutoVersandErgebnis = { gesendet: 0, uebersprungen: 0, fehler: 0, meldungen: [] }
  let abfrage = admin.from('auto_nachrichten').select('*').eq('status', 'geplant')
  abfrage = opts.id ? abfrage.eq('id', opts.id) : abfrage.lte('senden_ab', new Date().toISOString()).order('senden_ab', { ascending: true }).limit(20)
  const { data: zeilen, error } = await abfrage
  if (error) throw new Error(`Vorgemerkte automatische Nachrichten ließen sich nicht lesen: ${error.message}`)
  if (!zeilen || zeilen.length === 0) {
    if (opts.id) ergebnis.meldungen.push('Diese Nachricht ist nicht mehr zum Senden vorgemerkt.')
    return ergebnis
  }
  const { data: regeln } = await admin.from('auto_nachricht_regeln').select('id, titel, aktiv')
  // deno-lint-ignore no-explicit-any
  const regelMap = new Map(((regeln ?? []) as any[]).map((r) => [r.id, r]))
  for (const z of zeilen) {
    const r = await versendeEine(admin, z, regelMap.get(z.regel), absenden, !!opts.id)
    if (r === 'gesendet') ergebnis.gesendet++
    else if (r === 'fehler') ergebnis.fehler++
    else ergebnis.uebersprungen++
  }
  if (opts.id && ergebnis.gesendet === 0) {
    const { data: nachher } = await admin.from('auto_nachrichten').select('status, grund').eq('id', opts.id).maybeSingle()
    if (nachher?.grund) ergebnis.meldungen.push(`Nicht gesendet: ${nachher.grund}`)
  }
  return ergebnis
}
