// Kontoauszug für den Zahlungsabgleich auslesen (22.11.2026) — Aktion `kontoauszug_abgleich_auslesen`.
// Anders als kontoauszug_auslesen (Auswertung in der Kundenakte) gehört der Auszug hier der Holding
// selbst, nicht einer Akte, und der Verwendungszweck muss VOLLSTÄNDIG bleiben: Rechnungsnummern und
// Referenzen sind das stärkste Merkmal beim Abgleich (siehe _shared/zahlungsAbgleich.ts). Kategorien
// braucht der Abgleich nicht.
//
// Erlaubte Dateien (nur diese beiden Orte):
//   - Bucket kunden-dokumente, Ordner „kontoauszug-abgleich/“ (die Oberfläche lädt dort hoch und löscht danach),
//   - Bucket email-anhaenge, Ordner „telegram/“ (per Telegram geschickte Datei, Werkzeug kontoauszug_abgleichen).
// CSV wird ohne KI gelesen (_shared/kontoauszugCsv.ts); PDF und Fotos wie in kontoauszug.ts in Blöcken
// zu drei Seiten, höchstens vier gleichzeitig, jeder gescheiterte Block einmal wiederholt.
// Schreibt nichts in die Datenbank. Rechte (Bereich Unternehmensberatung) prüft index.ts vor dem Aufruf.

import { betragAusWert, datumIso, SEITEN_JE_BLOCK, teilePdf, type Block, type KontoauszugHelfer } from './kontoauszug.ts'
import { istSichererPfad } from '../_shared/speicherPfad.ts'
import { dekodiereText, leseKontoCsv } from '../_shared/kontoauszugCsv.ts'
import type { AbgleichBuchung } from '../_shared/zahlungsAbgleich.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type AbgleichDatei = { name: string; bank?: string | null; iban?: string | null; von?: string | null; bis?: string | null; anzahl: number; fehler?: string }

export type AbgleichAuslesenErgebnis =
  | { ok: true; buchungen: AbgleichBuchung[]; datei: AbgleichDatei }
  | { ok: false; fehler: string; status: number }

export type AbgleichAuslesenHelfer = Pick<KontoauszugHelfer, 'callClaudeResearch' | 'restMs' | 'hoechstensMs'>

const MODELL = 'claude-sonnet-5-5' as const
const GLEICHZEITIG = 4
const MAX_SEITEN = SEITEN_JE_BLOCK * GLEICHZEITIG * 2
const MAX_TOKENS = 16_000
const MAX_DATEI_BYTES = 20 * 1024 * 1024
const MAX_BILD_BYTES = 5 * 1024 * 1024
const MINDEST_ZEIT_MS = 20_000
const RAND = 2

/** Ort der Datei, nur die beiden erlaubten Ordner. */
export function erlaubterOrt(d: { eimer?: unknown; pfad?: unknown }): { eimer: string; pfad: string } | null {
  const eimer = typeof d.eimer === 'string' ? d.eimer.trim() : ''
  const pfad = typeof d.pfad === 'string' ? d.pfad.trim() : ''
  if (!pfad || !istSichererPfad(pfad)) return null
  if (eimer === 'kunden-dokumente' && pfad.startsWith('kontoauszug-abgleich/')) return { eimer, pfad }
  if (eimer === 'email-anhaenge' && pfad.startsWith('telegram/')) return { eimer, pfad }
  return null
}

