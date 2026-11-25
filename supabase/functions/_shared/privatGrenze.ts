// Grenze zwischen privat und Mayer (25.11.2026) — EINE Regel für alle Stellen.
//
// ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
// │ Wer Termine/Mails/Akten Mayer-seitig ausgibt, MUSS diese Funktionen nutzen.                                   │
// │ Mayer-seitig = Mayer-Assistent (Telegram), Morgen-/Abendnachricht, Tagesplan, „Bitte bestätigen“, Vorschläge, │
// │ Kalender-Abo, Superuser-Ansichten, alles, was Kollegen sehen. Der private Assistent (privatBot.ts,            │
// │ privatTagesplan.ts, privatWoche.ts) ist die Gegenseite und darf private Daten zeigen.                         │
// │ Der Wächter-Test privatGrenze.waechter.test.ts schlägt an, sobald eine Datei neu aus `termine` liest, ohne     │
// │ dort eingeordnet zu sein.                                                                                     │
// └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Anlass: Zweimal (23./24.11.2026) erschienen private Outlook-Termine eines Geschäftsführers im Mayer-Assistenten,
// zuletzt als „Bitte bestätigen: Termin → Akte …“ mit dem Namen einer gleichnamigen Mayer-Akte. Die Regel stand bis
// dahin verstreut (tagesmeldung.ts, telegram-gateway/index.ts) und fehlte an den übrigen Stellen.
//
// Regel für Termine (aus Commit 43222a1, hier zentral):
//   Ein Termin ist PRIVAT, wenn er keine Kollegen hat (termine.teilnehmer leer) UND keine Mayer-Akte (kunde_id leer
//   oder kunde_bereich 'privat') UND mindestens eines gilt:
//     - er kommt aus Microsoft/Outlook (ms_id gesetzt),
//     - er hängt an einer privaten Akte (kunde_bereich 'privat'),
//     - sein Besitzer nutzt den privaten Assistenten (Option besitzerPrivatAssistent).
//   Gäste/Outlook-Teilnehmer von außen (gast, ms_teilnehmer) machen einen Termin NICHT zum Firmentermin — sonst würde
//   ein privates Treffen mit einem Kontakt, dessen Adresse zufällig bei einer Mayer-Akte steht, wieder Mayer-seitig.
//
// Die Regeln selbst sind reine Funktionen; nur standardPrivatPruefer fragt die Datenbank (wer nutzt den privaten Assistenten).

import { privatBotAktiv } from './telegramPrivat.ts'

// deno-lint-ignore no-explicit-any
type Db = any

/** Felder, die die Termin-Regel braucht. Wer Termine lädt, muss sie mit auswählen. */
export const PRIVAT_TERMIN_SPALTEN = 'besitzer_email, teilnehmer, kunde_id, kunde_bereich, ms_id'

export type PrivatTerminFelder = {
  besitzer_email?: string | null
  teilnehmer?: unknown
  kunde_id?: string | null
  kunde_bereich?: string | null
  ms_id?: string | null
}

export type PrivatOptionen = {
  /** Der Besitzer des Termins nutzt den privaten Assistenten (dann sind auch seine CRM-Termine ohne Kollegen und
   *  ohne Mayer-Akte privat — sie stehen in seinem privaten Morgenplan). */
  besitzerPrivatAssistent?: boolean
}

function text(x: unknown): string {
  return typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x)
}

function adresse(x: unknown): string {
  return text(x).trim().toLowerCase()
}

/** Keine Kollegen eingetragen (termine.teilnehmer leer bzw. nur leere Einträge). */
export function ohneKollegen(t: Pick<PrivatTerminFelder, 'teilnehmer'>): boolean {
  return !(Array.isArray(t.teilnehmer) && t.teilnehmer.some((x) => text(x).trim()))
}

/** Keine Mayer-Akte: keine Akte oder eine private Akte. */
export function ohneMayerAkte(t: Pick<PrivatTerminFelder, 'kunde_id' | 'kunde_bereich'>): boolean {
  return !text(t.kunde_id).trim() || text(t.kunde_bereich).trim() === 'privat'
}

