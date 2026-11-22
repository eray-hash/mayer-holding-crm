// Assistent-Werkzeug „kontoauszug_abgleichen“ (22.11.2026): Ein per Telegram geschickter Kontoauszug
// (pfad="telegram/…", PDF, Foto oder CSV) wird gegen offene Ausgangsrechnungen und offene
// Verbindlichkeiten abgeglichen (_shared/zahlungsAbgleich.ts). Erster Aufruf: nur Vorschläge mit
// Kennung (v…), Sicherheit und Grund. Gebucht wird erst mit bestaetigt=true und den Kennungen, die der
// Mitarbeiter ausdrücklich bestätigt hat.
//
// Lesen: CSV direkt hier ohne KI; PDF/Foto über die email-gateway-Aktion kontoauszug_abgleich_auslesen
// (email-gateway/abgleichAuslesen.ts, mit Dienstschlüssel im Auftrag des Mitarbeiters). Die gelesenen
// Buchungen liegen danach in kunden-dokumente/kontoauszug-abgleich/assistent/<…>.json, damit das
// Bestätigen den Auszug nicht noch einmal (mit KI) lesen muss. Beim Bestätigen wird mit dem frischen
// Stand der Datenbank neu abgeglichen — nur Vorschläge, die dann noch dieselbe Kennung haben, werden gebucht.
//
// Buchen wie im CRM: Rechnungen über berechneZahlung (rechnungZahlungWerkzeuge.ts, gleiche Rechenregeln
// wie „Zahlung erfassen“), zusätzlich zahlungen[].quelle = Fingerabdruck der Buchung; bei Skonto gilt die
// Rechnung als bezahlt; Vermerk im Verlauf der Akte. Verbindlichkeiten: status bezahlt, bezahlt_am, Zeile
// mit Kennung in der Notiz. Jede Liste wird direkt vor dem Schreiben frisch gelesen.
//
// Rechte: Rechnungen und Verbindlichkeiten hängen am Bereich Unternehmensberatung (Zeilenregel
// darf_bereich('beratung')); Rechnungen zu Akten, die der Mitarbeiter nicht sehen darf, werden weder
// vorgeschlagen noch gebucht.

import { aktuellePerson } from '../_shared/kiVerbrauch.ts'
import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { dekodiereText, leseKontoCsv } from '../_shared/kontoauszugCsv.ts'
import {
  type AbgleichBuchung,
  type AbgleichErgebnis,
  type AbgleichRechnung,
  type AbgleichVerbindlichkeit,
  type AbgleichVorschlag,
  type BekannteZahlung,
  deDatum,
  euro,
  gleicheAb,
  kennungenAusText,
  kurzHash,
  SICHERHEIT_TEXT,
  verbindlichkeitNotiz,
  zahlungsNotiz,
  zahlungsVermerk,
} from '../_shared/zahlungsAbgleich.ts'
import { darfAkte, istFremdePrivatakte, nichtFreigegeben, type RechteMitarbeiter } from './rechte.ts'
import { berechneZahlung, darfRechnungen, offenerBetrag, type RechnungZeile, type Zahlung } from './rechnungZahlungWerkzeuge.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

export type AuszugGelesen = { ok: true; buchungen: AbgleichBuchung[]; datei: { name: string; bank?: string | null; von?: string | null; bis?: string | null; anzahl: number; fehler?: string } } | { ok: false; fehler: string }

export type AbgleichKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string; email?: string | null }
  protokolliere: (text: string) => void
  heute: string
  /** Liest PDF/Foto (Vorgabe: email-gateway-Aktion kontoauszug_abgleich_auslesen). Für Tests ersetzbar. */
  leseAuszug?: (datei: { eimer: string; pfad: string; name: string }, email: string) => Promise<AuszugGelesen>
}

const TELEGRAM_EIMER = 'email-anhaenge'
const ABLAGE = 'kunden-dokumente'

