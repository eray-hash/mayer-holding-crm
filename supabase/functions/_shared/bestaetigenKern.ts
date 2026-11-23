// „Bitte bestätigen“ per Telegram-Knopf (Runde 6, 23.11.2026) — gemeinsamer Kern ohne Datenbank: Tabelle, Schalter,
// Knopf-Kennungen und alle Nachrichtentexte an einer Stelle (damit Eray sie auf einen Blick freigeben kann).
//
// Anlass (Nutzungsauswertung 23.11.2026): Das Team arbeitet fast nur über Telegram. Vorschläge, die nur im Browser
// bestätigt werden, bleiben liegen (88 Termin→Akte-Vorschläge bei Hasan, 41 Mail→Akte-Vorschläge im persönlichen
// Postfach bei Quirin, Dateien in „Ungeklärte Eingänge“), und der Status einer Akte wechselt fast nie.
//
//  - Tabelle telegram_vorschlaege (SQL: supabase/sql/runde6_bestaetigen.sql): je verschickter Vorschlag eine Zeile
//    (wer, was, welche Akte, Status, Telegram-Nachricht). Nur der Server liest und schreibt (keine Regeln für Logins).
//    Dazu zwei Verwaltungszeilen (art 'lauf'): 'einstellung' (Schalter) und 'status_stand' (letzter Lauf der
//    Status-Vorschläge), sowie je Person und Tag eine Sperrzeile 'lauf|<adresse>|<datum>'.
//  - Schalter (Zeile 'einstellung', daten): { zuordnung_an, status_an, empfaenger } — Standard AUS. Empfänger sind
//    Adressen, 'superuser' (alle mit mitarbeiter.ist_superuser) oder '*' (alle). Regel des Nutzers: neue automatische
//    Nachrichten an Kollegen erst nach seiner Freigabe der Texte — deshalb zuerst nur Eray.
//  - Knopf: „bt:<kennung>:<wahl>:<code>“, wahl j = Ja, a = Andere Akte, i = Ignorieren, n = Nein. Der Code steht nur
//    in der Telegram-Nachricht; ausgeführt wird nur im Chat des Empfängers.

export const TABELLE = 'telegram_vorschlaege'
export const EINSTELLUNG_ID = 'einstellung'
export const STATUS_STAND_ID = 'status_stand'

export type VorschlagArt = 'termin' | 'mail' | 'mail_privat' | 'eingang' | 'status'
export type VorschlagStatus = 'offen' | 'laeuft' | 'erledigt' | 'ignoriert' | 'nein' | 'veraltet' | 'fehler'
export type Wahl = 'ja' | 'andere' | 'ignorieren' | 'nein'

/** Ziel einer Zuordnung: Kundenakte oder (nur bei Ungeklärten Eingängen) Objekt mit Ordner. */
export type Ziel = { art: 'kunde' | 'objekt'; id: string; name: string; bereich?: string; ordner?: string }

export type ZuordnungDaten = {
  /** Termin-Titel, Mail-Betreff oder Dateiname. */
  titel: string
  /** Beginn des Termins, Datum der Mail bzw. der Datei (ISO oder JJJJ-MM-TT). */
  wann?: string | null
  ganztags?: boolean
  /** Absender einer Mail. */
  von?: string | null
  ziel: Ziel
  grund?: string
  /** Mail aus dem persönlichen Postfach, Ziel ist eine Akte der Holding: wird beim Ja ins CRM übergeben. */
  uebergabe?: boolean
}

export type StatusDaten = {
  name: string
  bereich: string
  netz: string
  von: string
  nach: string
  vonName: string
  nachName: string
  ereignis: string
  anlass: string
}

export type VorschlagZeile = {
  id: string
  empfaenger_email: string
  art: VorschlagArt | 'lauf'
  bezug_id: string
  kunde_id: string | null
  daten: ZuordnungDaten | StatusDaten | Record<string, unknown>
  code: string
  status: VorschlagStatus
  ergebnis?: string | null
  telegram_nachricht?: { chat: number | string; id: number } | null
  erstellt_am?: string
  erledigt_am?: string | null
}

// ---------------------------------------------------------------------------------------------
// Schalter

export type Einstellung = { zuordnungAn: boolean; statusAn: boolean; empfaenger: string[] }

export const STANDARD_EINSTELLUNG: Einstellung = { zuordnungAn: false, statusAn: false, empfaenger: ['eray.yesil@fundament-it.de'] }

