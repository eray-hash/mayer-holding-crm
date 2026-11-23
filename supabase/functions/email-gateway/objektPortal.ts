// Interessenten-Portal für Objekte (21.11.2026, Eray): Ein Interessent bekommt einen geheimen Link
// (objekt_freigaben.token). Vor der ersten Einsicht stimmt er den AGB, der Provisionsvereinbarung und dem
// vorzeitigen Beginn zu (Texte aus den Vorlagen der Immo-Abteilung); erst dann sieht er die vollständigen
// Objektdaten und die für Interessenten freigegebenen Unterlagen (objekte.interessenten_dokumente).
// Die Zustimmung wird mit Zeitpunkt, getipptem Namen, Gerät und dem genauen Wortlaut gespeichert.
// Alles läuft mit dem Dienstschlüssel; der Link ist der einzige Nachweis, deshalb strenge Prüfung des Zeichens.
import { pruefeSpeicherPfad } from '../_shared/speicherPfad.ts'
import { belegtVon, ueberschneidet, zeitraumText, type FremdZeile, type TerminZeile } from '../_shared/besichtigungZeiten.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'
import { heuteBerlin } from '../_shared/heuteBerlin.ts'

export const PORTAL_TEXTE = { agb: 'vl_immo_portal_agb', provision: 'vl_immo_portal_provision', widerruf: 'vl_immo_portal_widerruf' } as const
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/

// deno-lint-ignore no-explicit-any
type Admin = any

export type PortalErgebnis =
  | { stufe: 'ungueltig'; grund: string }
  | {
      stufe: 'zustimmung'
      name: string
      objekt: { bezeichnung: string; ort: string; typ: string; kaufpreis: number | null }
      texte: { agb: string; provision: string; widerruf: string }
    }
  | {
      stufe: 'frei'
      name: string
      zugestimmtAm: string
      objekt: { bezeichnung: string; adresse: string; typ: string; kaufpreis: number | null; beschreibung: string }
      dokumente: { id: string; name: string; typ: string; groesse: string }[]
      besichtigung: PortalBesichtigung
      /** Rückmeldung nach Buchen, Absagen oder Rückrufwunsch. */
      hinweis?: string
    }

/** Besichtigung im Portal: freie Zeiten, die eigene Buchung, ein offener Rückrufwunsch. */
export type PortalBesichtigung = {
  zeiten: { id: string; beginn: string; ende: string; treffpunkt: string; makler: string; freiePlaetze: number }[]
  meine: { id: string; beginn: string; ende: string; treffpunkt: string; makler: string } | null
  rueckrufAm: string | null
}

/** Ort aus einer Adresse ("Hauptstraße 1, 89073 Ulm" → "89073 Ulm"); vor der Zustimmung keine Hausnummer zeigen. */
export function ortAus(adresse: string): string {
  const a = (adresse ?? '').trim()
  const plzOrt = /(\d{5}\s+[^,\n]+)/.exec(a)
  if (plzOrt) return plzOrt[1].trim()
  const teile = a.split(/[,\n]/).map((t) => t.trim()).filter(Boolean)
  return teile.length > 1 ? teile[teile.length - 1] : a.replace(/\s+\d+[a-z]?\b/gi, '').trim()
}

export function fuelleText(text: string, w: { name: string; objekt: string; provision: string; datum: string }): string {
  return text
    .replace(/\{\{\s*Name Interessent\s*\}\}/g, w.name)
    .replace(/\{\{\s*Objekt\s*\}\}/g, w.objekt)
    .replace(/\{\{\s*Provision\s*\}\}/g, w.provision)
    .replace(/\{\{\s*Datum\s*\}\}/g, w.datum)
}

/** Alle Dokumente eines Objekts (objekte.dokumente ist { Ordner: Dokument[] }). */
export function alleDokumente(dokumente: unknown): { id: string; name: string; typ: string; groesse: string; url?: string }[] {
  if (!dokumente || typeof dokumente !== 'object') return []
  const liste = Array.isArray(dokumente) ? dokumente : Object.values(dokumente as Record<string, unknown>).flat()
  // deno-lint-ignore no-explicit-any
  return (liste as any[]).filter((d) => d && typeof d.id === 'string').map((d) => ({ id: d.id, name: String(d.name ?? ''), typ: String(d.typ ?? ''), groesse: String(d.groesse ?? ''), url: d.url }))
}