export const ABGLEICH_WERKZEUGE = [
  {
    name: 'kontoauszug_abgleichen',
    description:
      'Gleicht einen per Telegram geschickten Kontoauszug der Holding (PDF, Foto oder CSV-Export der Bank, pfad="telegram/…") mit offenen Ausgangsrechnungen (Zahlungseingänge) und offenen Verbindlichkeiten (Zahlungsausgänge) ab. Ohne bestaetigt: liefert Vorschläge mit Kennung (v…), Sicherheit (sicher/wahrscheinlich/unklar) und Grund — nichts wird gebucht; zeig sie dem Mitarbeiter und frag, welche gebucht werden sollen. Mit bestaetigt=true und vorschlag_ids: bucht genau diese Vorschläge wie „Zahlung erfassen“ (Teilzahlung, Rechnung bezahlt, Vermerk in der Akte) bzw. markiert Verbindlichkeiten als bezahlt. Schon gebuchte Buchungen werden nie doppelt gebucht. Nicht für Kontoauszüge von Kunden (das ist die Auswertung in der Akte).',
    input_schema: {
      type: 'object',
      properties: {
        pfad: { type: 'string', description: 'Per Telegram geschickte Datei, exakt wie angegeben, beginnt mit "telegram/".' },
        bestaetigt: { type: 'boolean', description: 'Nur true, wenn der Mitarbeiter die genannten Vorschläge ausdrücklich zum Buchen freigegeben hat.' },
        vorschlag_ids: { type: 'array', items: { type: 'string' }, description: 'Kennungen der zu buchenden Vorschläge (v…) aus dem ersten Aufruf; „alle sicheren“ = alle mit Sicherheit sicher.' },
      },
      required: ['pfad'],
    },
  },
]

export function istAbgleichWerkzeug(name: string): boolean {
  return ABGLEICH_WERKZEUGE.some((w) => w.name === name)
}

