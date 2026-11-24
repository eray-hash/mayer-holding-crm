// Katalog aller automatischen Nachrichten (24.11.2026) — die eine Stelle, die die Seite „Automatische Nachrichten“
// (src/pages/automatik/AutomatischeNachrichten.tsx) anzeigt: was geht wann bei welchem Anlass an wen, wo wird es
// geschaltet, woher kommt der Text, wo steht der Verlauf. Stand aus dem Code erhoben (Inventar 24.11.2026).
// Neue automatische Nachricht gebaut? → hier eintragen, sonst fehlt sie auf der Seite.
//
// Schalter-Kennungen (`schalter.id`) sind die Schlüssel, die der Server mit den Aktionen `automatik_stand` (lesen) und
// `automatik_schalter` (ändern, nur Geschäftsführung/Superuser) kennt — siehe email-gateway/automatik.ts.
// Vorlagen-Kennungen (`text.vorlageId`) sind Zeilen in mail_vorlagen (im Browser über state.mailVorlagen bearbeitbar).

export type Kanal = 'kunde' | 'gast' | 'telegram' | 'privat' | 'wiedervorlage'

export const KANAL_TITEL: Record<Kanal, string> = {
  kunde: 'E-Mail an Kunden',
  gast: 'E-Mail an Termin-Gäste',
  telegram: 'Telegram an Mitarbeiter',
  privat: 'Privater Assistent (nur für den Besitzer)',
  wiedervorlage: 'Wiedervorlagen und Follow-ups (intern)',
}

/** Woher der Text kommt — und ob er hier bearbeitet werden kann. */
export type TextQuelle =
  | { art: 'vorlage'; vorlageId: string } // Mail-Vorlage, hier bearbeitbar
  | { art: 'regel'; regelId: string } // auto_nachricht_regeln → deren Mail-Vorlage, hier bearbeitbar
  | { art: 'wv_regeln'; ausloeser?: string } // Titel/Fälligkeit im Wiedervorlage-Katalog, hier bearbeitbar
  | { art: 'fest'; beispiel?: string } // im Programm festgelegt (Inhalt aus den Daten der Akte)
  | { art: 'ki'; hinweis: string } // ganz oder teilweise von der KI formuliert

/** Wie die Nachricht geschaltet wird. */
export type Schalter =
  | { art: 'an_aus'; id: string } // ein Schalter für alle
  | { art: 'stufe'; id: string } // aus | Probelauf (nur Superuser) | alle
  | { art: 'empfaenger'; id: string } // an/aus plus Empfängerliste
  | { art: 'regel'; id: string } // auto_nachricht_regeln (an/aus + Wartezeit)
  | { art: 'je_person'; wo: string } // jeder stellt für sich ein
  | { art: 'je_vorgang'; wo: string } // pro Termin / pro To-do / pro Akte
  | { art: 'immer' }

/** Wo die einzelnen geplanten/verschickten Nachrichten stehen. */
export type Protokoll = 'willkommen' | 'auto_nachrichten' | 'telegram_vorschlaege' | 'wiedervorlagen' | 'nachrichten_protokoll' | 'keins'

export type AutomatikEintrag = {
  id: string
  name: string
  kanal: Kanal
  empfaenger: string
  anlass: string
  zeitpunkt: string
  schalter: Schalter
  text: TextQuelle
  protokoll: Protokoll
  /** Nur für Geschäftsführung/Superuser sichtbar oder nur für sie bestimmt. */
  hinweis?: string
}