const datumDe = (d = new Date()) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)

async function ladeFreigabe(admin: Admin, token: unknown) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return { fehler: 'Dieser Link ist ungültig.' as const }
  const { data: f } = await admin.from('objekt_freigaben').select('*').eq('token', token).maybeSingle()
  if (!f) return { fehler: 'Dieser Link ist ungültig.' as const }
  if (f.status === 'widerrufen') return { fehler: 'Dieser Zugang wurde beendet. Bitte wenden Sie sich an uns.' as const }
  if (new Date(f.gueltig_bis).getTime() < Date.now()) return { fehler: 'Dieser Link ist abgelaufen. Bitte fordern Sie bei uns einen neuen an.' as const }
  const { data: o } = await admin
    .from('objekte')
    .select('id, bezeichnung, adresse, typ, kaufpreis, expose_text, dokumente, interessenten_dokumente, verantwortlich, activities')
    .eq('id', f.objekt_id)
    .maybeSingle()
  if (!o) return { fehler: 'Dieses Objekt ist nicht mehr verfügbar.' as const }
  return { f, o }
}

async function ladeTexte(admin: Admin): Promise<{ agb: string; provision: string; widerruf: string }> {
  const { data } = await admin.from('vorlagen').select('id, text').in('id', Object.values(PORTAL_TEXTE))
  const t = (id: string) => ((data ?? []) as { id: string; text: string }[]).find((x) => x.id === id)?.text ?? ''
  return { agb: t(PORTAL_TEXTE.agb), provision: t(PORTAL_TEXTE.provision), widerruf: t(PORTAL_TEXTE.widerruf) }
}

/** Seite laden: vor der Zustimmung nur Eckdaten und die Texte, danach alles Freigegebene. */
export async function portalLaden(admin: Admin, token: unknown): Promise<PortalErgebnis> {
  const r = await ladeFreigabe(admin, token)
  if ('fehler' in r) return { stufe: 'ungueltig', grund: r.fehler ?? 'Dieser Link ist ungültig.' }
  const { f, o } = r
  await admin.from('objekt_freigaben').update({ zugriffe: (f.zugriffe ?? 0) + 1, letzter_zugriff: new Date().toISOString() }).eq('id', f.id)
  if (f.status !== 'zugestimmt') {
    const kaufpreis = o.kaufpreis === null || o.kaufpreis === undefined ? null : Number(o.kaufpreis)
    const texte = await ladeTexte(admin)
    const werte = { name: f.name, objekt: `${o.bezeichnung} (${ortAus(o.adresse)})`, provision: f.provision, datum: datumDe() }
    return {
      stufe: 'zustimmung',
      name: f.name,
      objekt: { bezeichnung: o.bezeichnung, ort: ortAus(o.adresse), typ: o.typ ?? '', kaufpreis },
      texte: { agb: fuelleText(texte.agb, werte), provision: fuelleText(texte.provision, werte), widerruf: fuelleText(texte.widerruf, werte) },
    }
  }
  return await freieSeite(admin, f, o)
}

// deno-lint-ignore no-explicit-any
async function freieSeite(admin: Admin, f: any, o: any, hinweis?: string): Promise<PortalErgebnis> {
  const kaufpreis = o.kaufpreis === null || o.kaufpreis === undefined ? null : Number(o.kaufpreis)
  const frei = new Set(Array.isArray(o.interessenten_dokumente) ? (o.interessenten_dokumente as string[]) : [])
  return {
    stufe: 'frei',
    name: f.name,
    zugestimmtAm: f.zustimmung?.am ?? '',
    objekt: { bezeichnung: o.bezeichnung, adresse: o.adresse ?? '', typ: o.typ ?? '', kaufpreis, beschreibung: o.expose_text ?? '' },
    dokumente: alleDokumente(o.dokumente).filter((d) => frei.has(d.id) && d.url).map(({ id, name, typ, groesse }) => ({ id, name, typ, groesse })),
    besichtigung: await besichtigungStand(admin, f, o, new Date()),
    ...(hinweis ? { hinweis } : {}),
  }
}