/** Kommt der Termin aus Microsoft/Outlook? */
export function istOutlookTermin(t: Pick<PrivatTerminFelder, 'ms_id'>): boolean {
  return !!text(t.ms_id).trim()
}

/**
 * Ist der Termin privat? (Regel oben.) Mayer-seitig nie zeigen — auch Kollegen nicht als „belegt“, außer eine Stelle
 * blockiert damit nur Zeiten ohne jede Angabe (Buchungsseiten).
 */
export function istPrivaterTermin(t: PrivatTerminFelder, o: PrivatOptionen = {}): boolean {
  if (!ohneKollegen(t) || !ohneMayerAkte(t)) return false
  return istOutlookTermin(t) || text(t.kunde_bereich).trim() === 'privat' || o.besitzerPrivatAssistent === true
}

/** Nur die Termine, die Mayer-seitig erscheinen dürfen. `privatAssistent(email)`: nutzt der Besitzer den privaten Assistenten? */
export function nurMayerTermine<T extends PrivatTerminFelder>(liste: T[], privatAssistent: (email: string) => boolean = () => false): T[] {
  return liste.filter((t) => !istPrivaterTermin(t, { besitzerPrivatAssistent: privatAssistent(adresse(t.besitzer_email)) }))
}

/** Eine Akte (Zeile aus kunden) ist privat, wenn sie im Bereich „privat“ liegt. */
export function istPrivateAkte(a: { bereich?: string | null } | null | undefined): boolean {
  return text(a?.bereich).trim() === 'privat'
}

/** Ein Objekt ist privat, sobald ein Besitzer eingetragen ist. */
export function istPrivatesObjekt(o: { privat_besitzer?: string | null } | null | undefined): boolean {
  return !!adresse(o?.privat_besitzer)
}

export type PrivatMailFelder = {
  besitzer_email?: string | null
  zuordnung_vorschlag?: { art?: string | null } | null
}

/**
 * Private Mail: liegt im persönlichen Postfach eines Mitarbeiters (eingegangene_emails.besitzer_email gesetzt) bzw.
 * ist ein Vorschlag aus dem persönlichen Postfach (zuordnung_vorschlag.art 'privat', in „Bitte bestätigen“ art
 * 'mail_privat'). Erst nach „ins CRM übergeben“ (besitzer_email leer) ist sie eine Mayer-Mail.
 */
export function istPrivateMail(m: PrivatMailFelder | null | undefined): boolean {
  if (!m) return false
  return !!adresse(m.besitzer_email) || text(m.zuordnung_vorschlag?.art) === 'privat'
}

/**
 * Lädt einmal je Lauf, wer den privaten Assistenten nutzt, und merkt es sich (_shared/telegramPrivat.ts, privatBotAktiv).
 * `pruefe` ist für Tests ersetzbar. Fehler zählen als „nutzt ihn nicht“ — die Regel über ms_id und private Akten
 * gilt trotzdem.
 */
export function privatAssistentMerker(pruefe: (email: string) => Promise<boolean>): { nutzt: (email: string) => Promise<boolean>; bekannt: (email: string) => boolean } {
  const merker = new Map<string, boolean>()
  return {
    nutzt: async (email: string) => {
      const e = adresse(email)
      if (!e) return false
      if (!merker.has(e)) merker.set(e, await pruefe(e).catch(() => false))
      return merker.get(e) === true
    },
    /** Nur schon Geladenes (synchron, für Filter nach einem `nutzt` je Besitzer). */
    bekannt: (email: string) => merker.get(adresse(email)) === true,
  }
}

/** Für Filter: erst alle Besitzer einer Liste laden, dann synchron filtern. */
export async function ladeBesitzer(liste: PrivatTerminFelder[], m: ReturnType<typeof privatAssistentMerker>): Promise<void> {
  for (const e of new Set(liste.map((t) => adresse(t.besitzer_email)).filter(Boolean))) await m.nutzt(e)
}

/** Standard-Prüfer mit der Datenbank (privatBotAktiv: Schlüssel, Freischaltung, Vermerk). */
export function standardPrivatPruefer(db: Db): (email: string) => Promise<boolean> {
  return (email: string) => privatBotAktiv(db, email)
}
