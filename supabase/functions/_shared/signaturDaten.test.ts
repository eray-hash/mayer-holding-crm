// Prüft das Lesen von Kontaktangaben aus Mail-Signaturen: deutsche Nummern-Schreibweisen, Anschriften in
// verschiedenen Formen, Zitate und Weiterleitungen, eigene Signaturen und eigene Daten.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  anschriftSchluessel,
  datumAusKopf,
  eigeneDatenAus,
  gleicheAnschrift,
  gleicheNummer,
  htmlZuText,
  leereEigeneDaten,
  leseSignatur,
  namePasstZurAkte,
  signaturenVon,
  vergleichbareNummer,
  zerlegeMail,
} from './signaturDaten.ts'

const EIGENE = eigeneDatenAus([
  { name: 'Andreas Mayer', email: 'info@amayer-holding.com', telefon: '0731 1234567', signatur_html: '<p>Andreas Mayer<br>Mayer Holding UG<br>Schwabstr. 3<br>89075 Ulm<br>Tel. 0731 / 123 45 67</p>' },
  { name: 'Quirin Lutzenberger', email: 'immo@amayer-holding.com', telefon: null, signatur_html: null },
  { name: 'Hasan Süslü', email: 'privat.gf@beispiel.de', telefon: '+49 171 5550000', signatur_html: null },
])

Deno.test('Nummern: +49, 0049, (0), Schrägstrich und Bindestrich werden vergleichbar', () => {
  assertEquals(vergleichbareNummer('+49 (0) 731 / 12 34-56'), '0731123456')
  assertEquals(vergleichbareNummer('0049 172 9019790'), '01729019790')
  assertEquals(vergleichbareNummer('+49 172 9019790'), '01729019790')
  assertEquals(vergleichbareNummer('(0731) 123456'), '0731123456')
  assertEquals(vergleichbareNummer('+43 1 5551234'), '+4315551234')
  assertEquals(vergleichbareNummer('12345'), '')
  assert(gleicheNummer('0172-9019790', '+49 172 901 97 90'))
  assert(!gleicheNummer('0731 1', '0731 1'))
})

Deno.test('Signatur nach Grußformel: Firma, Anschrift mit D-PLZ, Handy ohne Beschriftung, Webseite', () => {
  const text = `Sehr geehrter Herr Meyer,

nach reiflicher Überlegung habe ich mich entschieden.

Mit freundlichen Grüßen
Claudia Scheelen

______________________________________
Claudia Scheelen GmbH
Bismarckstraße 13a\u200b
D79761 WaldshutTiengen

+49 172 9019790
kontakt@claudia-scheelen.com
www.claudia-scheelen.com`
  const d = leseSignatur(text, EIGENE)
  assertEquals(d.mobil, '+49 172 9019790')
  assertEquals(d.telefon, undefined)
  assertEquals(d.anschrift, 'Bismarckstraße 13a\n79761 WaldshutTiengen')
  assertEquals(d.webseite, 'www.claudia-scheelen.com')
  assertEquals(d.firma, 'Claudia Scheelen GmbH')
})

Deno.test('Beschriftete Nummern in einer Zeile, Anschrift in einer Zeile, Position', () => {
  const text = `Hallo Herr Mayer,
anbei die Unterlagen.

Viele Grüße
Max Muster
Geschäftsführer
Muster Bau GmbH | Hauptstr. 5 | 89073 Ulm
Tel.: 0731 / 98 76-0 · Fax: 0731 / 98 76-20 · Mobil: 0171 2345678
IBAN DE12 3456 7890 1234 5678 90 · HRB 12345`
  const d = leseSignatur(text, EIGENE)
  assertEquals(d.telefon, '0731 / 98 76-0')
  assertEquals(d.fax, '0731 / 98 76-20')
  assertEquals(d.mobil, '0171 2345678')
  assertEquals(d.anschrift, 'Hauptstr. 5\n89073 Ulm')
  assertEquals(d.position, 'Geschäftsführer')
  assertEquals(d.firma, 'Muster Bau GmbH | Hauptstr. 5 | 89073 Ulm')
})

Deno.test('PLZ vor der Straße und Straße mit Leerzeichen vor dem Punkt (Handy-Signatur)', () => {
  const text = `Bitte Andreas kannst du hier tätig werden wie besprochen. Lg jürgen
Dipl-Betriebswirt Jürgen Friedl
Vorstand der JFS AG
70794 Filderstadt
Echterdingerstr .57`
  const d = leseSignatur(text, EIGENE)
  assertEquals(d.anschrift, 'Echterdingerstr. 57\n70794 Filderstadt')
})