export type ZustimmungEingabe = { name?: unknown; agb?: unknown; provision?: unknown; sofortBeginn?: unknown }

/** Zustimmung festhalten. Liefert danach die freigegebene Seite. */
export async function portalZustimmen(
  admin: Admin,
  token: unknown,
  e: ZustimmungEingabe,
  meta: { ip: string; geraet: string },
  melde?: (verantwortlich: string, text: string) => Promise<void>,
): Promise<PortalErgebnis | { stufe: 'fehler'; grund: string }> {
  const r = await ladeFreigabe(admin, token)
  if ('fehler' in r) return { stufe: 'ungueltig', grund: r.fehler ?? 'Dieser Link ist ungültig.' }
  const { f, o } = r
  if (f.status === 'zugestimmt') return await portalLaden(admin, token)
  const name = typeof e.name === 'string' ? e.name.trim().replace(/\s+/g, ' ') : ''
  if (name.length < 3 || name.length > 120) return { stufe: 'fehler', grund: 'Bitte geben Sie Ihren vollständigen Namen ein.' }
  if (e.agb !== true || e.provision !== true || e.sofortBeginn !== true) {
    return { stufe: 'fehler', grund: 'Bitte bestätigen Sie alle drei Punkte, um die Unterlagen zu sehen.' }
  }
  const jetzt = new Date()
  const texte = await ladeTexte(admin)
  const werte = { name, objekt: `${o.bezeichnung} (${ortAus(o.adresse)})`, provision: f.provision, datum: datumDe(jetzt) }
  const zustimmung = {
    am: jetzt.toISOString(),
    name,
    agb: true,
    provision: true,
    sofortBeginn: true,
    ip: meta.ip.slice(0, 64),
    geraet: meta.geraet.slice(0, 300),
    texte: { agb: fuelleText(texte.agb, werte), provision: fuelleText(texte.provision, werte), widerruf: fuelleText(texte.widerruf, werte) },
  }
  const { data: geschrieben } = await admin
    .from('objekt_freigaben')
    .update({ status: 'zugestimmt', zustimmung })
    .eq('id', f.id)
    .eq('status', 'eingeladen')
    .select('id')
  if (!geschrieben || geschrieben.length === 0) return await portalLaden(admin, token)

  const eintrag = `${name} hat im Interessenten-Portal den AGB und der Provisionsvereinbarung (${f.provision}) zugestimmt und sieht jetzt die freigegebenen Unterlagen.`
  await verlaufEintragen(admin, o.id, f.kunde_id, eintrag, `Interessenten-Portal ${o.bezeichnung}: AGB und Provisionsvereinbarung (${f.provision}) zugestimmt.`, `${name} (Portal)`)
  if (melde && o.verantwortlich) await melde(o.verantwortlich, `🏠 ${eintrag.replace(' hat im', ' hat für „' + o.bezeichnung + '“ im')}`).catch(() => undefined)
  return await portalLaden(admin, token)
}

/** Kurzlebige Download-Adresse für ein freigegebenes Dokument (nur nach Zustimmung). */
export async function portalDokument(admin: Admin, token: unknown, dokumentId: unknown): Promise<{ url: string } | { fehler: string }> {
  const r = await ladeFreigabe(admin, token)
  if ('fehler' in r) return { fehler: r.fehler ?? 'Dieser Link ist ungültig.' }
  const { f, o } = r
  if (f.status !== 'zugestimmt') return { fehler: 'Bitte stimmen Sie zuerst den Bedingungen zu.' }
  const frei = new Set(Array.isArray(o.interessenten_dokumente) ? (o.interessenten_dokumente as string[]) : [])
  const dok = alleDokumente(o.dokumente).find((d) => d.id === dokumentId)
  if (!dok || !frei.has(dok.id) || !dok.url) return { fehler: 'Dieses Dokument ist nicht freigegeben.' }
  const pfad = pruefeSpeicherPfad('objekt-dokumente', dok.url)
  const { data, error } = await admin.storage.from('objekt-dokumente').createSignedUrl(pfad, 60 * 10, { download: dok.name })
  if (error || !data?.signedUrl) return { fehler: 'Das Dokument lässt sich gerade nicht öffnen. Bitte versuchen Sie es später erneut.' }
  return { url: data.signedUrl }
}

