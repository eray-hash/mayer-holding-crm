// Assistent-Werkzeuge rund um Gesuche (wer sucht was) und das Interessenten-Portal (22.11.2026):
// „Welche Käufer passen zu diesem Objekt?“, „Welche Objekte passen zu Herrn X?“ und „Schick ihm den
// Portal-Link“.
//
// - Gesuche liegen als jsonb-Liste in kunden.gesuche (ältere Käuferprofile in kunden.kaeuferprofil zählen als
//   ein Gesuch mit). Der Abgleich ist derselbe wie bei der Treffer-Meldung und auf der Seite „Gesuche“:
//   _shared/gesuchAbgleich.ts (gleiche Regeln wie src/lib/gesuche.ts). Mayer und Privat bleiben getrennt.
// - Ein Zugang zum Interessenten-Portal ist eine Zeile in objekt_freigaben, Schlüssel wie im CRM
//   (src/lib/objektPortal.ts: 32 Zufallsbytes, base64url). Die Mail mit dem Link hat genau den Text des
//   Knopfs „Per E-Mail“ in der Objektakte (LinkMail in src/components/ObjektFreigaben.tsx) und geht über
//   denselben Weg (email-gateway, Aktion „send“) — hier über ctx.sendeMail, das index.ts bereitstellt.
//   Verschickt wird nur, wenn der Mitarbeiter es ausdrücklich will (senden=true).
//
// Der Assistent arbeitet mit vollen Datenbankrechten, deshalb bildet diese Datei die Zeilenregeln der
// Datenbank nach: Akten nach darfAkte, Objekte nach darfObjekt (Holding-Objekte nur mit Rechten für
// Immobilien), private Akten und Objekte nur ihr Besitzer. Das Interessenten-Portal gibt es nur für Objekte
// der Holding. Löschen oder Beenden eines Zugangs gibt es hier bewusst nicht.

import { type AbgleichObjekt, bestandVon, budgetText, eckdatenTexte, type Gesuch, gesucheDesKontakts, type KundenZeile, objektAusZeile, type ObjektZeile, pruefe, type Pruefung, vergleichePruefungen } from '../_shared/gesuchAbgleich.ts'
import { adresse, darfAkte, darfObjekt, darfObjekte, istFremdePrivatakte, istPrivat, istUnsichtbaresObjekt, nichtFreigegeben, type RechteMitarbeiter, SAMMELAKTEN } from './rechte.ts'

// deno-lint-ignore no-explicit-any
type Supa = any

/** Eine Mail über das Hauptpostfach der Firma (email-gateway, Aktion „send“). null = gesendet, sonst der Fehlertext. */
export type SendeMail = (m: { an: string; anName: string; betreff: string; text: string; kundeId?: string; kundeBereich?: string; kundeName?: string }) => Promise<string | null>

export type GesucheKontext = {
  supabase: Supa
  mitarbeiter: RechteMitarbeiter & { name: string }
  protokolliere: (text: string) => void
  heute: string
  /** Fehlt es, kann portal_zugang_anlegen nur anlegen, nicht verschicken. */
  sendeMail?: SendeMail
}

/** Gleich wie PROVISION_VORSCHLAG in src/components/ObjektFreigaben.tsx und email-gateway/anfragenManager.ts — bei Änderung alle anpassen. */
export const PROVISION_VORSCHLAG = '3 % des beurkundeten Kaufpreises zzgl. gesetzlicher Umsatzsteuer'
/** Wie die Datenbank-Funktion auto_nachricht_bauen: Adresse des CRM aus willkommen_einstellung.link_basis. */
const LINK_BASIS_VORGABE = 'https://eray-hash.github.io/mayer-holding-crm/'

const KUNDEN_SPALTEN = 'id, bereich, firma, ansprechpartner, email, telefon, verantwortlich, verantwortlich_email, privat_art, gesuche, kaeuferprofil'
const OBJEKT_SPALTEN = 'id, bezeichnung, adresse, typ, kaufpreis, status, verantwortlich, zugewiesener_kunde, verkaufsdaten, activities, privat_besitzer'