Deno.test('Nummer im Text ("Rückruf unter …") zählt, wenn die Signatur keine hat', () => {
  const d = leseSignatur('Hallo Herr Mayer,\nGerne kurzen Rückruf unter 015228467862\nDanke,\nLiebe Grüße\nRobin Wallisch', EIGENE)
  assertEquals(d.mobil, '015228467862')
  // … aber nicht, wenn sie erkennbar jemand anderem gehört
  const fremd = leseSignatur('Bitte rufen Sie meinen Steuerberater Herrn Kunz an unter 0731 555666.\nGruß\nTom', EIGENE)
  assertEquals(fremd.telefon, undefined)
})

Deno.test('Datum, Uhrzeit, Postleitzahl und Bankdaten sind keine Telefonnummern', () => {
  const d = leseSignatur('Termin am 12.10.2026 um 14:30.\nViele Grüße\nAnna\nKonto: 1234567890\nUSt-IdNr. DE123456789', EIGENE)
  assertEquals(d, {})
})

Deno.test('Eigene Signatur wird ausgeschlossen (Domain, voller Mitarbeitername, eigene Nummer und Anschrift)', () => {
  assertEquals(leseSignatur('Danke!\nMit freundlichen Grüßen\nAndreas Mayer\nTel. 0731 9999999\ninfo@amayer-holding.com', EIGENE), {})
  assertEquals(leseSignatur('Hallo\nGruß\nQuirin Lutzenberger\nMobil 0170 1111111', EIGENE), {})
  // gleicher Nachname, anderer Vorname: ein Kunde (Quirins Vater) bleibt erkennbar
  const vater = leseSignatur('Hallo\nMit freundlichen Grüßen\nGeorg Lutzenberger\nLutzenberger Architektur\nMobil 0170 2222222', EIGENE)
  assertEquals(vater.mobil, '0170 2222222')
  // eigene Nummer/Anschrift ohne Namen
  const nurNummer = leseSignatur('Hallo\nGruß\nSekretariat\nTel. 0731 1234567\nSchwabstr. 3\n89075 Ulm', EIGENE)
  assertEquals(nurNummer, {})
})

Deno.test('zerlegeMail: Zitate werden ihrem Verfasser zugeordnet (iPhone-Antwort, Outlook-Kopf, Weiterleitung)', () => {
  const text = `Hallo,
Dann nehmen wir doch Mittwoch 13 Uhr.
Schönen Gruss
Andreas Mayer
Von meinem iPhone gesendet

> Am 12.10.2026 um 17:43 schrieb Robin Wallisch <robin.wallisch1987@gmail.com>:
>
> \ufeffHallo Herr Mayer,
> Mittwoch wäre möglich.
> Liebe Grüße
> Robin Wallisch
> Mobil: 0152 28467862
>
>>> Am 12.10.2026 um 16:09 schrieb Andreas Mayer <info@amayer-holding.com>:
>>>
>> Hallo, nach Rücksprache geht Mittwoch.
>> Andreas Mayer
>> Tel. 0731 1234567`
  const teile = zerlegeMail(text, { email: 'info@amayer-holding.com', name: 'Andreas Mayer' })
  assertEquals(teile.map((t) => t.autorEmail), ['info@amayer-holding.com', 'robin.wallisch1987@gmail.com', 'info@amayer-holding.com'])
  assertEquals(teile[1].datum, '2026-10-12')
  assertEquals(teile[1].autorName, 'Robin Wallisch')
  const funde = signaturenVon(text, { absenderEmail: 'info@amayer-holding.com' }, 'Robin.Wallisch1987@gmail.com', EIGENE)
  assertEquals(funde.length, 1)
  assertEquals(funde[0].daten.mobil, '0152 28467862')
  assertEquals(funde[0].datum, '2026-10-12')
})

Deno.test('zerlegeMail: weitergeleitete Mail eines Dritten gehört nicht dem Absender', () => {
  const text = `Bitte schau dir das an.
Gruß
Jürgen Friedl
Mobil 0171 3333333

Anfang der weitergeleiteten Nachricht:

> Von: BÜRO - KITCOM <info@kitcom-edelstahl.de>
> Datum: 30. Januar 2025 um 12:35:27 MEZ
> An: Jürgen Friedl <coach@bw-friedl.eu>
> Betreff: WG: Informationsanforderung
>
> Mit freundlichen Grüßen
> Johanna Hirsch
> Tel. 07031 444444
> Industriestr. 9
> 71063 Sindelfingen`
  const vomAbsender = signaturenVon(text, { absenderEmail: 'coach@bw-friedl.eu' }, 'coach@bw-friedl.eu', EIGENE)
  assertEquals(vomAbsender.length, 1)
  assertEquals(vomAbsender[0].daten.mobil, '0171 3333333')
  assertEquals(vomAbsender[0].daten.anschrift, undefined)
  const dritter = signaturenVon(text, { absenderEmail: 'coach@bw-friedl.eu' }, 'info@kitcom-edelstahl.de', EIGENE)
  assertEquals(dritter[0].datum, '2025-01-30')
  assertEquals(dritter[0].daten.telefon, '07031 444444')
  assertEquals(dritter[0].daten.anschrift, 'Industriestr. 9\n71063 Sindelfingen')
})

