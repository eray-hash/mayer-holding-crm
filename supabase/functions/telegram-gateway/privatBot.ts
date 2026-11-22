// Privater Assistent: ein zweiter Telegram-Bot (nur für Freigeschaltete, MS_ERLAUBT), der auf demselben
// Code läuft wie der Mayer-Bot und deshalb jede Neuerung sofort mitbekommt.
//
// - Telegram ruft `telegram-gateway?bot=privat` auf; index.ts verarbeitet das Update dann in mitBot(true, …).
// - Innerhalb dieses Rahmens antworten alle Aufrufe an den aktuellen Chat mit dem privaten Schlüssel
//   (botToken), der Gesprächszustand liegt getrennt in privat_einstellungen.telegram_zustand, und der
//   Assistent bekommt nur die Werkzeuge der Liste unten. Seine Rechte tragen `nurPrivat: true`
//   (rechte.ts): Es gibt für ihn nur die eigenen privaten Kontakte und Objekte.
// - Nachrichten an Kollegen (kollegen_benachrichtigen, Termin-Einladungen, Rückfragen) bleiben beim Mayer-Bot.
import { AsyncLocalStorage } from 'node:async_hooks'
import { privatBotToken, privatWebhookGeheimnis } from '../_shared/telegramPrivat.ts'

export { privatBotToken, privatWebhookGeheimnis }

const RAHMEN = new AsyncLocalStorage<{ privat: boolean }>()

/** Führt `arbeit` im Rahmen des privaten (true) oder des Mayer-Bots (false) aus. */
export function mitBot<T>(privat: boolean, arbeit: () => T): T {
  return RAHMEN.run({ privat }, arbeit)
}

/** Läuft der aktuelle Ablauf für den privaten Bot? */
export function imPrivatBot(): boolean {
  return RAHMEN.getStore()?.privat === true
}

/** Schlüssel für Antworten an den aktuellen Chat: im privaten Rahmen der private Bot, sonst `standard` (Mayer-Bot). */
export function botToken(standard: string | undefined): string | undefined {
  return imPrivatBot() ? privatBotToken() : standard
}

/** Werkzeuge des privaten Assistenten. Alles andere (gemeinsames Postfach, Kollegen, Rechnungen, Aktenpflege …) gibt es dort nicht. */
export const PRIVAT_BOT_WERKZEUGE: readonly string[] = [
  'kunden_suchen',
  'kundenakte_lesen',
  'dokument_inhalt',
  'aufgaben_uebersicht',
  'objekte_suchen',
  'objektakte_lesen',
  'notiz_speichern',
  'aufgabe_setzen',
  'aktivitaet_aendern',
  'kunde_anlegen',
  'kunde_aendern',
  'dateien_ablegen',
  'kunde_loeschen',
  'kunden_aus_liste',
  'datei_lesen',
  'gespraechsprotokoll_anlegen',
  'dokument_erstellen',
  'termine_zeigen',
  'termin_anlegen',
  'termin_absagen',
  'termin_aendern',
  'termin_briefing',
  'objekt_luecken',
  'fotos_ins_objekt',
  'titelbild_vorschlagen',
  'bild_reihenfolge_setzen',
  'todo_anlegen',
  'todo_erledigen',
  'todo_aendern',
  'todos_aufraeumen',
  'privater_bereich',
  'in_oeffentlich_holen',
  'meine_post_vorschlaege',
  'alles_durchsuchen',
  'internet_recherche',
  'wunsch_notieren',
  'objekt_ins_mayer_crm',
  'objekt_anlegen',
  'objekt_aendern',
  'dateien_ins_objekt',
  'gesuche_suchen',
  'passende_kaeufer',
  'passende_objekte',
  'datei_verschieben',
  'datei_umbenennen',
  'datei_loeschen',
]

/** Darf der private Assistent dieses Werkzeug benutzen? Hotmail- und Brief-Werkzeuge über `privatWerkzeug`. */
export function imPrivatBotErlaubt(name: string, privatWerkzeug: (name: string) => boolean): boolean {
  return PRIVAT_BOT_WERKZEUGE.includes(name) || privatWerkzeug(name)
}

type Werkzeug = { name: string; description?: string; input_schema?: { properties?: Record<string, unknown>; required?: string[] } & Record<string, unknown> } & Record<string, unknown>

