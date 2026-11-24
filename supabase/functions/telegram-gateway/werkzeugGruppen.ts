// Werkzeug-Gruppen des Telegram-Assistenten: Grundwerkzeuge immer, Sachgebiete nur bei Bedarf.
//
// Warum: Bis 22.11.2026 ist der Assistent auf über 110 Werkzeuge und einen Hinweistext mit rund 75
// Absätzen gewachsen. Gemessen (count_tokens, 22.11.2026): Werkzeuge + Hinweistext = rund 88.600 Tokens
// bei JEDEM Schritt — vor Runde 2 waren es 28.000. Das kostet bei jedem abgelaufenen Zwischenspeicher
// eine teure Neuschrift, macht die erste Antwort langsamer, und das Modell verwechselt ähnliche Werkzeuge.
//
// So geht es:
// - KERN: die meistgenutzten Werkzeuge (gezählt in den gespeicherten Gesprächen am 22.11.2026, ergänzt
//   nach Urteil) — immer dabei.
// - GRUPPEN: je Sachgebiet (Objekte, Vermarktung, Rechnungen …) die übrigen Werkzeuge und die Absätze
//   des Hinweistexts, die sie erklären. Eine Gruppe kommt dazu, wenn
//     1. Stichwörter in der neuen Nachricht oder in den letzten Zügen passen (billig, ohne KI),
//     2. ein Werkzeug der Gruppe schon im Verlauf benutzt wurde (der Verlauf enthält dessen Aufruf —
//        so bleibt auch „ja, schick sie ab“ nach mail_vorbereiten beim richtigen Werkzeug),
//     3. eine offene Rückfrage dazugehört (Mail-Entwurf, Aktenpflege),
//     4. ein Datei-Eingang kommt (Dateien und Objekte, weil Fotos und Unterlagen in Objekte gehören können),
//     5. das Modell sie mit weitere_werkzeuge_laden anfordert, oder
//     6. das Modell ein freigegebenes, aber nicht geladenes Werkzeug trotzdem aufruft (merke()).
// - Zwischenspeicher: Reihenfolge Grundwerkzeuge → Ladewerkzeug (Marke) → Gruppen in fester Reihenfolge.
//   Der Teil bis zur Marke ist für alle Anfragen gleich und wird immer wieder gelesen; dazu kommt in
//   index.ts die bisherige Marke am Hinweistext und eine Marke am letzten Nachrichtenblock
//   (mitNachrichtenCache), damit die Schritte eines Zugs den Verlauf nicht jedes Mal voll bezahlen.
// - Unbekannte Werkzeuge und unbekannte Absätze (später dazugekommen) zählen zum KERN: Es geht nie still
//   etwas verloren. Der Test werkzeugGruppen.test.ts verlangt trotzdem, dass jedes Werkzeug genau einer
//   Gruppe zugeordnet ist, damit der Kern nicht unbemerkt wieder wächst.
// - Der private Assistent (privatBot.ts) bekommt vorher schon nur seine Liste; hier wird nur daraus
//   ausgewählt — was dort fehlt, kann auch keine Gruppe zurückbringen. Hotmail/Briefe sind dort immer dabei.
// - Abschalten ohne neuen Code: Secret TELEGRAM_WERKZEUGGRUPPEN=aus → alle Werkzeuge, voller Hinweistext
//   (wie vorher); die Zwischenspeicher-Marken bleiben.

export type GruppenName =
  | 'objekte'
  | 'vermarktung'
  | 'rechnungen'
  | 'vertrieb'
  | 'akademie'
  | 'buecher'
  | 'postfach'
  | 'kalender'
  | 'dateien'
  | 'aktenpflege'
  | 'nachfassen'
  | 'hotmail'

type Gruppe = {
  titel: string
  // Eine Zeile für das Modell: wofür die Gruppe da ist.
  wofuer: string
  werkzeuge: readonly string[]
  // Stichwörter auf kleingeschriebenem Text mit ae/oe/ue/ss statt Umlauten (siehe normalisiere).
  stichworte: RegExp
}

/**
 * Immer geladen. Gezählt in den gespeicherten Gesprächen aller Mitarbeiter und des privaten Assistenten
 * (22.11.2026): kunden_suchen 9, kundenakte_lesen 7, todo_anlegen 7, dokument_inhalt 6, dateien_ablegen 5,
 * datei_lesen 3, dokument_erstellen 3, objekte_suchen 3, dokument_aus_akte_nehmen 2, notiz_speichern 2,
 * termine_zeigen 2, todo_aendern 2, datei_senden 2, je 1: wunsch_notieren, kollegen_benachrichtigen,
 * kunde_anlegen, objektakte_lesen, aufgaben_uebersicht. Nach Urteil dazu: Akte ändern, Termin anlegen,
 * Volltextsuche, Firmenüberblick, Notiz/Aufgabe/Aktivität, Gesprächsprotokoll, Kunde löschen (Rückfrage
 * über zwei Nachrichten), Internet, To-do erledigen.
 * (Die Hotmail-Werkzeuge waren ebenfalls häufig, aber nur im privaten Assistenten — dort ist die Gruppe
 * hotmail immer geladen.)
 */
