// Gemeinsamer Kern für Partner und Vermittler (22.11.2026): Arten, Rollen, Provisionsstand, Erkennen
// doppelter Partner und der Erst-Vorschlag „Partner aus dem CRM übernehmen“. Reine Funktionen ohne
// Datenbank — genutzt von der Seite /partner (src/pages/partner/Partner.tsx, src/lib/partner.ts) und vom
// Assistenten (telegram-gateway/partnerWerkzeuge.ts). Tabellen: partner, partner_bezug.
//
// Vorschlag (findePartnerKandidaten) liest nur, was der Aufrufer ohnehin sehen darf, und schreibt nichts.
// Quellen:
//  1. kunden.vermittler (Feld der Projekt-Checkliste, { name, kundeId? }) → „hat vermittelt“ zur Akte
//  2. Verlauf eines Objekts „Angeboten von Makler Helmut Dick (HD-IMMO), Tel. …, mail@…“ → „hat angeboten“
//  3. Immobilien-Kundenakten der Form „Hotel Gasthof Hirsch (HD-IMMO, Helmut Dick)“ — eigentlich ein Objekt,
//     das ein Makler anbietet → Makler aus der Klammer, „hat angeboten“ zur Akte
//  4. Akten, die selbst ein Partner sind: „Azad (Vermittler)“, Lead-Einstufung „Makler/Immobilienmakler …“,
//     „Vermittler/Geschäftspartner …“ oder ein Name mit Immo/Makler/Immobilien → Partner mit eigener Akte
//  5. Verlauf einer Akte „Laut Liste des Vermittlers Azad …“, „vermittelt durch …“, „auf Empfehlung von …“
//     → „hat vermittelt“ zur Akte
// Gleiche Partner werden über E-Mail, Web-Adresse, Telefonnummer, Firma und Name zusammengeführt und mit
// den schon vorhandenen Partnern abgeglichen (dann nur noch fehlende Zuordnungen vorschlagen).

export const PARTNER_ARTEN = ['vermittler', 'makler', 'tippgeber', 'notar', 'steuerberater', 'bank', 'gutachter', 'sonstige'] as const
export type PartnerArt = (typeof PARTNER_ARTEN)[number]
export const PARTNER_ART_NAME: Record<PartnerArt, string> = {
  vermittler: 'Vermittler',
  makler: 'Makler',
  tippgeber: 'Tippgeber',
  notar: 'Notar',
  steuerberater: 'Steuerberater',
  bank: 'Bank',
  gutachter: 'Gutachter',
  sonstige: 'Sonstige',
}

export const BEZUG_ROLLEN = ['vermittelt', 'angeboten', 'beraten'] as const
export type BezugRolle = (typeof BEZUG_ROLLEN)[number]
export const ROLLE_NAME: Record<BezugRolle, string> = { vermittelt: 'hat vermittelt', angeboten: 'hat angeboten', beraten: 'hat beraten' }

export const PROVISION_STATUS = ['keine', 'offen', 'abgerechnet', 'bezahlt'] as const
export type ProvisionStatus = (typeof PROVISION_STATUS)[number]
export const PROVISION_STATUS_NAME: Record<ProvisionStatus, string> = { keine: 'keine Provision', offen: 'offen', abgerechnet: 'abgerechnet', bezahlt: 'bezahlt' }

/** Zählt als „noch zu zahlen“: vereinbart, aber nicht bezahlt. */
export function istProvisionOffen(status: string | null | undefined): boolean {
  return status === 'offen' || status === 'abgerechnet'
}

function text(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim()
}

/** Art aus freier Eingabe („Maklerin“, „Steuerbüro“, „Sparkasse“) → Kennung; undefined, wenn unklar. */
export function artAus(roh: unknown): PartnerArt | undefined {
  const t = text(roh).toLowerCase()
  if (!t) return undefined
  if ((PARTNER_ARTEN as readonly string[]).includes(t)) return t as PartnerArt
  if (/makler|immobilienb[üu]ro/.test(t)) return 'makler'
  if (/tippgeber|empfehl|empfehler/.test(t)) return 'tippgeber'
  if (/notar/.test(t)) return 'notar'
  if (/steuer|stb\b|wirtschaftspr[üu]f/.test(t)) return 'steuerberater'
  if (/bank|sparkasse|volksbank|raiffeisen|kredit|finanzierer/.test(t)) return 'bank'
  if (/gutacht|sachverst[äa]nd|bewerter/.test(t)) return 'gutachter'
  if (/vermittl|gesch[äa]ftspartner|berater|finanzkonzept|versicherung/.test(t)) return 'vermittler'
  if (/sonst|andere/.test(t)) return 'sonstige'
  return undefined
}

