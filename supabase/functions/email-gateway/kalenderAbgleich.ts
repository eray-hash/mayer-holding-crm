// Abgleich Outlook-Kalender ↔ CRM-Kalender (eigene Termine des Mitarbeiters), beide Richtungen.
//
// - Outlook → CRM: alle Termine im Fenster 60 Tage zurück bis 18 Monate voraus (Änderungsabfrage calendarView/delta,
//   Stand in ms_konten.stand.kalenderDelta). Serientermine kommen als einzelne Termine (ms_serie). Sie gehören dem
//   Mitarbeiter allein; Kollegen sehen sie nur als „belegt“ (kalender_belegt).
// - CRM → Outlook: nur eigene Termine ohne Kollegen, ohne eingeladenen Kunden und ohne Akte eines Mayer-Bereichs
//   (Mayer-Termine gehören nicht ins private Microsoft-Konto; die gibt es weiter über das Kalender-Abo).
//   Ohne Teilnehmer, damit Outlook keine zweite Einladung verschickt.
// - Abgeglichen werden Titel, Ort, Beginn, Ende, ganztägig (Prüfsumme ms_hash). Die Notiz geht nur beim Anlegen mit.
// - Ändern/Löschen eines Outlook-Termins MIT Teilnehmern würde Microsoft an alle melden → nur über eine Vormerkung
//   (Bestätigung durch den Besitzer, siehe vormerkungen.ts). Gelöscht in Outlook → im CRM gelöscht, wenn dort unverändert.
// - Seiten (22.11.2026): Reicht die Zeit eines Laufs nicht für alle Seiten einer Runde (@odata.nextLink), merkt sich der
//   Lauf die nächste Seite (ms_konten.stand.kalenderWeiter) und macht beim nächsten Lauf dort weiter — vorher begann
//   er die Runde wieder von vorn und kam bei einem großen Kalender nie bis zum @odata.deltaLink (so am 20.11. beim
//   ersten Abgleich, der dann von Hand angestoßen werden musste).
// - Die eigenen CRM-Termine werden seitenweise gelesen (die Datenbank liefert höchstens 1000 Zeilen je Abfrage; ohne
//   das fehlten ab dem 1001. Termin die Zuordnungen: Änderungen und Löschungen aus Outlook kamen nicht mehr an).
import { berlinZuUtc, graph, isoZuMsZeit, MsFehler, msZeitZuIso } from '../_shared/microsoft.ts'
import { ERLAUBTE_ERINNERUNGEN } from './kalender.ts'
import { AUSFUEHRER, merkeVor } from './vormerkungen.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type MsTermin = {
  id: string
  subject?: string
  bodyPreview?: string
  location?: { displayName?: string }
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  isAllDay?: boolean
  isCancelled?: boolean
  isOrganizer?: boolean
  type?: string
  seriesMasterId?: string
  attendees?: { emailAddress?: { name?: string; address?: string }; status?: { response?: string } }[]
  lastModifiedDateTime?: string
  '@removed'?: { reason?: string }
}

export type CrmTermin = {
  id: string
  titel: string
  beschreibung: string
  ort: string
  beginn: string
  ende: string
  ganztags: boolean
  besitzer_email: string
  teilnehmer: string[]
  kunde_id: string | null
  kunde_bereich: string | null
  gast: { email?: string; eingeladen?: boolean } | null
  ms_id: string | null
  ms_hash: string | null
  ms_geaendert: string | null
  ms_teilnehmer: { name: string; email: string; antwort?: string }[] | null
  ms_serie?: boolean
  ms_vorgemerkt?: string | null
  geaendert_am?: string
}

const FENSTER_ZURUECK_TAGE = 60
const FENSTER_VORAUS_TAGE = 548
const NEUSTART_TAGE = 30 // danach wird das Fenster neu gesetzt (sonst würde es nie weiterwandern)

const iso = (d: string) => new Date(d).toISOString()
const zeitpunkt = (d: string) => Date.parse(d)

/** Angefangene Runde der Änderungsabfrage: nächste Seite, Beginn der Runde, volle Runde (neues Fenster) oder Änderungen. */
export type KalenderWeiter = { link: string; seit: string; voll: boolean }