export const KERN: readonly string[] = [
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
  'kunde_loeschen',
  'dateien_ablegen',
  'dokument_aus_akte_nehmen',
  'datei_lesen',
  'gespraechsprotokoll_anlegen',
  'termine_zeigen',
  'termin_anlegen',
  'firmenueberblick',
  'internet_recherche',
  'wunsch_notieren',
  'kollegen_benachrichtigen',
  'todo_anlegen',
  'todo_erledigen',
  'todo_aendern',
  // 24.11.2026: endgültig löschen statt nur abhaken — gehört zu den To-do-Werkzeugen, kommt oft ohne Stichwort („nimm X raus“).
  'todo_loeschen',
  'dokument_erstellen',
  'datei_senden',
  'alles_durchsuchen',
  // Runde 5: eigenes Profil (klein; die Nachfrage nach der Telefonnummer wird ohne Stichwort beantwortet)
  // und „was ist neu im CRM“.
  'mein_profil_aendern',
  'neuigkeiten_im_crm',
  // Runde 6: Antwort auf die Wiedervorlage „Neuanfrage prüfen“ kommt meist ohne Stichwort („passt nicht“, „später“) —
  // ein Statuswechsel wie kunde_aendern, deshalb im Kern.
  'lead_einstufen',
]

export const GRUPPEN: Record<GruppenName, Gruppe> = {
  objekte: {
    titel: 'Immobilien-Objekte',
    wofuer: 'Objektakten anlegen und ändern, Unterlagen und Fotos ins Objekt, Titelbild und Reihenfolge, Exposé, Kundenakte in Objektakte umziehen, was in Objektakten fehlt, Vorab-Kurzprüfung im Chat ausfüllen',
    werkzeuge: ['objekt_anlegen', 'objekt_aendern', 'dateien_ins_objekt', 'akte_in_objekt_umwandeln', 'expose_erstellen', 'fotos_ins_objekt', 'titelbild_vorschlagen', 'bild_reihenfolge_setzen', 'objekt_luecken', 'kurzpruefung_ausfuellen'],
    stichworte:
      /kurzpruef|akquise|objekt|immobili|expose|\bfotos?\b|\bbilder?\b|titelbild|grundriss|wohnung|\bhaus\b|haeuser|grundstueck|\bmfh\b|\befh\b|\betw\b|gewerbeeinheit|halle\b|baujahr|wohnflaeche|makler|alleinauftrag|reihenfolge|vollstaendig/,
  },
  vermarktung: {
    titel: 'Vermarktung',
    wofuer: 'Besichtigungen, Gesuche und passende Käufer oder Objekte, Zugang zum Interessenten-Portal, Rendite und Kaufpreis prüfen',
    werkzeuge: ['besichtigungen_zeigen', 'besichtigung_anlegen', 'besichtigung_aendern', 'gesuche_suchen', 'passende_kaeufer', 'passende_objekte', 'portal_zugang_anlegen', 'rendite_rechnen', 'rendite_pruefstein'],
    stichworte: /besichtig|kaeufer|kaufinteress|interessent|gesuch|suchprofil|wer sucht|sucht (ein|eine|einen|nach)\b|portal|rendite|kaufpreis|lohnt sich|\bmiete|mietrendite|faktor|passend|quadratmeter|\bqm\b|m²/,
  },
  rechnungen: {
    titel: 'Rechnungen und Buchhaltung',
    wofuer: 'Rechnungen ausstellen (PDF) und per Mail versenden, Rechnungen erfassen, Status und Zahlungen, offene Rechnungen, Kontoauszug abgleichen, Rechnungsvorschläge, Zahlungserinnerungen und Mahnungen erstellen und senden, Follow-up einer Rechnung vorführen, Verbindlichkeiten, Übergabe an den Steuerberater, Kostenvoranschläge',
    werkzeuge: [
      'rechnung_erfassen',
      // 24.11.2026: Rechnung ausstellen (PDF auf dem Briefbogen) und mit Anhang versenden — rechnungErstellen.ts.
      'rechnung_erstellen',
      'rechnung_versenden',
      'rechnung_aendern',
      'rechnung_status_setzen',
      'rechnung_zahlung_erfassen',
      'rechnungen_offen',
      'kontoauszug_abgleichen',
      'rechnung_vorschlaege',
      'export_steuerberater_status',
      'kostenvoranschlag_anlegen',
      'kostenvoranschlaege_auflisten',
      'kostenvoranschlag_aendern',
      'mahn_vorschlaege',
      // 24.11.2026: Zahlungserinnerung/Mahnung direkt hier, Follow-up vorführen — mahnungWerkzeuge.ts.
      'mahnung_erstellen',
      'followup_durchspielen',
      'verbindlichkeiten_pruefen',
    ],
    stichworte:
      /rechnung|zahlung|bezahl|durchspiel|vorfuehr|gezahlt|zahlt\b|ueberwies|ueberweisung|kontoauszug|\bmahn|offene posten|\bgeld\b|\bschuld(et|en|ig)|forderung|steuerberater|datev|buchhaltung|\bbeleg|kostenvoranschlag|\bkv\b|angebot|skonto|verbindlichkeit|abrechn|abgerechnet|honorar|gutschrift/,
  },
  vertrieb: {
    titel: 'Umsatz und Partner',
    wofuer: 'Umsatzvorschau, Chance und erwarteter Umsatz einer Akte, Provisionen, Verzeichnis der Partner und Vermittler, entgangene Klienten (als entgangen markieren, warum wir Kunden verlieren, wer zu entgehen droht)',
    // 24.11.2026: entgangene Klienten — entgangenWerkzeuge.ts.
    werkzeuge: ['umsatz_vorschau', 'umsatzziel_stand', 'chance_setzen', 'chance_vorschlaege_zeigen', 'provisionen_offen', 'partner_suchen', 'partner_anlegen', 'partner_zuordnen', 'als_entgangen_markieren', 'entgangene_klienten'],
    stichworte: /umsatz|\bziel|\bsoll\b|rueckstand|trichter|\bleads?\b|provision|chance|wahrscheinlich|prozent|%|erwart|quartal|reinkommt|kommt .{0,30}rein|pipeline|partner|vermittler|tippgeber|notar|gutachter|empfehl|empfohlen|vermittelt|steuerberater|€|\beuro\b|verloren|verlier|entgangen|entgeh|abgesprung|abspring|kein interesse|abgesagt|aufgeben|funkstille/,
  },
  akademie: {
    titel: 'Akademie',
    wofuer: 'Seminartermine zeigen und anlegen, Teilnehmer zeigen und anmelden',
    werkzeuge: ['seminartermine_zeigen', 'seminartermin_anlegen', 'teilnehmer_zeigen', 'teilnehmer_anmelden'],
    stichworte: /seminar|akademie|teilnehm|schulung|\bkurs|workshop|vortrag|webinar|anmeld|dozent/,
  },
  buecher: {
    titel: 'Bücher & Verlag',
    wofuer: 'Bücher und Verlagsprojekte zeigen, anlegen und ändern, Kontakte zu Büchern',
    werkzeuge: ['buecher_auflisten', 'buch_lesen', 'buch_anlegen', 'buch_aendern', 'buch_kontakte_suchen'],
    stichworte: /\bbuch\b|buecher|buches|verlag|manuskript|lektor|isbn|auflage|\bautor|cover|druckerei/,
  },
  postfach: {
    titel: 'Postfach und E-Mails',
    wofuer: 'gemeinsames Postfach lesen und zuordnen, Mails ganz lesen und weiterleiten, Mails an Kunden vorbereiten und senden, gesendete Mails, privater Bereich und Vorschläge im eigenen Postfach',
    werkzeuge: ['gemeinsames_postfach', 'mail_zuordnen', 'mail_lesen', 'mail_weiterleiten', 'mail_vorbereiten', 'mail_senden', 'gesendete_mails', 'privater_bereich', 'in_oeffentlich_holen', 'meine_post_vorschlaege'],
    stichworte: /mail|postfach|posteingang|weiterleit|newsletter|rundschreiben|anschreiben|geschrieben|gesendet|verschickt|absender|schreib(e|st)? (ihm|ihr|ihnen|dem|der|den|an|herrn?|frau)\b|antworte (ihm|ihr|ihnen|dem|der|den|herrn?|frau)\b|geantwortet|beantwort|zurueckgeschrieben|kam (was|etwas|post|eine?)\b|privat|@/,
  },
  kalender: {
    titel: 'Kalender',
    wofuer: 'Termine absagen und verschieben, Termine einer Akte zuordnen, freie Zeiten finden, Termin-Briefing, Protokoll nach einem Kundentermin, Gesprächsaufnahme auf mehrere Akten verteilen, Tagesablauf (Tag zeigen, planen, abhaken)',
    // 24.11.2026: aufnahme_verteilen — Gesprächsaufnahme bzw. Sprachnotiz auf mehrere Akten verteilen (aufnahmeVerteilen.ts).
    werkzeuge: ['termin_absagen', 'termin_aendern', 'freie_zeiten', 'termin_briefing', 'nachtermin_protokoll', 'termin_zuordnen', 'tag_zeigen', 'tag_vorschlagen', 'tag_eintrag_erledigt', 'tag_eintrag_hinzufuegen', 'tag_eintrag_entfernen', 'aufnahme_verteilen'],
    stichworte:
      /aufnahme|aufgenommen|sprachnotiz|verteil|termin|kalender|absag|verschieb|verleg|\bfrei|wann (hast|habe|hat|kann|koennen)|\buhr\b|(?<![\d.])\d{1,2}[:.]\d{2}(?![\d])|morgen|naechste woche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|briefing|vorbereit|wie lief|besprechung|meeting|treffen|mein(en)? tag|tagesablauf|tagesplan|tagesliste|heute an|heute (zu tun|dran|machen|erledigen)|plan(e)? (mir|meinen|den) tag|plan mir|offen geblieben|a-aufgabe|b-aufgabe|c-aufgabe/,
  },
  dateien: {
    titel: 'Dateien verwalten',
    wofuer: 'Dateien verschieben, umbenennen, löschen, an Kollegen schicken, nicht zugeordnete Dateien, Dateien aussortieren, Links öffnen, Tabellen erstellen',
    werkzeuge: ['datei_verschieben', 'datei_umbenennen', 'datei_loeschen', 'datei_an_kollegen', 'unzugeordnete_dateien', 'dateien_aussortieren', 'link_oeffnen', 'tabelle_erstellen', 'diagramm_erstellen'],
    stichworte: /diagramm|mind-?map|schaubild|organigramm|struktogramm|ablaufplan|flussdiagramm|zeitstrahl|brainstorm|skizz|zeichne|grafik|\bbild\b|baumdiagramm|entscheidungsbaum|datei|verschieb|umbenenn|loesch|falsche[nr]? akte|ungeklaert|unzugeordnet|liegengeblieben|aussortier|tabelle|excel|\bcsv\b|https?:\/\/|www\.|drive|dropbox|\blink/,
  },
  aktenpflege: {
    titel: 'Aktenpflege',
    wofuer: 'Kunden aus einer Liste anlegen, Akte in einen anderen Bereich verschieben, Akten zusammenführen, doppelte Akten finden, Stammdaten aus Mail-Signaturen, Akten ohne Telefon oder E-Mail',
    werkzeuge: ['kunden_aus_liste', 'kunde_bereich_wechseln', 'kunden_zusammenfuehren', 'dubletten_finden', 'stammdaten_vorschlaege', 'kontakt_luecken'],
    stichworte:
      /kontaktdaten|kontakt-?nachfrage|ohne (telefon|e-?mail|nummer)|fehlt (die )?(telefon|nummer|e-?mail)|nicht erreichbar|liste|tabelle|excel|\bcsv\b|import|mehrere kunden|(diese|folgende|neue) kunden|kunden auf einmal|bereich|nach (erben|immobilien|akademie|finanzierung|unternehmensberatung|betriebs)|zusammenfuehr|zusammenleg|dieselbe|derselbe|doppelt|dublette|zweimal|signatur|stammdaten/,
  },
  nachfassen: {
    titel: 'Nachfassen',
    wofuer: 'Nächste Follow-up-Schritte einer Akte, Wiedervorlagen, To-do-Liste aufräumen, Stand der Online-Unterschriften, Statusbericht an den Kunden, „Bitte bestätigen“-Vorschläge (Zuordnung, Statuswechsel), Abend-Rückblick an/aus',
    werkzeuge: ['followup_naechste_schritte', 'wiedervorlagen_auflisten', 'wiedervorlage_anlegen', 'wiedervorlage_erledigen', 'wiedervorlage_verschieben', 'todos_aufraeumen', 'unterschrift_status', 'statusbericht_entwurf', 'vorschlaege_bestaetigen', 'abend_rueckblick_einstellen'],
    stichworte: /follow-?up|naechsten? schritte|als naechstes|wiedervorlage|nachfass|nachhak|erinner|aufraeum|\braeum.{0,40}\bauf\b|to-?dos?.{0,30}(weg|streich)|was kann weg|von (meiner|der) liste|unterschrift|unterschrieb|unterzeichn|vertrag|vollmacht|vereinbarung|statusbericht|zwischenstand|bericht|vorschlaege_bestaetigen|bitte bestaetigen|andere akte|rueckblick/,
  },
  hotmail: {
    titel: 'Hotmail und Briefe (Bereich Privat)',
    wofuer: 'eigenes Hotmail-Postfach lesen, ordnen, beantworten und ablegen, Briefe auf dem eigenen Briefbogen, privates Objekt ins Mayer-CRM, alles zu einer Person, eigene Verträge und Abos',
    werkzeuge: [
      'outlook_suche',
      'outlook_posteingang',
      'outlook_mail',
      'outlook_verlauf',
      'outlook_anhang_lesen',
      'outlook_offene_punkte',
      'outlook_ordnen',
      'outlook_mail_vorbereiten',
      'outlook_mail_loeschen',
      'outlook_ablegen',
      'brief_erstellen',
      'objekt_ins_mayer_crm',
      // Hasans Wünsche vom 23.11.2026 — nur im privaten Assistenten, dort ist diese Gruppe immer geladen.
      'person_ueberblick',
      'vertrag_anlegen',
      'vertrag_aendern',
      'vertraege_zeigen',
      'vertrag_loeschen',
      'kontakte_vorschlagen',
      'werbung_aufraeumen',
      'meldungen_einstellen',
    ],
    stichworte: /hotmail|outlook|privat|\bbrief\b|briefe\b|briefbogen|briefkopf|mein(e|em|en)? (post|mail)|mayer-crm|ins crm/,
  },
}

