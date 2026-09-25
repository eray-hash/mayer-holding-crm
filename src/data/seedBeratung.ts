import type { Kunde, Rechnung, Protokoll, Konzept, Beratungsvertrag, Vorlage } from '../types'
import { addDays, uid } from '../lib/dates'

// Referenzdatum der Demo: 08.09.2026
const REF = '2026-09-08'

const rel = (days: number) => addDays(REF, days)

export const seedKunden: Kunde[] = [
  {
    id: 'k1',
    firma: 'Nordwind Maschinenbau GmbH',
    ansprechpartner: 'Sabine Kellermann',
    email: 's.kellermann@nordwind-maschinen.de',
    telefon: '+49 421 55 12 340',
    prioritaet: 'Hoch',
    status: 'lead',
    followUp: { date: rel(3), note: 'Erstkontakt-Anruf vereinbaren', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-2),
    activities: [
      { id: uid('act'), date: rel(-2), text: 'Anfrage über Website eingegangen', user: 'System' },
    ],
  },
  {
    id: 'k2',
    firma: 'Lindenhof Textilhandel KG',
    ansprechpartner: 'Michael Groß',
    email: 'm.gross@lindenhof-textil.de',
    telefon: '+49 30 88 21 904',
    prioritaet: 'Mittel',
    status: 'erstkontakt',
    followUp: { date: rel(-4), note: 'Rückruf zur Terminfindung', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-4),
    activities: [
      { id: uid('act'), date: rel(-9), text: 'Status: Lead / Neuanfrage → Erstkontakt hergestellt am ' + rel(-9) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k3',
    firma: 'Bergmann & Schuster Logistik AG',
    ansprechpartner: 'Christine Bergmann',
    email: 'c.bergmann@bs-logistik.de',
    telefon: '+49 211 77 43 210',
    prioritaet: 'Hoch',
    status: 'termin',
    followUp: { date: rel(2), note: 'Erstgespräch vorbereiten (Unterlagen)', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-1),
    activities: [
      { id: uid('act'), date: rel(-6), text: 'Status: Erstkontakt hergestellt → Erstgespräch terminiert am ' + rel(-6) + ' durch Thomas Berger', user: 'Thomas Berger' },
      { id: uid('act'), date: rel(-1), text: 'Termin für ' + rel(2) + ' bestätigt', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k4',
    firma: 'Falkenstein Immobilienverwaltung GmbH',
    ansprechpartner: 'Andreas Falkenstein',
    email: 'a.falkenstein@falkenstein-iv.de',
    telefon: '+49 69 90 12 887',
    prioritaet: 'Mittel',
    status: 'durchgefuehrt',
    followUp: { date: rel(5), note: 'Konzept ausarbeiten', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-3),
    activities: [
      { id: uid('act'), date: rel(-3), text: 'Status: Erstgespräch terminiert → Erstgespräch durchgeführt am ' + rel(-3) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k5',
    firma: 'Rheinquell Getränke GmbH',
    ansprechpartner: 'Peter Winkelmann',
    email: 'p.winkelmann@rheinquell.de',
    telefon: '+49 221 33 56 771',
    prioritaet: 'Hoch',
    status: 'konzept',
    followUp: { date: rel(-2), note: 'Feedback zum Konzept einholen', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-7),
    activities: [
      { id: uid('act'), date: rel(-7), text: 'Status: Erstgespräch durchgeführt → Konzeptvorstellung am ' + rel(-7) + ' durch Thomas Berger', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k6',
    firma: 'Wiesengrund Agrarhandel eG',
    ansprechpartner: 'Katrin Voss',
    email: 'k.voss@wiesengrund-agrar.de',
    telefon: '+49 511 22 98 034',
    prioritaet: 'Niedrig',
    status: 'angebot',
    followUp: { date: rel(6), note: 'Nachfassen zum Angebot', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-4),
    activities: [
      { id: uid('act'), date: rel(-4), text: 'Status: Konzeptvorstellung → Angebot / Beratungsvertrag versendet am ' + rel(-4) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k7',
    firma: 'Amberger Feinmechanik GmbH',
    ansprechpartner: 'Robert Amberger',
    email: 'r.amberger@amberger-feinmechanik.de',
    telefon: '+49 941 44 21 665',
    prioritaet: 'Mittel',
    status: 'unterschrieben',
    followUp: { date: rel(1), note: 'Mandat starten, Kickoff planen', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-1),
    activities: [
      { id: uid('act'), date: rel(-1), text: 'Status: Angebot / Beratungsvertrag versendet → Beratungsvertrag unterschrieben am ' + rel(-1) + ' durch Thomas Berger', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k8',
    firma: 'Hoffmann & Cie. Vermögensverwaltung',
    ansprechpartner: 'Elisabeth Hoffmann',
    email: 'e.hoffmann@hoffmann-vv.de',
    telefon: '+49 89 66 43 219',
    prioritaet: 'Hoch',
    status: 'aktives_mandat',
    followUp: { date: rel(-6), note: 'Quartalsreview durchführen', done: false },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-12),
    activities: [
      { id: uid('act'), date: rel(-30), text: 'Status: Beratungsvertrag unterschrieben → Aktives Mandat / laufende Beratung am ' + rel(-30) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
      { id: uid('act'), date: rel(-12), text: 'Zwischenbericht versendet', user: 'Julia Hartmann' },
    ],
  },
  {
    id: 'k9',
    firma: 'Seidel Bau- und Projektentwicklung',
    ansprechpartner: 'Frank Seidel',
    email: 'f.seidel@seidel-bau.de',
    telefon: '+49 351 77 88 902',
    prioritaet: 'Mittel',
    status: 'rechnung_gestellt',
    followUp: { date: rel(10), note: 'Zahlungseingang prüfen', done: false },
    verantwortlich: 'Thomas Berger',
    letzteAktivitaet: rel(-5),
    activities: [
      { id: uid('act'), date: rel(-5), text: 'Status: Aktives Mandat / laufende Beratung → Leistung erbracht / Rechnung gestellt am ' + rel(-5) + ' durch Thomas Berger', user: 'Thomas Berger' },
    ],
  },
  {
    id: 'k10',
    firma: 'Brandt & Möller Consulting Partner',
    ansprechpartner: 'Nicole Brandt',
    email: 'n.brandt@brandt-moeller.de',
    telefon: '+49 40 12 34 567',
    prioritaet: 'Niedrig',
    status: 'abgeschlossen',
    followUp: { date: rel(-20), note: 'Mandat abgeschlossen', done: true },
    verantwortlich: 'Julia Hartmann',
    letzteAktivitaet: rel(-15),
    activities: [
      { id: uid('act'), date: rel(-15), text: 'Status: Leistung erbracht / Rechnung gestellt → Abgeschlossen am ' + rel(-15) + ' durch Julia Hartmann', user: 'Julia Hartmann' },
    ],
  },
]

export const seedRechnungen: Rechnung[] = [
  { id: uid('r'), nummer: 'RE-2026-1001', kundeId: 'k7', datum: rel(-40), betragNetto: 4200, betragBrutto: 4998, status: 'Bezahlt', zahlungsziel: rel(-26) },
  { id: uid('r'), nummer: 'RE-2026-1014', kundeId: 'k8', datum: rel(-35), betragNetto: 6800, betragBrutto: 8092, status: 'Bezahlt', zahlungsziel: rel(-21) },
  { id: uid('r'), nummer: 'RE-2026-1022', kundeId: 'k8', datum: rel(-12), betragNetto: 3400, betragBrutto: 4046, status: 'Versendet', zahlungsziel: rel(16) },
  { id: uid('r'), nummer: 'RE-2026-1031', kundeId: 'k9', datum: rel(-5), betragNetto: 9600, betragBrutto: 11424, status: 'Versendet', zahlungsziel: rel(9) },
  { id: uid('r'), nummer: 'RE-2026-0987', kundeId: 'k9', datum: rel(-52), betragNetto: 2100, betragBrutto: 2499, status: 'Überfällig', zahlungsziel: rel(-24) },
  { id: uid('r'), nummer: 'RE-2026-1035', kundeId: 'k10', datum: rel(-16), betragNetto: 12500, betragBrutto: 14875, status: 'Bezahlt', zahlungsziel: rel(-2) },
  { id: uid('r'), nummer: 'RE-2026-0965', kundeId: 'k10', datum: rel(-70), betragNetto: 5400, betragBrutto: 6426, status: 'Überfällig', zahlungsziel: rel(-40) },
  { id: uid('r'), nummer: 'RE-2026-1040', kundeId: 'k7', datum: rel(-1), betragNetto: 1800, betragBrutto: 2142, status: 'Entwurf', zahlungsziel: rel(29) },
]

export const seedProtokolle: Protokoll[] = [
  { id: uid('p'), kundeId: 'k3', datum: rel(-1), teilnehmer: 'Christine Bergmann, Thomas Berger', betreff: 'Vorgespräch Erstgespräch', text: 'Themen für das Erstgespräch abgestimmt, Fokus auf Prozessoptimierung Lager.' },
  { id: uid('p'), kundeId: 'k5', datum: rel(-7), teilnehmer: 'Peter Winkelmann, Thomas Berger', betreff: 'Konzeptvorstellung', text: 'Konzept zur Neuausrichtung Vertrieb vorgestellt, positives Feedback.' },
  { id: uid('p'), kundeId: 'k8', datum: rel(-12), teilnehmer: 'Elisabeth Hoffmann, Julia Hartmann', betreff: 'Quartalsgespräch Q3', text: 'Laufendes Mandat besprochen, Zwischenbericht übergeben.' },
  { id: uid('p'), kundeId: 'k8', datum: rel(-45), teilnehmer: 'Elisabeth Hoffmann, Julia Hartmann', betreff: 'Kickoff aktives Mandat', text: 'Startbesprechung zur laufenden Vermögensberatung.' },
]

export const seedKonzepte: Konzept[] = [
  { id: uid('c'), kundeId: 'k5', datum: rel(-7), titel: 'Konzept Vertriebsneuausrichtung', version: 'v1.2', status: 'Vorgestellt' },
  { id: uid('c'), kundeId: 'k6', datum: rel(-9), titel: 'Konzept Prozessdigitalisierung', version: 'v1.0', status: 'Angebot erstellt' },
  { id: uid('c'), kundeId: 'k7', datum: rel(-14), titel: 'Konzept Nachfolgeplanung', version: 'v2.0', status: 'Angenommen' },
]

export const seedVertraege: Beratungsvertrag[] = [
  { id: uid('v'), kundeId: 'k7', vertragsnr: 'BV-2026-044', datum: rel(-1), laufzeit: '12 Monate', volumen: 48000, datei: 'Beratungsvertrag_Amberger.pdf' },
  { id: uid('v'), kundeId: 'k8', vertragsnr: 'BV-2025-198', datum: rel(-30), laufzeit: '24 Monate', volumen: 96000, datei: 'Beratungsvertrag_Hoffmann.pdf' },
  { id: uid('v'), kundeId: 'k9', vertragsnr: 'BV-2025-176', datum: rel(-60), laufzeit: '6 Monate', volumen: 27000, datei: 'Beratungsvertrag_Seidel.pdf' },
  { id: uid('v'), kundeId: 'k10', vertragsnr: 'BV-2025-140', datum: rel(-90), laufzeit: '12 Monate', volumen: 42000, datei: 'Beratungsvertrag_BrandtMoeller.pdf' },
]

// Ab hier: echte, aus den gescannten Originaldokumenten (2026-09-21) übertragene Vorlagen.
// Adresse durchgängig auf die korrekte, aktuelle Anschrift korrigiert (Schwabstrasse 3, 89075 Ulm) —
// die alten Vollmacht-Vorlagen trugen noch die veraltete Anschrift Herrlinger Str. 83, 89081 Ulm.

const vollmachtFinanzamt = `VOLLMACHT FÜR DAS FINANZAMT

Vollmachtgeber:
Name: _______________________
Geburtsdatum: _______________________
Adresse: _______________________
Steuernummer: _______________________

Hiermit bevollmächtige ich die Unternehmensberatung Andreas Mayer, Andreas Mayer und seine Mitarbeiter, Schwabstrasse 3, 89075 Ulm, mich in allen steuerlichen Angelegenheiten gegenüber dem Finanzamt zu vertreten.

Die Vollmacht umfasst insbesondere das Recht:
• zur Einsichtnahme in meine Steuerakten,
• zur Entgegennahme und Abgabe von Steuerbescheiden und Schriftstücken,
• zur Stellung und Entgegennahme von Anträgen,
• zur Teilnahme an Besprechungen und Verhandlungen mit dem Finanzamt,
• zur Entgegennahme von Bescheiden und sonstigen Mitteilungen,
• zur Einlegung und Rücknahme von Rechtsbehelfen (z. B. Einspruch),
• zur Abgabe und Unterzeichnung von Erklärungen, soweit gesetzlich zulässig.

Die Vollmacht gilt ab dem Tag der Unterzeichnung und ist bis auf Widerruf gültig, mindestens 2 Monate.

Ort, Datum: _______________________
Unterschrift Vollmachtgeber: _______________________`

const vollmachtBankKredit = `VOLLMACHT BANK – KREDITVERHANDLUNGEN
(in Kooperation)

Vollmachtgeber: _______________________

Hiermit erteile ich der Unternehmensberatung Andreas Mayer Consulting, Schwabstrasse 3, 89075 Ulm, die Vollmacht, in meinem Namen und für meine Rechnung Verhandlungen über die Aufnahme von Krediten und Darlehen bei der Bank zu führen.

Die bevollmächtigte Person ist berechtigt:
• Kreditangebote zu prüfen und zu verhandeln,
• Kreditverträge zu unterschreiben,
• alle notwendigen Dokumente im Zusammenhang mit der Kreditaufnahme auszufüllen und zu unterzeichnen.

Diese Vollmacht gilt ab sofort und bleibt gültig, bis sie von mir schriftlich widerrufen wird.

Bevollmächtigte Person: Unternehmensberatung Andreas Mayer Consulting, Schwabstrasse 3, 89075 Ulm
Wohnhaft: _______________________

Ort, Datum: _______________________
Unterschrift Vollmachtgeber: _______________________
Unterschrift bevollmächtigte Person: _______________________`

const geheimhaltungsvereinbarung = `GEHEIMHALTUNGS- UND QUELLENSCHUTZVEREINBARUNG

zwischen _______________________ (nachfolgend "Auftraggeber" genannt)
und _______________________, vertreten durch _______________________ (nachfolgend "Partei/MA/Vermittler" genannt)

§ 1 Gegenstand des Vertrages
Die Parteien bestätigen unwiderruflich und rechtsverbindlich vollen Quellen-, Kunden-, Objekt- und Courtageschutz für alle im Rahmen der Geschäftstätigkeit erschlossenen Quellen, Firmen und Personen. Der Schutz gilt auch dann, wenn es aus welchem Grund auch immer nicht zum angestrebten Geschäftsabschluss kommen sollte.

§ 2 Nichtoffenbarung
Jede Partei verpflichtet sich, die ihr von der anderen Seite bekannt gegebenen Adressen streng vertraulich zu behandeln und nicht ohne Zustimmung der anderen Partei zur Verwertung anzubieten. Ferner verpflichtet man sich, keine Geschäfte über vorgeschobene Dritte – gleichgültig ob nahestehende oder juristische Personen – mit den zu Objekten, Kunden/Aufträgen zur Verfügung gestellten Informationen abzuwickeln.

§ 3 Verschwiegenheit beteiligter Personen
Jede Vertragspartei zeichnet für die Verschwiegenheit und Einhaltungspflicht der für sie tätigen Angestellten, freiberuflichen Mitarbeiter sowie weiterer Vertragspersonen (Dritte) verantwortlich. Die Verschwiegenheitspflicht wirkt über die Vertragsdauer hinaus.

§ 4 Direkte Kontaktaufnahme
Direkte Kontaktaufnahme ist nur über die Firma zulässig. Sollte bereits ein Kontakt zum Geschäftspartner der anderen Seite bestehen, muss dies nach Bekanntgabe unverzüglich mitgeteilt werden. Dies entbindet nicht vom Kunden-/Objektschutz.

§ 5 Schriftformerfordernis
Über jegliche im Sinne dieses Vertrages sich anbahnenden Geschäfte unterrichtet der Geschäftspartner unverzüglich und unaufgefordert.

§ 6 Konventionalstrafe
Bei fahrlässigem Verstoß oder vorsätzlicher Zuwiderhandlung gegen diese Vereinbarung unterliegt die verstoßende Partei einer Konventionalstrafe in doppelter Höhe des jeweils erzielten Geschäftsvolumens, mindestens jedoch 20.000,00 €.

§ 7 Weiterbeauftragung
Unterbeauftragte dürfen nur in Abstimmung mit der anderen Partei beauftragt werden. Rechte und Pflichten aus dieser Vereinbarung sind entsprechend an Unterbeauftragte weiterzugeben und zu überwachen.

§ 8 Vertragsdauer
Diese Vereinbarung gilt zunächst für fünf Jahre ab Vertragsdatum und verlängert sich automatisch um jeweils ein Jahr, sofern sie nicht mit einer Frist von 3 Monaten zum jeweiligen Vertragsende gekündigt wird. Das Recht zur Kündigung aus wichtigem Grund bleibt unberührt.

§ 9 Salvatorische Klausel
Sollten einzelne Bestimmungen dieses Vertrages ganz oder teilweise unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. Die unwirksame Bestimmung ist durch eine Regelung zu ersetzen, die dem wirtschaftlichen Zweck der unwirksamen Bestimmung am nächsten kommt. Mündliche Nebenabreden bestehen nicht.

§ 10 Rechtsverbindlichkeit
Dieser Vertrag wird von den Unterzeichnern im eigenen Namen und im Namen ihrer Firmen geschlossen. Die Rechtsverbindlichkeit gilt auch bei Übermittlung per Fax oder E-Mail mit Rückbestätigung.

Auftraggeber                              Auftragnehmer/Dienstleister
Ort, Datum: ____________                  Ort, Datum: ____________
Unterschrift: ____________                Unterschrift: ____________`

const feedbackbogenText = `FEEDBACKBOGEN – VERMÖGENSSCHUTZ IN UNSICHEREN ZEITEN

Veranstaltung: _______________  Datum: _______________
Anrede / Name / Telefon (mobil) / E-Mail (Pflichtfelder)

1. Allgemeines Feedback zum Vortrag
☐ Verständlichkeit der Inhalte   ☐ Praxisrelevanz für meine Situation
☐ Ist es Ihnen bewusst, wie viel Geld Sie in der Vergangenheit verschenkt haben
☐ Nutzen für meine persönliche Planung

2. Offenes Feedback
Welcher Impuls aus dem Vortrag hat Ihnen die größte Erkenntnis gebracht?

3. Ihre momentane Aufstellung (privat/unternehmerisch betrachtet)
Kriterien (unternehmerisch): Unternehmen, Umsatzvolumen p.a., Immobilien, Investment (ETF/Fonds/Unternehmensbeteiligungen) — je Anzahl und ca. Wert/Investment in €
Kriterien (persönlich): Familienstand, Kinder (Anzahl/Alter), Ehevertrag (Ja/Nein), Unternehmensnachfolge geregelt (Ja/Nein)

4. Beratungsgespräch / Kosten
Für die Sichtung Ihrer Unterlagen und eine Erstbewertung erheben wir eine Aufwandsentschädigung in Höhe von 3.250 € zzgl. gesetzlicher Mehrwertsteuer. Bei Umsetzung und Auftragserteilung wird diese vollständig verrechnet.
☐ Ja, ich möchte einen Termin vereinbaren     ☐ Nein, aktuell kein Interesse

5. Einverständnis & Datenschutz (Pflichtfeld)
☐ Ich bin damit einverstanden, dass meine Angaben zur Kontaktaufnahme genutzt werden.
Ihre Daten werden ausschließlich zum Zweck der Kontaktaufnahme und zur Vereinbarung eines Beratungsgesprächs gespeichert und verarbeitet. Eine Weitergabe an Dritte erfolgt nicht. Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.

Unterschrift / Ort, Datum`

const beratungsvereinbarungText = `BERATUNGSVEREINBARUNG

zwischen
Andreas Mayer Holding UG / Unternehmensberatung Andreas Mayer
Schwabstrasse 3, 89075 Ulm — Steuernummer 71504682835
- nachfolgend "Berater" -

und dem nachfolgend benannten Auftraggeber
- nachfolgend "Auftraggeber" -

wird folgende Beratungsvereinbarung geschlossen. Auftragsnummer: _______________

1. Gegenstand der Beratung
Der Auftraggeber beauftragt den Berater mit der Sichtung der vom Auftraggeber übergebenen Unterlagen sowie einer Erstbewertung im Zusammenhang mit dem Themenbereich Vermögensschutz in unsicheren Zeiten. Grundlage der Beratung sind die vom Auftraggeber gemachten Angaben sowie die eingereichten Unterlagen.
Die Beratung erfolgt als individuelle, persönliche Beratung. Eine weitergehende Umsetzung, rechtliche oder steuerliche Detailprüfung sowie eine Begleitung bei der Umsetzung sind nicht Gegenstand dieses Vertrages, soweit hierzu keine gesonderte schriftliche Vereinbarung getroffen wird.

2. Leistungsumfang
• Sichtung der übergebenen Unterlagen.
• Strukturierte Erstbewertung der privaten und/oder unternehmerischen Vermögenssituation.
• Persönliches Beratungsgespräch.
• Erste Handlungshinweise und Einschätzung zu weiterem Beratungsbedarf.

3. Vergütung
Für die Sichtung der Unterlagen, die Erstbewertung sowie das persönliche Beratungsgespräch wird ein pauschales Honorar in Höhe von 3.250,00 Euro zuzüglich gesetzlicher Umsatzsteuer vereinbart.

4. Zahlungsbedingungen
Die Zahlung ist innerhalb von 7 Tagen nach Rechnungszugang fällig, sofern kein anderes Zahlungsziel angegeben ist. Bei umfangreicher Umsetzung oder Folgebeauftragung wird zusätzliche Vergütung gesondert vereinbart.

5. Mitwirkung des Auftraggebers
Der Auftraggeber stellt dem Berater alle für die Beratung erforderlichen Informationen und Unterlagen vollständig und wahrheitsgemäß zur Verfügung.

6. Haftung
Der Berater haftet nicht für Nachteile, die daraus entstehen, dass Informationen unvollständig, verspätet oder unzutreffend übermittelt wurden. Eine Haftung für wirtschaftliche, steuerliche oder rechtliche Empfehlungen ist ausgeschlossen, soweit nicht Vorsatz oder grobe Fahrlässigkeit vorliegt.

7. Vertraulichkeit und Datenschutz
Beide Parteien behandeln alle im Rahmen der Zusammenarbeit bekannt gewordenen vertraulichen Informationen vertraulich. Personenbezogene Daten dürfen zur Kontaktaufnahme, Terminvereinbarung, Durchführung der Beratung und Mandatsdokumentation verarbeitet werden.

8. Schlussbestimmungen
Änderungen und Ergänzungen bedürfen der Schriftform. Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. Es gilt deutsches Recht, Gerichtsstand ist, soweit gesetzlich zulässig, der Sitz des Beraters.

9. Unterschriften
Berater                                    Auftraggeber
Name: ____________                         Name: ____________
Unterschrift: ____________                 Unterschrift: ____________`

const mandantenfragebogenUnternehmenPrivatText = `MANDANTENFRAGEBOGEN – UNTERNEHMEN & PRIVAT

A. Allgemeine Angaben
Name/Vorname, Anschrift, Geburtsdatum, Familienstand/Kinder, Staatsangehörigkeit(en), Steuer-ID/Steuernummer, Telefon/Mobil, E-Mail. Bei Aufenthaltsstatus (falls nicht EU): Aufenthaltstitel vorhanden, Duldung, Antrag auf Aufenthaltstitel gestellt.

B. Unternehmen / berufliche Situation
Rechtsform und Basisunterlagen (bitte beifügen): Beschreibung der Tätigkeit, aktueller Handelsregisterauszug, Gesellschaftsvertrag/Satzung, Gesellschafterliste, Geschäftsführer-Anstellungsvertrag (falls vorhanden).

C. Private Einkünfte und Vermögen
Einkunftsarten (bitte Unterlagen beifügen): Nichtselbständige Arbeit (Lohn-/Gehaltsabrechnungen, Lohnsteuerbescheinigung), Selbständigkeit/freier Beruf (EÜR/BWA), Vermietung und Verpachtung (Mietverträge, Abrechnungen), Kapitalvermögen (Bank-/Depotauszüge, Steuerbescheinigungen), Renten (Rentenbescheide), sonstige Einkünfte.

D. Rechtliche & Geschäftsspezifische Dokumente
Gewerbeanmeldung (aktuelle Kopie), Gesellschaftsvertrag (falls es sich um eine GmbH, UG oder OHG handelt, nicht nur Einzelunternehmen), Verträge mit wichtigsten Partnern: Miet-/Pachtverträge des Betriebs, Leasingverträge (Fahrzeuge, Maschinen, IT etc.), Darlehens- und Kreditverträge (inkl. Tilgungspläne), Versicherungen des Betriebs.

E. Sozialversicherung / Krankenversicherung
Gesetzliche Krankenversicherung, private Krankenversicherung, Rentenversicherungsverlauf (Deutschland/Ausland), weitere Vorsorgeverträge (z. B. Rürup, Riester, Pensionskasse).

F. Ziele und Erwartungen (Mehrfachauswahl möglich)
☐ Steuerliche Entlastung   ☐ Vermögensaufbau/Investments   ☐ Absicherung der Familie
☐ Unternehmensnachfolge/Exit   ☐ Optimierung des Aufenthaltstitels   ☐ Vereinfachung der Strukturen   ☐ Sonstiges: _______________`

const professionelleBeratungsfragenText = `PROFESSIONELLE BERATUNGSFRAGEN

Bereich: _______________  Kunde: _______________  Datum: _______________
Telefon: _______________  Firmenform: _______________  Interessen/Motive: _______________

• Wie ist Ihr Unternehmen aktuell strukturiert?
• Welche kurz- und langfristigen Ziele verfolgen Sie?
• Benötigen Sie aktuell neue Finanzierungen, Kredite oder Fördermittel?
• Planen Sie eine Übertragung von Immobilien auf Ihre Kinder zu Lebzeiten?
• Gibt es Überlegungen zur Unternehmensnachfolge?
• Welche steuerlichen Optimierungen sind für Sie besonders wichtig?
• Haben Sie bereits Fördermittel beantragt oder erhalten?
• Welche Zielgruppe möchten Sie künftig stärker ansprechen?
• Welche Risiken bestehen derzeit im Unternehmen?
• Welche Bereiche Ihres Unternehmens sollen verbessert oder neu strukturiert werden?

Ihre Fragen bzw. Notizen:`

const notwendigeUnterlagenChecklisteText = `NOTWENDIGE UNTERLAGEN ZUR SAMMLUNG (Checkliste für den Mandanten)

A. Steuerliche Abschlüsse & Bescheide
☐ Einkommensteuererklärungen der letzten 3 Jahre
☐ Einkommensteuerbescheide der letzten 3 Jahre
☐ Gewerbesteuererklärungen (falls Gewerbe angemeldet ist) für die letzten 3 Jahre
☐ Aktuelle Bescheide des Finanzamts
☐ Korrespondenz mit dem Finanzamt: alle Briefe, Mahnungen, Stundungsbescheide oder Vollstreckungsmitteilungen der letzten 12 Monate

B. Buchhaltung & Finanzen
☐ Jahresabschlüsse: Bilanz und GuV der letzten 2–3 Jahre
☐ Kontoauszüge: Geschäftskonto letzten 12 Monate (vollständig), Privatkonto letzten 6–12 Monate (zur Analyse des privaten Lebensunterhalts und möglicher Vermischung von Mitteln)
☐ Kreditverträge & Darlehen: alle aktuellen Verträge mit Banken, Leasinggesellschaften oder privaten Gläubigern (inkl. Tilgungsplänen und Restschulden)
☐ Forderungsliste: Liste aller offenen Forderungen an Kunden (mit Fälligkeitsdatum)
☐ Verbindlichkeitsliste: alle offenen Rechnungen an Lieferanten, Handwerker etc.

C. Familienspezifische Daten
☐ Heiratsurkunde   ☐ Güterstand (z. B. Zugewinngemeinschaft, Gütertrennung)
☐ Unterhaltsverpflichtungen (Urteile, Vereinbarungen)   ☐ Sonstige Verpflichtungen

D. Rechtliche & Geschäftsspezifische Dokumente
☐ Gewerbeanmeldung (aktuelle Kopie)
☐ Gesellschaftsvertrag (falls es sich um eine GmbH, UG oder OHG handelt, nicht nur Einzelunternehmen)
☐ Verträge mit wichtigsten Partnern: Miet-/Pachtverträge des Betriebs, Leasingverträge (Fahrzeuge, Maschinen, IT etc.), Darlehens- und Kreditverträge (inkl. Tilgungsplänen), wichtige Kunden- und Lieferantenverträge, Versicherungen des Betriebs`

const fragenSteuerberaterText = `FRAGEN AN DEN STEUERBERATER (Prep-Sheet für das eigene Mandantengespräch)

1. Fragen an den Steuerberater (zur Klärung der aktuellen Lage)
• Aktueller Status der Buchhaltung: Welche Buchhaltung ist bereits an das Finanzamt abgegeben? Ist die Buchhaltung für das laufende Jahr vollständig? Liegen die Voranmeldungen (Umsatzsteuer und Einkommensteuer-Vorauszahlungen) für das aktuelle Jahr vor? Gibt es offene Forderungen oder Verbindlichkeiten, die nicht in der Buchhaltung erfasst sind?
• Finanzamtskorrespondenz: Gibt es offene Festsetzungen oder Mahnungen vom Finanzamt? Liegt eine aktuelle Steuerbescheinigung oder ein Schätzungsbescheid vor?
• Liquiditätsprognose: Liegt eine aktuelle Liquiditätsplanung (3–6 Monate) vor? Wie hoch ist der prognostizierte Verlust oder Gewinn für das laufende Quartal/bis aktuellem Stand?
• Familienbezogene Steuerfragen: Wurde die Zusammenveranlagung (Ehegattensplitting) korrekt berücksichtigt? Gibt es offene Fragen bei Kindergeld, Kinderfreibeträgen oder Unterhaltszahlungen, die die Steuerlast beeinflussen?`

const mandantenmemoStrukturText = `MANDANTENMEMO – VORLAGE / STRUKTUR

1. Ausgangslage
Kurze Zusammenfassung der Situation und des Ziels des Mandanten.

2. Vergleichende Übersicht
Gegenüberstellung der in Frage kommenden Instrumente/Szenarien (z. B. tabellarisch nach Kriterium).

3. Entscheidungsmatrix
Bewertung der Instrumente je nach Kriterium (z. B. Kosten, Zeitaufwand, Flexibilität, Sicherheit) mit einer zusammenfassenden Einschätzung, welches Instrument zu welcher Situation passt.

4. Handlungsempfehlungen
Konkrete, nach Szenario gestaffelte Empfehlungen.

5. Offene Punkte für das Mandantengespräch
Nummerierte Liste offener Fragen, die im nächsten Gespräch mit dem Mandanten zu klären sind — diese Liste sollte automatisch das nächste Gesprächsprotokoll bzw. die nächsten Aufgaben speisen.`

export const seedVorlagen: Vorlage[] = [
  { id: uid('vl'), kategorie: 'vollmacht', name: 'Vollmacht für das Finanzamt', typ: 'Vollmacht', zuletztGeaendert: rel(-4), text: vollmachtFinanzamt },
  { id: uid('vl'), kategorie: 'vollmacht', name: 'Vollmacht Bank – Kreditverhandlungen', typ: 'Vollmacht', zuletztGeaendert: rel(-4), text: vollmachtBankKredit },
  {
    id: uid('vl'),
    kategorie: 'schreiben',
    name: 'Feedbackbogen – Vermögensschutz in unsicheren Zeiten',
    typ: 'Formular',
    zuletztGeaendert: rel(-4),
    text: feedbackbogenText,
    formularPfad: '/formular/feedbackbogen',
  },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Mandantenfragebogen – Unternehmen & Privat', typ: 'Schreiben', zuletztGeaendert: rel(-4), text: mandantenfragebogenUnternehmenPrivatText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Professionelle Beratungsfragen', typ: 'Schreiben', zuletztGeaendert: rel(-4), text: professionelleBeratungsfragenText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Notwendige Unterlagen – Checkliste für den Mandanten', typ: 'Schreiben', zuletztGeaendert: rel(-4), text: notwendigeUnterlagenChecklisteText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Fragen an den Steuerberater', typ: 'Schreiben', zuletztGeaendert: rel(-4), text: fragenSteuerberaterText },
  { id: uid('vl'), kategorie: 'schreiben', name: 'Mandantenmemo – Vorlage/Struktur', typ: 'Schreiben', zuletztGeaendert: rel(-4), text: mandantenmemoStrukturText },
  { id: uid('vl'), kategorie: 'vertraege', name: 'Beratungsvereinbarung', typ: 'Vertrag', zuletztGeaendert: rel(-4), text: beratungsvereinbarungText },
  { id: uid('vl'), kategorie: 'vertraege', name: 'Geheimhaltungs- und Quellenschutzvereinbarung (NDA)', typ: 'Vertrag', zuletztGeaendert: rel(-4), text: geheimhaltungsvereinbarung },
]