// ---------- Verlauf ----------

/** Eintrag oben in den Verlauf des Objekts und (falls verknüpft) der Kundenakte — Liste direkt vor dem Schreiben frisch gelesen. */
async function verlaufEintragen(admin: Admin, objektId: string, kundeId: string | null | undefined, textObjekt: string, textKunde: string, user: string) {
  const heute = heuteBerlin()
  const { data: o } = await admin.from('objekte').select('activities').eq('id', objektId).maybeSingle()
  if (o) {
    const verlauf = Array.isArray(o.activities) ? o.activities : []
    await admin.from('objekte').update({ activities: [{ id: `act_${crypto.randomUUID().slice(0, 10)}`, date: heute, text: textObjekt, user }, ...verlauf] }).eq('id', objektId)
  }
  if (kundeId) {
    const { data: k } = await admin.from('kunden').select('activities').eq('id', kundeId).maybeSingle()
    if (k) {
      const kv = Array.isArray(k.activities) ? k.activities : []
      await admin.from('kunden').update({ activities: [{ id: crypto.randomUUID(), date: heute, text: textKunde, user }, ...kv], letzte_aktivitaet: heute }).eq('id', kundeId)
    }
  }
}

// ---------- Besichtigung vereinbaren (22.11.2026) ----------
// Der Makler gibt in der Objektakte Zeiten frei (Tabelle besichtigung_zeiten). Nach der Zustimmung sieht der
// Interessent die freien Zeiten und bucht eine davon selbst. Die Buchung ist eine ganz normale Zeile in
// `besichtigungen` (Auslöser an_besichtigungen merkt Bestätigung, Erinnerung und bei Absage die Absage-Mail vor),
// dazu ein Termin im Kalender des Maklers, ein Verlaufseintrag in Objekt und Kundenakte und eine Telegram-Notiz.
// Die Plätze zählt die Datenbankfunktion besichtigung_portal_buchen in einer Transaktion (keine Doppelbuchung).

/** Frühestens so lange vor Beginn buchbar. */
const VORLAUF_MS = 2 * 3600000
const VORAUS_MS = 60 * 86400000
const RUECKRUF_SPERRE_MS = 24 * 3600000
const TELEFON = /^\+?[0-9][0-9 ()/.-]{4,28}[0-9]$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Wie kalender.ts ERLAUBTE_ERINNERUNGEN (Minuten vorher). */
const ERINNERUNGEN = [1440, 60, 30, 15]

type ZeitZeile = { id: string; beginn: string; ende: string; plaetze: number; makler: string; treffpunkt: string }
type Makler = { name: string; email: string; chat: number | string | null }

const LEER: PortalBesichtigung = { zeiten: [], meine: null, rueckrufAm: null }

async function ladeMakler(admin: Admin, namen: string[]): Promise<Map<string, Makler>> {
  const aus = new Map<string, Makler>()
  const sauber = [...new Set(namen.map((n) => n.trim()).filter(Boolean))]
  if (sauber.length === 0) return aus
  const { data } = await admin.from('mitarbeiter').select('name, email, telegram_chat_id').eq('aktiv', true).in('name', sauber)
  for (const m of (data ?? []) as { name: string; email: string | null; telegram_chat_id: number | string | null }[]) {
    if (m.email) aus.set(m.name.trim().toLowerCase(), { name: m.name, email: m.email.trim().toLowerCase(), chat: m.telegram_chat_id ?? null })
  }
  return aus
}

const maklerVon = (z: { makler?: string | null }, o: { verantwortlich?: string | null }) => String(z.makler ?? '').trim() || String(o.verantwortlich ?? '').trim()

/**
 * Freie Zeiten eines Objekts: offen, frühestens in 2 Stunden, höchstens 60 Tage voraus, noch Plätze frei und
 * der Makler ist laut CRM-Kalender und eigenem Kalender nicht anderweitig belegt. Termine, die aus Buchungen
 * genau dieser Zeit stammen, zählen nicht als belegt (sonst verschwände eine Zeit mit mehreren Plätzen nach der ersten Buchung).
 */