/** Feste Reihenfolge der Gruppen in der Werkzeugliste (gleiche Auswahl = gleiche Bytes = Zwischenspeicher trifft). */
export const GRUPPEN_REIHENFOLGE: readonly GruppenName[] = ['objekte', 'vermarktung', 'rechnungen', 'vertrieb', 'akademie', 'buecher', 'postfach', 'kalender', 'dateien', 'aktenpflege', 'nachfassen', 'hotmail']

const ZU_GRUPPE = new Map<string, GruppenName>(GRUPPEN_REIHENFOLGE.flatMap((g) => GRUPPEN[g].werkzeuge.map((w) => [w, g] as [string, GruppenName])))

/** Gruppe eines Werkzeugs; unbekannte (später dazugekommene) Werkzeuge gehören zum Kern. */
export function gruppeVon(werkzeug: string): GruppenName | 'kern' {
  return ZU_GRUPPE.get(werkzeug) ?? 'kern'
}

/**
 * Absätze des Hinweistexts, die zu einer Gruppe gehören — erkannt am Anfang des Absatzes. Alles andere
 * (auch neue Absätze, die hier noch fehlen) bleibt im Kern und wird immer geschickt.
 */
export const ABSATZ_GRUPPE: readonly [string, GruppenName][] = [
  ['- Gemeinsames Postfach:', 'postfach'],
  ['- Mails ganz lesen und weiterleiten:', 'postfach'],
  ['- Privater Bereich:', 'postfach'],
  ['- Vorschläge im eigenen Postfach:', 'postfach'],
  ['- E-Mails:', 'postfach'],
  ['- Gesendete Mails:', 'postfach'],
  ['- Rechnungen:', 'rechnungen'],
  ['- Rechnungen ausstellen:', 'rechnungen'],
  ['- Zahlungen auf Rechnungen:', 'rechnungen'],
  ['- Kontoauszug abgleichen:', 'rechnungen'],
  ['- Rechnungsvorschläge:', 'rechnungen'],
  ['- Übergabe an den Steuerberater:', 'rechnungen'],
  ['- Kostenvoranschläge:', 'rechnungen'],
  ['- Mahnwesen:', 'rechnungen'],
  ['- Objektakten anlegen und befüllen:', 'objekte'],
  ['- Kundenakte ist eigentlich ein Objekt:', 'objekte'],
  ['- Exposés und Dokumente zu Immobilien:', 'objekte'],
  ['- Fotos zu Objekten:', 'objekte'],
  ['- Vollständigkeit von Objektakten:', 'objekte'],
  ['- Besichtigungen:', 'vermarktung'],
  ['- Gesuche und passende Käufer:', 'vermarktung'],
  ['- Rendite und Kaufpreis eines Objekts:', 'vermarktung'],
  ['- Partner und Vermittler:', 'vertrieb'],
  ['- Umsatzvorschau und Provisionen:', 'vertrieb'],
  ['- Umsatzziele:', 'vertrieb'],
  ['- Chance und erwarteter Umsatz einer Akte:', 'vertrieb'],
  ['- Entgangene Klienten:', 'vertrieb'],
  ['- Seminartermine der Akademie:', 'akademie'],
  ['- Bücher & Verlag:', 'buecher'],
  ['- Dateien in Akten verwalten:', 'dateien'],
  ['- Links:', 'dateien'],
  ['- Stammdaten aus E-Mail-Signaturen:', 'aktenpflege'],
  ['- Doppelte Akten:', 'aktenpflege'],
  ['- Fehlende Kontaktdaten:', 'aktenpflege'],
  ['- Kurzprüfung von Objekten:', 'objekte'],
  ['- Wiedervorlagen:', 'nachfassen'],
  ['- To-dos aufräumen:', 'nachfassen'],
  ['- Abend-Rückblick:', 'nachfassen'],
  ['- Statusbericht an den Kunden:', 'nachfassen'],
  ['- Online-Unterschrift:', 'nachfassen'],
  ['- Termin-Briefing:', 'kalender'],
  ['- Nachfrage nach Kundenterminen:', 'kalender'],
  ['- Aufnahmen auf Akten verteilen:', 'kalender'],
]