function neueId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`
}

function cachePfad(pfad: string): string {
  return `kontoauszug-abgleich/assistent/${kurzHash(pfad)}-${kurzHash(`${pfad}|x`)}.json`
}

async function leseUeberGateway(datei: { eimer: string; pfad: string; name: string }, email: string): Promise<AuszugGelesen> {
  const url = Deno.env.get('SUPABASE_URL')
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const geheim = Deno.env.get('CRM_SHARED_SECRET')
  try {
    const antwort = await fetch(`${url}/functions/v1/email-gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${schluessel}`, 'x-ki-person': aktuellePerson() || email, ...(geheim ? { 'x-crm-secret': geheim } : {}) },
      body: JSON.stringify({ action: 'kontoauszug_abgleich_auslesen', datei, imAuftragVon: email }),
      signal: AbortSignal.timeout(180_000),
    })
    const daten = await antwort.json().catch(() => ({}))
    if (!antwort.ok || !daten?.ok) return { ok: false, fehler: String(daten?.error ?? `Anfrage fehlgeschlagen (${antwort.status})`) }
    return { ok: true, buchungen: Array.isArray(daten.buchungen) ? daten.buchungen : [], datei: daten.datei ?? { name: datei.name, anzahl: 0 } }
  } catch (err) {
    return { ok: false, fehler: `Der Auszug ließ sich nicht lesen (${err instanceof Error ? err.message : String(err)}).` }
  }
}

type Gespeichert = { pfad: string; buchungen: AbgleichBuchung[]; datei: Extract<AuszugGelesen, { ok: true }>['datei'] }

async function ladeOderLies(k: AbgleichKontext, pfad: string): Promise<Gespeichert | string> {
  const { supabase } = k
  const gespeichert = await supabase.storage.from(ABLAGE).download(cachePfad(pfad))
  if (gespeichert?.data) {
    try {
      const g = JSON.parse(await gespeichert.data.text()) as Gespeichert
      if (g?.pfad === pfad && Array.isArray(g.buchungen)) return g
    } catch { /* neu lesen */ }
  }
  const name = pfad.split('/').pop() || 'Kontoauszug'
  let gelesen: AuszugGelesen
  if (/\.(csv|txt)$/i.test(name)) {
    const { data, error } = await supabase.storage.from(TELEGRAM_EIMER).download(pfad)
    if (error || !data) return 'Fehler: Diese Datei gibt es in der Ablage nicht.'
    const e = leseKontoCsv(dekodiereText(new Uint8Array(await data.arrayBuffer())))
    gelesen = e.buchungen.length ? { ok: true, buchungen: e.buchungen, datei: { name, von: e.von, bis: e.bis, anzahl: e.buchungen.length } } : { ok: false, fehler: e.fehler ?? 'Keine Buchungen gefunden.' }
  } else {
    gelesen = await (k.leseAuszug ?? leseUeberGateway)({ eimer: TELEGRAM_EIMER, pfad, name }, String(k.mitarbeiter.email ?? ''))
  }
  if (!gelesen.ok) return `Fehler: ${gelesen.fehler}`
  const g: Gespeichert = { pfad, buchungen: gelesen.buchungen, datei: gelesen.datei }
  await supabase.storage.from(ABLAGE).upload(cachePfad(pfad), new Blob([JSON.stringify(g)], { type: 'application/json' }), { contentType: 'application/json', upsert: true })
  return g
}

type AkteKurz = { id: string; bereich: string | null; firma: string | null; ansprechpartner: string | null; verantwortlich_email: string | null }
type VerbZeile = { id: string; lieferant: string; lieferant_email: string | null; rechnungsnummer: string | null; datum: string; betrag_brutto: number | string | null; status: string; bezahlt_am: string | null; notiz: string | null }

const RECHNUNG_SPALTEN = 'id, nummer, kunde_id, datum, betrag_netto, betrag_brutto, status, zahlungsziel, mahnstufe, zahlungen, mahnungen, versendet_am, bezahlt_am'
const VERB_SPALTEN = 'id, lieferant, lieferant_email, rechnungsnummer, datum, betrag_brutto, status, bezahlt_am, notiz'

async function gleicheMitStandAb(k: AbgleichKontext, buchungen: AbgleichBuchung[]): Promise<{ ergebnis: AbgleichErgebnis; akten: Map<string, AkteKurz> } | string> {
  const { supabase, mitarbeiter } = k
  const { data: rDaten, error: rFehler } = await supabase.from('rechnungen').select(RECHNUNG_SPALTEN).limit(5000)
  if (rFehler) return `Fehler beim Laden der Rechnungen: ${rFehler.message}`
  const { data: vDaten, error: vFehler } = await supabase.from('verbindlichkeiten').select(VERB_SPALTEN).limit(5000)
  if (vFehler) return `Fehler beim Laden der Verbindlichkeiten: ${vFehler.message}`
  const rechnungen = (rDaten ?? []) as RechnungZeile[]
  const ids = [...new Set(rechnungen.map((r) => r.kunde_id).filter(Boolean))]
  const akten = new Map<string, AkteKurz>()
  if (ids.length) {
    const { data } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').in('id', ids)
    for (const a of (data ?? []) as AkteKurz[]) akten.set(a.id, a)
  }
  const sichtbar = (r: RechnungZeile) => {
    const a = akten.get(r.kunde_id)
    return !a || darfAkte(mitarbeiter, a)
  }
  const offen: AbgleichRechnung[] = rechnungen
    .filter((r) => (r.status === 'Versendet' || r.status === 'Überfällig') && sichtbar(r) && offenerBetrag(r) > 0)
    .map((r) => {
      const a = akten.get(r.kunde_id)
      return { id: r.id, nummer: r.nummer, datum: r.datum, brutto: Number(r.betrag_brutto), offen: offenerBetrag(r), kundeId: r.kunde_id, namen: [a?.firma ?? '', a?.ansprechpartner ?? ''].filter(Boolean) }
    })
  const verb = (vDaten ?? []) as VerbZeile[]
  const offeneV: AbgleichVerbindlichkeit[] = verb
    .filter((v) => v.status !== 'bezahlt')
    .map((v) => ({ id: v.id, lieferant: v.lieferant, lieferantEmail: v.lieferant_email, rechnungsnummer: v.rechnungsnummer, datum: v.datum, betrag: v.betrag_brutto == null ? null : Number(v.betrag_brutto) }))
  // Bekannte Zahlungen aus ALLEN Rechnungen (auch nicht sichtbaren — nur zum Erkennen von Doppeltem).
  const bekannte: BekannteZahlung[] = []
  for (const r of rechnungen) {
    const bez = sichtbar(r) ? `Rechnung ${r.nummer}` : 'einer anderen Rechnung'
    for (const z of Array.isArray(r.zahlungen) ? (r.zahlungen as (Zahlung & { quelle?: string })[]) : []) {
      bekannte.push({ art: 'rechnung', zielId: r.id, bezeichnung: bez, datum: z.datum, betrag: Number(z.betrag) || 0, quellen: z.quelle ? [z.quelle] : [] })
    }
  }
  for (const v of verb) {
    if (v.status !== 'bezahlt') continue
    bekannte.push({ art: 'verbindlichkeit', zielId: v.id, bezeichnung: `Verbindlichkeit ${v.lieferant}`, datum: v.bezahlt_am ?? '', betrag: Number(v.betrag_brutto) || 0, quellen: kennungenAusText(v.notiz) })
  }
  return { ergebnis: gleicheAb(buchungen, offen, offeneV, bekannte), akten }
}

function buchungKurz(b: AbgleichBuchung): string {
  const wer = String(b.gegenName ?? '').trim()
  return `${deDatum(b.datum)} ${b.betrag > 0 ? '+' : '−'}${euro(Math.abs(b.betrag))}${wer ? ` ${b.betrag > 0 ? 'von' : 'an'} ${wer}` : ''}`
}

function zielKurz(v: AbgleichVorschlag): string {
  return v.ziele
    .map((z) => (z.art === 'rechnung' ? `${z.nummer} (${z.name}) ${euro(z.betrag)}${z.vollstaendig ? ' → bezahlt' : ' Teilzahlung'}` : `Verbindlichkeit ${z.name}${z.nummer ? ` ${z.nummer}` : ''} → bezahlt`))
    .join(' + ')
}

function vorschlagsListe(e: AbgleichErgebnis, g: Gespeichert): string {
  const d = g.datei
  const zeitraum = d.von || d.bis ? ` (${d.von ? deDatum(d.von) : '?'}–${d.bis ? deDatum(d.bis) : '?'})` : ''
  const zeilen = [`Kontoauszug „${d.name}“${d.bank ? `, ${d.bank}` : ''}${zeitraum}: ${g.buchungen.length} Buchungen, ${e.vorschlaege.length} Vorschläge.`]
  if (d.fehler) zeilen.push(`Hinweis beim Lesen: ${d.fehler}`)
  for (const s of ['sicher', 'wahrscheinlich', 'unklar'] as const) {
    const liste = e.vorschlaege.filter((v) => v.sicherheit === s)
    if (!liste.length) continue
    zeilen.push('', `${SICHERHEIT_TEXT[s].toUpperCase()}:`)
    for (const v of liste.slice(0, 40)) zeilen.push(`- [${v.id}] ${buchungKurz(v.buchung)} → ${zielKurz(v)}. ${v.grund}${v.hinweis ? ` ${v.hinweis}` : ''}`)
    if (liste.length > 40) zeilen.push(`… und ${liste.length - 40} weitere (im CRM unter Rechnungen → Kontoauszug abgleichen).`)
  }
  if (e.schonGebucht.length) zeilen.push('', `Schon gebucht: ${e.schonGebucht.length} (${e.schonGebucht.slice(0, 5).map((x) => `${buchungKurz(x.buchung)}: ${x.wo}`).join('; ')}${e.schonGebucht.length > 5 ? ' …' : ''}).`)
  if (e.ohneTreffer.length) {
    const ein = e.ohneTreffer.filter((x) => x.buchung.betrag > 0).length
    zeilen.push('', `Ohne passenden offenen Posten: ${e.ohneTreffer.length} (${ein} Eingänge, ${e.ohneTreffer.length - ein} Ausgänge), z. B. ${e.ohneTreffer.slice(0, 5).map((x) => buchungKurz(x.buchung)).join('; ')}.`)
  }
  if (e.vorschlaege.length) zeilen.push('', 'Nichts gebucht. Zum Buchen den Mitarbeiter fragen und dann kontoauszug_abgleichen mit bestaetigt=true und den freigegebenen vorschlag_ids aufrufen.')
  return zeilen.join('\n').slice(0, 15000)
}

async function bucheRechnung(k: AbgleichKontext, v: AbgleichVorschlag, z: AbgleichVorschlag['ziele'][number]): Promise<string> {
  const { supabase, mitarbeiter, protokolliere, heute } = k
  const { data } = await supabase.from('rechnungen').select(RECHNUNG_SPALTEN).eq('id', z.id).maybeSingle()
  const r = data as RechnungZeile | null
  if (!r) return `${z.nummer}: Rechnung nicht mehr vorhanden — nichts gebucht.`
  const { data: a } = await supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich_email').eq('id', r.kunde_id).maybeSingle()
  const akte = a as AkteKurz | null
  if (akte && (istFremdePrivatakte(mitarbeiter, akte) || !darfAkte(mitarbeiter, akte))) return `${z.nummer}: ${nichtFreigegeben(akte.bereich, mitarbeiter.name)}`
  const zahlungenVorher = Array.isArray(r.zahlungen) ? (r.zahlungen as (Zahlung & { quelle?: string })[]) : []
  if (zahlungenVorher.some((x) => x.quelle === v.fingerabdruck)) return `${r.nummer}: diese Buchung ist schon erfasst — nicht doppelt gebucht.`
  const e = berechneZahlung(r, { betrag: z.betrag, datum: v.buchung.datum, notiz: zahlungsNotiz(v), von: mitarbeiter.name, ueberzahlungBestaetigt: true })
  if (typeof e === 'string') return `${r.nummer}: ${e.replace(/^Fehler: /, '')}`
  const zahlungen = (e.aenderung.zahlungen as Zahlung[]).map((x) => (x.id === e.zahlung.id ? { ...x, quelle: v.fingerabdruck } : x))
  const voll = e.vollstaendig || z.vollstaendig
  const aenderung: Record<string, unknown> = voll ? { zahlungen, status: 'Bezahlt', bezahlt_am: v.buchung.datum, mahnstufe: null } : { ...e.aenderung, zahlungen }
  const { error } = await supabase.from('rechnungen').update(aenderung).eq('id', r.id)
  if (error) return `${r.nummer}: Fehler beim Speichern (${error.message}) — nichts gebucht.`
  const vermerk = zahlungsVermerk({ nummer: r.nummer, betrag: e.zahlung.betrag, vollstaendig: voll, offenNachher: voll ? 0 : e.offenNachher, skonto: voll && !e.vollstaendig ? v.skonto : undefined })
  if (akte) {
    // Verlauf frisch lesen und vorne anfügen (wie vermerk() im CRM).
    const { data: frisch } = await supabase.from('kunden').select('activities').eq('id', akte.id).maybeSingle()
    const alt = Array.isArray(frisch?.activities) ? frisch.activities : []
    await supabase.from('kunden').update({ activities: [{ id: neueId('act'), date: heute, text: vermerk, user: mitarbeiter.name }, ...alt], letzte_aktivitaet: heute }).eq('id', akte.id)
  }
  protokolliere(`${vermerk} (${akte?.firma ?? 'ohne Akte'})`)
  return `${r.nummer}: ${euro(e.zahlung.betrag)} gebucht${voll ? ', Rechnung bezahlt' : `, noch offen ${euro(e.offenNachher)}`}${e.ueberzahlung > 0 ? ` (Überzahlung ${euro(e.ueberzahlung)} — klären)` : ''}.`
}

async function bucheVerbindlichkeit(k: AbgleichKontext, v: AbgleichVorschlag, z: AbgleichVorschlag['ziele'][number]): Promise<string> {
  const { supabase, protokolliere } = k
  const { data } = await supabase.from('verbindlichkeiten').select(VERB_SPALTEN).eq('id', z.id).maybeSingle()
  const zeile = data as VerbZeile | null
  if (!zeile) return `Verbindlichkeit ${z.name}: nicht mehr vorhanden — nichts gebucht.`
  if (zeile.status === 'bezahlt' || kennungenAusText(zeile.notiz).includes(v.fingerabdruck)) return `Verbindlichkeit ${zeile.lieferant}: schon als bezahlt vermerkt — nichts geändert.`
  const { error } = await supabase.from('verbindlichkeiten').update({ status: 'bezahlt', bezahlt_am: v.buchung.datum, notiz: verbindlichkeitNotiz(zeile.notiz, v) }).eq('id', zeile.id)
  if (error) return `Verbindlichkeit ${zeile.lieferant}: Fehler beim Speichern (${error.message}).`
  protokolliere(`Verbindlichkeit ${zeile.lieferant}${zeile.rechnungsnummer ? ` (${zeile.rechnungsnummer})` : ''} laut Kontoauszug als bezahlt am ${deDatum(v.buchung.datum)} vermerkt`)
  return `Verbindlichkeit ${zeile.lieferant}${zeile.rechnungsnummer ? ` ${zeile.rechnungsnummer}` : ''}: als bezahlt am ${deDatum(v.buchung.datum)} vermerkt.`
}

// deno-lint-ignore no-explicit-any
export async function fuehreAbgleichWerkzeugAus(name: string, input: any, k: AbgleichKontext): Promise<string> {
  if (name !== 'kontoauszug_abgleichen') return `Fehler: unbekanntes Werkzeug ${name}.`
  const { supabase, mitarbeiter } = k
  if (!darfRechnungen(mitarbeiter)) return nichtFreigegeben('beratung', mitarbeiter.name)
  const pfad = String(input?.pfad ?? '').trim()
  if (!pfad.startsWith('telegram/') || !istSichererPfad(pfad)) return 'Fehler: pfad muss exakt aus dem Datei-Eingang stammen und mit "telegram/" beginnen.'

  // Liegt die Datei nur in privaten Akten anderer, gibt es sie für diesen Mitarbeiter nicht (wie datei_lesen).
  const { data: privat } = await supabase.from('kunden').select('id, bereich, verantwortlich_email, dokumente').eq('bereich', 'privat')
  const marke = `/${TELEGRAM_EIMER}/${pfad}`
  const darin = ((privat ?? []) as (AkteKurz & { dokumente?: { url?: string }[] | null })[]).filter((a) => (a.dokumente ?? []).some((d) => String(d?.url ?? '').includes(marke)))
  if (darin.length && darin.every((a) => istFremdePrivatakte(mitarbeiter, a))) return 'Fehler: Diese Datei gibt es in der Ablage nicht.'

  const g = await ladeOderLies(k, pfad)
  if (typeof g === 'string') return g
  if (!g.buchungen.length) return `Im Auszug „${g.datei.name}“ wurden keine Buchungen gefunden.${g.datei.fehler ? ` ${g.datei.fehler}` : ''}`
  const stand = await gleicheMitStandAb(k, g.buchungen)
  if (typeof stand === 'string') return stand

  if (input?.bestaetigt !== true) return vorschlagsListe(stand.ergebnis, g)

  const ids = (Array.isArray(input?.vorschlag_ids) ? input.vorschlag_ids : []).map((x: unknown) => String(x ?? '').trim().replace(/^\[|\]$/g, '')).filter(Boolean) as string[]
  if (!ids.length) return 'Fehler: vorschlag_ids fehlen. Nenne die Kennungen (v…) der Vorschläge, die der Mitarbeiter freigegeben hat.'
  const nachId = new Map(stand.ergebnis.vorschlaege.map((v) => [v.id, v]))
  const zeilen: string[] = []
  for (const id of [...new Set(ids)]) {
    const v = nachId.get(id)
    if (!v) {
      const gebucht = stand.ergebnis.schonGebucht.length ? ' (womöglich schon gebucht)' : ''
      zeilen.push(`[${id}]: diesen Vorschlag gibt es nicht mehr${gebucht} — nichts gebucht. Ruf das Werkzeug ohne bestaetigt erneut auf.`)
      continue
    }
    for (const z of v.ziele) zeilen.push(`[${id}] ${z.art === 'rechnung' ? await bucheRechnung(k, v, z) : await bucheVerbindlichkeit(k, v, z)}`)
  }
  return [`Kontoauszug „${g.datei.name}“ — gebucht:`, ...zeilen].join('\n')
}