export async function freieBesichtigungsZeiten(admin: Admin, o: { id: string; verantwortlich?: string | null }, jetzt: Date): Promise<PortalBesichtigung['zeiten']> {
  const { data: zeilen, error } = await admin
    .from('besichtigung_zeiten')
    .select('id, beginn, ende, plaetze, makler, treffpunkt')
    .eq('objekt_id', o.id)
    .eq('status', 'offen')
    .gt('beginn', new Date(jetzt.getTime() + VORLAUF_MS).toISOString())
    .lt('beginn', new Date(jetzt.getTime() + VORAUS_MS).toISOString())
    .order('beginn')
    .limit(200)
  if (error || !Array.isArray(zeilen) || zeilen.length === 0) return []
  const zeiten = zeilen as ZeitZeile[]
  const { data: gebucht } = await admin
    .from('besichtigungen')
    .select('besichtigung_zeit_id, kalender_termin_id')
    .in('besichtigung_zeit_id', zeiten.map((z) => z.id))
    .eq('status', 'geplant')
  const anzahl = new Map<string, number>()
  const eigeneTermine = new Map<string, Set<string>>()
  for (const b of (gebucht ?? []) as { besichtigung_zeit_id: string; kalender_termin_id: string | null }[]) {
    anzahl.set(b.besichtigung_zeit_id, (anzahl.get(b.besichtigung_zeit_id) ?? 0) + 1)
    if (b.kalender_termin_id) {
      if (!eigeneTermine.has(b.besichtigung_zeit_id)) eigeneTermine.set(b.besichtigung_zeit_id, new Set())
      eigeneTermine.get(b.besichtigung_zeit_id)!.add(String(b.kalender_termin_id))
    }
  }
  const mitPlatz = zeiten.filter((z) => (anzahl.get(z.id) ?? 0) < Math.max(1, Number(z.plaetze ?? 1)))
  if (mitPlatz.length === 0) return []

  const makler = await ladeMakler(admin, mitPlatz.map((z) => maklerVon(z, o)))
  const emails = [...new Set([...makler.values()].map((m) => m.email))]
  let termine: TerminZeile[] = []
  let fremd: FremdZeile[] = []
  if (emails.length > 0) {
    const von = new Date(Math.min(...mitPlatz.map((z) => Date.parse(z.beginn))) - 86400000).toISOString()
    const bis = new Date(Math.max(...mitPlatz.map((z) => Date.parse(z.ende))) + 86400000).toISOString()
    const [t, fr] = await Promise.all([
      alleZeilen(() => admin.from('termine').select('id, beginn, ende, ganztags, besitzer_email, teilnehmer').eq('ganztags', false).lt('beginn', bis).gt('ende', von)),
      admin.from('kalender_fremd').select('email, belegt').in('email', emails),
    ])
    termine = (t.data ?? []) as TerminZeile[]
    fremd = (fr.data ?? []) as FremdZeile[]
  }
  const belegtJe = new Map<string, ReturnType<typeof belegtVon>>()
  for (const e of emails) belegtJe.set(e, belegtVon(e, termine, fremd))

  return mitPlatz
    .filter((z) => {
      const m = makler.get(maklerVon(z, o).toLowerCase())
      if (!m) return true
      const ausnahmen = eigeneTermine.get(z.id) ?? new Set<string>()
      const belegt = (belegtJe.get(m.email) ?? []).filter((b) => !b.terminId || !ausnahmen.has(b.terminId))
      return !ueberschneidet(z, belegt)
    })
    .map((z) => ({
      id: z.id,
      beginn: new Date(z.beginn).toISOString(),
      ende: new Date(z.ende).toISOString(),
      treffpunkt: String(z.treffpunkt ?? ''),
      makler: maklerVon(z, o),
      freiePlaetze: Math.max(1, Number(z.plaetze ?? 1)) - (anzahl.get(z.id) ?? 0),
    }))
}