/** Alle eigenen CRM-Termine, seitenweise nach id (die Datenbank liefert höchstens 1000 Zeilen je Abfrage). */
export async function ladeEigeneTermine(admin: Db, ich: string): Promise<CrmTermin[]> {
  const alle: CrmTermin[] = []
  for (let letzte = '', seite = 0; seite < 100; seite++) {
    let q = admin.from('termine').select(SPALTEN).eq('besitzer_email', ich).order('id', { ascending: true }).limit(1000)
    if (letzte) q = q.gt('id', letzte)
    const { data, error } = await q
    if (error) throw new Error(`Termine nicht lesbar: ${error.message}`)
    const teil = (data ?? []) as CrmTermin[]
    alle.push(...teil)
    if (teil.length < 1000) break
    letzte = teil[teil.length - 1].id
  }
  return alle
}

/** Erste Adresse einer vollen Runde: Fenster 60 Tage zurück bis 18 Monate voraus. */
export function fensterAdresse(jetzt: number): { url: string; vonTag: string; bisTag: string } {
  const vonTag = new Date(jetzt - FENSTER_ZURUECK_TAGE * 86400000).toISOString()
  const bisTag = new Date(jetzt + FENSTER_VORAUS_TAGE * 86400000).toISOString()
  return { url: `/me/calendarView/delta?startDateTime=${vonTag}&endDateTime=${bisTag}`, vonTag, bisTag }
}

/** Outlook-Termin → CRM-Felder (Zeiten als UTC-Zeitpunkte; ganztägig = Mitternacht deutscher Zeit). */
export function ausOutlook(t: MsTermin) {
  const ganztags = !!t.isAllDay
  const beginn = ganztags ? berlinZuUtc(`${String(t.start?.dateTime ?? '').slice(0, 10)}T00:00:00`) : msZeitZuIso(t.start)
  const ende = ganztags ? berlinZuUtc(`${String(t.end?.dateTime ?? '').slice(0, 10)}T00:00:00`) : msZeitZuIso(t.end)
  return {
    titel: (t.subject ?? '').trim() || '(ohne Titel)',
    ort: (t.location?.displayName ?? '').trim(),
    beginn: beginn ?? new Date().toISOString(),
    ende: ende ?? beginn ?? new Date().toISOString(),
    ganztags,
  }
}

/**
 * Einzelne Termine einer Serie (occurrence) liefert die Änderungsabfrage von Microsoft ohne Betreff, Ort und
 * Text — die stehen nur am Serien-Haupttermin. Fehlt der Betreff, werden sie von dort übernommen.
 * (Am 20.11.2026 kamen so 780 Serien-Termine von Hasan als „(ohne Titel)“ ins CRM.)
 */
export function mitSerienKopf(t: MsTermin, kopf: Pick<MsTermin, 'subject' | 'location' | 'bodyPreview'> | null | undefined): MsTermin {
  if (!kopf || (t.subject ?? '').trim()) return t
  return {
    ...t,
    subject: kopf.subject,
    location: (t.location?.displayName ?? '').trim() ? t.location : kopf.location,
    bodyPreview: (t.bodyPreview ?? '').trim() ? t.bodyPreview : kopf.bodyPreview,
  }
}

/** CRM-Termin → Outlook-Inhalt (ohne Teilnehmer). */
export function nachOutlook(a: Pick<CrmTermin, 'titel' | 'ort' | 'beginn' | 'ende' | 'ganztags'> & { beschreibung?: string }, mitNotiz = false): Record<string, unknown> {
  const tag = (x: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(x))
  return {
    subject: a.titel.slice(0, 255),
    location: { displayName: a.ort ?? '' },
    isAllDay: a.ganztags,
    start: a.ganztags ? { dateTime: `${tag(a.beginn)}T00:00:00`, timeZone: 'W. Europe Standard Time' } : isoZuMsZeit(a.beginn),
    end: a.ganztags ? { dateTime: `${tag(a.ende)}T00:00:00`, timeZone: 'W. Europe Standard Time' } : isoZuMsZeit(a.ende),
    ...(mitNotiz && a.beschreibung ? { body: { contentType: 'text', content: a.beschreibung } } : {}),
  }
}

