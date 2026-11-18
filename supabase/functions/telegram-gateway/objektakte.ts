// Immobilien-Objekte im Assistenten: suchen und die ganze Objektakte lesen (Wunsch aus der
// Wunsch-Auswertung vom 18.11.2026 — der Assistent kannte bis dahin nur Ort, Typ, Status und
// Verantwortlichen). Nur Lesen; die Rechte prüft der Aufrufer (darfObjekte), Kundennamen aus
// anderen Bereichen filtert `darfKunde`.
//
// Objekt-Dokumente liegen im privaten Bucket "objekt-dokumente", ihre url ist dort der Pfad. Für das
// Lesen per email-gateway bekommen sie den Vorsatz OBJEKT_DOKUMENT_PRAEFIX (siehe dokumentSchluessel
// dort), damit sie nicht für Kundendokumente gehalten werden.

export const OBJEKT_DOKUMENT_PRAEFIX = 'objekt-dokumente:'

export const OBJEKT_STATUS: Record<string, string> = {
  akquise: 'Akquise',
  vorbereitung: 'Objektaufnahme / Vorbereitung',
  vermarktung: 'Aktiv in Vermarktung',
  reserviert: 'Reserviert',
  notarauftrag_vorbereitet: 'Notarauftrag vorbereitet',
  vertragsentwurf_erhalten: 'Vertragsentwurf erhalten',
  pruefung_verkaeufer: 'Prüfung durch Verkäufer',
  pruefung_kaeufer: 'Prüfung durch Käufer',
  aenderungswuensche: 'Änderungswünsche klären',
  notartermin: 'Notartermin',
  beurkundet: 'Beurkundet',
  faelligkeitsmitteilung: 'Fälligkeitsmitteilung versendet',
  kaufpreis_gezahlt: 'Kaufpreis gezahlt',
  besitzuebergang: 'Besitzübergang',
  verkauft: 'Verkauft (Grundbuch umgeschrieben)',
  archiv: 'Archiv',
  on_hold: 'Zurückgestellt',
  abgebrochen: 'Nicht zustande gekommen / abgebrochen',
}

// Ordner, deren Dateien beim Lesen der Akte NICHT von selbst eingelesen werden: Fotos sind keine
// Unterlagen, und eine Akte mit 50 Bildern soll nicht bei jedem Blick Lesekosten auslösen. Einzeln
// lassen sie sich trotzdem mit dokument_inhalt lesen.
const NICHT_VON_SELBST_LESEN = new Set(['Bilder'])

export const OBJEKT_SPALTEN =
  'id, bezeichnung, adresse, gruppe, typ, kaufpreis, prioritaet, status, follow_up, verantwortlich, activities, dokumente, quelle, immo_radar_link, lukrativitaet, zugewiesener_kunde, eigentuemer, expose_text, off_market, verkaufsdaten, kurzpruefung, bewertung, unterlagen_anforderungen'

export type ObjektDokument = { id: string; name: string; typ: string; datum: string; groesse: string; url: string }

// deno-lint-ignore no-explicit-any
export type ObjektRow = Record<string, any> & {
  id: string
  bezeichnung: string
  adresse: string
  typ: string
  status: string
  kaufpreis: number | string | null
  verantwortlich: string | null
  dokumente: Record<string, ObjektDokument[]> | null
}

export type InhaltVermerk = { status: string; zusammenfassung?: string; fehler?: string }

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

function abstand(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const v = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let vorher = v[0]
    v[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = v[j]
      v[j] = Math.min(v[j] + 1, v[j - 1] + 1, vorher + (a[i - 1] === b[j - 1] ? 0 : 1))
      vorher = tmp
    }
  }
  return v[b.length]
}

function deDatum(iso: unknown): string {
  const s = String(iso ?? '')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s
}

function euro(n: unknown): string {
  const z = typeof n === 'string' ? Number(n) : n
  return typeof z === 'number' && Number.isFinite(z) && z > 0 ? `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(z)} €` : ''
}