// deno-lint-ignore no-explicit-any
async function besichtigungStand(admin: Admin, f: any, o: any, jetzt: Date): Promise<PortalBesichtigung> {
  try {
    const { data: meine } = await admin
      .from('besichtigungen')
      .select('id, beginn, dauer_min, durchgefuehrt_von, besichtigung_zeit_id')
      .eq('freigabe_id', f.id)
      .eq('status', 'geplant')
      .gt('beginn', jetzt.toISOString())
      .order('beginn')
      .limit(1)
    const rueckrufAm = f.rueckruf_am ? String(f.rueckruf_am) : null
    const b = Array.isArray(meine) ? meine[0] : null
    if (b) {
      let treffpunkt = String(o.adresse ?? '')
      let ende = new Date(Date.parse(b.beginn) + Math.max(15, Number(b.dauer_min ?? 30)) * 60000).toISOString()
      if (b.besichtigung_zeit_id) {
        const { data: z } = await admin.from('besichtigung_zeiten').select('treffpunkt, ende').eq('id', b.besichtigung_zeit_id).maybeSingle()
        if (z?.treffpunkt) treffpunkt = String(z.treffpunkt)
        if (z?.ende) ende = new Date(z.ende).toISOString()
      }
      return { zeiten: [], meine: { id: b.id, beginn: new Date(b.beginn).toISOString(), ende, treffpunkt, makler: String(b.durchgefuehrt_von ?? '') }, rueckrufAm }
    }
    return { zeiten: await freieBesichtigungsZeiten(admin, o, jetzt), meine: null, rueckrufAm }
  } catch (err) {
    console.error('Interessenten-Portal: Besichtigungszeiten nicht lesbar:', err instanceof Error ? err.message : err)
    return LEER
  }
}

export type BesichtigungEingabe = { art?: unknown; zeitId?: unknown; besichtigungId?: unknown; telefon?: unknown; nachricht?: unknown }
type PortalFehler = { stufe: 'fehler'; grund: string }

/**
 * Aktion des Interessenten zur Besichtigung (nur mit gültigem Link und erteilter Zustimmung):
 * 'buchen' (zeitId, optional telefon), 'absagen' (besichtigungId), 'rueckruf' (telefon, optional nachricht).
 * Liefert die aktualisierte Seite mit einem Hinweis oder eine Fehlermeldung.
 */
