// Wortlaut der Kanzlei-Formulare, aus den gescannten Originalen vom 21.09.2026 übernommen.
//
// Die Online-Formulare (src/pages/formulare) zeigen diese Texte und keinen selbst formulierten
// Ersatz. Geändert wurde nur, was der Nutzer vorgegeben hat oder ein offensichtlicher Tippfehler
// war: die Anschrift (Schwabstraße 3, 89075 Ulm statt Herrlinger Str. 83), "Unterzeichung",
// "Wiederruf", "besondere Rechtsgeschäft", "Zeite". Die Paragraphen der Geheimhaltungsvereinbarung
// stehen exakt wie gedruckt, auch dort, wo der Satzbau holpert — Vertragsinhalt wird hier nicht
// umgeschrieben. Dieselben Texte liegen als befüllbare Vorlagen in der Tabelle "vorlagen".
//
// Bewusst NICHT hier: Bankverbindung und Steuernummer (öffentliches Repository).

export const KANZLEI_ANSCHRIFT = 'Schwabstraße 3, 89075 Ulm'

// ---------- Vollmacht für das Finanzamt ----------
export const VOLLMACHT_FINANZAMT = {
  titel: 'Vollmacht für das Finanzamt',
  einleitung: 'Hiermit bevollmächtige ich,',
  bevollmaechtigter: ['die Firma Unternehmensberatung Andreas Mayer', 'Name: Andreas Mayer und seiner Mitarbeiter', `Adresse: ${KANZLEI_ANSCHRIFT}`],
  auftrag: 'mich in allen steuerlichen Angelegenheiten gegenüber dem Finanzamt zu vertreten.',
  rechteEinleitung: 'Die Vollmacht umfasst insbesondere das Recht:',
  rechte: [
    'zur Einsichtnahme in meine Steuerakten,',
    'zur Entgegennahme und Abgabe von Schriftstücken,',
    'zur Stellung und Entgegennahme von Anträgen,',
    'zur Teilnahme an Besprechungen und Verhandlungen mit dem Finanzamt,',
    'zur Entgegennahme von Steuerbescheiden und sonstigen Mitteilungen,',
    'zur Einlegung und Rücknahme von Rechtsbehelfen (z. B. Einspruch),',
    'zur Abgabe und Unterzeichnung von Erklärungen, soweit gesetzlich zulässig.',
  ],
  geltung: 'Die Vollmacht gilt ab dem Tag der Unterzeichnung und ist bis auf Widerruf gültig, mindestens 2 Monate.',
}

// ---------- Vollmacht Bank – Kreditverhandlungen ----------
export const VOLLMACHT_BANK = {
  titel: 'Vollmacht Bank – Kreditverhandlungen',
  bevollmaechtigter: ['Bevollmächtigte Person: Unternehmensberatung Andreas Mayer Consulting', 'Schwabstraße 3', '89075 Ulm'],
  // {name} und {bank} werden beim Anzeigen eingesetzt.
  erteilung:
    'Hiermit erteile ich, {name}, der Unternehmensberatung Andreas Mayer Consulting die Vollmacht, in meinem Namen und für meine Rechnung bei der Bank {bank} Verhandlungen über die Aufnahme von Krediten und Darlehen zu führen.',
  rechteEinleitung: 'Die bevollmächtigte Person ist berechtigt:',
  rechte: [
    'Kreditangebote zu prüfen und zu verhandeln',
    'Kreditverträge zu unterschreiben',
    'Alle notwendigen Dokumente im Zusammenhang mit der Kreditaufnahme auszufüllen und zu unterzeichnen',
  ],
  geltung: 'Diese Vollmacht gilt ab sofort und bleibt gültig, bis sie von mir schriftlich widerrufen wird.',
}