const KEIN_OBJEKT = 'Fehler: Es gibt kein Objekt mit dieser objekt_id. Ermittle die richtige ID mit objekte_suchen.'
const KEINE_AKTE = 'Fehler: Es gibt keine Akte mit dieser kunde_id. Ermittle sie mit kunden_suchen.'
const NUR_HOLDING = 'Das Interessenten-Portal gibt es nur für Objekte der Holding, nicht für private Objekte oder private Kontakte.'
const HOECHSTENS = 25

export const GESUCHE_WERKZEUGE = [
  {
    name: 'gesuche_suchen',
    description:
      'Listet die Gesuche (Suchprofile von Käufern: wer sucht welche Objektart, wo, mit welchem Budget) aus den Akten. Für Fragen wie „Wer sucht ein Mehrfamilienhaus in Ulm?“, „Welche Gesuche hat Herr X?“, „Zeig alle offenen Gesuche“. Ohne Angaben alle offenen Gesuche. Liefert kunde_id und gesuch_id für passende_objekte.',
    input_schema: {
      type: 'object',
      properties: {
        suchbegriff: { type: 'string', description: 'Optional: Name, Ort, Objektart oder Stichwort aus Titel und Notizen (alle Wörter müssen vorkommen).' },
        kunde_id: { type: 'string', description: 'Optional: nur die Gesuche dieser Akte.' },
        mit_erledigten: { type: 'boolean', description: 'true = auch erledigte Gesuche zeigen.' },
      },
    },
  },
  {
    name: 'passende_kaeufer',
    description:
      'Welche Käufer passen zu diesem Objekt? Gleicht ein Objekt mit allen offenen Gesuchen ab (dieselben Regeln wie die Seite „Gesuche“ und die Treffer-Meldung) und liefert die passenden Kontakte nach Güte sortiert, je mit kurzem Grund (was passt, was beim Objekt noch fehlt) und ob der Kontakt schon einen Zugang zum Interessenten-Portal hat. objekt_id aus objekte_suchen. Danach kann portal_zugang_anlegen den Link anlegen und auf ausdrücklichen Wunsch verschicken.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string' },
        nur_vollstaendige: { type: 'boolean', description: 'true = nur Treffer ohne offene Punkte.' },
      },
      required: ['objekt_id'],
    },
  },
  {
    name: 'passende_objekte',
    description:
      'Welche Objekte passen zu einem Gesuch oder zu einem Kontakt? Mit gesuch_id nur dieses Gesuch, mit kunde_id alle offenen Gesuche dieser Akte. Liefert die passenden Objekte nach Güte sortiert mit kurzem Grund und objekt_id.',
    input_schema: {
      type: 'object',
      properties: {
        gesuch_id: { type: 'string', description: 'ID des Gesuchs aus gesuche_suchen.' },
        kunde_id: { type: 'string', description: 'Die Akte des Suchenden (kunden_suchen oder gesuche_suchen).' },
      },
    },
  },
  {
    name: 'portal_zugang_anlegen',
    description:
      'Legt für einen Interessenten einen Zugang zum Interessenten-Portal eines Objekts an (eigener Link; dort sieht er nach Zustimmung zu AGB und Provisionsvereinbarung Exposé und freigegebene Unterlagen) — wie „Interessent freischalten“ in der Objektakte. Mit kunde_id aus einer Akte (Name, E-Mail, Telefon von dort) oder mit name/email/telefon für jemanden ohne Akte. Gibt es schon einen offenen Zugang für ihn, wird dieser genommen. ' +
      'senden=true schickt ihm sofort die Mail mit dem Link (Text wie der Knopf „Per E-Mail“) — NUR wenn der Mitarbeiter ausdrücklich gesagt hat, dass der Link an den Interessenten gehen soll. Sonst ohne senden: dann bekommt der Mitarbeiter den Link zum Weitergeben.',
    input_schema: {
      type: 'object',
      properties: {
        objekt_id: { type: 'string' },
        kunde_id: { type: 'string', description: 'Akte des Interessenten (z. B. aus passende_kaeufer).' },
        name: { type: 'string', description: 'Name des Interessenten (nötig ohne kunde_id; mit kunde_id nur, wenn abweichend).' },
        email: { type: 'string', description: 'E-Mail-Adresse (nötig fürs Verschicken; mit kunde_id nur, wenn abweichend).' },
        telefon: { type: 'string' },
        provision: { type: 'string', description: `Optional: Provision, wie sie in der Provisionsvereinbarung steht. Vorgabe: „${PROVISION_VORSCHLAG}“.` },
        senden: { type: 'boolean', description: 'true = Mail mit dem Link sofort an den Interessenten schicken (nur auf ausdrücklichen Wunsch).' },
      },
      required: ['objekt_id'],
    },
  },
]