export async function portalBesichtigung(
  admin: Admin,
  token: unknown,
  e: BesichtigungEingabe,
  melde?: (verantwortlich: string, text: string) => Promise<void>,
): Promise<PortalErgebnis | PortalFehler> {
  const r = await ladeFreigabe(admin, token)
  if ('fehler' in r) return { stufe: 'ungueltig', grund: r.fehler ?? 'Dieser Link ist ungültig.' }
  const { f, o } = r
  if (f.status !== 'zugestimmt') return { stufe: 'fehler', grund: 'Bitte stimmen Sie zuerst den Bedingungen zu.' }
  const name = String(f.zustimmung?.name ?? '').trim() || String(f.name ?? '').trim()
  const telefon = typeof e.telefon === 'string' ? e.telefon.trim().replace(/\s+/g, ' ') : ''
  if (telefon && !TELEFON.test(telefon)) return { stufe: 'fehler', grund: 'Bitte prüfen Sie die Telefonnummer.' }
  const user = `${name} (Portal)`
  const sage = async (wer: string, text: string) => {
    if (melde && wer) await melde(wer, text).catch(() => undefined)
  }
  const neuGeladen = async (hinweis: string): Promise<PortalErgebnis | PortalFehler> => {
    const frisch = await ladeFreigabe(admin, token)
    if ('fehler' in frisch) return { stufe: 'ungueltig', grund: frisch.fehler ?? 'Dieser Link ist ungültig.' }
    return await freieSeite(admin, frisch.f, frisch.o, hinweis)
  }
  const jetzt = new Date()

  if (e.art === 'buchen') {
    if (typeof e.zeitId !== 'string' || !UUID.test(e.zeitId)) return { stufe: 'fehler', grund: 'Bitte wählen Sie einen Termin aus.' }
    const NICHT_FREI: PortalFehler = { stufe: 'fehler', grund: 'Dieser Termin ist leider nicht mehr frei. Bitte wählen Sie einen anderen.' }
    const zeit = (await freieBesichtigungsZeiten(admin, o, jetzt)).find((z) => z.id === e.zeitId)
    if (!zeit) return NICHT_FREI
    if (!f.email && !f.telefon && !telefon) return { stufe: 'fehler', grund: 'Bitte geben Sie eine Telefonnummer an, damit wir Sie erreichen können.' }
    const id = `bes_${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`
    const tel = telefon || String(f.telefon ?? '')
    const email = String(f.email ?? '')
    const { data: antwort, error } = await admin.rpc('besichtigung_portal_buchen', {
      p_freigabe: f.id,
      p_zeit: zeit.id,
      p_zeile: { id, interessent: name, telefon: tel, email, durchgefuehrt_von: zeit.makler },
    })
    if (error) throw new Error(`Besichtigung buchen: ${error.message}`)
    if (antwort === 'ungueltig') return { stufe: 'ungueltig', grund: 'Dieser Link ist ungültig.' }
    if (antwort === 'schon_gebucht') return { stufe: 'fehler', grund: 'Sie haben bereits einen Besichtigungstermin. Wenn Sie einen anderen möchten, sagen Sie diesen bitte zuerst ab.' }
    if (antwort !== 'ok') return NICHT_FREI

    if (telefon && !f.telefon) await admin.from('objekt_freigaben').update({ telefon }).eq('id', f.id)
    const makler = (await ladeMakler(admin, [zeit.makler])).get(zeit.makler.toLowerCase())
    if (makler) {
      const bisBeginn = (Date.parse(zeit.beginn) - jetzt.getTime()) / 60000
      const { data: termin, error: tFehler } = await admin
        .from('termine')
        .insert({
          titel: `Besichtigung ${o.bezeichnung} – ${name}`,
          beschreibung: ['Vom Interessenten im Portal gebucht.', tel && `Telefon: ${tel}`, email && `E-Mail: ${email}`].filter(Boolean).join('\n'),
          ort: zeit.treffpunkt || String(o.adresse ?? ''),
          beginn: zeit.beginn,
          ende: zeit.ende,
          ganztags: false,
          besitzer_email: makler.email,
          // Kein Gast: die Mails an den Interessenten kommen aus den automatischen Nachrichten der Besichtigung.
          teilnehmer: [],
          kunde_id: f.kunde_id ?? null,
          kunde_bereich: f.kunde_id ? f.kunde_bereich ?? 'immobilienkunden' : null,
          kunde_name: f.kunde_id ? name : null,
          quelle: 'portal',
          erinnert: { [makler.email]: ERINNERUNGEN.filter((m) => bisBeginn <= m) },
          geaendert_am: jetzt.toISOString(),
        })
        .select('id')
        .single()
      if (tFehler) console.error('Interessenten-Portal: Kalendertermin nicht angelegt:', tFehler.message)
      else if (termin?.id) await admin.from('besichtigungen').update({ kalender_termin_id: termin.id }).eq('id', id)
    }
    const wann = zeitraumText(zeit)
    await verlaufEintragen(admin, o.id, f.kunde_id, `${name} hat im Interessenten-Portal eine Besichtigung gebucht: ${wann}.`, `Besichtigung ${o.bezeichnung} im Portal gebucht: ${wann}.`, user)
    await sage(
      zeit.makler,
      ['📅 Besichtigung im Portal gebucht', '', o.bezeichnung, wann, `Interessent: ${name}`, tel ? `Telefon: ${tel}` : '', email ? `E-Mail: ${email}` : '', zeit.treffpunkt ? `Treffpunkt: ${zeit.treffpunkt}` : '']
        .filter(Boolean)
        .join('\n'),
    )
    return await neuGeladen(`Ihr Besichtigungstermin ist eingetragen: ${wann}. Sie sehen ihn hier jederzeit und können ihn bei Bedarf absagen.`)
  }

  if (e.art === 'absagen') {
    if (typeof e.besichtigungId !== 'string' || !e.besichtigungId) return { stufe: 'fehler', grund: 'Diesen Termin gibt es nicht mehr.' }
    const { data: b } = await admin
      .from('besichtigungen')
      .select('id, beginn, dauer_min, status, kalender_termin_id, durchgefuehrt_von, besichtigung_zeit_id')
      .eq('id', e.besichtigungId)
      .eq('freigabe_id', f.id)
      .maybeSingle()
    if (!b || b.status !== 'geplant') return { stufe: 'fehler', grund: 'Diesen Termin gibt es nicht mehr.' }
    if (Date.parse(b.beginn) <= jetzt.getTime()) return { stufe: 'fehler', grund: 'Der Termin hat schon begonnen. Bitte rufen Sie uns an.' }
    const { data: geaendert } = await admin
      .from('besichtigungen')
      .update({ status: 'abgesagt', kalender_termin_id: null, geaendert_am: jetzt.toISOString() })
      .eq('id', b.id)
      .eq('status', 'geplant')
      .select('id')
    if (!geaendert || geaendert.length === 0) return { stufe: 'fehler', grund: 'Diesen Termin gibt es nicht mehr.' }
    if (b.kalender_termin_id) await admin.from('termine').delete().eq('id', b.kalender_termin_id)
    const wann = zeitraumText({ beginn: b.beginn, ende: new Date(Date.parse(b.beginn) + Math.max(15, Number(b.dauer_min ?? 30)) * 60000).toISOString() })
    await verlaufEintragen(admin, o.id, f.kunde_id, `${name} hat die Besichtigung am ${wann} im Interessenten-Portal abgesagt.`, `Besichtigung ${o.bezeichnung} am ${wann} im Portal abgesagt.`, user)
    await sage(String(b.durchgefuehrt_von ?? '').trim() || String(o.verantwortlich ?? ''), ['❌ Besichtigung im Portal abgesagt', '', o.bezeichnung, wann, `Interessent: ${name}`].join('\n'))
    return await neuGeladen('Ihr Termin ist abgesagt. Sie können jederzeit einen neuen wählen.')
  }

  if (e.art === 'rueckruf') {
    const tel = telefon || String(f.telefon ?? '')
    if (!tel) return { stufe: 'fehler', grund: 'Bitte geben Sie Ihre Telefonnummer an.' }
    const nachricht = typeof e.nachricht === 'string' ? e.nachricht.trim().slice(0, 500) : ''
    const grenze = new Date(jetzt.getTime() - RUECKRUF_SPERRE_MS).toISOString()
    // Nur einmal je 24 Stunden melden — auch bei gleichzeitigen Klicks (bedingtes Schreiben).
    const { data: neu } = await admin
      .from('objekt_freigaben')
      .update({ rueckruf_am: jetzt.toISOString(), ...(telefon && !f.telefon ? { telefon } : {}) })
      .eq('id', f.id)
      .or(`rueckruf_am.is.null,rueckruf_am.lt.${grenze}`)
      .select('id')
    if (!neu || neu.length === 0) return await neuGeladen('Ihr Rückrufwunsch liegt uns schon vor. Wir melden uns so bald wie möglich.')
    await verlaufEintragen(
      admin,
      o.id,
      f.kunde_id,
      `${name} möchte angerufen werden (Interessenten-Portal: kein Besichtigungstermin passt). Telefon: ${tel}${nachricht ? ` — „${nachricht}“` : ''}`,
      `Interessenten-Portal ${o.bezeichnung}: bittet um Rückruf wegen eines Besichtigungstermins (Telefon ${tel}).${nachricht ? ` „${nachricht}“` : ''}`,
      user,
    )
    await sage(
      String(o.verantwortlich ?? '').trim() || String(f.erstellt_von ?? ''),
      ['📞 Bitte zurückrufen (Interessenten-Portal)', '', o.bezeichnung, `${name}, Telefon ${tel}`, 'Keiner der freigegebenen Besichtigungstermine passt.', nachricht ? `„${nachricht}“` : ''].filter(Boolean).join('\n'),
    )
    return await neuGeladen('Danke! Wir rufen Sie so bald wie möglich an, um einen passenden Termin zu finden.')
  }

  return { stufe: 'fehler', grund: 'Unbekannte Aktion.' }
}