// ---------- Allgemeine Vollmacht ----------
export const ALLGEMEINE_VOLLMACHT = {
  titel: 'Allgemeine Vollmacht',
  befugnis:
    'Der Bevollmächtigte ist befugt, den Vollmachtgeber in allen Angelegenheiten vor Behörden und Privatpersonen zu vertreten. Der Bevollmächtigte ist berechtigt, für die allgemeine Vertretung oder besondere Rechtsgeschäfte Unterbevollmächtigte zu bestellen und in seinem eigenen Namen oder als Vertreter weiterer Personen Rechtsgeschäfte vorzunehmen.',
  fortgeltung: 'Diese Vollmacht erlischt nicht mit dem Tode, sondern durch den Widerruf des Vollmachtgebers oder den Widerruf der Erben.',
}

// ---------- Geheimhaltungs- und Quellenschutzvereinbarung ----------
export const GEHEIMHALTUNG = {
  titel: 'Geheimhaltungs- und Quellenschutzvereinbarung',
  parteiBezeichnung: '(nachstehend Partei / MA / Vermittler genannt)',
  auftraggeberBezeichnung: '(nachstehend Auftraggeber genannt)',
  ueberleitung: 'wird folgendes vereinbart:',
  paragraphen: [
    {
      titel: '§ 1 Gegenstand des Vertrages',
      text: 'Die Parteien bestätigen unwiderruflich und rechtsverbindlich vollen Quellen-, Kunden-, Objekt und Courtageschutz für alle im Rahmen der Geschäftstätigkeiten, aus Gesprächen, Verkäufen, Vermittlungen und/oder Telefonaten, Schriftstücken ersichtlicher Firmen, Unternehmungen, Gesellschaften und Personen. Sie behält unabhängig vom Grund auch dann ihre Gültigkeit, wenn es zu dem angestrebten Geschäftsabschluss nicht gekommen sein sollte.',
    },
    {
      titel: '§ 2 Nichtumgehung',
      text: 'Ferner verpflichtet sich die Partei die bekannt gegebenen Adressen und Informationen streng vertraulich zu behandeln und nicht ohne Zustimmung der anderen Seite zur Verwertung anzubieten und zur Kenntnis zu bringen. Ferner verpflichtet sich die Parteien ausdrücklich, keine Geschäfte über vorgeschobene Dritte, gleichgültig ob natürliche oder juristische Personen, mit den zu Objekten, Kunden/Aufträgen zur Verfügung gestellten Unterlagen abzuwickeln.',
    },
    {
      titel: '§ 3 Verschwiegenheit beteiligter Personen',
      text: 'Die Vertragspartei zeichnet gleichermaßen verantwortlich für die Verschwiegenheit und die Einhaltungspflicht der Bestimmungen dieses Vertrages, auch für seine Angestellten und freiberuflichen Mitarbeiter sowie für Dritte und weitere Kontaktpersonen. Die Verschwiegenheit wirkt über die Vertragsdauer hinaus.',
    },
    {
      titel: '§ 4 Direkte Kontaktaufnahme',
      text: 'Direkte Kontaktaufnahme ist nur über die Firma zulässig. Sollte bereits ein Kontakt zu den Geschäftspartner des anderen auf direktem Wege bestehen muss dies sofort nach dessen Bekanntgabe mitgeteilt und gegebenenfalls bewiesen werden. Dies entbindet nicht den Kunden- Objektschutz usw..',
    },
    {
      titel: '§ 5 Schriftformerfordernis',
      text: 'Über jegliche im Sinne dieses Vertrages sich anbahnenden Geschäfte unterrichtet der Geschäftspartner unverzüglich und unaufgefordert.',
    },
    {
      titel: '§ 6 Konventionalstrafe',
      text: 'Bei fahrlässigem Verstoß gegen diese Vereinbarung oder vorsätzlicher Zuwiderhandlung unterliegen die Partei einer Konventionalstrafe in doppelter Höhe nach § 3 für jedes einzelne, unloyal erzielte Geschäftsvolumen min. 20.000,00 €.',
    },
    {
      titel: '§ 7 Weiterbeauftragung',
      text: 'Die Partei werden Untervermittler nur in Abstimmung beauftragen. Die Rechten und Pflichten aus dieser Vereinbarung sind dann zwischen Beauftragenden und Untervermittler zu fixieren umzusetzen und zu überwachen',
    },
    {
      titel: '§ 8 Vertragsdauer',
      text: 'Diese Vereinbarung gilt zunächst bis zum Ablauf von fünf Jahren ab Datum dieses Vertrages und verlängert sich automatisch um jeweils ein Jahr. Die Vereinbarung kann mit 3 Monaten Frist zum jeweiligen Vertragsende gekündigt werden. Eine Kündigung aus wichtigem Grund bleibt unbenommen.',
    },
    {
      titel: '§ 9 Salvatorische Klausel',
      text: 'Mündliche Nebenabreden sind nicht getroffen. Änderungen und Ergänzungen dieser Vereinbarung bedürfen zu ihrer Wirksamkeit der Schriftform. Sollte eine Bestimmung dieses Vertrages unwirksam sein oder werden, sollte sich bei der praktischen Abwicklung der Zusammenarbeit eine Vertragslücke herausstellen, so bleibt die Wirksamkeit der übrigen Bestimmungen hiervon unberührt. Die Vertragsparteien verpflichten sich die unwirksamen Bestimmungen durch solche zu ersetzen, die dem wirtschaftlichem Zwecke dieser Vereinbarung am nächsten kommen. Eine zu ergänzende Vertragslücke ist ebenfalls unter Berücksichtigung der wirtschaftlichen Zielsetzung des Vertragswerkes zu schließen.',
    },
    {
      titel: '§ 10 Rechtsverbindlichkeit',
      text: 'Die vertragsschließenden Parteien bestätigen die Rechtsverbindlichkeit dieses Vertrages auch bei Übermittlung / Unterzeichnung per Fax oder e-Mail mit Rückbestätigung.',
    },
  ],
  schluss: 'Dieser Vertrag wird von den Unterzeichnern im eigenen und im Namen ihrer Firmen getroffen.',
}

