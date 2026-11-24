-- Seite „Automatische Nachrichten“ (24.11.2026): Die bisher fest im Programm stehenden Mails an Termin-Gäste, die
-- Bestätigung der Online-Buchung und die Kopie des unterschriebenen Dokuments werden bearbeitbare Vorlagen in
-- mail_vorlagen. Der Text ist Wort für Wort der bisherige (erzeugt aus STANDARD_VORLAGEN in
-- supabase/functions/email-gateway/automatikVorlagen.ts), nur mit Platzhaltern {{Name}}. Fehlt eine Zeile oder ist ihr
-- Text leer, verschickt der Server weiter den festen Text. Nur hinzufügen, nie überschreiben (on conflict do nothing).

-- mv-auto-gast-einladung: Platzhalter {{Anrede}}, {{Name}}, {{Titel}}, {{Zeit}}, {{Ort}}, {{Eckdaten}}, {{Absender}}
insert into mail_vorlagen (id, name, betreff, text) values (
  'mv-auto-gast-einladung',
  $vorlage$Termin-Einladung an Gäste (automatisch)$vorlage$,
  $vorlage$Einladung: {{Titel}} – {{Zeit}}$vorlage$,
  $vorlage${{Anrede}}

hiermit laden wir Sie zu folgendem Termin ein:

{{Eckdaten}}

Mit der angehängten Kalenderdatei können Sie den Termin in Ihren Kalender übernehmen. Sollte der Termin für Sie nicht passen, antworten Sie gern einfach auf diese Mail.

Mit freundlichen Grüßen
{{Absender}}
Andreas Mayer Holding$vorlage$
) on conflict (id) do nothing;

-- mv-auto-gast-aenderung: Platzhalter {{Anrede}}, {{Name}}, {{Titel}}, {{Zeit}}, {{Ort}}, {{Eckdaten}}, {{Absender}}
insert into mail_vorlagen (id, name, betreff, text) values (
  'mv-auto-gast-aenderung',
  $vorlage$Termin geändert, an Gäste (automatisch)$vorlage$,
  $vorlage$Geänderter Termin: {{Titel}} – {{Zeit}}$vorlage$,
  $vorlage${{Anrede}}

unser gemeinsamer Termin hat sich geändert. Hier die aktuellen Angaben:

{{Eckdaten}}

Mit der angehängten Kalenderdatei können Sie Ihren Kalender aktualisieren.

Mit freundlichen Grüßen
{{Absender}}
Andreas Mayer Holding$vorlage$
) on conflict (id) do nothing;

-- mv-auto-gast-absage: Platzhalter {{Anrede}}, {{Name}}, {{Titel}}, {{Zeit}}, {{Ort}}, {{Eckdaten}}, {{Absender}}
insert into mail_vorlagen (id, name, betreff, text) values (
  'mv-auto-gast-absage',
  $vorlage$Termin abgesagt, an Gäste (automatisch)$vorlage$,
  $vorlage$Abgesagt: {{Titel}} – {{Zeit}}$vorlage$,
  $vorlage${{Anrede}}

leider müssen wir den folgenden Termin absagen:

{{Eckdaten}}

Mit der angehängten Kalenderdatei können Sie den Termin aus Ihrem Kalender entfernen. Für einen neuen Termin melden wir uns gern bei Ihnen.

Mit freundlichen Grüßen
{{Absender}}
Andreas Mayer Holding$vorlage$
) on conflict (id) do nothing;

-- mv-auto-gast-erinnerung: Platzhalter {{Anrede}}, {{Name}}, {{Titel}}, {{Zeit}}, {{Ort}}, {{Eckdaten}}, {{Absender}}, {{Wann}}
insert into mail_vorlagen (id, name, betreff, text) values (
  'mv-auto-gast-erinnerung',
  $vorlage$Terminerinnerung an Gäste (automatisch)$vorlage$,
  $vorlage$Erinnerung: {{Titel}} – {{Zeit}}$vorlage$,
  $vorlage${{Anrede}}

wir möchten Sie an unseren {{Wann}} erinnern:

{{Eckdaten}}

Sollte etwas dazwischengekommen sein, antworten Sie gern einfach auf diese Mail.

Mit freundlichen Grüßen
{{Absender}}
Andreas Mayer Holding$vorlage$
) on conflict (id) do nothing;

-- mv-auto-buchung-bestaetigung: Platzhalter {{Anrede}}, {{Name}}, {{Titel}}, {{Tag}}, {{Datum}}, {{Uhrzeit}}, {{Bis}}, {{Zeit}}, {{Ort}}, {{Hinweis}}, {{Eckdaten}}, {{Absender}}
insert into mail_vorlagen (id, name, betreff, text) values (
  'mv-auto-buchung-bestaetigung',
  $vorlage$Terminbestätigung nach Online-Buchung (automatisch)$vorlage$,
  $vorlage$Terminbestätigung: {{Titel}} am {{Datum}} um {{Uhrzeit}} Uhr$vorlage$,
  $vorlage${{Anrede}}

vielen Dank für Ihre Buchung. Hiermit bestätigen wir Ihren Termin:

{{Eckdaten}}

Im Anhang finden Sie den Termin als Kalenderdatei. Mit einem Klick darauf können Sie ihn in Ihren Kalender übernehmen.

Falls Sie den Termin absagen oder verschieben möchten, antworten Sie einfach auf diese E-Mail oder rufen Sie uns an.

Mit freundlichen Grüßen
{{Absender}}
Andreas Mayer Holding$vorlage$
) on conflict (id) do nothing;

-- mv-auto-unterschrift-kopie: Platzhalter {{Anrede}}, {{Name}}, {{Dokument}}
insert into mail_vorlagen (id, name, betreff, text) values (
  'mv-auto-unterschrift-kopie',
  $vorlage$Kopie des unterschriebenen Dokuments (automatisch)$vorlage$,
  $vorlage$Ihre unterschriebene {{Dokument}}$vorlage$,
  $vorlage${{Anrede}}

vielen Dank für Ihre Unterschrift. Im Anhang finden Sie „{{Dokument}}“ mit Ihrer elektronischen Unterschrift für Ihre Unterlagen.

Mit freundlichen Grüßen
Andreas Mayer Holding$vorlage$
) on conflict (id) do nothing;

select json_agg(id order by id) as vorhanden from mail_vorlagen where id like 'mv-auto-%';