/**
 * Die Werkzeugliste des privaten Assistenten aus der vollen Liste: nur erlaubte Werkzeuge, ohne die
 * Sammelakten (ziel) und kunde_anlegen nur für private Kontakte.
 */
export function werkzeugeFuerPrivatBot<T extends Werkzeug>(alle: readonly T[], privatWerkzeug: (name: string) => boolean): T[] {
  return alle
    .filter((w) => imPrivatBotErlaubt(w.name, privatWerkzeug))
    .map((w) => {
      const kopie = structuredClone(w) as T
      const props = kopie.input_schema?.properties
      if (props && 'ziel' in props) {
        delete props.ziel
        if (Array.isArray(kopie.input_schema?.required)) kopie.input_schema!.required = kopie.input_schema!.required.filter((r) => r !== 'ziel')
      }
      if (kopie.name === 'kunde_anlegen' && props) {
        props.bereich = { type: 'string', enum: ['privat'], description: 'Immer privat: Im privaten Assistenten entstehen nur private Kontakte (nur er sieht sie).' }
        kopie.description =
          'Legt einen neuen PRIVATEN Kontakt des Mitarbeiters an (nur er sieht ihn). Vorher mit kunden_suchen prüfen, dass es ihn noch nicht gibt. privat_art wählt optional den Ablauf (Status) eines Bereichs. Legst du ihn an, weil eine geschickte Datei zu jemandem gehört, den es noch nicht gibt, setz automatisch=true mit Begründung.'
      }
      if (kopie.name === 'kunden_aus_liste' && props) {
        // deno-lint-ignore no-explicit-any
        const zeile = (props.eintraege as any)?.items?.properties
        if (zeile) zeile.bereich = { type: 'string', enum: ['privat'], description: 'Immer privat: Im privaten Assistenten entstehen nur private Kontakte.' }
      }
      if (kopie.name === 'termin_anlegen' && props) delete props.teilnehmer
      if (kopie.name === 'termine_zeigen' && props) delete props.person
      return kopie
    })
}

export const PRIVAT_BOT_HINWEIS = `DU BIST HIER DER PRIVATE ASSISTENT (eigener Telegram-Bot). Du bist der private Assistent des Mitarbeiters im Bereich Privat. Das hat Vorrang vor allem, was oben über die Holding steht:
- Du arbeitest nur mit seinen PRIVATEN Sachen: private Kontakte (mit Unterlagen, Notizen, Aufgaben, Gesprächsprotokollen), private Objekte, seine eigene To-do-Liste, seine Termine ohne Kollegen, sein Hotmail-Postfach, Briefe auf seinem Briefbogen.
- Akten, Objekte und To-do-Listen der Mayer Holding, das gemeinsame Postfach, die Sammelakten („intern“, „Ungeklärte Eingänge“) und alles von Kollegen siehst du hier nicht. Fragt er danach, sag ihm, dass er dafür den Mayer-Assistenten nutzt. Nachrichten an Kollegen und Termine mit Kollegen laufen ebenfalls nur über den Mayer-Assistenten.
- Neue Kontakte legst du hier immer als private Kontakte an (kunde_anlegen mit bereich=privat).
- Geschickte Dateien legst du bei seinem passenden privaten Kontakt ab (dateien_ablegen). Ist nicht klar, zu wem eine Datei gehört, frag ihn kurz — es gibt hier keine Sammelakte. Schickt er mehrere Dateien auf einmal, verarbeitest du nur eine nach der anderen.
- Sagt er, etwas soll „rüber ins Mayer-CRM“ (oder „in die Holding“, „für alle“), übernimmst du es: einen Kontakt mit in_oeffentlich_holen (art=kontakt; seine Unterlagen und bei ihm abgelegten Mails gehen mit), ein Objekt mit objekt_ins_mayer_crm, eine Mail aus seinem privaten Postfach mit in_oeffentlich_holen (art=mail bzw. gesendete_mail, ohne kunde_id — sie landet im gemeinsamen Postfach). Vorher fragst du kurz nach, was genau und wohin (bei einem Kontakt: welcher Bereich), und führst es erst nach seinem klaren Ja in der nächsten Nachricht aus. Danach ist es für dich hier nicht mehr sichtbar.`