const AUFTRAG = `Du bist ein präzises Extraktionssystem für Bank-Kontoauszüge eines Unternehmens. Die Buchungen werden anschließend mit offenen Rechnungen abgeglichen.

Regeln:
- Der Ausschnitt kann mitten im Auszug beginnen oder enden. Nur echte Buchungszeilen erfassen. Beginnt der Ausschnitt mit dem Rest einer Buchung von der vorigen Seite (ohne eigenes Datum und ohne Betrag), lass diesen Rest weg.
- Jede Buchungszeile genau einmal. Nichts auslassen, nichts erfinden.
- Anfangssaldo, Endsaldo, Zwischensummen, "Übertrag" sind KEINE Buchungen.
- Beträge: Ausgaben/Soll negativ, Eingänge/Haben positiv. "1.234,56" -> 1234.56. Vorzeichen aus "S"/"H" bzw. "-"/"+" ableiten.
- Datum = Buchungstag als YYYY-MM-DD; nur Tag/Monat -> Jahr aus dem Zeitraum (Jahreswechsel beachten).
- z (Verwendungszweck): VOLLSTÄNDIG und wortgetreu, über alle Zeilen der Buchung hinweg, mit allen Rechnungsnummern, Kundennummern und Referenzen (auch End-to-End-Referenz, Kundenreferenz). Höchstens 300 Zeichen. Nicht kürzen, nicht umformulieren.
- g: Name der Gegenpartei (Auftraggeber bei Eingängen, Empfänger bei Ausgängen) oder null.
- i: IBAN der Gegenpartei ohne Leerzeichen oder null.
- Unleserliche Fotostellen: nur sicher Erkennbares erfassen.

Antworte NUR mit einem JSON-Objekt in genau dieser Form, ohne Text davor oder danach:
{"bank": "Name der Bank oder null", "iban": "IBAN des Kontos oder null", "von": "Zeitraum-Beginn YYYY-MM-DD oder null", "bis": "Zeitraum-Ende YYYY-MM-DD oder null", "buchungen": [{"d": "YYYY-MM-DD", "z": "Verwendungszweck vollständig", "g": "Gegenpartei oder null", "i": "IBAN oder null", "b": -12.34}]}
b ist eine Zahl mit Dezimalpunkt, ohne Tausenderpunkt und ohne Anführungszeichen. Keine Buchungen gefunden: "buchungen": [].`

type Zeile = { datum: string; zweck: string; name: string | null; iban: string | null; betrag: number }
export type AbgleichBlock = { bank: string | null; iban: string | null; von: string | null; bis: string | null; zeilen: Zeile[]; ohneBetrag: number }

function textOderNull(w: unknown): string | null {
  if (typeof w !== 'string') return null
  const s = w.trim()
  return s && s.toLowerCase() !== 'null' ? s : null
}