// ---------- Feedbackbogen ----------
export const FEEDBACKBOGEN = {
  titel: 'Feedbackbogen – Vermögensschutz in unsicheren Zeiten',
  pflichtHinweis: 'Alle Felder mit Stern * sind Pflichtfelder zum Ausfüllen',
  abschnitt1: '1. Allgemeines Feedback zu Vortrag',
  kriterien: [
    'Verständlichkeit der Inhalte',
    'Praxisrelevanz für meine Situation',
    'Ist es Ihnen bewusst wieviel Geld Sie in der Vergangenheit verschenkt haben',
    'Nutzen für meine persönlichen Planung',
  ],
  bewertungsHinweis: 'Bitte bewerten Sie durch ein Kreuz in Feld: JA oder NEIN',
  abschnitt2: '2. Offenes Feedback',
  frageErkenntnis: 'Welcher Impuls aus dem Vortrag hat Ihnen die größte Erkenntnis gebracht',
  abschnitt3: '3. Ihre momentane Aufstellung (Privat/ Unternehmerisch) betrachtet',
  aufstellungHinweis: 'Diese Daten sind wichtig, um den Nutzenvorteil im Beratungsgespräch bzgl. Ihrer Situation darstellen zu können!',
  unternehmerisch: {
    kopf: ['Kriterien (unternehmerisch) Ausfüllen', 'Anzahl', 'ca. Wert / Investment (€)'],
    zeilen: ['Unternehmen', 'Umsatzvolumen p.a.', 'Immobilien', 'Investment (ETF/ Fonds/ Unternehmensbeteiligungen)'],
  },
  persoenlich: {
    kopf: 'Kriterien (persönlich) Ausfüllen',
    zeilen: ['Familienstand (verh./ gesch./verw.)', 'Kinder (Anzahl / Alter)', 'Ehevertrag (Ja/Nein)', 'Unternehmensnachfolge geregelt (Ja/ Nein)'],
  },
  abschnitt4: '4. Beratungsgespräch / Kosten',
  anspruch: 'Um Ihren Anspruch (zeitnah) für ein persönliches Beratungsgespräch geltend zu machen kreuzen Sie an:',
  kosten: 'Für die Sichtung Ihrer Unterlagen und einer Erstbewertung. Erheben wir eine Aufwandsentschädigung in Höhe von:',
  betrag: '3.250 € (zzgl. Mehrwertsteuer)',
  verrechnung: 'Bei Umsetzung und Auftragserteilung wird die Aufwandsentschädigung verrechnet',
  ja: 'JA → dann kontaktiere ich, (Herr A. Mayer) Sie, um einen Termin zu vereinbaren',
  nein: 'NEIN → aktuell kein Interesse vereinbaren',
  abschnitt5: '5. Einverständnis & Datenschutz (Pflichtfeld *)',
  einverstaendnis: 'Ich bin damit einverstanden, dass meine Angaben zu Kontaktaufnahme genutzt werden.',
  datenschutz:
    'Datenschutzklausel: Ihre Daten werden ausschließlich zum Zweck der Kontaktaufnahme und zur Vereinbarung eines Beratungsgesprächs erhoben, gespeichert und verarbeitet. Eine Weitergabe an Dritte erfolgt nicht, außer Sie wünschen ausdrücklich die Weiterleitung an eine von Ihnen genannte Kontaktperson. Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen. Weitere Informationen finden Sie in unserer Datenschutzerklärung.',
  unterschrift: 'Unterschrift / Ort/ Datum',
}