export const KATALOG: AutomatikEintrag[] = [
  // ── E-Mail an Kunden ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'willkommen', name: 'Willkommensnachricht mit Hochlade-Link', kanal: 'kunde',
    empfaenger: 'E-Mail-Adresse der Akte (ohne Adresse wartet sie, bis eine eingetragen wird)',
    anlass: 'Neue Akte im ersten Stand ihres Bereichs oder Akte wechselt von „Neuanfrage/Lead“ auf den nächsten Stand (z. B. Erstkontakt). Nicht bei privaten, automatisch angelegten oder verlorenen Akten.',
    zeitpunkt: 'nach der eingestellten Wartezeit (Vorgabe 60 Minuten); nach 7 Tagen ungesendet verfällt sie',
    schalter: { art: 'an_aus', id: 'willkommen' }, text: { art: 'vorlage', vorlageId: 'mv-willkommen-auto' }, protokoll: 'willkommen',
  },
  ...([
    ['immo_besichtigung_bestaetigung', 'Besichtigung bestätigen', 'Besichtigung wird angelegt (solange sie geplant ist und in der Zukunft liegt; nie bei privaten Objekten)', 'nach der eingestellten Wartezeit'],
    ['immo_besichtigung_erinnerung', 'Erinnerung an die Besichtigung', 'geplante Besichtigung', 'am Vortag um 9 Uhr'],
    ['immo_besichtigung_danke', 'Danke nach der Besichtigung', 'Besichtigung wird auf „durchgeführt“ gesetzt (nicht mehr nach 7 Tagen)', 'nach der eingestellten Wartezeit'],
    ['immo_besichtigung_absage', 'Absage der Besichtigung', 'Besichtigung wird auf „abgesagt“ gesetzt', 'nach der eingestellten Wartezeit'],
    ['immo_besichtigung_angebot', 'Kaufpreisangebot zur Besichtigung', 'bei einer Besichtigung wird ein Kaufpreisangebot eingetragen (entfällt, wenn es wieder entfernt wird)', 'nach der eingestellten Wartezeit'],
    ['immo_portal_anfrage', 'Portal-Link an neue Interessenten', 'der Anfragenmanager erkennt eine Objektanfrage (ImmoScout24, Kleinanzeigen, direkt) sicher und legt Akte und Portal-Zugang an', 'nach der eingestellten Wartezeit'],
    ['immo_portal_zustimmung', 'Bestätigung der Zustimmung im Interessenten-Portal', 'Interessent stimmt im Portal AGB und Provision zu (entfällt bei Widerruf)', 'nach der eingestellten Wartezeit'],
    ['akademie_seminar_bestaetigung', 'Seminar: Anmeldebestätigung', 'Anmeldung zu einem geplanten Seminartermin', 'nach der eingestellten Wartezeit'],
    ['akademie_seminar_warteliste', 'Seminar: Platz auf der Warteliste', 'Anmeldung landet auf der Warteliste (Termin voll)', 'nach der eingestellten Wartezeit'],
    ['akademie_seminar_erinnerung', 'Seminar: Erinnerung', 'geplanter Seminartermin mit Anmeldung', '2 Tage vor Beginn'],
    ['akademie_seminar_absage', 'Seminar abgesagt', 'Seminartermin wird abgesagt (an alle außer Stornierten)', 'nach der eingestellten Wartezeit'],
  ] as const).map(([id, name, anlass, zeitpunkt]): AutomatikEintrag => ({
    id, name, kanal: 'kunde', empfaenger: id.startsWith('akademie') ? 'Seminar-Teilnehmer' : 'Interessent bzw. Eigentümer (laut Regel)',
    anlass, zeitpunkt, schalter: { art: 'regel', id }, text: { art: 'regel', regelId: id }, protokoll: 'auto_nachrichten',
    ...(id.startsWith('immo_portal')
      ? { hinweis: 'AGB, Provisionsvereinbarung und Widerrufsbelehrung: Wortlaut unter Vorlagen → Verträge („Interessenten-Portal …“); die Bestätigung schickt den zugestimmten Wortlaut mit.' }
      : {}),
  })),
  {
    id: 'buchung_bestaetigung', name: 'Terminbestätigung nach Online-Buchung', kanal: 'kunde',
    empfaenger: 'wer über die öffentliche Buchungsseite einen Termin bucht', anlass: 'Kunde bucht einen freien Termin auf der Buchungsseite eines Mitarbeiters',
    zeitpunkt: 'sofort, mit Kalenderdatei', schalter: { art: 'je_person', wo: 'Kalender → Online-Buchung des Mitarbeiters' },
    text: { art: 'vorlage', vorlageId: 'mv-auto-buchung-bestaetigung' }, protokoll: 'nachrichten_protokoll',
  },
  {
    id: 'unterschrift_kopie', name: 'Kopie des unterschriebenen Dokuments', kanal: 'kunde',
    empfaenger: 'wer online unterschrieben hat', anlass: 'Kunde unterschreibt ein Dokument online', zeitpunkt: 'sofort',
    schalter: { art: 'an_aus', id: 'unterschrift_kopie' }, text: { art: 'vorlage', vorlageId: 'mv-auto-unterschrift-kopie' }, protokoll: 'nachrichten_protokoll',
  },
  {
    id: 'behoerde_vollmacht', name: 'Unterschriebene Vollmacht an die Behörde', kanal: 'kunde',
    empfaenger: 'die Behörden-Adresse, die beim Versenden des Formular-Links angegeben wurde', anlass: 'Kunde reicht ein Formular mit Unterschrift ein, zu dem eine Behörde hinterlegt ist',
    zeitpunkt: 'sofort', schalter: { art: 'je_vorgang', wo: 'nur wenn beim Formular-Link eine Behörde angegeben wurde' }, text: { art: 'fest' }, protokoll: 'keins',
  },
  {
    id: 'investoren_portal_link', name: 'Anmelde-Link zum Investoren-Portal', kanal: 'kunde',
    empfaenger: 'bekannter Investor, der den Link anfordert', anlass: 'Anforderung auf der Portalseite', zeitpunkt: 'sofort',
    schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'keins',
  },

  // ── E-Mail an Termin-Gäste ────────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'gast_einladung', name: 'Termin-Einladung an Gäste', kanal: 'gast',
    empfaenger: 'eingeladener Kunde der Akte und externe Gäste des Termins', anlass: 'Termin wird mit Gästen gespeichert (im CRM oder per Telegram „lade … ein“)',
    zeitpunkt: 'sofort, mit Kalenderdatei', schalter: { art: 'je_vorgang', wo: 'pro Termin: Gäste eintragen bzw. Kunden einladen' },
    text: { art: 'vorlage', vorlageId: 'mv-auto-gast-einladung' }, protokoll: 'nachrichten_protokoll',
  },
  {
    id: 'gast_aenderung', name: 'Termin geändert (an Gäste)', kanal: 'gast',
    empfaenger: 'alle eingeladenen Gäste', anlass: 'Zeit, Ort oder Titel eines Termins mit eingeladenen Gästen ändert sich',
    zeitpunkt: 'sofort, mit aktualisierter Kalenderdatei', schalter: { art: 'je_vorgang', wo: 'pro Termin' },
    text: { art: 'vorlage', vorlageId: 'mv-auto-gast-aenderung' }, protokoll: 'nachrichten_protokoll',
  },
  {
    id: 'gast_absage', name: 'Termin abgesagt (an Gäste)', kanal: 'gast',
    empfaenger: 'bisher eingeladene Gäste', anlass: 'Termin gelöscht, Gast entfernt oder Einladung zurückgezogen',
    zeitpunkt: 'sofort, mit Kalenderdatei zum Entfernen', schalter: { art: 'je_vorgang', wo: 'pro Termin' },
    text: { art: 'vorlage', vorlageId: 'mv-auto-gast-absage' }, protokoll: 'nachrichten_protokoll',
  },
  {
    id: 'gast_erinnerung', name: 'Terminerinnerung an Gäste', kanal: 'gast',
    empfaenger: 'alle eingeladenen Gäste (Kunde und Externe)', anlass: 'bevorstehender Termin mit eingeladenen Gästen',
    zeitpunkt: '1 Tag und 1 Stunde vorher (ganztägige Termine nur am Vortag)', schalter: { art: 'je_vorgang', wo: 'automatisch für jeden eingeladenen Gast' },
    text: { art: 'vorlage', vorlageId: 'mv-auto-gast-erinnerung' }, protokoll: 'nachrichten_protokoll',
  },

  // ── Telegram an Mitarbeiter (Mayer-Bot) ───────────────────────────────────────────────────────────────────────────
  { id: 'morgen_uebersicht', name: 'Morgen-Übersicht', kanal: 'telegram', empfaenger: 'jeder Mitarbeiter mit Telegram (Geschäftsführung zusätzlich offene Fragen)', anlass: 'heute stehen Termine, fällige Wiedervorlagen, Aufgaben oder neue Treffer an (sonst keine Nachricht)', zeitpunkt: 'werktags ab 8:00, einmal am Tag', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen: Morgen-Übersicht' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'termin_erinnerung', name: 'Terminerinnerung', kanal: 'telegram', empfaenger: 'Besitzer und Teilnehmer des Termins', anlass: 'bevorstehender Termin', zeitpunkt: 'je Person einstellbar: 1 Tag, 60, 30 oder 15 Minuten vorher (Vorgabe 60 Minuten)', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen: Erinnerungen' }, text: { art: 'fest', beispiel: '⏰ Erinnerung: Besprechung in 1 Stunde (Di., 14:00–15:00)\nOrt: Büro Ulm\nKunde: …' }, protokoll: 'nachrichten_protokoll' },
  { id: 'termin_teilnehmer_info', name: 'Neuer, geänderter oder abgesagter Termin eines Kollegen', kanal: 'telegram', empfaenger: 'die eingetragenen Kollegen', anlass: 'ein Kollege legt einen Termin mit Teilnehmern an, ändert Zeit/Ort/Titel, nimmt jemanden heraus oder sagt ab', zeitpunkt: 'sofort', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'termin_briefing', name: 'Termin-Briefing vor Kundenterminen', kanal: 'telegram', empfaenger: 'Beteiligte des Termins, die die Akte sehen dürfen', anlass: 'Termin mit Kunden- oder Objektakte beginnt bald', zeitpunkt: 'etwa 60 Minuten vorher (je Person einstellbar)', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen: Briefing' }, text: { art: 'ki', hinweis: 'Gesprächspunkte formuliert die KI aus der Akte' }, protokoll: 'nachrichten_protokoll' },
  { id: 'termin_briefing_morgen', name: 'Morgenübersicht der Kundentermine', kanal: 'telegram', empfaenger: 'wer es eingeschaltet hat', anlass: 'heute gibt es Kundentermine', zeitpunkt: 'täglich ab 7:30', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'aufnahme_erinnerung', name: '„Gespräch aufnehmen?“ zum Terminbeginn', kanal: 'telegram', empfaenger: 'Beteiligte eines Termins mit Akte', anlass: 'Termin mit Akte beginnt, noch keine Aufnahme', zeitpunkt: 'zum Beginn (bis 5 Minuten danach)', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen (Vorgabe aus)' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'nach_termin_nachfrage', name: '„Wie lief der Termin mit …?“', kanal: 'telegram', empfaenger: 'Besitzer des Termins', anlass: 'Termin mit genau einer Kundenakte ist vorbei und es gibt heute noch kein Protokoll', zeitpunkt: '10–20 Minuten nach Terminende, höchstens 4 am Tag', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen: Nachfrage' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'todo_erinnerung', name: 'To-do-Erinnerung', kanal: 'telegram', empfaenger: 'Besitzer bzw. Zuständige des To-dos', anlass: 'eingestellte Erinnerungszeit eines offenen To-dos ist erreicht', zeitpunkt: 'zur Erinnerungszeit', schalter: { art: 'je_vorgang', wo: 'pro To-do: Erinnerung' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'tagesplan_morgen', name: '„Dein Tag“ (Tagesablauf morgens)', kanal: 'telegram', empfaenger: 'wer den Tagesablauf eingeschaltet hat', anlass: 'Arbeitstag mit offenen Einträgen', zeitpunkt: 'werktags ab 7:45', schalter: { art: 'je_person', wo: 'Tagesablauf-Einstellungen' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'tagesplan_abend', name: '„Offen geblieben – morgen übernehmen?“', kanal: 'telegram', empfaenger: 'wer den Tagesablauf-Abend eingeschaltet hat', anlass: 'im heutigen Plan ist etwas offen', zeitpunkt: 'werktags ab 17:30', schalter: { art: 'je_person', wo: 'Tagesablauf-Einstellungen' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'abend_rueckblick', name: 'Abend-Rückblick', kanal: 'telegram', empfaenger: 'alle Mitarbeiter mit Telegram (ohne die mit Tagesablauf-Abend)', anlass: 'Arbeitstag mit heute erledigten oder offenen fälligen Aufgaben', zeitpunkt: 'werktags ab der eingestellten Uhrzeit (17:30), einmal am Tag', schalter: { art: 'stufe', id: 'abend_rueckblick' }, text: { art: 'fest', beispiel: 'Heute erledigt: 4\nNoch offen und fällig:\n• … [✓ Erledigt] [→ Morgen]\nMorgen: …' }, protokoll: 'nachrichten_protokoll' },
  { id: 'bitte_bestaetigen', name: '„Bitte bestätigen“ – Zuordnungsvorschläge', kanal: 'telegram', empfaenger: 'eingetragene Empfänger (derzeit alle)', anlass: 'offene Vorschläge: Termin, E-Mail oder Datei aus „Ungeklärte Eingänge“ → Akte', zeitpunkt: 'werktags ab 8:20, einmal am Tag, höchstens 5 je Person', schalter: { art: 'empfaenger', id: 'bitte_bestaetigen' }, text: { art: 'fest', beispiel: 'Bitte bestätigen (1 von 5): Termin → Akte\n\nTermin: „…“ am Fr 27.11. um 12:00\nVorschlag: Akte „…“\nGrund: …\n[✅ Ja] [Andere Akte] [Ignorieren]' }, protokoll: 'telegram_vorschlaege' },
  { id: 'status_vorschlag', name: 'Statuswechsel vorschlagen', kanal: 'telegram', empfaenger: 'Verantwortlicher der Akte', anlass: 'Termin mit Akte angelegt, Vertrag/Vollmacht abgelegt, Angebot erstellt oder Kunde hat auf unsere Mail geantwortet', zeitpunkt: 'werktags 8–19 Uhr; je Akte ein offener Vorschlag, nach „Nein“ 7 Tage Pause', schalter: { art: 'empfaenger', id: 'status_vorschlag' }, text: { art: 'fest', beispiel: 'Status ändern?\n\nAkte: „…“\nAnlass: Der Kunde hat auf eine E-Mail geantwortet\nJetzt: Lead / Neuanfrage\nVorschlag: Erstkontakt hergestellt\n[✅ Ja] [Nein]' }, protokoll: 'telegram_vorschlaege' },
  { id: 'kontakt_nachfrage', name: '„Zu Akte X fehlen Telefon und E-Mail – weißt du sie?“', kanal: 'telegram', empfaenger: 'Verantwortlicher der Akte', anlass: 'laufende Akte ganz ohne Telefon und E-Mail', zeitpunkt: 'werktags 10:30–12 Uhr, höchstens 3 Akten am Tag; dieselbe Akte frühestens nach 30 Tagen', schalter: { art: 'stufe', id: 'kontakt_nachfrage' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'kurzpruefung_hinweis', name: 'Wochenhinweis Kurzprüfung', kanal: 'telegram', empfaenger: 'Verantwortliche von Akquise-Objekten', anlass: 'Objekte in der Akquise ohne begonnene Kurzprüfung', zeitpunkt: 'montags 9–11 Uhr, einmal pro Woche', schalter: { art: 'stufe', id: 'kurzpruefung_hinweis' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'objekt_luecken', name: '„Was fehlt noch in deinen Objektakten?“', kanal: 'telegram', empfaenger: 'Verantwortliche von Objekten in Vorbereitung/Vermarktung', anlass: 'Lücken laut Vollständigkeitsprüfung', zeitpunkt: 'montags ab 8:30, einmal pro Woche', schalter: { art: 'je_person', wo: 'je Person abschaltbar' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'kundenbericht_erinnerung', name: '„Statusbericht ist fertig – prüfen und senden“', kanal: 'telegram', empfaenger: 'Verantwortlicher der Akte (nie der Kunde)', anlass: 'Akte hat einen Berichtstag eingestellt', zeitpunkt: 'am eingestellten Wochentag ab 8 Uhr', schalter: { art: 'an_aus', id: 'kundenbericht' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'mahn_hinweis', name: 'Mahnvorschläge', kanal: 'telegram', empfaenger: 'Verantwortlicher der Akte, sonst die Geschäftsführung (nie der Kunde)', anlass: 'überfällige Rechnung erreicht die nächste Mahnstufe', zeitpunkt: 'täglich ab 9 Uhr', schalter: { art: 'an_aus', id: 'mahn' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'rechnung_wochenhinweis', name: '„N Rechnungen sind fällig zu stellen“', kanal: 'telegram', empfaenger: 'Geschäftsführung (andere nur, wenn eingeschaltet)', anlass: 'offene Rechnungsvorschläge (angenommener Kostenvoranschlag, erledigte Akte, Seminar, Beurkundung)', zeitpunkt: 'montags 9–12 Uhr', schalter: { art: 'je_person', wo: 'je Person' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'anfrage_neu', name: 'Neue Objektanfrage angelegt', kanal: 'telegram', empfaenger: 'Verantwortlicher des Objekts', anlass: 'Anfragenmanager hat eine Anfrage sicher erkannt und Akte und Portal-Zugang angelegt', zeitpunkt: 'sofort', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'anfrage_unklar', name: 'Mögliche Anfrage, Objekt nicht sicher erkannt', kanal: 'telegram', empfaenger: 'Verantwortlicher des Objekts', anlass: 'Mail sieht nach Anfrage aus, Objekt unsicher – es wird nichts angelegt', zeitpunkt: 'sofort', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'gesuch_treffer', name: 'Neuer Treffer Gesuch ↔ Objekt', kanal: 'telegram', empfaenger: 'Verantwortliche von Objekt und Kontakt', anlass: 'ein Gesuch passt neu zu einem Objekt', zeitpunkt: 'höchstens alle 5 Minuten', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'gespraech_fertig', name: 'Auswertung der Gesprächsaufnahme fertig', kanal: 'telegram', empfaenger: 'wer aufgenommen hat', anlass: 'Abschrift und Auswertung sind fertig oder gescheitert', zeitpunkt: 'sobald fertig', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'buchung_telegram', name: '„Online-Termin gebucht“', kanal: 'telegram', empfaenger: 'Mitarbeiter, bei dem gebucht wurde', anlass: 'Kunde bucht online', zeitpunkt: 'sofort', schalter: { art: 'je_person', wo: 'Online-Buchung' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'portal_meldungen', name: 'Meldungen aus Interessenten- und Kundenportal', kanal: 'telegram', empfaenger: 'Verantwortlicher von Objekt bzw. Akte', anlass: 'Interessent stimmt zu, bucht/sagt Besichtigung ab, bittet um Rückruf oder Kunde schreibt über seinen Kundenbereich', zeitpunkt: 'sofort', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'unterschrift_telegram', name: 'Online unterschrieben / abgelehnt', kanal: 'telegram', empfaenger: 'wer die Unterschrift angefordert hat', anlass: 'Kunde unterschreibt online oder lehnt ab', zeitpunkt: 'sofort', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'seminar_anmeldung_telegram', name: 'Neue Seminar-Anmeldung', kanal: 'telegram', empfaenger: 'Zuständiger des Seminars', anlass: 'Anmeldung über die Internetseite', zeitpunkt: 'sofort', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'todo_aufraeumen', name: '„Du hast N alte To-dos – aufräumen?“', kanal: 'telegram', empfaenger: 'wer es eingeschaltet hat', anlass: 'mindestens 10 alte To-dos', zeitpunkt: 'einmal im Monat, werktags 9–10 Uhr', schalter: { art: 'je_person', wo: 'To-do-Liste → Aufräumen' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'tipp_der_woche', name: 'Tipp der Woche aus „Neu im CRM“', kanal: 'telegram', empfaenger: 'Mitarbeiter mit ungelesener passender Neuerung', anlass: 'neue Funktion, die die Person noch nicht kennt', zeitpunkt: 'dienstags ab 10 Uhr, höchstens einmal pro Woche', schalter: { art: 'je_person', wo: '„Neu im CRM“' }, text: { art: 'fest', beispiel: 'Inhalt aus „Neu im CRM“' }, protokoll: 'nachrichten_protokoll' },
  { id: 'wochenbericht_gf', name: 'Wochenbericht (Zahlen)', kanal: 'telegram', empfaenger: 'Geschäftsführung', anlass: 'Wochenende', zeitpunkt: 'freitags ab 16 Uhr', schalter: { art: 'je_person', wo: 'Kalender-Einstellungen' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'wochenrueckblick', name: 'Wochenrückblick für die Geschäftsführung', kanal: 'telegram', empfaenger: 'eingetragene Empfänger', anlass: 'Wochenabschluss', zeitpunkt: 'am eingestellten Tag (Vorgabe freitags 16 Uhr)', schalter: { art: 'je_person', wo: 'Superuser-Bereich: Wochenrückblick' }, text: { art: 'ki', hinweis: 'Zahlen fest, zwei Sätze Zusammenfassung von der KI' }, protokoll: 'nachrichten_protokoll' },
  { id: 'kontrollbericht', name: 'Täglicher Kontrollbericht (Quirin → Hasan)', kanal: 'telegram', empfaenger: 'eingetragener Empfänger je Mitarbeiter', anlass: 'Arbeitstag', zeitpunkt: 'werktags ab 18 Uhr', schalter: { art: 'je_person', wo: 'Einstellung Kontrollbericht' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll' },
  { id: 'superuser_meldungen', name: 'Superuser: Wochenbericht, Wünsche, Datensicherung', kanal: 'telegram', empfaenger: 'nur Superuser', anlass: 'Wochenende, neue Wünsche/Fehler aus den Gesprächen, fehlgeschlagene Sicherung', zeitpunkt: 'freitags 16 Uhr bzw. alle 2 Stunden bzw. nachts', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'nachrichten_protokoll', hinweis: 'nur für Superuser' },

  // ── Privater Assistent ────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'privat_morgenplan', name: 'Privater Morgenplan', kanal: 'privat', empfaenger: 'nur der Besitzer des privaten Assistenten', anlass: 'private Termine, eigene To-dos, Hotmail, Fristen, unbeantwortete Mails', zeitpunkt: 'täglich ab 8 Uhr', schalter: { art: 'je_person', wo: 'im privaten Assistenten („Morgenplan aus“)' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'privat_abendrueckblick', name: 'Privater Abend-Rückblick', kanal: 'privat', empfaenger: 'nur der Besitzer', anlass: 'erledigte oder offene eigene To-dos', zeitpunkt: 'täglich ab 21:30', schalter: { art: 'je_person', wo: 'im privaten Assistenten' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'privat_termin_briefing', name: 'Privates Kurz-Briefing vor Terminen', kanal: 'privat', empfaenger: 'nur der Besitzer', anlass: 'privater Termin mit erkennbarer Person', zeitpunkt: '25–40 Minuten vorher', schalter: { art: 'je_person', wo: 'im privaten Assistenten' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'privat_wochenrueckblick', name: 'Privater Sonntags-Wochenrückblick', kanal: 'privat', empfaenger: 'nur der Besitzer', anlass: 'Wochenende', zeitpunkt: 'sonntags ab 18 Uhr', schalter: { art: 'je_person', wo: 'im privaten Assistenten' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'privat_vormerkungen', name: 'Vorschläge aus Mails: Fristen, Zusagen, Termine', kanal: 'privat', empfaenger: 'nur der Besitzer', anlass: 'die KI findet in privaten Mails eine Frist, eine eigene Zusage oder einen Termin', zeitpunkt: 'um 7:15, 12:30 und 17:30', schalter: { art: 'je_person', wo: 'nur mit privatem Assistenten' }, text: { art: 'ki', hinweis: 'die KI fasst den Fund zusammen' }, protokoll: 'keins', hinweis: 'Private Inhalte werden bewusst nirgends gesammelt.' },

  // ── Wiedervorlagen / Follow-ups ───────────────────────────────────────────────────────────────────────────────────
  { id: 'wv_regeln', name: 'Automatische Wiedervorlagen (Regelkatalog)', kanal: 'wiedervorlage', empfaenger: 'Verantwortlicher der Akte (erscheint in Morgen-Übersicht und Abend-Rückblick)', anlass: 'Akte neu oder Stand gewechselt, Unterlagen angefordert/eingegangen, Angebot, Rechnung versendet, Termin — je nach Regel; schließt sich bei Statuswechsel', zeitpunkt: 'fällig nach den Tagen der jeweiligen Regel', schalter: { art: 'je_vorgang', wo: 'je Regel unten an/aus' }, text: { art: 'wv_regeln' }, protokoll: 'wiedervorlagen' },
  { id: 'followup_erstkontakt', name: 'Follow-up „Erstkontakt aufnehmen“', kanal: 'wiedervorlage', empfaenger: 'die neue Akte', anlass: 'die KI legt aus einer eingehenden Mail eine Anfrage an oder ein Kunde füllt das Anfrage-Formular aus', zeitpunkt: 'fällig am selben Tag', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'followup_seminar', name: 'Follow-up „Anmeldung bestätigen“', kanal: 'wiedervorlage', empfaenger: 'die neue Akademie-Akte', anlass: 'Seminar-Anmeldung über das Internet legt eine neue Akte an', zeitpunkt: 'fällig am selben Tag', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'keins' },
  { id: 'followup_behoerde', name: 'Follow-up „Rückmeldung der Behörde prüfen“', kanal: 'wiedervorlage', empfaenger: 'die Akte', anlass: 'Vollmacht automatisch an die Behörde geschickt', zeitpunkt: 'fällig nach 14 Tagen', schalter: { art: 'immer' }, text: { art: 'fest' }, protokoll: 'keins' },
]

/** Platzhalter der neuen Vorlagen (mv-auto-*); Gast-Mails, Buchung, Unterschrift. */
export const AUTOMATIK_PLATZHALTER: Record<string, { name: string; bedeutung: string }[]> = {
  gast: [
    { name: 'Anrede', bedeutung: '„Guten Tag Max Muster,“ bzw. „Guten Tag,“' },
    { name: 'Titel', bedeutung: 'Titel des Termins' },
    { name: 'Zeit', bedeutung: 'Datum und Uhrzeit, z. B. „Di., 01.12.2026, 14:00–16:00 Uhr“' },
    { name: 'Ort', bedeutung: 'Ort des Termins (leer, wenn keiner)' },
    { name: 'Eckdaten', bedeutung: 'Titel, Zeit und Ort untereinander' },
    { name: 'Absender', bedeutung: 'Name des Mitarbeiters, der den Termin angelegt hat' },
    { name: 'Name', bedeutung: 'Name des Gastes (leer, wenn keiner bekannt)' },
  ],
  gast_erinnerung: [
    { name: 'Anrede', bedeutung: '„Guten Tag Max Muster,“ bzw. „Guten Tag,“' },
    { name: 'Wann', bedeutung: '„bevorstehenden Termin“ (1 Tag vorher) bzw. „Termin in einer Stunde“' },
    { name: 'Titel', bedeutung: 'Titel des Termins' },
    { name: 'Zeit', bedeutung: 'Datum und Uhrzeit' },
    { name: 'Ort', bedeutung: 'Ort des Termins' },
    { name: 'Eckdaten', bedeutung: 'Titel, Zeit und Ort untereinander' },
    { name: 'Absender', bedeutung: 'Name des Mitarbeiters' },
    { name: 'Name', bedeutung: 'Name des Gastes' },
  ],
  buchung_bestaetigung: [
    { name: 'Anrede', bedeutung: '„Guten Tag Max Muster,“' },
    { name: 'Name', bedeutung: 'Name der Person, die gebucht hat' },
    { name: 'Titel', bedeutung: 'Titel des Termins' },
    { name: 'Tag', bedeutung: 'z. B. „Dienstag, 01.12.2026“' },
    { name: 'Datum', bedeutung: 'z. B. „01.12.2026“' },
    { name: 'Uhrzeit', bedeutung: 'Beginn, z. B. „14:00“' },
    { name: 'Bis', bedeutung: 'Ende, z. B. „15:00“' },
    { name: 'Zeit', bedeutung: 'Tag, von–bis Uhr' },
    { name: 'Ort', bedeutung: 'Ort aus der Buchungseinstellung' },
    { name: 'Hinweis', bedeutung: 'Hinweis aus der Buchungseinstellung' },
    { name: 'Eckdaten', bedeutung: 'Titel, Zeit, Ort, Gesprächspartner und Hinweis untereinander' },
    { name: 'Absender', bedeutung: 'Name des Mitarbeiters' },
  ],
  unterschrift_kopie: [
    { name: 'Anrede', bedeutung: '„Guten Tag Max Muster,“' },
    { name: 'Name', bedeutung: 'Name des Unterzeichners' },
    { name: 'Dokument', bedeutung: 'Titel des unterschriebenen Dokuments' },
  ],
}