/** Liest daten der Zeile 'einstellung'. Fehlt sie oder ist sie kaputt: alles AUS. */
export function leseEinstellung(daten: unknown): Einstellung {
  if (!daten || typeof daten !== 'object') return { ...STANDARD_EINSTELLUNG, empfaenger: [...STANDARD_EINSTELLUNG.empfaenger] }
  const d = daten as Record<string, unknown>
  const empfaenger = Array.isArray(d.empfaenger) ? d.empfaenger.map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean) : [...STANDARD_EINSTELLUNG.empfaenger]
  return { zuordnungAn: d.zuordnung_an === true, statusAn: d.status_an === true, empfaenger }
}

/** Bekommt dieser Mitarbeiter die Nachrichten? */
export function istEmpfaenger(e: Einstellung, m: { email?: string | null; ist_superuser?: boolean | null }): boolean {
  const adresse = String(m.email ?? '').trim().toLowerCase()
  if (!adresse) return false
  return e.empfaenger.includes('*') || e.empfaenger.includes(adresse) || (e.empfaenger.includes('superuser') && m.ist_superuser === true)
}

// ---------------------------------------------------------------------------------------------
// Kennungen und Knöpfe

const ZEICHEN = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function zufall(laenge: number): string {
  const b = crypto.getRandomValues(new Uint8Array(laenge))
  return [...b].map((x) => ZEICHEN[x % ZEICHEN.length]).join('')
}

export function neueKennung(): string {
  return `tv_${zufall(10)}`
}

const WAHL_ZEICHEN: Record<Wahl, string> = { ja: 'j', andere: 'a', ignorieren: 'i', nein: 'n' }
const ZEICHEN_WAHL: Record<string, Wahl> = { j: 'ja', a: 'andere', i: 'ignorieren', n: 'nein' }

export function knopfDaten(id: string, wahl: Wahl, code: string): string {
  return `bt:${id}:${WAHL_ZEICHEN[wahl]}:${code}`
}

export function leseKnopf(daten: unknown): { id: string; wahl: Wahl; code: string } | null {
  const m = /^bt:(tv_[A-Za-z0-9]{6,20}):([jain]):([A-Za-z0-9]{6,20})$/.exec(String(daten ?? ''))
  return m ? { id: m[1], wahl: ZEICHEN_WAHL[m[2]], code: m[3] } : null
}

export function istBestaetigenKnopf(daten: unknown): boolean {
  return String(daten ?? '').startsWith('bt:')
}

type Knopf = { text: string; callback_data: string }

function kurz(text: string, laenge: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > laenge ? `${t.slice(0, laenge - 1)}…` : t
}

export function zuordnungKnoepfe(id: string, code: string, zielName: string): Knopf[][] {
  return [
    [{ text: `✅ Ja, zu ${kurz(zielName, 28)}`, callback_data: knopfDaten(id, 'ja', code) }],
    [
      { text: 'Andere Akte', callback_data: knopfDaten(id, 'andere', code) },
      { text: 'Ignorieren', callback_data: knopfDaten(id, 'ignorieren', code) },
    ],
  ]
}

export function statusKnoepfe(id: string, code: string, nachName: string): Knopf[][] {
  return [[{ text: `✅ Ja, Status auf „${kurz(nachName, 30)}“`, callback_data: knopfDaten(id, 'ja', code) }], [{ text: 'Nein', callback_data: knopfDaten(id, 'nein', code) }]]
}

// ---------------------------------------------------------------------------------------------
// Texte (Freigabe durch Eray vor dem Einschalten)

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const BERLIN = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** „Do 27.11. um 10:00“ bzw. „Do 27.11.“ (ganztags oder nur ein Datum). */
export function wannText(wann: string | null | undefined, ganztags = false): string {
  const w = String(wann ?? '').trim()
  if (!w) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const [y, m, d] = w.split('-').map(Number)
    return `${WOCHENTAG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`
  }
  const datum = new Date(w)
  if (Number.isNaN(datum.getTime())) return ''
  const t: Record<string, string> = {}
  for (const p of BERLIN.formatToParts(datum)) t[p.type] = p.value
  const tag = WOCHENTAG[new Date(Date.UTC(Number(t.year), Number(t.month) - 1, Number(t.day))).getUTCDay()]
  return ganztags ? `${tag} ${t.day}.${t.month}.` : `${tag} ${t.day}.${t.month}. um ${t.hour}:${t.minute}`
}

const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  immobilienkunden: 'Immobilien',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'privater Kontakt',
}