Deno.test('zerlegeMail: Outlook-Kopf nach Unterstrich-Linie; Unterstrich-Linie allein bleibt Text', () => {
  const text = `Kurze Antwort.
Gruß S. Bulut
________________________________
Von: Mustafa Karakaya <mefeka1907@icloud.com>
Gesendet: Donnerstag, 19. September 2024 01:54
An: Lukas Brinkmann <vertrag@finconcept.de>
Betreff: Leasing

Hallo Lukas,
Gruß
Mustafa
Handy 0176 5555555`
  const teile = zerlegeMail(text, { email: 'seyfi84@hotmail.de' })
  assertEquals(teile.map((t) => t.autorEmail), ['seyfi84@hotmail.de', 'mefeka1907@icloud.com'])
  assertEquals(teile[1].datum, '2024-09-19')
  assertEquals(signaturenVon(text, { absenderEmail: 'seyfi84@hotmail.de' }, 'seyfi84@hotmail.de', EIGENE), [])
})

Deno.test('Mitarbeiter-Adressen liefern nie Kundendaten', () => {
  assertEquals(signaturenVon('Hallo\nGruß\nHasan\nMobil 0172 7777777', { absenderEmail: 'privat.gf@beispiel.de' }, 'privat.gf@beispiel.de', EIGENE), [])
})

Deno.test('Anschriften vergleichen: Str./Straße, Komma oder Zeilenumbruch', () => {
  assert(gleicheAnschrift('Hauptstr. 5\n89073 Ulm', 'Hauptstraße 5, 89073 Ulm'))
  assert(!gleicheAnschrift('Hauptstr. 5\n89073 Ulm', 'Hauptstr. 7, 89073 Ulm'))
  assertEquals(anschriftSchluessel('Schwabstr. 3, 89075 Ulm'), '89075|schwabstrasse|3')
})

Deno.test('HTML und Datumsangaben', () => {
  assertEquals(htmlZuText('<div>Max&nbsp;M&uuml;ller<br>Tel. 0731&#160;1</div><p>x</p>').trim(), 'Max Müller\nTel. 0731 1\nx')
  assertEquals(datumAusKopf('Am Mo., 12. Okt. 2026 um 15:26 Uhr schrieb'), '2026-10-12')
  assertEquals(datumAusKopf('On Oct 3, 2026, at 9:00 AM'), '2026-10-03')
})

Deno.test('Absendername passt zur Akte', () => {
  assert(namePasstZurAkte('Robin Wallisch', { ansprechpartner: 'Robin Wallisch', firma: 'Wallisch / Simpfendörfer' }))
  assert(namePasstZurAkte('Pinti Clean GmbH', { ansprechpartner: '', firma: 'Pinti Clean' }))
  assert(!namePasstZurAkte('Robin Meier', { ansprechpartner: 'Anna Wallisch', firma: 'Wallisch GmbH' }))
  assert(!namePasstZurAkte('', { ansprechpartner: 'Anna', firma: '' }))
  assertEquals(leereEigeneDaten().domains, ['amayer-holding.com', 'fundament-it.de'])
})

Deno.test('Steuerzeichen als Bindestrich (Word) und Ziffern in Links (QR-Code) werden richtig behandelt', () => {
  const d = leseSignatur('Danke.\nHerzliche Grüße\nClaudia\nBismarckstraße 13a\nD\u001e79761 Waldshut\u001eTiengen', EIGENE)
  assertEquals(d.anschrift, 'Bismarckstraße 13a\n79761 Waldshut-Tiengen')
  const qr = leseSignatur('Kontaktdaten speichern:\n<a href="https://x.de/vcard"><img src="https://api.qrserver.com/?data=BEGIN%3AVCARD%0ATEL%3B%3A04102+6647973%0A"></a>\nGruß\nTeam', EIGENE)
  assertEquals(qr, {})
})