export async function terminHash(a: Pick<CrmTermin, 'titel' | 'ort' | 'beginn' | 'ende' | 'ganztags'>): Promise<string> {
  const kern = JSON.stringify([(a.titel ?? '').trim(), (a.ort ?? '').trim(), iso(a.beginn).slice(0, 16), iso(a.ende).slice(0, 16), !!a.ganztags])
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(kern)))
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Darf dieser CRM-Termin ins private Outlook? */
export function darfNachOutlook(a: CrmTermin): boolean {
  if ((a.teilnehmer ?? []).length > 0) return false
  if (a.gast?.email) return false
  if (a.kunde_id && a.kunde_bereich && a.kunde_bereich !== 'privat') return false
  return true
}

const teilnehmerVon = (t: MsTermin) =>
  (t.attendees ?? []).map((x) => ({ name: x.emailAddress?.name ?? '', email: String(x.emailAddress?.address ?? '').toLowerCase(), antwort: x.status?.response ?? '' })).filter((x) => x.email)

const SPALTEN = 'id, titel, beschreibung, ort, beginn, ende, ganztags, besitzer_email, teilnehmer, kunde_id, kunde_bereich, gast, ms_id, ms_hash, ms_geaendert, ms_teilnehmer, ms_serie, ms_vorgemerkt, geaendert_am'

export type KalenderBericht = { vonMicrosoft: number; nachMicrosoft: number; geloescht: number; konflikte: number; vorgemerkt: number; fehler: string[] }