export function zielText(z: Ziel): string {
  if (z.art === 'objekt') return `Objekt „${z.name}“${z.ordner ? `, Ordner ${z.ordner}` : ''}`
  const bereich = BEREICH_NAME[String(z.bereich ?? '')]
  return `Akte „${z.name}“${bereich ? ` (${bereich})` : ''}`
}

const KOPF: Record<Exclude<VorschlagArt, 'status'>, string> = {
  termin: 'Termin → Akte',
  mail: 'E-Mail → Akte',
  mail_privat: 'E-Mail aus deinem persönlichen Postfach → Akte',
  eingang: 'Datei aus „Ungeklärte Eingänge“ → Akte',
}

/** Text einer „Bitte bestätigen“-Nachricht zu einer Zuordnung. */
export function zuordnungText(art: Exclude<VorschlagArt, 'status'>, d: ZuordnungDaten, nr: number, von: number): string {
  const zeilen = [`Bitte bestätigen${von > 1 ? ` (${nr} von ${von})` : ''}: ${KOPF[art]}`, '']
  const wann = wannText(d.wann, d.ganztags === true)
  if (art === 'termin') zeilen.push(`Termin: „${kurz(d.titel, 120)}“${wann ? ` am ${wann}` : ''}`)
  else if (art === 'eingang') zeilen.push(`Datei: „${kurz(d.titel, 120)}“${wann ? ` vom ${wann.replace(/ um .*$/, '')}` : ''}`)
  else zeilen.push(`E-Mail${d.von ? ` von ${kurz(d.von, 80)}` : ''}${wann ? ` vom ${wann.replace(/ um .*$/, '')}` : ''}: „${kurz(d.titel || '(ohne Betreff)', 120)}“`)
  zeilen.push(`Vorschlag: ${zielText(d.ziel)}`)
  if (d.grund) zeilen.push(`Grund: ${kurz(d.grund, 160)}`)
  if (art === 'mail_privat') {
    zeilen.push(
      '',
      d.uebergabe
        ? 'Hinweis: Mit „Ja“ wird die Mail ins CRM übernommen und der Akte zugeordnet. Danach sehen sie die Kollegen dieses Bereichs.'
        : 'Die Mail bleibt privat und wird nur bei deinem privaten Kontakt abgelegt.',
    )
  }
  return zeilen.join('\n')
}

/** Text eines Statusvorschlags. */
export function statusText(d: StatusDaten): string {
  return [
    'Status ändern?',
    '',
    `Akte: „${d.name}“ (${BEREICH_NAME[d.bereich] ?? d.bereich})`,
    `Anlass: ${d.anlass}`,
    `Jetzt: ${d.vonName}`,
    `Vorschlag: ${d.nachName}`,
  ].join('\n')
}

/** Anlass-Satz je Ereignis. */
export function anlassText(ereignis: string, angabe: string): string {
  const a = kurz(angabe, 100)
  if (ereignis === 'termin') return `Termin mit dieser Akte eingetragen${a ? ` (${a})` : ''}.`
  if (ereignis === 'vertrag') return `Vertrag oder Vollmacht in der Akte abgelegt${a ? ` („${a}“)` : ''}.`
  if (ereignis === 'angebot') return `Angebot bzw. Kostenvoranschlag erstellt${a ? ` („${a}“)` : ''}.`
  if (ereignis === 'antwort') return `Der Kunde hat auf eine E-Mail geantwortet${a ? ` („${a}“)` : ''}.`
  return a
}

/** Frage nach „Andere Akte“ (der Assistent nimmt die Antwort mit dem Werkzeug vorschlaege_bestaetigen entgegen). */
export function andereAkteFrage(art: VorschlagArt, d: ZuordnungDaten): string {
  const was = art === 'termin' ? `der Termin „${kurz(d.titel, 80)}“` : art === 'eingang' ? `die Datei „${kurz(d.titel, 80)}“` : `die E-Mail „${kurz(d.titel || '(ohne Betreff)', 80)}“`
  return `Zu welcher Akte gehört ${was}? Schreib mir einfach den Namen, dann ordne ich es zu.`
}

/** Neuer Text der Nachricht nach der Entscheidung (die Knöpfe verschwinden dabei). */
export function erledigtText(art: VorschlagArt, daten: ZuordnungDaten | StatusDaten | Record<string, unknown>, ergebnis: string): string {
  const d = daten as Record<string, unknown>
  const kopf = art === 'status' ? `Status der Akte „${kurz(String(d.name ?? ''), 80)}“` : `${KOPF[art]}: „${kurz(String(d.titel ?? '') || '(ohne Betreff)', 100)}“`
  return `${kopf}\n${ergebnis}`.slice(0, 4000)
}