export const LADE_WERKZEUG_NAME = 'weitere_werkzeuge_laden'

/** Das Ladewerkzeug. Fester Text (keine Auswahl darin), damit der Zwischenspeicher bis hierher immer trifft. */
export const LADE_WERKZEUG = {
  name: LADE_WERKZEUG_NAME,
  description:
    'Lädt die Werkzeuge eines Sachgebiets dazu, die gerade nicht geladen sind (welche das sind, steht am Ende der Hinweise unter „Weitere Werkzeuge“). Nimm das, sobald du für eine Bitte ein Werkzeug brauchst, das dir fehlt — auch mehrere Gruppen auf einmal. Die Werkzeuge stehen dir ab dem nächsten Schritt zur Verfügung. Sag nie, dass du etwas nicht kannst, bevor du die passende Gruppe geladen hast.',
  input_schema: {
    type: 'object',
    properties: {
      gruppen: { type: 'array', items: { type: 'string', enum: [...GRUPPEN_REIHENFOLGE] }, description: 'Die zu ladenden Gruppen, z. B. ["objekte"].' },
    },
    required: ['gruppen'],
  },
}

// ---------- Auswahl ----------

/** Kleinschreibung, Umlaute als ae/oe/ue/ss und é als e (Exposé), damit die Stichwörter einfach bleiben. */
export function normalisiere(text: string): string {
  return text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[éè]/g, 'e')
}