/** Vergleichsform: klein, Umlaute ausgeschrieben, nur Buchstaben und Ziffern. */
export function normText(v: unknown): string {
  return text(v)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '')
}

const RECHTSFORMEN = /\b(gmbh\s*&\s*co\.?\s*kg|gmbh|mbh|ug|haftungsbeschr[äa]nkt|ag|kg|ohg|gbr|e\.?\s?k\.?|e\.?\s?v\.?|co\.?|inh\.?)(?=\s|$|[),.])/gi

/** Firma ohne Rechtsform und ohne Klammerzusatz, als Vergleichsform. */
export function normFirma(v: unknown): string {
  return normText(text(v).replace(/\([^)]*\)/g, ' ').replace(RECHTSFORMEN, ' '))
}

const FREEMAIL = /^(gmail|googlemail|gmx|web|yahoo|hotmail|outlook|live|icloud|me|t-online|freenet|aol|mail|posteo|arcor|online|email)\./i

/** Web-Adresse der E-Mail, wenn es keine allgemeine (gmx, web.de, …) ist. */
export function firmenDomain(email: unknown): string {
  const d = text(email).toLowerCase().split('@')[1] ?? ''
  return d && !FREEMAIL.test(d) ? d : ''
}

export function nurZiffern(v: unknown): string {
  return String(v ?? '').replace(/^\s*\+49/, '0').replace(/\D/g, '')
}

export type PartnerKurz = { id?: string; name?: string | null; firma?: string | null; email?: string | null; telefon?: string | null }

/** Schlüssel, über die zwei Einträge als derselbe Partner gelten. */
export function partnerSchluessel(p: PartnerKurz): string[] {
  const s = new Set<string>()
  const mail = text(p.email).toLowerCase()
  if (mail.includes('@')) s.add(`e:${mail}`)
  const dom = firmenDomain(mail)
  if (dom) s.add(`d:${dom}`)
  const tel = nurZiffern(p.telefon)
  if (tel.length >= 7) s.add(`t:${tel}`)
  const f = normFirma(p.firma)
  if (f.length >= 3) s.add(`w:${f}`)
  const n = normFirma(p.name)
  if (n.length >= 3) s.add(`w:${n}`)
  return [...s]
}

/** Vorhandene Partner, die zu einem neuen Eintrag passen (gleiche E-Mail, Telefonnummer, Firma oder Name). */
export function aehnlichePartner<T extends PartnerKurz>(vorhanden: readonly T[], neu: PartnerKurz): T[] {
  const s = new Set(partnerSchluessel(neu))
  if (!s.size) return []
  return vorhanden.filter((p) => partnerSchluessel(p).some((k) => s.has(k)))
}

/** Anzeigename: „Helmut Dick (HD-IMMO)“, sonst Firma oder Name. */
export function partnerName(p: { name?: string | null; firma?: string | null }): string {
  const n = text(p.name)
  const f = text(p.firma)
  if (n && f && normText(n) !== normText(f)) return `${n} (${f})`
  return n || f || 'ohne Namen'
}

/** Betrag aus 1200, "1.200,50", "1.200 €"; undefined, wenn keiner. */
export function leseBetrag(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : undefined
  let t = text(v).replace(/€|eur(o)?/gi, '').replace(/\s/g, '')
  if (!t) return undefined
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined
}

export type BezugFuerSumme = { provision_status?: string | null; betrag?: number | string | null }