export function istGesucheWerkzeug(name: string): boolean {
  return GESUCHE_WERKZEUGE.some((w) => w.name === name)
}

// ---------------------------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------------------------

type Kunde = KundenZeile & { email?: string | null; telefon?: string | null }

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

function kontaktName(k: Pick<Kunde, 'firma' | 'ansprechpartner'>): string {
  const f = txt(k.firma)
  const p = txt(k.ansprechpartner)
  return p && p !== f ? `${f} (${p})` : f || p || 'ohne Namen'
}

function objektName(o: { bezeichnung?: string | null; adresse?: string | null; id: string }): string {
  return txt(o.bezeichnung) || txt(o.adresse) || o.id
}

function norm(s: string): string {
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

/** Kurzbeschreibung eines Gesuchs: „Haus, Wohnung · Ulm · bis 900.000 € · Faktor bis 20“. */
export function gesuchKurz(g: Gesuch): string {
  return [g.objekttypen.join(', '), g.lage.trim(), budgetText(g), ...eckdatenTexte(g)].filter((x) => x && x !== '–').join(' · ') || 'ohne Angaben'
}

/** Kurzer Grund: „passt: Objektart Haus, Lage Ulm, Preis im Budget; noch offen: Baujahr beim Objekt nicht hinterlegt“. */
export function grundText(t: Pruefung): string {
  return `passt: ${t.passt.join(', ')}${t.offen.length ? `; noch offen: ${t.offen.join(', ')}` : ''}`
}

async function ladeKunden(supabase: Supa): Promise<Kunde[] | string> {
  const { data, error } = await supabase.from('kunden').select(KUNDEN_SPALTEN).limit(5000)
  if (error) return `Fehler beim Laden der Akten: ${error.message}`
  return (data ?? []) as Kunde[]
}

async function ladeObjekte(supabase: Supa): Promise<ObjektZeile[] | string> {
  const { data, error } = await supabase.from('objekte').select(OBJEKT_SPALTEN).limit(5000)
  if (error) return `Fehler beim Laden der Objekte: ${error.message}`
  return (data ?? []) as ObjektZeile[]
}

/** Ein Objekt samt Rechteprüfung: fremde private Objekte „gibt es nicht“, Holding-Objekte brauchen Rechte für Immobilien. */
async function ladeObjekt(supabase: Supa, m: RechteMitarbeiter & { name: string }, id: string): Promise<{ o?: ObjektZeile; fehler?: string }> {
  if (!id) return { fehler: 'Fehler: objekt_id fehlt. Ermittle sie mit objekte_suchen.' }
  const { data, error } = await supabase.from('objekte').select(OBJEKT_SPALTEN).eq('id', id).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden des Objekts: ${error.message}` }
  if (!data || istUnsichtbaresObjekt(m, data)) return { fehler: KEIN_OBJEKT }
  if (!darfObjekt(m, data)) return { fehler: nichtFreigegeben('immobilien', m.name) }
  return { o: data as ObjektZeile }
}

/** Eine Akte samt Rechteprüfung. Fremde private Akten „gibt es nicht“. */
async function ladeAkte(supabase: Supa, m: RechteMitarbeiter & { name: string }, id: string): Promise<{ k?: Kunde; fehler?: string }> {
  const { data, error } = await supabase.from('kunden').select(KUNDEN_SPALTEN).eq('id', id).maybeSingle()
  if (error) return { fehler: `Fehler beim Laden der Akte: ${error.message}` }
  if (!data || istFremdePrivatakte(m, data)) return { fehler: KEINE_AKTE }
  if (!darfAkte(m, data)) return { fehler: nichtFreigegeben(data.bereich, m.name) }
  return { k: data as Kunde }
}

/** Die Objekte, die ein Kontakt durchsucht und die der Mitarbeiter sehen darf (Mayer oder private desselben Besitzers). */
function bestandFuer(m: RechteMitarbeiter, kunde: KundenZeile, objekte: ObjektZeile[]): AbgleichObjekt[] {
  const bestand = bestandVon(kunde)
  if (bestand === null) return []
  return objekte.filter((o) => darfObjekt(m, o)).map(objektAusZeile).filter((o) => o.besitzer === bestand)
}

/** Neuer Schlüssel für einen Portal-Link — genau wie neuesToken in src/lib/objektPortal.ts (32 Zufallsbytes, base64url, 43 Zeichen). */
export function neuesToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function portalLink(basis: string, token: string): string {
  const b = basis.endsWith('/') ? basis : `${basis}/`
  return `${b}#/formular/objekt/${token}`
}

/** Betreff und Text der Einladung — wortgleich zu LinkMail in src/components/ObjektFreigaben.tsx. */
export function portalEinladung(e: { name: string; objektBezeichnung: string; link: string; absender: string }): { betreff: string; text: string } {
  return {
    betreff: `Ihre Unterlagen zu ${e.objektBezeichnung}`,
    text: `Guten Tag ${e.name},\n\nvielen Dank für Ihr Interesse an ${e.objektBezeichnung}. Über diesen Link sehen Sie das Exposé und die Unterlagen, sobald Sie unseren Bedingungen und der Provisionsvereinbarung zugestimmt haben:\n${e.link}\n\nFür Fragen oder einen Besichtigungstermin antworten Sie einfach auf diese E-Mail.\n\nMit freundlichen Grüßen\n${e.absender}\nAndreas Mayer Holding`,
  }
}

const STATUS_TEXT: Record<string, string> = { eingeladen: 'Link angelegt, noch nicht zugestimmt', zugestimmt: 'hat zugestimmt', widerrufen: 'Zugang beendet' }

type Freigabe = { id: string; token: string; kunde_id: string | null; name: string; email: string | null; status: string; gueltig_bis: string | null }

function istOffen(f: Freigabe): boolean {
  return f.status !== 'widerrufen' && (!f.gueltig_bis || Date.parse(f.gueltig_bis) > Date.now())
}

// ---------------------------------------------------------------------------------------------
// Ausführen
// ---------------------------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
export async function fuehreGesucheWerkzeugAus(name: string, input: any, k: GesucheKontext): Promise<string> {
  const { supabase, mitarbeiter } = k

  if (name === 'gesuche_suchen') {
    const kundeId = txt(input?.kunde_id)
    let kunden: Kunde[]
    if (kundeId) {
      const r = await ladeAkte(supabase, mitarbeiter, kundeId)
      if (r.fehler) return r.fehler
      kunden = [r.k!]
    } else {
      const alle = await ladeKunden(supabase)
      if (typeof alle === 'string') return alle
      kunden = alle.filter((x) => darfAkte(mitarbeiter, x))
    }
    const woerter = norm(txt(input?.suchbegriff)).match(/[a-z0-9-]{2,}/g) ?? []
    const zeilen: string[] = []
    let anzahl = 0
    for (const kunde of kunden) {
      if (bestandVon(kunde) === null) continue
      for (const g of gesucheDesKontakts(kunde)) {
        if (g.erledigt && input?.mit_erledigten !== true) continue
        if (woerter.length) {
          const heu = norm([kontaktName(kunde), g.titel, g.lage, g.objekttypen.join(' '), g.nutzung, g.notizen].join(' '))
          if (!woerter.every((w) => heu.includes(w))) continue
        }
        anzahl++
        if (zeilen.length >= 40) continue
        const teile = [`${kontaktName(kunde)}: „${g.titel || 'ohne Titel'}“`, gesuchKurz(g)]
        if (g.nutzung && g.nutzung !== 'Unklar') teile.push(g.nutzung)
        if (g.notizen) teile.push(`Notiz: ${g.notizen.slice(0, 150)}`)
        if (g.erledigt) teile.push('erledigt')
        zeilen.push(`- ${teile.join(' | ')} (kunde_id=${kunde.id}, gesuch_id=${g.id})`)
      }
    }
    if (!anzahl) return woerter.length ? `Keine Gesuche zu „${txt(input?.suchbegriff)}“ gefunden.` : 'Keine offenen Gesuche gefunden.'
    return [`${anzahl} Gesuch${anzahl === 1 ? '' : 'e'}${input?.mit_erledigten === true ? '' : ' (offen)'}:`, ...zeilen, anzahl > zeilen.length ? `… und ${anzahl - zeilen.length} weitere (eingrenzen).` : ''].filter(Boolean).join('\n')
  }

  if (name === 'passende_kaeufer') {
    const r = await ladeObjekt(supabase, mitarbeiter, txt(input?.objekt_id))
    if (r.fehler) return r.fehler
    const zeile = r.o!
    const o = objektAusZeile(zeile)
    const kopf = `Objekt „${objektName(zeile)}“ (objekt_id=${zeile.id})`
    if (['verkauft', 'archiv', 'abgebrochen'].includes(o.status)) return `${kopf} hat den Status ${o.status} und steht nicht mehr zur Vermittlung — deshalb passt kein Gesuch.`
    if (o.zugewiesen) return `${kopf} ist schon einem Kunden zugewiesen und steht nicht mehr zur Vermittlung — deshalb passt kein Gesuch.`
    const alle = await ladeKunden(supabase)
    if (typeof alle === 'string') return alle
    const treffer: { kunde: Kunde; g: Gesuch; t: Pruefung }[] = []
    for (const kunde of alle) {
      if (!darfAkte(mitarbeiter, kunde) || bestandVon(kunde) !== o.besitzer) continue
      for (const g of gesucheDesKontakts(kunde)) {
        if (g.erledigt || !g.id) continue
        const t = pruefe(g, o)
        if (t && !(input?.nur_vollstaendige === true && t.offen.length)) treffer.push({ kunde, g, t })
      }
    }
    if (!treffer.length) return `${kopf}: Zurzeit passt kein offenes Gesuch${input?.nur_vollstaendige === true ? ' ohne offene Punkte' : ''}. Gesuche werden in den Akten erfasst (Seite „Gesuche“).`
    treffer.sort((a, b) => vergleichePruefungen(a.t, b.t) || kontaktName(a.kunde).localeCompare(kontaktName(b.kunde), 'de'))

    // Wer hat schon einen Zugang zum Interessenten-Portal? (Nur bei Objekten der Holding.)
    const zugang = new Map<string, string>()
    if (!o.besitzer) {
      const { data } = await supabase.from('objekt_freigaben').select('id, token, kunde_id, name, email, status, gueltig_bis').eq('objekt_id', zeile.id)
      for (const f of (data ?? []) as Freigabe[]) {
        const stand = f.status === 'eingeladen' && !istOffen(f) ? 'Link abgelaufen' : STATUS_TEXT[f.status] ?? f.status
        if (f.kunde_id && (!zugang.has(f.kunde_id) || f.status === 'zugestimmt')) zugang.set(f.kunde_id, stand)
        const mail = adresse(f.email)
        if (mail && (!zugang.has(`@${mail}`) || f.status === 'zugestimmt')) zugang.set(`@${mail}`, stand)
      }
    }
    const vollstaendig = treffer.filter((x) => !x.t.offen.length).length
    const zeilen = treffer.slice(0, HOECHSTENS).map(({ kunde, g, t }, i) => {
      const portal = zugang.get(kunde.id) ?? zugang.get(`@${adresse(kunde.email)}`)
      const teile = [
        `${i + 1}. ${kontaktName(kunde)} — Gesuch „${g.titel || 'ohne Titel'}“ (${gesuchKurz(g)})`,
        t.offen.length ? 'zu prüfen' : 'passt vollständig',
        grundText(t),
      ]
      if (!o.besitzer) teile.push(portal ? `Portal: ${portal}` : 'Portal: noch kein Zugang')
      if (!txt(kunde.email)) teile.push('keine E-Mail in der Akte')
      return `${teile.join(' | ')} (kunde_id=${kunde.id}, gesuch_id=${g.id})`
    })
    return [
      `${kopf}: ${treffer.length} passende${treffer.length === 1 ? 's' : ''} Gesuch${treffer.length === 1 ? '' : 'e'}, davon ${vollstaendig} ohne offene Punkte. Beste zuerst.`,
      ...zeilen,
      treffer.length > HOECHSTENS ? `… und ${treffer.length - HOECHSTENS} weitere.` : '',
      o.besitzer ? '' : 'Portal-Link: mit portal_zugang_anlegen (objekt_id, kunde_id) anlegen; verschicken nur auf ausdrücklichen Wunsch (senden=true).',
    ].filter(Boolean).join('\n')
  }

  if (name === 'passende_objekte') {
    const gesuchId = txt(input?.gesuch_id)
    const kundeId = txt(input?.kunde_id)
    if (!gesuchId && !kundeId) return 'Fehler: gesuch_id oder kunde_id fehlt. Ermittle sie mit gesuche_suchen.'
    let kunde: Kunde | undefined
    if (kundeId) {
      const r = await ladeAkte(supabase, mitarbeiter, kundeId)
      if (r.fehler) return r.fehler
      kunde = r.k
    } else {
      const alle = await ladeKunden(supabase)
      if (typeof alle === 'string') return alle
      kunde = alle.find((x) => darfAkte(mitarbeiter, x) && gesucheDesKontakts(x).some((g) => g.id === gesuchId))
      if (!kunde) return 'Fehler: Dieses Gesuch gibt es nicht. Ermittle die gesuch_id mit gesuche_suchen.'
    }
    const gesuche = gesucheDesKontakts(kunde!).filter((g) => (gesuchId ? g.id === gesuchId : !g.erledigt))
    if (!gesuche.length) return gesuchId ? 'Fehler: Dieses Gesuch gehört nicht zu dieser Akte. Ermittle die gesuch_id mit gesuche_suchen.' : `${kontaktName(kunde!)} hat kein offenes Gesuch. Gesuche werden in der Akte erfasst.`
    if (bestandVon(kunde!) === null) return `${kontaktName(kunde!)} ist ein privater Kontakt außerhalb des Immobilien-Ablaufs — dafür gibt es keinen Abgleich.`
    if (!bestandVon(kunde!) && !darfObjekte(mitarbeiter)) return nichtFreigegeben('immobilien', mitarbeiter.name)
    const objekte = await ladeObjekte(supabase)
    if (typeof objekte === 'string') return objekte
    const bestand = bestandFuer(mitarbeiter, kunde!, objekte)
    const bloecke: string[] = []
    for (const g of gesuche) {
      const kopf = `Gesuch „${g.titel || 'ohne Titel'}“ von ${kontaktName(kunde!)} (${gesuchKurz(g)}, gesuch_id=${g.id})${g.erledigt ? ' — als erledigt markiert' : ''}`
      const treffer = bestand.map((o) => ({ o, t: pruefe(g, o) })).filter((x): x is { o: AbgleichObjekt; t: Pruefung } => !!x.t)
      treffer.sort((a, b) => vergleichePruefungen(a.t, b.t))
      if (!treffer.length) {
        bloecke.push(`${kopf}: zurzeit kein passendes Objekt.`)
        continue
      }
      bloecke.push(
        [
          `${kopf}: ${treffer.length} passende${treffer.length === 1 ? 's' : ''} Objekt${treffer.length === 1 ? '' : 'e'}.`,
          ...treffer.slice(0, 15).map(({ o, t }, i) => `${i + 1}. ${o.bezeichnung || o.adresse || o.id}${o.adresse && o.bezeichnung ? `, ${o.adresse}` : ''} — ${t.offen.length ? 'zu prüfen' : 'passt vollständig'} | ${grundText(t)} (objekt_id=${o.id})`),
          treffer.length > 15 ? `… und ${treffer.length - 15} weitere.` : '',
        ].filter(Boolean).join('\n'),
      )
    }
    return bloecke.join('\n\n')
  }

  if (name === 'portal_zugang_anlegen') {
    if (mitarbeiter.nurPrivat === true) return NUR_HOLDING
    const r = await ladeObjekt(supabase, mitarbeiter, txt(input?.objekt_id))
    if (r.fehler) return r.fehler
    const objekt = r.o!
    if (adresse(objekt.privat_besitzer)) return NUR_HOLDING
    if (!darfObjekte(mitarbeiter)) return nichtFreigegeben('immobilien', mitarbeiter.name)

    let akte: Kunde | undefined
    const kundeId = txt(input?.kunde_id)
    if (kundeId) {
      if (SAMMELAKTEN.includes(kundeId)) return 'Fehler: Die Sammelakten (Ungeklärte Eingänge, Intern) sind keine Interessenten. Nimm die Akte des Interessenten.'
      const a = await ladeAkte(supabase, mitarbeiter, kundeId)
      if (a.fehler) return a.fehler
      akte = a.k
      if (istPrivat(akte)) return NUR_HOLDING
    }
    const name = (txt(input?.name) || (akte ? txt(akte.ansprechpartner) || txt(akte.firma) : '')).replace(/\s+/g, ' ')
    const email = (txt(input?.email) || txt(akte?.email)).toLowerCase()
    const telefon = txt(input?.telefon) || txt(akte?.telefon)
    const provision = txt(input?.provision) || PROVISION_VORSCHLAG
    if (name.length < 2) return 'Fehler: Name des Interessenten fehlt. Gib kunde_id oder name an.'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return `Fehler: „${email}“ ist keine gültige E-Mail-Adresse.`
    const senden = input?.senden === true
    if (senden && !email) return `Fehler: Für ${name} ist keine E-Mail-Adresse hinterlegt — ohne Adresse kann der Link nicht verschickt werden. Nichts angelegt. Entweder email angeben oder ohne senden anlegen und den Link selbst weitergeben.`
    if (senden && !k.sendeMail) return 'Fehler: Verschicken ist hier nicht möglich. Nichts angelegt. Ohne senden anlegen und den Link selbst weitergeben.'

    // Gibt es für ihn schon einen offenen Zugang zu diesem Objekt? Dann diesen nehmen (wie der Anfragenmanager).
    const { data: vorhandene, error: vFehler } = await supabase.from('objekt_freigaben').select('id, token, kunde_id, name, email, status, gueltig_bis').eq('objekt_id', objekt.id)
    if (vFehler) return `Fehler beim Laden der Zugänge: ${vFehler.message}`
    const offen = ((vorhandene ?? []) as Freigabe[]).find((f) => istOffen(f) && ((akte && f.kunde_id === akte.id) || (email && adresse(f.email) === email)))

    let freigabe: { id: string; token: string; status: string }
    if (offen) {
      freigabe = offen
    } else {
      const zeile = {
        id: crypto.randomUUID(),
        token: neuesToken(),
        objekt_id: objekt.id,
        kunde_id: akte?.id ?? null,
        kunde_bereich: akte?.bereich ?? null,
        name,
        email: email || null,
        telefon: telefon || null,
        provision,
        status: 'eingeladen',
        erstellt_von: mitarbeiter.name,
      }
      const { error } = await supabase.from('objekt_freigaben').insert(zeile)
      if (error) return `Fehler beim Anlegen des Zugangs: ${error.message}. Nichts angelegt.`
      freigabe = { id: zeile.id, token: zeile.token, status: 'eingeladen' }
      k.protokolliere(`Zugang zum Interessenten-Portal für ${name} zum Objekt „${objektName(objekt)}“ angelegt`)
    }

    const { data: einstellung } = await supabase.from('willkommen_einstellung').select('link_basis').eq('id', 1).maybeSingle()
    const link = portalLink(txt(einstellung?.link_basis) || LINK_BASIS_VORGABE, freigabe.token)

    let versand = ''
    let versandFehler = ''
    if (senden) {
      const mail = portalEinladung({ name, objektBezeichnung: txt(objekt.bezeichnung) || objektName(objekt), link, absender: mitarbeiter.name })
      try {
        const fehler = await k.sendeMail!({ an: email, anName: name, betreff: mail.betreff, text: mail.text, ...(akte ? { kundeId: akte.id, kundeBereich: txt(akte.bereich), kundeName: name } : {}) })
        if (fehler) versandFehler = fehler
      } catch (e) {
        versandFehler = e instanceof Error ? e.message : String(e)
      }
      if (!versandFehler) {
        versand = `Mail „${mail.betreff}“ mit dem Link an ${email} geschickt.`
        k.protokolliere(`Portal-Link zum Objekt „${objektName(objekt)}“ per Mail an ${name} <${email}> geschickt`)
      }
    }

    // Verlauf am Objekt (frisch lesen, nur die Spalte activities schreiben).
    if (!offen || versand) {
      const wasText = !offen ? `Zugang zum Interessenten-Portal für ${name}${email ? ` (${email})` : ''} angelegt` : `Portal-Link an ${name} (${email}) erneut geschickt`
      const { data: frisch } = await supabase.from('objekte').select('activities').eq('id', objekt.id).maybeSingle()
      if (frisch) {
        const verlauf = Array.isArray(frisch.activities) ? frisch.activities : []
        const eintrag = { id: `act_${crypto.randomUUID().slice(0, 10)}`, date: k.heute, text: `${wasText}${versand && !offen ? ' und per Mail geschickt' : ''} (per Telegram von ${mitarbeiter.name}).`, user: mitarbeiter.name }
        await supabase.from('objekte').update({ activities: [eintrag, ...verlauf] }).eq('id', objekt.id)
      }
    }

    const wer = `${name}${email ? ` (${email})` : ''}`
    const teile = [
      offen
        ? `${wer} hat schon einen offenen Zugang zum Interessenten-Portal von „${objektName(objekt)}“ (${STATUS_TEXT[offen.status] ?? offen.status}) — kein neuer angelegt.`
        : `Angelegt: Zugang zum Interessenten-Portal von „${objektName(objekt)}“ für ${wer}, Provision: ${provision}, 90 Tage gültig.`,
      `Link: ${link}`,
      versand,
      versandFehler ? `Nicht verschickt: ${versandFehler}. Der Zugang besteht trotzdem; den Link kann der Mitarbeiter selbst weitergeben.` : '',
      !senden ? (email ? 'Noch nicht verschickt — auf Wunsch mit senden=true per Mail an den Interessenten schicken.' : 'Keine E-Mail-Adresse hinterlegt — den Link selbst weitergeben.') : '',
      `(freigabe_id=${freigabe.id})`,
    ]
    return teile.filter(Boolean).join(' ')
  }

  return `Fehler: unbekanntes Werkzeug ${name}.`
}
