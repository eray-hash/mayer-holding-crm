// Interessenten-Portal für Objekte (21.11.2026, Eray): Ein Interessent bekommt einen geheimen Link
// (objekt_freigaben.token). Vor der ersten Einsicht stimmt er den AGB, der Provisionsvereinbarung und dem
// vorzeitigen Beginn zu (Texte aus den Vorlagen der Immo-Abteilung); erst dann sieht er die vollständigen
// Objektdaten und die für Interessenten freigegebenen Unterlagen (objekte.interessenten_dokumente).
// Die Zustimmung wird mit Zeitpunkt, getipptem Namen, Gerät und dem genauen Wortlaut gespeichert.
// Alles läuft mit dem Dienstschlüssel; der Link ist der einzige Nachweis, deshalb strenge Prüfung des Zeichens.
import { pruefeSpeicherPfad } from '../_shared/speicherPfad.ts'

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
  const kaufpreis = o.kaufpreis === null || o.kaufpreis === undefined ? null : Number(o.kaufpreis)
  if (f.status !== 'zugestimmt') {
    const texte = await ladeTexte(admin)
    const werte = { name: f.name, objekt: `${o.bezeichnung} (${ortAus(o.adresse)})`, provision: f.provision, datum: datumDe() }
    return {
      stufe: 'zustimmung',
      name: f.name,
      objekt: { bezeichnung: o.bezeichnung, ort: ortAus(o.adresse), typ: o.typ ?? '', kaufpreis },
      texte: { agb: fuelleText(texte.agb, werte), provision: fuelleText(texte.provision, werte), widerruf: fuelleText(texte.widerruf, werte) },
    }
  }
  const frei = new Set(Array.isArray(o.interessenten_dokumente) ? (o.interessenten_dokumente as string[]) : [])
  return {
    stufe: 'frei',
    name: f.name,
    zugestimmtAm: f.zustimmung?.am ?? '',
    objekt: { bezeichnung: o.bezeichnung, adresse: o.adresse ?? '', typ: o.typ ?? '', kaufpreis, beschreibung: o.expose_text ?? '' },
    dokumente: alleDokumente(o.dokumente).filter((d) => frei.has(d.id) && d.url).map(({ id, name, typ, groesse }) => ({ id, name, typ, groesse })),
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

  const heute = jetzt.toISOString().slice(0, 10)
  const eintrag = `${name} hat im Interessenten-Portal den AGB und der Provisionsvereinbarung (${f.provision}) zugestimmt und sieht jetzt die freigegebenen Unterlagen.`
  const verlauf = Array.isArray(o.activities) ? o.activities : []
  await admin.from('objekte').update({ activities: [{ id: `act_${crypto.randomUUID().slice(0, 10)}`, date: heute, text: eintrag, user: `${name} (Portal)` }, ...verlauf] }).eq('id', o.id)
  if (f.kunde_id) {
    const { data: k } = await admin.from('kunden').select('activities').eq('id', f.kunde_id).maybeSingle()
    if (k) {
      const kv = Array.isArray(k.activities) ? k.activities : []
      await admin
        .from('kunden')
        .update({ activities: [{ id: crypto.randomUUID(), date: heute, text: `Interessenten-Portal ${o.bezeichnung}: AGB und Provisionsvereinbarung (${f.provision}) zugestimmt.`, user: `${name} (Portal)` }, ...kv], letzte_aktivitaet: heute })
        .eq('id', f.kunde_id)
    }
  }
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