export async function gleicheKalenderAb(admin: Db, ich: string, budgetMs = 60_000): Promise<KalenderBericht> {
  const start = Date.now()
  const b: KalenderBericht = { vonMicrosoft: 0, nachMicrosoft: 0, geloescht: 0, konflikte: 0, vorgemerkt: 0, fehler: [] }
  const { data: konto } = await admin.from('ms_konten').select('stand').eq('login_email', ich).maybeSingle()
  const stand = (konto?.stand ?? {}) as Record<string, unknown>
  let delta = stand.kalenderDelta as { link: string; seit: string } | undefined
  if (delta && Date.now() - Date.parse(delta.seit) > NEUSTART_TAGE * 86400000) delta = undefined
  let weiter = (stand.kalenderWeiter ?? undefined) as KalenderWeiter | undefined
  // Angefangene Runde verwerfen, wenn sie zu alt ist oder (als Änderungsrunde) zu einem abgelaufenen Fenster gehört.
  if (weiter && (!weiter.link || !(Date.now() - Date.parse(weiter.seit) <= NEUSTART_TAGE * 86400000) || (!weiter.voll && !delta))) weiter = undefined

  let crm: CrmTermin[]
  try {
    crm = await ladeEigeneTermine(admin, ich)
  } catch (e) {
    // Ohne vollständige Liste lieber gar nicht abgleichen (sonst fehlen Zuordnungen).
    b.fehler.push(e instanceof Error ? e.message : String(e))
    const { data: jetzt } = await admin.from('ms_konten').select('stand').eq('login_email', ich).maybeSingle()
    await admin.from('ms_konten').update({ stand: { ...((jetzt?.stand ?? {}) as Record<string, unknown>), kalenderLauf: { am: new Date().toISOString(), ...b } } }).eq('login_email', ich)
    return b
  }
  const nachMsId = new Map(crm.filter((a) => a.ms_id).map((a) => [a.ms_id!, a]))
  const behandelt = new Set<string>()
  const fenster = fensterAdresse(Date.now())
  const { vonTag, bisTag } = fenster
  // Volle Runde (neues Fenster) ODER Fortsetzung einer vollen Runde; „erster“ = volle Runde, die in DIESEM Lauf beginnt —
  // nur dann sind am Ende alle Outlook-Termine des Fensters gesehen (für das Lösen verwaister Verknüpfungen unten).
  const voll = weiter ? weiter.voll : !delta
  const erster = !delta && !weiter
  const rundeSeit = weiter?.seit ?? (voll ? new Date().toISOString() : delta!.seit)
  let fertig = false
  let abgelaufen = false

  // ---- 1) Outlook → CRM ----
  const gesehen = new Set<string>()
  // Serien-Haupttermine (Betreff, Ort, Text) je Lauf nur einmal holen.
  const serienKoepfe = new Map<string, Promise<MsTermin | null>>()
  const serienKopf = (id: string) => {
    if (!serienKoepfe.has(id)) {
      serienKoepfe.set(
        id,
        graph<MsTermin>(admin, ich, `/me/events/${encodeURIComponent(id)}?$select=subject,location,bodyPreview`).catch((e) => {
          b.fehler.push(`Serie ohne Betreff (${e instanceof Error ? e.message : e})`)
          return null
        }),
      )
    }
    return serienKoepfe.get(id)!
  }
  let url = ''
  try {
    url = weiter?.link ?? delta?.link ?? fenster.url
    for (let seite = 0; seite < 60 && url && Date.now() - start < budgetMs; seite++) {
      const d = await graph<{ value?: MsTermin[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(admin, ich, url, {
        kopf: { prefer: 'outlook.timezone="W. Europe Standard Time", odata.maxpagesize=100' },
      })
      for (const roh of d.value ?? []) {
        const t = !roh['@removed'] && !(roh.subject ?? '').trim() && roh.seriesMasterId ? mitSerienKopf(roh, await serienKopf(roh.seriesMasterId)) : roh
        gesehen.add(t.id)
        const vorhanden = nachMsId.get(t.id)
        if (t['@removed'] || t.isCancelled) {
          if (!vorhanden || behandelt.has(t.id)) continue
          if ((await terminHash(vorhanden)) !== vorhanden.ms_hash) {
            // Im CRM geändert: nicht löschen, nur Verknüpfung lösen.
            await admin.from('termine').update({ ms_id: null, ms_hash: null, ms_geaendert: null }).eq('id', vorhanden.id)
            continue
          }
          await admin.from('termine').update({ ms_id: null }).eq('id', vorhanden.id) // ohne Löschvermerk
          const { error } = await admin.from('termine').delete().eq('id', vorhanden.id).eq('besitzer_email', ich)
          if (!error) b.geloescht++
          continue
        }
        if (!t.start?.dateTime) continue // Delta liefert manchmal nur Kennungen — beim nächsten vollen Lauf kommt der Rest
        const felder = ausOutlook(t)
        const extra = { ms_teilnehmer: teilnehmerVon(t), ms_serie: t.type === 'occurrence' || t.type === 'exception', ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString() }
        if (!vorhanden) {
          const bisBeginn = (Date.parse(felder.beginn) - Date.now()) / 60000
          const schonVorbei = ERLAUBTE_ERINNERUNGEN.filter((m) => bisBeginn <= m)
          const { error } = await admin.from('termine').insert({
            ...felder,
            beschreibung: (t.bodyPreview ?? '').trim().slice(0, 2000),
            besitzer_email: ich,
            teilnehmer: [],
            quelle: 'outlook',
            erinnert: { [ich]: schonVorbei },
            ...extra,
            ms_id: t.id,
            ms_hash: await terminHash(felder),
          })
          if (error && error.code !== '23505') b.fehler.push(`Neu aus Outlook: ${error.message}`)
          else if (!error) b.vonMicrosoft++
          behandelt.add(t.id)
          continue
        }
        // „(ohne Titel)“ aus einem früheren Lauf (Serien-Termine ohne Betreff): Titel jetzt nachtragen.
        const titelNachtragen = vorhanden.titel === '(ohne Titel)' && felder.titel !== '(ohne Titel)'
        const msNeu = titelNachtragen || !vorhanden.ms_geaendert || Date.parse(t.lastModifiedDateTime ?? '') > Date.parse(vorhanden.ms_geaendert)
        if (!msNeu) continue
        if ((await terminHash(vorhanden)) !== vorhanden.ms_hash) {
          b.konflikte++
          if ((Date.parse(vorhanden.geaendert_am ?? '') || 0) > (Date.parse(t.lastModifiedDateTime ?? '') || 0)) continue // CRM jünger → unten nach Outlook
        }
        const zeitAnders = iso(vorhanden.beginn) !== iso(felder.beginn) || iso(vorhanden.ende) !== iso(felder.ende) || vorhanden.ganztags !== felder.ganztags
        const bisBeginn = (Date.parse(felder.beginn) - Date.now()) / 60000
        const { error } = await admin
          .from('termine')
          .update({
            ...felder,
            ...extra,
            ms_hash: await terminHash(felder),
            geaendert_am: new Date().toISOString(),
            ...(zeitAnders ? { erinnert: { [ich]: ERLAUBTE_ERINNERUNGEN.filter((m) => bisBeginn <= m) } } : {}),
          })
          .eq('id', vorhanden.id)
        if (error) b.fehler.push(`Aus Outlook: ${error.message}`)
        else {
          b.vonMicrosoft++
          behandelt.add(t.id)
          Object.assign(vorhanden, felder, { ms_hash: await terminHash(felder) })
        }
      }
      if (d['@odata.deltaLink']) {
        delta = { link: d['@odata.deltaLink'], seit: voll ? rundeSeit : (delta?.seit ?? rundeSeit) }
        fertig = true
      }
      url = d['@odata.nextLink'] ?? ''
    }
  } catch (e) {
    if (e instanceof MsFehler && e.status === 410) abgelaufen = true
    b.fehler.push(`Outlook-Kalender: ${e instanceof Error ? e.message : e}`)
  }
  // Stand der Runde: fertig → nichts offen; Zeit oder Seiten aufgebraucht bzw. Fehler mitten in der Runde → nächste
  // Seite merken (beim ersten Seitenabruf einer neuen Runde einfach neu beginnen); abgelaufen (410) → alles neu.
  if (abgelaufen) {
    delta = undefined
    weiter = undefined
  } else if (fertig || !url) weiter = undefined
  else if (url !== delta?.link && url !== fenster.url) weiter = { link: url, seit: rundeSeit, voll }
  // Erster voller Lauf: CRM-Termine mit Outlook-Kennung im Fenster, die Outlook nicht mehr kennt, waren in Outlook gelöscht.
  if (erster && fertig) {
    for (const a of crm) {
      if (!a.ms_id || gesehen.has(a.ms_id) || a.ms_id && behandelt.has(a.ms_id)) continue
      if (zeitpunkt(a.beginn) < zeitpunkt(vonTag) || zeitpunkt(a.beginn) > zeitpunkt(bisTag)) continue
      await admin.from('termine').update({ ms_id: null, ms_hash: null, ms_geaendert: null }).eq('id', a.id)
      a.ms_id = null
    }
  }

  // ---- 2) Im CRM gelöscht → in Outlook löschen (mit Teilnehmern nur nach Bestätigung) ----
  const { data: loeschungen } = await admin.from('ms_loeschungen').select('id, ms_id, ms_liste_id').eq('login_email', ich).eq('art', 'termin').limit(100)
  for (const l of (loeschungen ?? []) as { id: number; ms_id: string; ms_liste_id: string | null }[]) {
    try {
      if (l.ms_liste_id === 'mit_teilnehmern') {
        await merkeVor(admin, ich, { art: 'termin_loeschen_ms', beschreibung: 'Outlook-Termin mit Teilnehmern absagen (im CRM gelöscht)', parameter: { msId: l.ms_id, bezug: 'im CRM gelöschter Termin' }, quelle: 'abgleich' })
        b.vorgemerkt++
      } else {
        await graph(admin, ich, `/me/events/${encodeURIComponent(l.ms_id)}`, { methode: 'DELETE' })
        b.geloescht++
      }
    } catch (e) {
      if (!(e instanceof MsFehler && e.status === 404)) {
        b.fehler.push(`Löschen in Outlook: ${e instanceof Error ? e.message : e}`)
        continue
      }
    }
    await admin.from('ms_loeschungen').delete().eq('id', l.id)
  }

  // ---- 3) CRM → Outlook ----
  for (const a of crm) {
    if (Date.now() - start > budgetMs) break
    if (a.ms_id && behandelt.has(a.ms_id)) continue
    if (zeitpunkt(a.ende) < zeitpunkt(vonTag) || zeitpunkt(a.beginn) > zeitpunkt(bisTag)) continue
    try {
      const hash = await terminHash(a)
      if (!a.ms_id) {
        if (!darfNachOutlook(a)) continue
        const t = await graph<MsTermin>(admin, ich, '/me/events', { methode: 'POST', daten: nachOutlook(a, true) })
        await admin.from('termine').update({ ms_id: t.id, ms_hash: hash, ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString(), ms_teilnehmer: [] }).eq('id', a.id)
        b.nachMicrosoft++
        continue
      }
      if (hash === a.ms_hash) continue
      if ((a.ms_teilnehmer ?? []).length > 0) {
        // Microsoft würde allen Teilnehmern eine Änderung schicken → nur nach Bestätigung, und nur einmal vormerken.
        if (a.ms_vorgemerkt === hash) continue
        await merkeVor(admin, ich, {
          art: 'termin_aendern_ms',
          beschreibung: `Outlook-Termin „${a.titel}“ ändern — die Teilnehmer bekommen eine Änderung`,
          parameter: { msId: a.ms_id, termin: { titel: a.titel, ort: a.ort, beginn: a.beginn, ende: a.ende, ganztags: a.ganztags }, terminId: a.id, hash, bezug: a.titel },
          quelle: 'abgleich',
        })
        await admin.from('termine').update({ ms_vorgemerkt: hash }).eq('id', a.id)
        b.vorgemerkt++
        continue
      }
      const t = await graph<MsTermin>(admin, ich, `/me/events/${encodeURIComponent(a.ms_id)}`, { methode: 'PATCH', daten: nachOutlook(a) })
      await admin.from('termine').update({ ms_hash: hash, ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString() }).eq('id', a.id)
      b.nachMicrosoft++
    } catch (e) {
      if (e instanceof MsFehler && e.status === 404 && a.ms_id) await admin.from('termine').update({ ms_id: null, ms_hash: null, ms_geaendert: null }).eq('id', a.id)
      else b.fehler.push(`Nach Outlook („${a.titel.slice(0, 40)}“): ${e instanceof Error ? e.message : e}`)
    }
  }

  const { data: jetzt } = await admin.from('ms_konten').select('stand').eq('login_email', ich).maybeSingle()
  await admin
    .from('ms_konten')
    .update({ stand: { ...((jetzt?.stand ?? {}) as Record<string, unknown>), kalenderDelta: delta ?? null, kalenderWeiter: weiter ?? null, kalenderLauf: { am: new Date().toISOString(), ...b, fehler: b.fehler.slice(0, 5) } } })
    .eq('login_email', ich)
  return b
}

// Ausführer für die Vormerkungen des Kalender-Abgleichs (Bestätigung durch den Besitzer).
AUSFUEHRER.termin_aendern_ms = async (admin, ich, p) => {
  const termin = (p.termin ?? {}) as Pick<CrmTermin, 'titel' | 'ort' | 'beginn' | 'ende' | 'ganztags'>
  const t = await graph<MsTermin>(admin, ich, `/me/events/${encodeURIComponent(String(p.msId))}`, { methode: 'PATCH', daten: nachOutlook(termin) })
  await admin.from('termine').update({ ms_hash: String(p.hash ?? ''), ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString(), ms_vorgemerkt: null }).eq('id', String(p.terminId ?? '')).eq('besitzer_email', ich)
  return 'In Outlook geändert, die Teilnehmer wurden benachrichtigt.'
}
AUSFUEHRER.termin_loeschen_ms = async (admin, ich, p) => {
  await graph(admin, ich, `/me/events/${encodeURIComponent(String(p.msId))}/cancel`, { methode: 'POST', daten: { comment: 'Der Termin muss leider entfallen.' } }).catch(async (e) => {
    // Nur der Organisator kann absagen; als Teilnehmer wird der Termin einfach entfernt.
    if (e instanceof MsFehler && (e.status === 400 || e.status === 403)) await graph(admin, ich, `/me/events/${encodeURIComponent(String(p.msId))}`, { methode: 'DELETE' })
    else throw e
  })
  return 'In Outlook abgesagt.'
}