type Block = { type?: string; text?: string; name?: string; content?: unknown }
export type VerlaufNachricht = { role: string; content: string | Block[] | unknown }

/** Text einer Nachricht für die Stichwortsuche (nur getippter/gesprochener Text, keine Werkzeug-Ergebnisse). */
function textVon(n: VerlaufNachricht): string {
  if (typeof n.content === 'string') return n.content
  if (!Array.isArray(n.content)) return ''
  return (n.content as Block[]).filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
}

/** Namen aller im Verlauf aufgerufenen Werkzeuge. */
export function benutzteWerkzeuge(verlauf: readonly VerlaufNachricht[]): string[] {
  const namen: string[] = []
  for (const n of verlauf) {
    if (!Array.isArray(n.content)) continue
    for (const b of n.content as Block[]) if (b?.type === 'tool_use' && typeof b.name === 'string') namen.push(b.name)
  }
  return namen
}

/**
 * Feste Sätze, die das System selbst in eine Nachricht schreibt (Sprachnachricht, Datei-Eingang, CRM-Fenster,
 * Mitteilung eines Kollegen). Sie zählen nicht als Stichwort: Bis 23.11.2026 lud „Bildunterschrift des
 * Mitarbeiters“ bei JEDEM Datei-Eingang die Gruppe nachfassen („unterschrift“), und „„Diese Mail“, „dieser
 * Kunde“ …“ im CRM-Fenster bei jeder geöffneten Akte die Gruppe postfach — je Schritt rund 5.000 bzw.
 * 7.000 Tokens umsonst. Was der Mitarbeiter selbst schreibt (auch die Bildunterschrift), bleibt stehen.
 */
