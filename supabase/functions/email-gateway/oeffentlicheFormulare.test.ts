import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  istInterneAkte, MAX_UNTERSCHRIFT_ZEICHEN, netzadresse, oeffentlicheGrenzen, pruefeFormularAbgabe, selbstauskunftFuerFormular,
} from './oeffentlicheFormulare.ts'

const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo' + 'A'.repeat(200)
const kopf = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null })

Deno.test('netzadresse: vorgelagerte Kopfzeile vor selbst befülltem x-forwarded-for', () => {
  assertEquals(netzadresse(kopf({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9', 'cf-connecting-ip': '9.9.9.9' })), '9.9.9.9')
  assertEquals(netzadresse(kopf({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9' })), '1.1.1.1')
  assertEquals(netzadresse(kopf({})), 'unbekannt')
})

Deno.test('Grenzen: bisher ungeschützte Aktionen bekommen eine, die übrigen nicht', () => {
  for (const a of ['public_get_kunde', 'public_submit_formular', 'public_get_vorschlag', 'public_entscheide_vorschlag', 'public_get_objekt', 'public_objekt_upload_url', 'public_submit_objekt_formular', 'public_get_unterlagen', 'public_unterlagen_upload_url', 'public_unterlagen_eingang', 'public_buchung_info', 'public_portal_link']) {
    const g = oeffentlicheGrenzen(a, '1.2.3.4', { kundeId: 'k_x', email: 'A@B.de' })
    assert(g && g.length > 0, a)
  }
  // Eigene Grenzen in index.ts/Modulen — hier nicht doppelt zählen.
  for (const a of ['public_kundenportal_laden', 'public_unterschrift_absenden', 'public_seminar_anmelden', 'public_objekt_portal', 'public_create_lead', 'public_buchung_anlegen', 'sync']) {
    assertEquals(oeffentlicheGrenzen(a, '1.2.3.4', {}), null, a)
  }
  const senden = oeffentlicheGrenzen('public_submit_formular', '1.2.3.4', { kundeId: 'k_abc' })!
  assert(senden.some((g) => g.schluessel === 'formular:senden:kunde:k_abc'))
  assert(oeffentlicheGrenzen('public_portal_link', 'x', { email: ' Max@Web.DE ' })!.some((g) => g.schluessel === 'portallink:mail:max@web.de'))
})

Deno.test('Abgabe: Name im Verlauf nur mit „(Formular)“, sonst Kunde (Formular)', () => {
  const ok = pruefeFormularAbgabe({ aktivitaetText: 'NDA unterschrieben.', aktivitaetUser: 'Max Muster (Formular)' })
  assert('werte' in ok)
  assertEquals(ok.werte.aktivitaetUser, 'Max Muster (Formular)')
  const falsch = pruefeFormularAbgabe({ aktivitaetText: 'x', aktivitaetUser: 'Andreas Mayer' })
  assert('werte' in falsch)
  assertEquals(falsch.werte.aktivitaetUser, 'Kunde (Formular)')
  const leer = pruefeFormularAbgabe({ aktivitaetText: 'x', aktivitaetUser: '(Formular)' })
  assert('werte' in leer)
  assertEquals(leer.werte.aktivitaetUser, 'Kunde (Formular)')
})

Deno.test('Abgabe: Text wird gekürzt, fehlender Text abgelehnt', () => {
  const lang = pruefeFormularAbgabe({ aktivitaetText: 'a'.repeat(50_000) })
  assert('werte' in lang)
  assertEquals(lang.werte.aktivitaetText.length, 20_000)
  assert('fehler' in pruefeFormularAbgabe({ aktivitaetText: '   ' }))
})

Deno.test('Abgabe: Unterschrift nur als PNG und nicht übergroß', () => {
  assert('werte' in pruefeFormularAbgabe({ aktivitaetText: 'x', signatur: { name: 'Max', dataUrl: PNG, kontext: 'NDA' } }))
  assert('fehler' in pruefeFormularAbgabe({ aktivitaetText: 'x', signatur: { name: 'Max', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=', kontext: 'NDA' } }))
  assert('fehler' in pruefeFormularAbgabe({ aktivitaetText: 'x', signatur: { name: 'Max', dataUrl: 'data:image/png;base64,' + 'A'.repeat(MAX_UNTERSCHRIFT_ZEICHEN), kontext: 'NDA' } }))
  assert('fehler' in pruefeFormularAbgabe({ aktivitaetText: 'x', signatur: 'kaputt' }))
})

Deno.test('Abgabe: Selbstauskunft wird auf bekannte Felder zurückgebaut', () => {
  const r = pruefeFormularAbgabe({
    aktivitaetText: 'x',
    selbstauskunft: { antworten: [{ frageId: 'f1', frageText: 'Einkommen?', antwort: '3000', boese: 'y' }, { frageId: '' }, 'kaputt'], signaturDataUrl: PNG, eingereichtAm: '2026-11-23', extra: 1 },
  })
  assert('werte' in r)
  assertEquals(r.werte.selbstauskunft, { antworten: [{ frageId: 'f1', frageText: 'Einkommen?', antwort: '3000' }], signaturDataUrl: PNG, eingereichtAm: '2026-11-23' })
  assert('fehler' in pruefeFormularAbgabe({ aktivitaetText: 'x', selbstauskunft: { antworten: [], signaturDataUrl: 'nein' } }))
})

Deno.test('Abgabe: Unterlagen-Liste nur Ja/Nein, Behörden-PDF begrenzt', () => {
  const r = pruefeFormularAbgabe({ aktivitaetText: 'x', unterlagenCheckliste: { Testament: true, Grundbuch: 'ja' }, behoerde: { email: 'fa@finanzamt.de', sig: 'abc', pdfBase64: 'JVBERi0=', pdfFilename: '../Vollmacht.pdf' } })
  assert('werte' in r)
  assertEquals(r.werte.unterlagenCheckliste, { Testament: true, Grundbuch: false })
  assertEquals(r.werte.behoerde?.pdfFilename, '.._Vollmacht.pdf')
  const kein = pruefeFormularAbgabe({ aktivitaetText: 'x', behoerde: { email: 'fa@finanzamt.de', pdfBase64: '<html>' } })
  assert('werte' in kein)
  assertEquals(kein.werte.behoerde?.pdfBase64, undefined)
})

Deno.test('Selbstauskunft nach außen nur „liegt vor“', () => {
  assertEquals(selbstauskunftFuerFormular({ antworten: [{ antwort: 'geheim' }], signaturDataUrl: PNG, eingereichtAm: '2026-11-20' }), { eingereicht: true, eingereichtAm: '2026-11-20' })
  assertEquals(selbstauskunftFuerFormular(null), undefined)
})

Deno.test('Interne Sammel-Akten', () => {
  assert(istInterneAkte('k_intern_holding'))
  assert(istInterneAkte('k_eingang_ungeklaert'))
  assert(!istInterneAkte('k_ql_osman_nergiz'))
})