/** Summe der offenen Provisionen und Anzahl offener Fälle ohne Betrag. */
export function offeneProvision(bezuege: readonly BezugFuerSumme[]): { summe: number; anzahl: number; ohneBetrag: number } {
  let summe = 0
  let anzahl = 0
  let ohneBetrag = 0
  for (const b of bezuege) {
    if (!istProvisionOffen(b.provision_status)) continue
    anzahl++
    const n = b.betrag === null || b.betrag === undefined || b.betrag === '' ? NaN : Number(b.betrag)
    if (Number.isFinite(n)) summe += n
    else ohneBetrag++
  }
  return { summe: Math.round(summe * 100) / 100, anzahl, ohneBetrag }
}

// ---------------------------------------------------------------------------------------------
// Texte lesen

export type AnbieterAusText = { art: PartnerArt; name: string; firma: string; telefon: string; email: string }

const ART_WORT = /^(Makler(?:in)?|Immobilienmakler(?:in)?|Vermittler(?:in)?|Tippgeber(?:in)?|Notar(?:in)?|Steuerberater(?:in)?|Gutachter(?:in)?|Bank|Eigentümer(?:in)?|Verkäufer(?:in)?|Bauträger|Verwalter(?:in)?)\s+/i

/** Liest „Angeboten von Makler Helmut Dick (HD-IMMO), Tel. 07162 45569, info@hdimmo.de.“ aus einem Verlaufstext.
 *  Eigentümer/Verkäufer sind keine Partner → null. */