const SYSTEM_SAETZE: readonly RegExp[] = [
  /\[Sprachnachricht des Mitarbeiters, automatisch abgehört[^\]]*\]/g,
  /Bildunterschrift des Mitarbeiters:/g,
  /„Diese Mail["“], „dieser Kunde["“], „hier["“] meinen das, wenn nichts anderes genannt ist\. Nenne die Kennung nicht\./g,
  /\[Systemmeldung, nicht vom Mitarbeiter getippt\] Im Auftrag von [^\n\]]{1,80} wurde dem Mitarbeiter über dich die folgende Mitteilung geschickt\. Fragt er danach weiter, hilf ihm ganz normal mit deinen Werkzeugen\./g,
]

/** Text ohne die festen Systemsätze (für die Stichwortsuche). */
export function ohneSystemSaetze(text: string): string {
  return SYSTEM_SAETZE.reduce((t, re) => t.replace(re, ' '), text)
}

/** Gruppen, deren Stichwörter im Text vorkommen (ohne die festen Systemsätze). */
export function gruppenAusText(text: string): Set<GruppenName> {
  const t = normalisiere(ohneSystemSaetze(text))
  return new Set(GRUPPEN_REIHENFOLGE.filter((g) => GRUPPEN[g].stichworte.test(t)))
}

export type AuswahlEingabe = {
  // Neue Nachricht oder Datei-Eingang dieses Zugs.
  eingang: string
  // Gespeicherter Verlauf (state.zuege → msgs), älteste zuerst.
  verlauf: readonly VerlaufNachricht[]
  privatBot: boolean
  // Offene Rückfragen aus dem vorigen Zug.
  offen?: { mail?: boolean; pflege?: boolean }
  // Wie viele der letzten Nachrichten (Mitarbeiter und Assistent) nach Stichwörtern durchsucht werden.
  // Der Assistent fragt nach einem Kundentermin „Wie lief der Termin …?“ — die Antwort selbst nennt oft
  // kein Stichwort.
  nachrichtenZurueck?: number
}