// ---------- Mandantenfragebogen Vermögens-, Familien- und Nachfolgeplanung ----------
export const MANDANTENFRAGEBOGEN_ERBEN = {
  titel: 'MANDANTENFRAGEBOGEN',
  untertitel: 'Vermögens-, Familien- und Nachfolgeplanung',
  einleitung:
    'Dieser Fragebogen dient der Vorbereitung einer ganzheitlichen Beratung zu Vermögen, Familie, Nachfolge, Erbfall, Schenkung sowie steuerlichen und wirtschaftlichen Auswirkungen geplanter Gestaltungen. Bitte füllen Sie die Angaben möglichst vollständig aus und reichen Sie die jeweils relevanten Unterlagen ein. Bei mehreren Eigentümern, Ehegatten, Lebenspartnern oder sonstigen Beteiligten kann der Fragebogen für jede relevante Person gesondert verwendet werden.',
  umfangTitel: 'Hinweis zum Umfang der Unterlagen',
  umfang:
    'Bitte reichen Sie nur Unterlagen und Angaben ein, die auf Ihre persönliche, familiäre, vermögensrechtliche oder steuerliche Situation zutreffen oder für die konkrete Beratung erforderlich sein können. Unterlagen, die für Sie nicht einschlägig sind, nicht vorliegen oder keinen Bezug zum Beratungsauftrag haben, müssen nicht eingereicht werden. Bitte vermerken Sie in diesen Fällen in der Spalte „Bemerkung“ beispielsweise: „Nicht zutreffend“, „Nicht vorhanden“, „Wird angefordert bei …“ oder „Nachreichung bis voraussichtlich …“.',
  datenschutzTitel: 'Datenschutzhinweis',
  datenschutz: [
    'Die im Rahmen dieses Fragebogens und durch beigefügte Unterlagen übermittelten personenbezogenen Daten werden ausschließlich zur Prüfung, Vorbereitung, Durchführung und Dokumentation der angefragten Beratung verarbeitet. Dies kann insbesondere Angaben zu Familie, möglichen Erben, Vermögen, Immobilien, Unternehmen, Beteiligungen, Finanzierungen, steuerlichen Unterlagen, Testamenten, Erbverträgen und Vollmachten umfassen.',
    `Die Verarbeitung erfolgt nur, soweit sie für die Anbahnung oder Durchführung des Beratungsverhältnisses erforderlich ist, zur Erfüllung rechtlicher Pflichten notwendig ist oder eine rechtliche Grundlage beziehungsweise Einwilligung besteht. Ihre Daten werden vertraulich behandelt und nur den mit der Bearbeitung betrauten Personen zugänglich gemacht. Eine Weitergabe an Dritte erfolgt nur, soweit sie zur Bearbeitung erforderlich, von Ihnen veranlasst oder gesetzlich vorgeschrieben ist. Weitere Informationen erhalten Sie bei: Andreas Mayer Holding UG, ${KANZLEI_ANSCHRIFT}.`,
  ],
  vermoegenTitel: '4. Vermögensübersicht',
  vermoegenEinleitung:
    'Bitte erfassen Sie sämtliche wesentlichen Vermögenswerte und Verbindlichkeiten. Für umfangreiche Vermögen kann die Tabelle auf einer separaten Anlage fortgeführt werden.',
  vermoegenBereiche:
    'Relevante Vermögensbereiche: Immobilien, selbstgenutztes Wohneigentum, Gewerbeimmobilien, Unternehmens- und Gesellschaftsbeteiligungen, Betriebsvermögen, Bankguthaben, Wertpapierdepots, Lebens- und Rentenversicherungen, Darlehensforderungen, Verbindlichkeiten, Kunst/Sammlungen/Fahrzeuge, digitales Vermögen, Auslandsvermögen und sonstige Vermögenswerte.',
  zieleTitel: '7. Ziele und offene Fragen',
  zieleFrage: 'Bitte beschreiben Sie Ihre wichtigsten Ziele und Prioritäten für die geplante Vermögens-, Erb- oder Nachfolgegestaltung:',
  schlussHinweis:
    'Hinweis: Dieser Fragebogen dient ausschließlich der Vorbereitung der Beratung und ersetzt keine individuelle rechtliche, notarielle oder steuerliche Einzelfallprüfung.',
  fusszeile: 'Vertrauliche Mandantenunterlage',
}