export function leseAngebotenVon(verlauf: unknown): AnbieterAusText | null {
  const t = String(verlauf ?? '')
  const m = t.match(/Angeboten von\s+(.+?)\.(?=\s+[A-ZÄÖÜ„"]|\s*$)/)
  if (!m) return null
  const teile = m[1].split(/,\s*/)
  let kopf = text(teile.shift())
  const rest = teile.join(', ')
  const artWort = kopf.match(ART_WORT)?.[1] ?? ''
  if (/eigent|verk[äa]uf|bautr/i.test(artWort)) return null
  if (artWort) kopf = text(kopf.slice(artWort.length))
  const klammer = kopf.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  let name = klammer ? text(klammer[1]) : kopf
  let firma = klammer ? text(klammer[2]) : ''
  if (!firma && istFirmenname(name)) {
    firma = name
    name = ''
  }
  const email = rest.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? ''
  const telefon = text(rest.match(/Tel\.?\s*([+\d][\d\s/()-]{5,}\d)/)?.[1] ?? '')
  if (!name && !firma) return null
  const art = artAus(artWort) ?? (/immo/i.test(`${name} ${firma}`) ? 'makler' : 'vermittler')
  return { art, name, firma, telefon, email: email.toLowerCase() }
}

/** Sieht wie eine Firma aus (HD-IMMO, Hirn Immobilien GmbH, Schweizer Immo Invest), nicht wie ein Ort. */
export function istFirmenname(t: unknown): boolean {
  const s = text(t)
  if (!s || /^\d{5}/.test(s)) return false
  return /immo|makler|gmbh|\bag\b|\bkg\b|\bug\b|e\.\s?k\.|real ?estate|invest|verwaltung|finanz|bank|kanzlei|notar|steuer/i.test(s) || /^[A-Z0-9-]{3,}$/.test(s) || /-[A-Z]{2,}\b/.test(s)
}

/** Sieht wie „Vorname Nachname“ aus. */
export function istPersonenname(t: unknown): boolean {
  return /^[A-ZÄÖÜ][a-zäöüß]+(?:[- ][A-ZÄÖÜ][a-zäöüß]+){1,2}$/.test(text(t)) && !istFirmenname(t)
}

/** Vermittler-Namen aus einem Verlaufs- oder Sachverhaltstext. sicher=false bei „auf Empfehlung von“ (oft Werbung). */
export function leseVermittlerAusVerlauf(verlauf: unknown): { name: string; sicher: boolean; art: PartnerArt }[] {
  const t = String(verlauf ?? '')
  const aus: { name: string; sicher: boolean; art: PartnerArt }[] = []
  const wort = "[A-ZÄÖÜ][\\wäöüß.'-]+"
  const name = `(${wort}(?:\\s${wort}){0,2})`
  const muster: { re: RegExp; sicher: boolean; art: PartnerArt }[] = [
    { re: new RegExp(`(?:Liste|Kunde|Kunden|Kontakt)\\s+des\\s+(?:Vermittlers|Tippgebers)\\s+${name}`, 'g'), sicher: true, art: 'vermittler' },
    { re: new RegExp(`vermittelt\\s+(?:von|durch|über)\\s+(?:(?:den|die|unseren?)\\s+)?(?:Vermittler(?:in)?\\s+|Tippgeber(?:in)?\\s+)?${name}`, 'g'), sicher: true, art: 'vermittler' },
    { re: new RegExp(`Tippgeber(?:in)?\\s+(?:ist\\s+|war\\s+)?${name}`, 'g'), sicher: true, art: 'tippgeber' },
    { re: new RegExp(`(?:auf\\s+)?Empfehlung\\s+von\\s+${name}`, 'g'), sicher: false, art: 'tippgeber' },
  ]
  for (const { re, sicher, art } of muster) {
    for (const m of t.matchAll(re)) {
      // „Lipert Finance aus Augsburg“ → „Lipert Finance“; Füllwörter am Ende weg
      const n = text(m[1].replace(/\s+(aus|in|von|und|bzw|mit|an|zu|der|die|das)\b.*$/i, '').replace(/[.,;:]+$/, ''))
      if (n.length >= 3 && !/^(Herrn?|Frau|Firma|Familie|Kunde|Liste|Vermittler|Tippgeber|Andreas Mayer|Hasan)$/i.test(n)) aus.push({ name: n, sicher, art })
    }
  }
  return aus
}

// ---------------------------------------------------------------------------------------------
// Vorschlag aus dem CRM

export type AkteEingabe = {
  id: string
  bereich: string
  firma?: string | null
  ansprechpartner?: string | null
  email?: string | null
  telefon?: string | null
  sachverhalt?: string | null
  vermittler?: { name?: string | null; kundeId?: string | null } | null
  activities?: { text?: string | null }[] | null
}
export type ObjektEingabe = { id: string; bezeichnung?: string | null; adresse?: string | null; activities?: { text?: string | null }[] | null; privat_besitzer?: string | null }
export type PartnerEingabe = PartnerKurz & { id: string; art?: string | null; akte_id?: string | null }
export type BezugEingabe = { partner_id: string; kunde_id?: string | null; objekt_id?: string | null; rolle: string }

export type KandidatBezug = { kunde_id?: string; objekt_id?: string; rolle: BezugRolle; titel: string }
export type Kandidat = {
  /** Stabile Kennung des Vorschlags (für Häkchen in der Oberfläche) */
  schluessel: string
  name: string
  firma: string
  art: PartnerArt
  email: string
  telefon: string
  /** Eigene Kundenakte des Partners */
  akte_id?: string
  /** Vorgeschlagen zum Übernehmen (Häkchen gesetzt) */
  sicher: boolean
  /** Woher der Vorschlag kommt, kurz */
  gruende: string[]
  /** Schon vorhandener Partner — dann werden nur die fehlenden Zuordnungen angelegt */
  vorhanden?: { id: string; name: string }
  /** Zuordnungen, die noch fehlen */
  bezuege: KandidatBezug[]
}

type Roh = {
  name: string
  firma: string
  art: PartnerArt
  artGewicht: number
  email: string
  telefon: string
  akte_id?: string
  sicher: boolean
  gruende: string[]
  bezuege: KandidatBezug[]
  hatObjekt: boolean
  braucheObjekt: boolean
}

function akteTitel(a: Pick<AkteEingabe, 'firma' | 'ansprechpartner'>): string {
  const f = text(a.firma)
  const p = text(a.ansprechpartner)
  return p && p !== f ? `${f} (${p})` : f || p || 'Akte ohne Namen'
}

function objektTitel(o: ObjektEingabe): string {
  return text(o.bezeichnung) || text(o.adresse) || 'Objekt ohne Bezeichnung'
}

function verlaufTexte(x: { activities?: { text?: string | null }[] | null }): string[] {
  return (Array.isArray(x.activities) ? x.activities : []).map((a) => String(a?.text ?? '')).filter(Boolean)
}

const SELBST_KLAMMER = /\((Vermittler(?:in)?|Tippgeber(?:in)?|Makler(?:in)?|Notar(?:in)?|Steuerberater(?:in)?|Gutachter(?:in)?)\)/i
const LEAD_PARTNER = /Als Lead aus E-Mail-Analyse übernommen:\s*„\s*((?:Immobilien)?makler(?:in)?|Vermittler(?:in)?|Tippgeber(?:in)?|Geschäftspartner\/Vermittler|Vermittler\/Geschäftspartner|Makler\/Immobilienmakler)\b/i

// „Vermittlung von Interessenten: … Geschäftspartner/Vermittler.“ — die Einstufung steht weiter hinten
const LEAD_PARTNER_IM_TEXT = /Als Lead aus E-Mail-Analyse übernommen:\s*„[^“”"]*?\b(Geschäftspartner\/Vermittler|Vermittler\/Geschäftspartner)\b/i

/** Vorschlag, welche Partner und Zuordnungen aus dem CRM übernommen werden könnten. Schreibt nichts. */
export function findePartnerKandidaten(e: {
  akten: readonly AkteEingabe[]
  objekte: readonly ObjektEingabe[]
  partner: readonly PartnerEingabe[]
  bezuege: readonly BezugEingabe[]
}): { kandidaten: Kandidat[]; schonErledigt: number } {
  const roh: Roh[] = []
  const akteNach = new Map(e.akten.map((a) => [a.id, a]))
  const neu = (r: Partial<Roh> & { name?: string; firma?: string; art: PartnerArt }): Roh => ({
    name: text(r.name),
    firma: text(r.firma),
    art: r.art,
    artGewicht: r.artGewicht ?? 1,
    email: text(r.email).toLowerCase(),
    telefon: text(r.telefon),
    akte_id: r.akte_id,
    sicher: r.sicher ?? false,
    gruende: r.gruende ?? [],
    bezuege: r.bezuege ?? [],
    hatObjekt: r.hatObjekt ?? false,
    braucheObjekt: r.braucheObjekt ?? false,
  })

  for (const a of e.akten) {
    if (a.bereich === 'privat') continue
    const titel = akteTitel(a)

    // 1. Feld „Vermittler“ der Projekt-Checkliste
    const vName = text(a.vermittler?.name)
    if (vName) {
      const vAkte = a.vermittler?.kundeId ? akteNach.get(a.vermittler.kundeId) : undefined
      roh.push(
        neu({
          name: vAkte ? text(vAkte.ansprechpartner) || vName : vName,
          firma: vAkte ? text(vAkte.firma).replace(SELBST_KLAMMER, '').trim() : '',
          email: vAkte?.email ?? '',
          telefon: vAkte?.telefon ?? '',
          akte_id: vAkte?.id,
          art: 'vermittler',
          sicher: true,
          gruende: [`Als Vermittler eingetragen in „${titel}“`],
          bezuege: [{ kunde_id: a.id, rolle: 'vermittelt', titel }],
        }),
      )
    }

    // 3. Immobilien-Akte „Objekt (Makler-Firma, Name)“
    const firmaText = text(a.firma)
    const klammer = firmaText.match(/^(.*\S)\s*\(([^)]+)\)\s*$/)
    const verlauf = verlaufTexte(a)
    if (a.bereich === 'immobilienkunden' && klammer && !SELBST_KLAMMER.test(firmaText)) {
      const teile = klammer[2].split(',').map(text).filter(Boolean)
      const firma = teile.find(istFirmenname) ?? ''
      if (firma) {
        const ansprech = text(a.ansprechpartner)
        const name = teile.find((t) => t !== firma && ((ansprech && normText(t) === normText(ansprech)) || istPersonenname(t))) ?? ''
        const dom = normText(firmenDomain(a.email).split('.')[0])
        const kontaktPasst = (!!name && normText(name) === normText(ansprech)) || (!!dom && dom.includes(normText(firma)))
        const maklerImVerlauf = verlauf.some((v) => /makler/i.test(v) && v.includes(firma))
        roh.push(
          neu({
            name,
            firma,
            email: kontaktPasst ? text(a.email) : '',
            telefon: kontaktPasst ? text(a.telefon) : '',
            art: 'makler',
            sicher: kontaktPasst || maklerImVerlauf,
            gruende: [`Bietet „${text(klammer[1])}“ an (Name der Immobilien-Akte)`],
            bezuege: [{ kunde_id: a.id, rolle: 'angeboten', titel }],
            hatObjekt: true,
          }),
        )
      }
    }

    // 4. Akte ist selbst ein Partner
    const selbst = firmaText.match(SELBST_KLAMMER) ?? text(a.ansprechpartner).match(SELBST_KLAMMER)
    const leadText = verlauf.find((v) => LEAD_PARTNER.test(v) || LEAD_PARTNER_IM_TEXT.test(v)) ?? ''
    const lead = leadText.match(LEAD_PARTNER) ?? leadText.match(LEAD_PARTNER_IM_TEXT)
    const immoName = /immo|makler/i.test(firmaText) && !(a.bereich === 'immobilienkunden' && klammer)
    if (selbst || lead || immoName) {
      const art = artAus(selbst?.[1] ?? lead?.[1]) ?? (immoName ? 'makler' : 'vermittler')
      const firmaOhne = text(firmaText.replace(SELBST_KLAMMER, ''))
      const ansprech = text(text(a.ansprechpartner).replace(SELBST_KLAMMER, ''))
      const firmaIstPerson = !istFirmenname(firmaOhne) && (!ansprech || normText(ansprech) === normText(firmaOhne))
      roh.push(
        neu({
          name: firmaIstPerson ? firmaOhne : ansprech,
          firma: firmaIstPerson ? '' : firmaOhne,
          email: a.email ?? '',
          telefon: a.telefon ?? '',
          akte_id: a.id,
          art,
          artGewicht: selbst ? 3 : lead ? 2 : 1,
          sicher: !!selbst,
          braucheObjekt: !selbst && !lead,
          gruende: [
            selbst
              ? `Eigene Akte „${titel}“ als ${PARTNER_ART_NAME[art]} gekennzeichnet`
              : lead
                ? `Akte „${titel}“: bei der Mail-Auswertung als ${lead[1]} eingestuft`
                : `Akte „${titel}“: Name klingt nach Makler`,
          ],
        }),
      )
    }

    // 5. Verlauf / Sachverhalt: „Liste des Vermittlers Azad“, „vermittelt durch …“, „auf Empfehlung von …“
    const gesehen = new Set<string>()
    for (const v of [...verlauf, text(a.sachverhalt)]) {
      for (const f of leseVermittlerAusVerlauf(v)) {
        const k = normText(f.name)
        if (gesehen.has(k)) continue
        gesehen.add(k)
        // Eigene Akte des Vermittlers: dort steht sein Name selbst
        if (k && normText(firmaText).startsWith(k)) continue
        roh.push(
          neu({
            name: istFirmenname(f.name) ? '' : f.name,
            firma: istFirmenname(f.name) ? f.name : '',
            art: f.art,
            artGewicht: 1,
            sicher: f.sicher,
            gruende: [f.sicher ? `Im Verlauf von „${titel}“ als Vermittler genannt` : `„${titel}“ kam auf Empfehlung (laut Verlauf, oft Werbung — bitte prüfen)`],
            bezuege: [{ kunde_id: a.id, rolle: 'vermittelt', titel }],
          }),
        )
      }
    }
  }

  // 2. Objekte: „Angeboten von …“
  for (const o of e.objekte) {
    if (text(o.privat_besitzer)) continue
    const titel = objektTitel(o)
    const gesehen = new Set<string>()
    for (const v of verlaufTexte(o)) {
      const anb = leseAngebotenVon(v)
      if (!anb) continue
      const k = normText(`${anb.name}${anb.firma}`)
      if (gesehen.has(k)) continue
      gesehen.add(k)
      roh.push(
        neu({
          ...anb,
          artGewicht: 2,
          sicher: true,
          gruende: [`Hat das Objekt „${titel}“ angeboten (Verlauf des Objekts)`],
          bezuege: [{ objekt_id: o.id, rolle: 'angeboten', titel }],
          hatObjekt: true,
        }),
      )
    }
  }

  // Zusammenführen (gemeinsamer Schlüssel = derselbe Partner)
  const eltern = roh.map((_, i) => i)
  const wurzel = (i: number): number => (eltern[i] === i ? i : (eltern[i] = wurzel(eltern[i])))
  const besitzer = new Map<string, number>()
  roh.forEach((r, i) => {
    const schl = partnerSchluessel(r)
    if (r.akte_id) schl.push(`a:${r.akte_id}`)
    for (const s of schl) {
      const j = besitzer.get(s)
      if (j === undefined) besitzer.set(s, i)
      else eltern[wurzel(i)] = wurzel(j)
    }
  })
  const gruppen = new Map<number, Roh[]>()
  roh.forEach((r, i) => {
    const w = wurzel(i)
    gruppen.set(w, [...(gruppen.get(w) ?? []), r])
  })

  const vorhandeneBezuege = new Set(e.bezuege.map((b) => `${b.partner_id}|${b.kunde_id ?? ''}|${b.objekt_id ?? ''}|${b.rolle}`))
  const kandidaten: Kandidat[] = []
  let schonErledigt = 0
  for (const g of gruppen.values()) {
    const erst = <K extends 'name' | 'firma' | 'email' | 'telefon'>(feld: K) => g.map((r) => r[feld]).find(Boolean) ?? ''
    // Personenname bevorzugt aus einer Quelle, die wie ein Name aussieht
    const name = g.map((r) => r.name).find(istPersonenname) ?? erst('name')
    const firmaRoh = g.map((r) => r.firma).find(istFirmenname) ?? erst('firma')
    const firma = normText(firmaRoh) === normText(name) ? '' : firmaRoh
    const art = [...g].sort((a, b) => b.artGewicht - a.artGewicht)[0].art
    const akte_id = g.map((r) => r.akte_id).find(Boolean)
    const hatObjekt = g.some((r) => r.hatObjekt)
    const sicher = g.some((r) => r.sicher) || (g.some((r) => r.braucheObjekt) && hatObjekt) || g.some((r) => !r.braucheObjekt && r.artGewicht >= 2)
    const gruende = [...new Set(g.flatMap((r) => r.gruende))]
    if (!hatObjekt && g.every((r) => r.braucheObjekt)) gruende.push('Kein Objekt von ihm im CRM — bitte prüfen')
    const bezugMap = new Map<string, KandidatBezug>()
    for (const b of g.flatMap((r) => r.bezuege)) {
      if (b.kunde_id && b.kunde_id === akte_id) continue
      bezugMap.set(`${b.kunde_id ?? ''}|${b.objekt_id ?? ''}|${b.rolle}`, b)
    }
    const email = erst('email')
    const telefon = erst('telefon')
    const vorhanden = aehnlichePartner(e.partner, { name, firma, email, telefon })[0] ?? (akte_id ? e.partner.find((p) => p.akte_id === akte_id) : undefined)
    let bezuege = [...bezugMap.values()]
    if (vorhanden) {
      bezuege = bezuege.filter((b) => !vorhandeneBezuege.has(`${vorhanden.id}|${b.kunde_id ?? ''}|${b.objekt_id ?? ''}|${b.rolle}`))
      if (!bezuege.length) {
        schonErledigt++
        continue
      }
    }
    kandidaten.push({
      schluessel: `${kandidaten.length}:${partnerSchluessel({ name, firma, email, telefon })[0] ?? akte_id ?? normText(name || firma)}`,
      name,
      firma,
      art,
      email,
      telefon,
      akte_id,
      sicher,
      gruende,
      vorhanden: vorhanden ? { id: vorhanden.id, name: partnerName(vorhanden) } : undefined,
      bezuege,
    })
  }
  kandidaten.sort((a, b) => Number(b.sicher) - Number(a.sicher) || b.bezuege.length - a.bezuege.length || partnerName(a).localeCompare(partnerName(b), 'de'))
  return { kandidaten, schonErledigt }
}