/** Welche Gruppen dieser Zug von Anfang an bekommt (ohne Prüfung, ob die Werkzeuge freigegeben sind). */
export function waehleGruppen(e: AuswahlEingabe): Set<GruppenName> {
  const gruppen = gruppenAusText(e.eingang)
  const zurueck = e.nachrichtenZurueck ?? 4
  const letzte = e.verlauf.filter((n) => textVon(n).trim()).slice(-zurueck)
  for (const g of gruppenAusText(letzte.map(textVon).join('\n'))) gruppen.add(g)
  for (const name of benutzteWerkzeuge(e.verlauf)) {
    const g = gruppeVon(name)
    if (g !== 'kern') gruppen.add(g)
  }
  if (/^\s*\[(Datei-Eingang|Sammelsendung)/.test(e.eingang) || /pfad=telegram\//.test(e.eingang)) {
    gruppen.add('dateien')
    gruppen.add('objekte')
  }
  if (e.offen?.mail) gruppen.add('postfach')
  if (e.offen?.pflege) gruppen.add('aktenpflege')
  if (e.privatBot) gruppen.add('hotmail')
  return gruppen
}

// ---------- Hinweistext ----------

type Absatz = { text: string; gruppe: GruppenName | 'kern' }
const ABSAETZE_CACHE = new Map<string, Absatz[]>()

/**
 * Zerlegt den Hinweistext in Absätze: Eine Zeile, die nicht eingerückt ist, beginnt einen neuen Absatz;
 * eingerückte Zeilen (z. B. „  1. …“ unter „- Dateien:“) gehören zum Absatz darüber.
 */
export function zerlegeHinweise(prompt: string): Absatz[] {
  const vorhanden = ABSAETZE_CACHE.get(prompt)
  if (vorhanden) return vorhanden
  const absaetze: Absatz[] = []
  for (const zeile of prompt.split('\n')) {
    if (absaetze.length > 0 && /^\s+\S/.test(zeile)) {
      absaetze[absaetze.length - 1].text += `\n${zeile}`
      continue
    }
    const treffer = ABSATZ_GRUPPE.find(([anfang]) => zeile.startsWith(anfang))
    absaetze.push({ text: zeile, gruppe: treffer ? treffer[1] : 'kern' })
  }
  ABSAETZE_CACHE.set(prompt, absaetze)
  return absaetze
}

/**
 * Hinweistext für die geladenen Gruppen: alle Kern-Absätze und die Absätze der geladenen Gruppen in der
 * ursprünglichen Reihenfolge, am Ende die Liste der nachladbaren Gruppen.
 */
export function hinweiseFuer(prompt: string, aktiv: ReadonlySet<GruppenName>, verfuegbar: ReadonlySet<GruppenName>): string {
  const teile = zerlegeHinweise(prompt)
    .filter((a) => a.gruppe === 'kern' || aktiv.has(a.gruppe))
    .map((a) => a.text)
  const nachladbar = GRUPPEN_REIHENFOLGE.filter((g) => verfuegbar.has(g) && !aktiv.has(g))
  if (nachladbar.length === 0) return teile.join('\n')
  return [
    ...teile,
    '',
    'Weitere Werkzeuge:',
    `- Für diese Sachgebiete sind die Werkzeuge gerade nicht geladen. Brauchst du eines davon, lade die Gruppe zuerst mit ${LADE_WERKZEUG_NAME} (auch mehrere auf einmal) und mach dann weiter — sag nie, dass du etwas nicht kannst, bevor du nachgesehen hast. Nennt ein Hinweis oben ein Werkzeug, das du gerade nicht hast, gehört es zu einer dieser Gruppen.`,
    ...nachladbar.map((g) => `  ${g}: ${GRUPPEN[g].wofuer} (${GRUPPEN[g].werkzeuge.join(', ')})`),
  ].join('\n')
}

// ---------- Zwischenspeicher ----------

const MARKE = { type: 'ephemeral' } as const

/**
 * Kopie der Nachrichten mit Zwischenspeicher-Marke am letzten Block der letzten Nachricht. So zahlt jeder
 * weitere Schritt eines Zugs (Werkzeug-Aufruf → Ergebnis → nächster Aufruf) den bisherigen Verlauf nur
 * noch zum Lesepreis statt voll. Verändert nichts am übergebenen Zustand (keine Marke im gespeicherten Verlauf).
 */
export function mitNachrichtenCache<T extends VerlaufNachricht>(messages: readonly T[]): T[] {
  const kopie = [...messages]
  const letzte = kopie.at(-1)
  if (!letzte) return kopie
  const bloecke: Block[] =
    typeof letzte.content === 'string' ? (letzte.content ? [{ type: 'text', text: letzte.content }] : []) : Array.isArray(letzte.content) ? [...(letzte.content as Block[])] : []
  for (let i = bloecke.length - 1; i >= 0; i--) {
    const b = bloecke[i]
    if (!b || typeof b !== 'object') continue
    if (!['text', 'image', 'document', 'tool_result', 'tool_use'].includes(String(b.type))) continue
    if (b.type === 'text' && !b.text) continue
    bloecke[i] = { ...b, cache_control: MARKE } as Block
    kopie[kopie.length - 1] = { ...letzte, content: bloecke }
    return kopie
  }
  return kopie
}

// ---------- Ein Gesprächszug ----------

export type WerkzeugAuswahl<T extends { name: string }> = {
  /** Geladene Gruppen (wächst während des Zugs). */
  readonly aktiv: ReadonlySet<GruppenName>
  /** Gruppen mit mindestens einem freigegebenen Werkzeug. */
  readonly verfuegbar: ReadonlySet<GruppenName>
  /** Werkzeugliste für den nächsten Aufruf: Kern, Ladewerkzeug (mit Marke), geladene Gruppen. */
  werkzeuge(): (T | typeof LADE_WERKZEUG)[]
  /** Hinweistext für den nächsten Aufruf. */
  hinweise(prompt: string): string
  /** Führt weitere_werkzeuge_laden aus; Ergebnis für das Modell. */
  lade(input: unknown): string
  /** Ein Werkzeug wurde aufgerufen: seine Gruppe gilt ab jetzt als geladen. */
  merke(werkzeug: string): void
}

/**
 * Auswahl für einen Gesprächszug. `alle` ist die schon nach Rechten gefilterte Liste (werkzeugListe in
 * index.ts, im privaten Assistenten nur dessen Werkzeuge) — die Auswahl nimmt nie etwas hinzu, das dort fehlt.
 */
export function starteAuswahl<T extends { name: string }>(alle: readonly T[], e: AuswahlEingabe, an = Deno.env.get('TELEGRAM_WERKZEUGGRUPPEN') !== 'aus'): WerkzeugAuswahl<T> {
  const verfuegbar = new Set<GruppenName>()
  for (const w of alle) {
    const g = gruppeVon(w.name)
    if (g !== 'kern') verfuegbar.add(g)
  }
  const aktiv = new Set<GruppenName>(an ? [...waehleGruppen(e)].filter((g) => verfuegbar.has(g)) : verfuegbar)
  const kern = alle.filter((w) => gruppeVon(w.name) === 'kern')
  // Marke am Ladewerkzeug: alles davor ist bei jeder Anfrage gleich.
  const lader = { ...LADE_WERKZEUG, cache_control: MARKE }

  return {
    aktiv,
    verfuegbar,
    werkzeuge() {
      if (!an) return [...alle]
      const dazu = GRUPPEN_REIHENFOLGE.filter((g) => aktiv.has(g)).flatMap((g) => alle.filter((w) => gruppeVon(w.name) === g))
      return [...kern, lader, ...dazu]
    },
    hinweise(prompt) {
      return an ? hinweiseFuer(prompt, aktiv, verfuegbar) : prompt
    },
    lade(input) {
      // deno-lint-ignore no-explicit-any
      const roh = (input as any)?.gruppen
      const gewuenscht = (Array.isArray(roh) ? roh : typeof roh === 'string' ? [roh] : []).map((g: unknown) => String(g).trim().toLowerCase())
      if (gewuenscht.length === 0) return `Fehler: Gib in gruppen an, welche Gruppen du brauchst: ${GRUPPEN_REIHENFOLGE.filter((g) => verfuegbar.has(g)).join(', ')}.`
      const neu: string[] = []
      const schon: string[] = []
      const fehlt: string[] = []
      for (const g of gewuenscht) {
        if (!(g in GRUPPEN) || !verfuegbar.has(g as GruppenName)) fehlt.push(g)
        else if (aktiv.has(g as GruppenName)) schon.push(GRUPPEN[g as GruppenName].titel)
        else {
          aktiv.add(g as GruppenName)
          const namen = alle.filter((w) => gruppeVon(w.name) === g).map((w) => w.name)
          neu.push(`${GRUPPEN[g as GruppenName].titel} (${namen.join(', ')})`)
        }
      }
      return [
        neu.length > 0 ? `Geladen: ${neu.join('; ')}. Diese Werkzeuge kannst du ab jetzt benutzen.` : '',
        schon.length > 0 ? `Schon geladen: ${schon.join(', ')}.` : '',
        fehlt.length > 0 ? `Nicht verfügbar: ${fehlt.join(', ')}. Verfügbar sind: ${GRUPPEN_REIHENFOLGE.filter((g) => verfuegbar.has(g)).join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join('\n')
    },
    merke(werkzeug) {
      const g = gruppeVon(werkzeug)
      if (g !== 'kern' && verfuegbar.has(g)) aktiv.add(g)
    },
  }
}