/** JSON-Antwort der KI lesen (auch in Zäunen oder mit Text drumherum). Wirft, wenn sie nicht lesbar ist. */
export function leseAbgleichAntwort(antwort: string): AbgleichBlock {
  const ohneZaun = antwort.replace(/```(?:json)?/gi, '')
  const a = ohneZaun.indexOf('{')
  const e = ohneZaun.lastIndexOf('}')
  const kaputt = 'Die KI hat keine lesbare Buchungsliste geliefert.'
  if (a < 0 || e <= a) throw new Error(kaputt)
  // deno-lint-ignore no-explicit-any
  let roh: any
  try {
    roh = JSON.parse(ohneZaun.slice(a, e + 1))
  } catch {
    throw new Error(kaputt)
  }
  if (!roh || typeof roh !== 'object' || !Array.isArray(roh.buchungen)) throw new Error(kaputt)
  const zeilen: Zeile[] = []
  let ohneBetrag = 0
  for (const z of roh.buchungen) {
    if (!z || typeof z !== 'object') continue
    const betrag = betragAusWert(z.b ?? z.betrag)
    const zweck = textOderNull(z.z ?? z.t ?? z.text) ?? ''
    const name = textOderNull(z.g ?? z.gegenpartei)
    if (betrag === null) {
      if (zweck || name) ohneBetrag++
      continue
    }
    zeilen.push({ datum: datumIso(z.d ?? z.datum), zweck: zweck.slice(0, 500), name, iban: textOderNull(z.i ?? z.iban)?.replace(/\s/g, '') ?? null, betrag })
  }
  const datumOderNull = (w: unknown) => (textOderNull(w) ? datumIso(w) : null)
  return { bank: textOderNull(roh.bank), iban: textOderNull(roh.iban)?.replace(/\s/g, '') ?? null, von: datumOderNull(roh.von), bis: datumOderNull(roh.bis), zeilen, ohneBetrag }
}

function vergleich(s: string | null): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '')
}

function gleich(a: Zeile, b: Zeile): boolean {
  if (a.datum !== b.datum || Math.abs(a.betrag - b.betrag) > 0.004) return false
  return (!!vergleich(a.name) && vergleich(a.name) === vergleich(b.name)) || (!!vergleich(a.zweck) && vergleich(a.zweck) === vergleich(b.zweck))
}

/** Blöcke in Seitenreihenfolge zusammenführen; an Blockgrenzen doppelt erfasste Buchungen entfernen (wie fuegeZusammen in kontoauszug.ts). */
export function fuegeAbgleichZusammen(teile: (AbgleichBlock | undefined)[]): { kopf: Omit<AbgleichBlock, 'zeilen' | 'ohneBetrag'>; zeilen: Zeile[]; ohneBetrag: number } {
  const gelesen = teile.filter((t): t is AbgleichBlock => !!t)
  const zeilen: Zeile[] = []
  let vorige: Zeile[] | null = null
  for (const teil of teile) {
    if (!teil) {
      vorige = null
      continue
    }
    let liste = teil.zeilen
    if (vorige?.length) {
      const ende = vorige.slice(-RAND)
      const benutzt = new Set<number>()
      const weg = new Set<number>()
      liste.slice(0, RAND).forEach((z, i) => {
        const j = ende.findIndex((v, k) => !benutzt.has(k) && gleich(v, z))
        if (j >= 0) {
          benutzt.add(j)
          weg.add(i)
        }
      })
      liste = liste.filter((_z, i) => !weg.has(i))
    }
    zeilen.push(...liste)
    vorige = teil.zeilen
  }
  const erstes = (k: 'bank' | 'iban' | 'von', l: AbgleichBlock[]) => l.map((t) => t[k]).find((v) => v != null) ?? null
  return {
    kopf: { bank: erstes('bank', gelesen), iban: erstes('iban', gelesen), von: erstes('von', gelesen), bis: [...gelesen].reverse().map((t) => t.bis).find((v) => v != null) ?? null },
    zeilen,
    ohneBetrag: gelesen.reduce((s, t) => s + t.ohneBetrag, 0),
  }
}

function bytesNachBase64(bytes: Uint8Array): string {
  let binaer = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binaer)
}

function bildTyp(name: string, typ: string): string | null {
  const t = typ.toLowerCase()
  if (['image/jpeg', 'image/png', 'image/webp'].includes(t)) return t
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  return null
}

function seitenText(b: { von: number; bis: number }): string {
  return b.von === b.bis ? `Seite ${b.von}` : `Seiten ${b.von}–${b.bis}`
}

export async function lieseAuszugFuerAbgleich(admin: Db, eingabe: { datei: unknown }, h: AbgleichAuslesenHelfer): Promise<AbgleichAuslesenErgebnis> {
  const start = Date.now()
  const frist = start + Math.min(h.hoechstensMs - 15_000, h.restMs() - 10_000)
  const bleibt = () => frist - Date.now()

  // deno-lint-ignore no-explicit-any
  const d = (eingabe.datei ?? {}) as any
  const ort = erlaubterOrt(d)
  if (!ort) return { ok: false, fehler: 'Diese Datei kann für den Abgleich nicht gelesen werden (unbekannter Ablageort).', status: 403 }
  const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 200) : ort.pfad.split('/').pop() || 'Kontoauszug'
  const typ = typeof d.typ === 'string' ? d.typ.trim().toLowerCase() : ''
  const istCsv = /\.(csv|txt)$/i.test(name) || /\.(csv|txt)$/i.test(ort.pfad) || typ === 'text/csv' || typ === 'text/plain'
  const istPdf = !istCsv && (typ === 'application/pdf' || /\.pdf$/i.test(name) || /\.pdf$/i.test(ort.pfad))
  if (/^image\/hei[cf]/.test(typ) || /\.hei[cf]$/i.test(name)) {
    return { ok: false, fehler: 'Fotos im HEIC-Format kann der Server nicht lesen. Bitte als JPG oder PNG schicken oder den Auszug als PDF oder CSV.', status: 415 }
  }
  const bild = istCsv || istPdf ? null : (bildTyp(name, typ) ?? bildTyp(ort.pfad, ''))
  if (!istCsv && !istPdf && !bild) return { ok: false, fehler: 'Diese Dateiart kann nicht gelesen werden — bitte den Kontoauszug als PDF, als CSV-Export der Bank oder als Foto (JPG, PNG).', status: 415 }

  const { data, error } = await admin.storage.from(ort.eimer).download(ort.pfad)
  if (error || !data) return { ok: false, fehler: `Die Datei ließ sich nicht laden (${error?.message ?? 'nicht gefunden'}).`, status: 404 }
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (bytes.length > MAX_DATEI_BYTES) return { ok: false, fehler: 'Die Datei ist größer als 20 MB.', status: 413 }

  if (istCsv) {
    const e = leseKontoCsv(dekodiereText(bytes))
    if (!e.buchungen.length) return { ok: false, fehler: e.fehler ?? 'In der Datei stehen keine Buchungen.', status: 422 }
    return { ok: true, buchungen: e.buchungen, datei: { name, iban: e.iban ?? null, von: e.von ?? null, bis: e.bis ?? null, anzahl: e.buchungen.length } }
  }

  if (bleibt() < MINDEST_ZEIT_MS + 10_000) return { ok: false, fehler: 'Der Server ist gerade beschäftigt — bitte in einer Minute noch einmal versuchen.', status: 503 }
  let bloecke: Block[]
  let seiten = 1
  if (istPdf) {
    const geteilt = await teilePdf(bytes)
    bloecke = geteilt.bloecke
    seiten = geteilt.seiten
    if (seiten > MAX_SEITEN) return { ok: false, fehler: `Der Auszug ist zu lang für einen Durchgang (${seiten} Seiten) — bitte in Teilen zu höchstens ${MAX_SEITEN} Seiten abgleichen.`, status: 413 }
  } else {
    if (bytes.length > MAX_BILD_BYTES) return { ok: false, fehler: 'Das Foto ist größer als 5 MB — bitte verkleinern.', status: 413 }
    bloecke = [{ von: 1, bis: 1, inhalt: { type: 'image', source: { type: 'base64', media_type: bild!, data: bytesNachBase64(bytes) } } }]
  }

  const teile = new Array<AbgleichBlock | undefined>(bloecke.length)
  let letzterFehler = ''
  let naechster = 0
  const arbeite = async () => {
    while (naechster < bloecke.length) {
      const i = naechster++
      const block = bloecke[i]
      for (let versuch = 1; versuch <= 2; versuch++) {
        if (bleibt() < MINDEST_ZEIT_MS) break
        try {
          const lage = seiten > SEITEN_JE_BLOCK ? ` Dir liegen die Seiten ${block.von} bis ${block.bis} von insgesamt ${seiten} vor.` : ''
          let stopp = ''
          const antwort = await h.callClaudeResearch([block.inhalt, { type: 'text', text: `${AUFTRAG}\n\nDateiname: ${name}.${lage}\n\nExtrahiere alle Buchungen.` }], {
            model: MODELL,
            maxSearches: 0,
            maxTokens: MAX_TOKENS,
            timeoutMs: bleibt() - 2_000,
            ohneNachdenken: true,
            meldeStopp: (g) => (stopp = g),
          })
          if (stopp === 'max_tokens') throw new Error(`${seitenText(block)}: zu viele Buchungen für eine Antwort.`)
          teile[i] = leseAbgleichAntwort(antwort)
          break
        } catch (err) {
          console.error(`Abgleich-Auszug: ${seitenText(block)}, Versuch ${versuch}`, err)
          letzterFehler = err instanceof Error ? err.message : String(err)
          if (/abort|timeout|timed out/i.test(letzterFehler)) break
          if (versuch === 1) await new Promise((r) => setTimeout(r, 1500))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(GLEICHZEITIG, bloecke.length) }, arbeite))

  const fehlend = bloecke.filter((_b, i) => !teile[i])
  if (fehlend.length === bloecke.length) return { ok: false, fehler: `Der Auszug ließ sich nicht auslesen${letzterFehler ? ` (${letzterFehler.slice(0, 200)})` : ''}. Bitte noch einmal versuchen.`, status: 502 }
  const { kopf, zeilen, ohneBetrag } = fuegeAbgleichZusammen(teile)
  const buchungen: AbgleichBuchung[] = zeilen.map((z, i) => ({ id: `pdf_${i + 1}`, datum: z.datum, betrag: z.betrag, verwendungszweck: z.zweck, gegenName: z.name, gegenIban: z.iban }))
  const hinweise: string[] = []
  if (fehlend.length) hinweise.push(`${fehlend.map(seitenText).join(', ')} von ${seiten} konnten nicht gelesen werden — dort fehlen Buchungen.`)
  if (ohneBetrag) hinweise.push(`${ohneBetrag} ${ohneBetrag === 1 ? 'Zeile' : 'Zeilen'} ohne lesbaren Betrag nicht übernommen.`)
  if (!buchungen.length && !hinweise.length) hinweise.push('Keine Buchungen gefunden — ist das ein Kontoauszug?')
  return {
    ok: true,
    buchungen,
    datei: { name, bank: kopf.bank, iban: kopf.iban, von: kopf.von, bis: kopf.bis, anzahl: buchungen.length, ...(hinweise.length ? { fehler: hinweise.join(' ') } : {}) },
  }
}