function kuerze(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)} … (gekürzt)` : s
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
}

export function objektStatus(status: unknown): string {
  return OBJEKT_STATUS[String(status ?? '')] ?? String(status ?? '—')
}

export function alleObjektDokumente(o: Pick<ObjektRow, 'dokumente'>): { ordner: string; dok: ObjektDokument }[] {
  const out: { ordner: string; dok: ObjektDokument }[] = []
  for (const [ordner, liste] of Object.entries(o.dokumente ?? {})) for (const dok of liste ?? []) if (dok?.id) out.push({ ordner, dok })
  return out
}

/** Die Form, in der email-gateway (dokument_inhalte) ein Objekt-Dokument lesen kann. */
export function leseRef(dok: ObjektDokument): { id: string; name: string; typ: string; datum: string; groesse: string; url: string } {
  return { ...dok, url: dok.url.startsWith(OBJEKT_DOKUMENT_PRAEFIX) || /^https?:\/\//i.test(dok.url) ? dok.url : `${OBJEKT_DOKUMENT_PRAEFIX}${dok.url}` }
}

export function lesenVonSelbst(ordner: string): boolean {
  return !NICHT_VON_SELBST_LESEN.has(ordner)
}

/** Sucht Objekte nach Bezeichnung, Adresse, Ort, Objektart, Eigentümer oder Auftraggeber. */
export function sucheObjekte(objekte: ObjektRow[], begriff: string): ObjektRow[] {
  const woerter = (norm(begriff).match(/[a-z0-9]{2,}/g) ?? []).filter((w) => !['objekt', 'immobilie', 'haus', 'in', 'der', 'die', 'das'].includes(w) || norm(begriff).trim() === w)
  if (woerter.length === 0) return []
  const ganz = norm(begriff).trim()
  return objekte
    .map((o) => {
      const vd = o.verkaufsdaten ?? {}
      const hay = norm(
        [o.bezeichnung, o.adresse, o.typ, o.eigentuemer?.name, o.eigentuemer?.ansprechpartner, vd.auftraggeber?.name, vd.uebersicht?.strasse, vd.uebersicht?.plzOrt, vd.uebersicht?.gemarkung].filter(Boolean).join(' '),
      )
      const hayWoerter: string[] = hay.match(/[a-z0-9]{2,}/g) ?? []
      let score = 0
      for (const t of woerter) {
        if (hayWoerter.includes(t)) score += 3
        else if (t.length >= 3 && hayWoerter.some((w) => w.startsWith(t))) score += 2
        else if (t.length >= 4 && hay.includes(t)) score += 1
        // Tippfehler („Supingen", „Suppigen"): ein Buchstabe daneben, bei langen Wörtern zwei.
        else if (t.length >= 5 && hayWoerter.some((w) => abstand(w, t) <= (t.length >= 9 ? 2 : 1))) score += 2
      }
      if (ganz.length >= 4 && hay.includes(ganz)) score += 3
      return { o, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.o)
}

export type AbteilungZeile = { id: string; art: string; daten: Record<string, unknown> }

/** Baut den Text der Objektakte für den Assistenten. */
export function objektakteText(
  o: ObjektRow,
  zusatz: {
    eintraege: AbteilungZeile[]
    inhalte: Map<string, InhaltVermerk>
    /** kundeId → Anzeigename, nur für Kunden, die der Mitarbeiter sehen darf. */
    kundenNamen: Map<string, string>
  },
): string {
  const z: string[] = []
  const kp = euro(o.kaufpreis)
  z.push(`Objekt: ${o.bezeichnung} | Adresse: ${o.adresse || '—'} | Objektart: ${o.typ || '—'}${o.gruppe ? ` | Liste: ${o.gruppe}` : ''} [objekt_id=${o.id}]`)
  z.push(`Status: ${objektStatus(o.status)} | Priorität: ${o.prioritaet || '—'} | Verantwortlich: ${o.verantwortlich || '—'}${o.off_market ? ' | nicht öffentlich angeboten (Off-Market)' : ''}`)
  z.push(`Kaufpreis: ${kp || 'nicht eingetragen'}`)
  const e = o.eigentuemer
  z.push(
    e?.name
      ? `Eigentümer: ${e.name}${e.ansprechpartner ? ` (Ansprechpartner: ${e.ansprechpartner})` : ''} | Telefon: ${e.telefon || '—'} | E-Mail: ${e.email || '—'}`
      : 'Eigentümer: nicht eingetragen',
  )
  if (o.zugewiesener_kunde?.kundeName) z.push(`Einem Kunden zugeordnet: ${o.zugewiesener_kunde.kundeName}`)
  const fu = o.follow_up
  z.push(`Follow-up: ${fu?.note ? `${fu.note} — fällig ${deDatum(fu.date)}${fu.done ? ' (erledigt)' : ''}` : 'keines'}`)
  if (o.quelle === 'immoradar' || o.immo_radar_link) z.push(`Herkunft: Immobilienradar${o.lukrativitaet ? `, Einschätzung „${o.lukrativitaet}"` : ''}${o.immo_radar_link ? ` (${o.immo_radar_link})` : ''}`)

  // Verkaufsdatenblatt
  const vd = o.verkaufsdaten
  z.push('', 'VERKAUFSDATENBLATT:')
  if (!vd) z.push('(noch nicht ausgefüllt)')
  else {
    if (vd.datum || vd.prio) z.push(`Stand ${deDatum(vd.datum) || '—'}${vd.prio ? `, Priorität ${vd.prio}` : ''}`)
    const ag = vd.auftraggeber ?? {}
    const agTeile = [txt(ag.name), txt(ag.telefon) && `Tel. ${txt(ag.telefon)}`, txt(ag.email), txt(ag.adresse), txt(ag.webseite), txt(ag.bonitaet) && `Bonität: ${txt(ag.bonitaet)}`].filter(Boolean)
    if (agTeile.length) z.push(`Auftraggeber: ${agTeile.join(', ')}`)
    if (vd.auftragsart) z.push(`Auftragsart: ${typeof vd.auftragsart === 'string' ? vd.auftragsart : JSON.stringify(vd.auftragsart)}`)
    const k = vd.kennzahlen ?? {}
    const kz = [
      ['Baujahr', txt(k.baujahr)], ['Grundstück', txt(k.grundstuecksflaeche)], ['Wohnfläche', txt(k.wohnflaeche)], ['Nutzfläche', txt(k.nutzflaeche)],
      ['Einheiten', txt(k.einheiten)], ['Zimmer', txt(k.zimmer)], ['Stellplätze', txt(k.stellplaetze)], ['Vermietung', txt(k.vermietungsstatus)],
      ['Jahresnettokaltmiete', euro(k.jahresnettokaltmiete)], ['Kaufpreisvorstellung', euro(k.kaufpreisvorstellung)], ['Zielverkaufspreis', euro(k.zielverkaufspreis)],
    ].filter(([, v]) => v)
    if (kz.length) z.push(`Kennzahlen: ${kz.map(([n, v]) => `${n} ${v}`).join(' · ')}`)
    const bw = vd.bewertung ?? {}
    const bwTeile = [txt(bw.rendite) && `Rendite ${txt(bw.rendite)}`, txt(bw.faktor) && `Faktor ${txt(bw.faktor)}`, euro(bw.marktwert) && `Marktwert ${euro(bw.marktwert)}`, (bw.verfahren ?? []).length ? `Verfahren: ${bw.verfahren.join(', ')}` : ''].filter(Boolean)
    if (bwTeile.length) z.push(`Bewertung im Blatt: ${bwTeile.join(' · ')}`)
    if ((vd.verkaufsstatus ?? []).length || txt(vd.verkaufsstatusNotiz)) z.push(`Verkaufsstand: ${[...(vd.verkaufsstatus ?? []), txt(vd.verkaufsstatusNotiz)].filter(Boolean).join(' · ')}`)
    const ue = vd.uebersicht ?? {}
    const ueTeile = [txt(ue.strasse), txt(ue.plzOrt), txt(ue.flurstueck) && `Flurstück ${txt(ue.flurstueck)}`, txt(ue.gemarkung) && `Gemarkung ${txt(ue.gemarkung)}`, txt(ue.objektart)].filter(Boolean)
    if (ueTeile.length) z.push(`Lage: ${ueTeile.join(', ')}`)
    const ul = Object.entries((vd.unterlagen ?? {}) as Record<string, { vorhanden?: boolean; geprueft?: boolean }>)
    if (ul.length) {
      const da = ul.filter(([, v]) => v?.vorhanden).map(([n, v]) => `${n}${v?.geprueft ? ' (geprüft)' : ''}`)
      const fehlt = ul.filter(([, v]) => !v?.vorhanden).map(([n]) => n)
      if (da.length) z.push(`Unterlagen laut Blatt vorhanden: ${da.join(', ')}`)
      if (fehlt.length) z.push(`Unterlagen laut Blatt fehlend: ${fehlt.join(', ')}`)
    }
    if (txt(vd.sonstiges)) z.push(`Sonstiges: ${kuerze(txt(vd.sonstiges), 800)}`)
  }

  // Vorab-Kurzprüfung
  const kp2 = o.kurzpruefung
  z.push('', 'VORAB-KURZPRÜFUNG:')
  if (!kp2) z.push('(noch nicht ausgefüllt)')
  else {
    if (kp2.datum || kp2.prio) z.push(`Stand ${deDatum(kp2.datum) || '—'}${kp2.prio ? `, Einstufung ${kp2.prio}${txt(kp2.prioBegruendung) ? ` (${txt(kp2.prioBegruendung)})` : ''}` : ''}`)
    for (const [zeile, w] of Object.entries((kp2.zeilen ?? {}) as Record<string, { ist?: string; marktwert?: string; ergebnis?: string }>)) {
      const t = [txt(w?.ist) && `Ist ${txt(w?.ist)}`, txt(w?.marktwert) && `Marktwert ${txt(w?.marktwert)}`, txt(w?.ergebnis) && `Ergebnis ${txt(w?.ergebnis)}`].filter(Boolean)
      if (t.length) z.push(`- ${zeile}: ${t.join(' · ')}`)
    }
    const prov = [txt(kp2.provisionProzent) && `${txt(kp2.provisionProzent)} %`, txt(kp2.provisionBetrag)].filter(Boolean)
    if (prov.length) z.push(`Provision: ${prov.join(' / ')}`)
    if (txt(kp2.verkaeuferBekannt)) z.push(`Verkäufer bekannt: ${txt(kp2.verkaeuferBekannt)}`)
    if (txt(kp2.direktesMandat)) z.push(`Direktes Mandat: ${txt(kp2.direktesMandat)}`)
    if ((kp2.gruendeDafuer ?? []).filter(Boolean).length) z.push(`Gründe dafür: ${kp2.gruendeDafuer.filter(Boolean).join('; ')}`)
    if ((kp2.gruendeDagegen ?? []).filter(Boolean).length) z.push(`Gründe dagegen: ${kp2.gruendeDagegen.filter(Boolean).join('; ')}`)
    if (txt(kp2.offeneFragen)) z.push(`Offene Fragen: ${txt(kp2.offeneFragen)}`)
    if (txt(kp2.zeiterfordernis)) z.push(`Zeitaufwand: ${txt(kp2.zeiterfordernis)}`)
    if ((kp2.naechsteSchritte ?? []).filter(Boolean).length) z.push(`Nächste Schritte: ${kp2.naechsteSchritte.filter(Boolean).join('; ')}`)
  }

  // Bewertung per Knopf
  const b = o.bewertung
  z.push('', 'BEWERTUNG:')
  if (!b) z.push('(noch keine Bewertung erstellt)')
  else if (b.status === 'laeuft') z.push(`Läuft gerade${b.schritt ? ` (${b.schritt})` : ''}, gestartet ${deDatum(b.gestartetAm)}.`)
  else if (b.status === 'fehler') z.push(`Letzter Versuch vom ${deDatum(b.gestartetAm)} ist fehlgeschlagen.`)
  else {
    const k = b.kennzahlen ?? {}
    const kz = [
      euro(k.marktwert) && `Marktwert ${euro(k.marktwert)}`,
      euro(k.marktwertVon) && euro(k.marktwertBis) && `Spanne ${euro(k.marktwertVon)} bis ${euro(k.marktwertBis)}`,
      k.preisProQm && `${euro(k.preisProQm)} je m²`,
      k.mieteProQm && `Miete ${k.mieteProQm} € je m²`,
      k.kaufpreisfaktor && `Faktor ${k.kaufpreisfaktor}`,
      k.rendite && `Rendite ${k.rendite} %`,
    ].filter(Boolean)
    z.push(`Erstellt ${deDatum(b.abgeschlossenAm ?? b.gestartetAm)}${b.gestartetVon ? ` von ${b.gestartetVon}` : ''}${b.vorlageName ? ` nach „${b.vorlageName}"` : ''}.${kz.length ? ` ${kz.join(' · ')}` : ''}`)
    if (txt(b.bericht)) z.push(`Bericht:\n${kuerze(txt(b.bericht), 6000)}`)
  }

  if (txt(o.expose_text)) z.push('', `EXPOSÉ-TEXT:\n${kuerze(txt(o.expose_text), 1500)}`)

  // Unterlagen beim Eigentümer angefordert
  const anf = (o.unterlagen_anforderungen ?? []) as { datum?: string; anName?: string; an?: string; ordner?: string[]; weitere?: string; art?: string; von?: string }[]
  if (anf.length) {
    z.push('', 'UNTERLAGEN ANGEFORDERT:')
    for (const a of anf.slice(0, 8)) z.push(`- ${deDatum(a.datum)} ${a.art === 'erinnerung' ? 'Erinnerung' : 'Anforderung'} an ${a.anName || a.an || '—'}${a.von ? ` (von ${a.von})` : ''}: ${[...(a.ordner ?? []), txt(a.weitere)].filter(Boolean).join(', ')}`)
  }

  // Dokumente je Ordner
  const doks = alleObjektDokumente(o)
  z.push('', `DOKUMENTE (${doks.length}):`)
  if (!doks.length) z.push('(keine)')
  const nachOrdner = new Map<string, ObjektDokument[]>()
  for (const { ordner, dok } of doks) nachOrdner.set(ordner, [...(nachOrdner.get(ordner) ?? []), dok])
  for (const [ordner, liste] of nachOrdner) {
    if (!lesenVonSelbst(ordner)) {
      z.push(`${ordner}: ${liste.length} ${liste.length === 1 ? 'Datei' : 'Dateien'} (Fotos; Inhalt einzeln mit dokument_inhalt lesbar)${liste.length <= 3 ? `: ${liste.map((d) => `${d.name} [dokument_id=${d.id}]`).join(', ')}` : ` [z. B. dokument_id=${liste[0].id}]`}`)
      continue
    }
    z.push(`${ordner}:`)
    for (const d of liste) {
      const i = zusatz.inhalte.get(leseRef(d).url)
      const vermerk = !i
        ? ''
        : i.status === 'gelesen'
          ? ` — Inhalt gelesen${i.zusammenfassung ? `: ${kuerze(i.zusammenfassung, 350)}` : ''}`
          : i.status === 'laeuft'
            ? ' — Inhalt wird gerade eingelesen'
            : i.status === 'nicht lesbar'
              ? ' — Dateityp nicht lesbar'
              : i.status === 'fehler'
                ? ' — Lesen fehlgeschlagen'
                : ''
      z.push(`- ${d.name} (${deDatum(d.datum)}, ${d.groesse}) [dokument_id=${d.id}]${vermerk}`)
    }
  }

  // Abteilungs-Einträge zum Objekt
  const fragen = zusatz.eintraege.filter((x) => x.art === 'frage' && x.daten.objektId === o.id)
  z.push('', `FRAGEN AN DIE GESCHÄFTSFÜHRUNG (${fragen.length}):`)
  if (!fragen.length) z.push('(keine)')
  for (const f of fragen) {
    const d = f.daten as Record<string, string>
    z.push(`- ${deDatum(d.erstelltAm)} ${d.gestelltVon || '—'}${d.prio ? ` (Prio ${d.prio})` : ''}: ${d.frage}${d.antwort ? ` → Antwort ${d.beantwortetVon || ''} am ${deDatum(d.beantwortetAm)}: ${d.antwort}` : ' → noch offen'}`)
  }

  const weitergaben = zusatz.eintraege.filter((x) => x.art === 'weitergabe' && Array.isArray(x.daten.objektIds) && (x.daten.objektIds as string[]).includes(o.id))
  z.push('', `WEITERGEGEBEN AN (${weitergaben.length}):`)
  if (!weitergaben.length) z.push('(an niemanden)')
  for (const w of weitergaben) {
    const d = w.daten as Record<string, unknown>
    z.push(`- ${deDatum(d.datum)} an ${d.an} von ${d.von || '—'} (${d.weg || '—'}${d.vereinbarung && d.vereinbarung !== 'keine' ? `, Vereinbarung: ${d.vereinbarung === 'nda' ? 'Vertraulichkeit' : d.vereinbarung === 'nichtumgehung' ? 'Nichtumgehung' : 'Vertraulichkeit und Nichtumgehung'}` : ''})`)
  }

  const treffer = zusatz.eintraege.filter((x) => x.art === 'treffer' && x.id.endsWith(`|${o.id}`))
  const sichtbareTreffer = treffer.filter((t) => zusatz.kundenNamen.has(String(t.daten.kundeId)))
  z.push('', `PASSENDE GESUCHE (${sichtbareTreffer.length}):`)
  if (!sichtbareTreffer.length) z.push('(keine)')
  for (const t of sichtbareTreffer) z.push(`- ${zusatz.kundenNamen.get(String(t.daten.kundeId))}: ${t.daten.art === 'treffer' ? 'passt' : 'könnte passen, noch zu prüfen'} (seit ${deDatum(t.daten.entdecktAm)})`)

  const zeiten = zusatz.eintraege.filter((x) => x.art === 'zeit' && x.daten.objektId === o.id)
  if (zeiten.length) {
    const jePerson = new Map<string, number>()
    for (const x of zeiten) jePerson.set(String(x.daten.mitarbeiter ?? '—'), (jePerson.get(String(x.daten.mitarbeiter ?? '—')) ?? 0) + (Number(x.daten.dauerMin) || 0))
    z.push('', `ZEITAUFWAND: ${[...jePerson].map(([n, m]) => `${n} ${Math.floor(m / 60)} Std. ${m % 60} Min.`).join(', ')}`)
  }
  const abr = zusatz.eintraege.find((x) => x.art === 'abrechnung' && x.id === o.id)
  if (abr && euro(abr.daten.provision)) z.push(`Erwartete Provision laut Abrechnung: ${euro(abr.daten.provision)}`)

  z.push('', 'AKTIVITÄTEN/NOTIZEN (neueste zuerst):')
  const akt = (o.activities ?? []) as { date?: string; user?: string; text?: string }[]
  z.push(...(akt.length ? akt.slice(0, 25).map((a) => `- ${deDatum(a.date)} ${a.user || ''}: ${a.text}`) : ['(keine)']))
  return kuerze(z.join('\n'), 26000)
}