/**
 * Die Checklisten-Abschnitte des Mandantenfragebogens (Abschnitte 1–3, 5 und 6 des Originals; 4 und 7
 * sind dort Freitext). Jeder Punkt ist wörtlich die Zeile "Unterlage / Angabe" des Originals.
 */
export const ERBEN_CHECKLISTE: { kategorie: string; punkte: string[] }[] = [
  {
    kategorie: '1. Persönliche Angaben',
    punkte: [
      'Vollständiger Name, Geburtsname, Geburtsdatum und Geburtsort',
      'Aktuelle Wohnanschrift und gewöhnlicher Aufenthalt',
      'Staatsangehörigkeit(en)',
      'Steuerliche Ansässigkeit; ggf. weitere Staaten',
      'Familienstand',
      'Datum der Eheschließung bzw. Begründung einer Lebenspartnerschaft',
      'Güterstand: Zugewinngemeinschaft, Gütertrennung oder Gütergemeinschaft',
      'Ehevertrag, Partnerschaftsvertrag oder Güterstandsvereinbarung',
      'Frühere Ehen oder Lebenspartnerschaften',
      'Unterhalts-, Pflege- oder sonstige dauerhafte Verpflichtungen',
    ],
  },
  {
    kategorie: '2. Familie und mögliche Erben',
    punkte: [
      'Ehegatte bzw. eingetragener Lebenspartner: Name und Geburtsdatum',
      'Kinder einschließlich Adoptiv-, Stief- und Pflegekinder',
      'Je Kind: Name, Geburtsdatum, Familienstand, Wohnsitz und Steueransässigkeit',
      'Minderjährige Kinder oder wirtschaftlich abhängige Angehörige',
      'Enkelkinder und weitere Abkömmlinge',
      'Eltern, Geschwister und weitere Angehörige, soweit relevant',
      'Patchwork-Familie, Stiefkinder oder nicht eheliche Kinder',
      'Personen mit Betreuungs-, Pflege- oder besonderem Schutzbedarf',
      'Gewünschte Erben oder Begünstigte',
      'Personen, die bewusst nicht bedacht werden sollen',
      'Voraussichtliche Pflichtteilsberechtigte bzw. Pflichtteilsrisiken',
    ],
  },
  {
    kategorie: '3. Testamente und Vorsorge',
    punkte: [
      'Eigenhändiges oder notarielles Testament',
      'Gemeinschaftliches Testament von Ehegatten',
      'Erbvertrag',
      'Vermächtnisse, Auflagen oder Teilungsanordnungen',
      'Pflichtteilsverzichts-, Erbverzichts- oder Abfindungsvereinbarungen',
      'Vorsorgevollmacht',
      'Patientenverfügung',
      'Betreuungsverfügung',
      'Notarverwahrung bzw. Registrierung letztwilliger Verfügungen',
      'Regelung für den Fall der Geschäftsunfähigkeit',
    ],
  },
  {
    kategorie: '5. Immobilien, Unternehmen und Finanzierung — Immobilien und Eigentum',
    punkte: [
      'Aktuelle Grundbuchauszüge zu sämtlichen Grundstücken und Miteigentumsanteilen',
      'Teilungserklärung bzw. Gemeinschaftsordnung, falls vorhanden',
      'Kaufvertrag, Übertragungsurkunde oder sonstiger Erwerbsnachweis je Objekt bzw. Anteil',
      'Aktuelles Verkehrswertgutachten oder belastbare Marktwertindikation',
      'Unterlagen zum Bodenwertanteil bzw. Grundstücksanteil',
      'Mieterliste, Hauptmietverträge und Nachträge',
      'Index-, Staffel-, Options- und Sonderkündigungsregelungen',
      'Übersicht zu Mietrückständen, Kautionen und Bürgschaften',
    ],
  },
  {
    kategorie: '5. Immobilien, Unternehmen und Finanzierung — Gesellschaften und Beteiligungen',
    punkte: [
      'Übersicht aller aktuellen und geplanten Gesellschaften einschließlich Beteiligungsquoten',
      'Gesellschaftsverträge, Satzungen und Nachfolgeklauseln',
      'Aktuelle Handelsregisterauszüge und Gesellschafterlisten',
      'Übersicht von Beteiligungsketten, Sonderbetriebsvermögen und Gesellschafterdarlehen',
    ],
  },
  {
    kategorie: '5. Immobilien, Unternehmen und Finanzierung — Finanzierung und Sicherheiten',
    punkte: [
      'Sämtliche bestehenden Darlehensverträge',
      'Aktuelle Restschuldbescheinigungen',
      'Unterlagen zu Sicherheiten, Grundschulden, Bürgschaften und persönlichen Haftungen',
      'Angaben zu Zinsbindungen, Prolongationen, Covenants und Change-of-Control-Klauseln',
    ],
  },
  {
    kategorie: '6. Frühere Übertragungen und Steuerdaten',
    punkte: [
      'Schenkungen der vergangenen zehn Jahre',
      'Frühere Erbschaften und Vermächtnisse',
      'Frühere Übertragungen von Immobilien oder Gesellschaftsanteilen',
      'Übertragungen unter Nießbrauchs- oder Wohnrechtsvorbehalt',
      'Rückforderungsrechte, Widerrufsrechte oder Pflegeauflagen',
      'Steuerbescheide zur Schenkung- oder Erbschaftsteuer',
      'Einkommensteuer- bzw. Feststellungserklärungen der letzten drei Jahre',
      'Jahresabschlüsse, Bilanzen oder Einnahmen-Überschuss-Rechnungen der letzten drei Jahre',
      'Unterlagen zur bisherigen Abschreibung (AfA)',
      'Nachweise zu Anschaffungs- bzw. Herstellungskosten',
      'Bewertungsgutachten oder steuerliche Wertfeststellungen',
      'Offene Betriebsprüfungen, Einsprüche oder sonstige steuerliche Risiken',
    ],
  },
]
