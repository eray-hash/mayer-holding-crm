// Outlook/Hotmail live im Bereich Privat (Vorbild: microsoft.py des Desktop-Assistenten).
//
// - Gelesen wird direkt bei Microsoft; gespeichert wird nichts — außer der Mitarbeiter legt eine Mail bewusst bei
//   einem seiner privaten Kontakte ab (dann wie eine Mail des persönlichen Postfachs in `eingegangene_emails`).
// - Mayer-Geschäft wird ausgeblendet (Entscheidung vom 20.11.2026): Mails von/an Mayer-Adressen und ganze
//   Unterhaltungen, aus denen eine Mail an Mayer ging (z. B. an info@/immo@ weitergeleitet). Regeln: _shared/mailRegeln.ts.
//   Die Kennungen dieser Unterhaltungen merkt sich `ms_konten.stand.mayerUnterhaltungen` (nur Kennungen, keine Inhalte).
// - Gilt immer nur für den eigenen Login (der Aufrufer wird in privatMicrosoft.ts ermittelt).
import { graph, graphAlle, MsFehler } from '../_shared/microsoft.ts'
import { einordnen, filtereMayer, istMayerMail, mayerUnterhaltungenAus, offenerPunkt, standardMayerDomains, type GraphMail, type MayerRegel } from '../_shared/mailRegeln.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export const OUTLOOK_AKTIONEN = new Set([
  'outlook_ordner',
  'outlook_liste',
  'outlook_suche',
  'outlook_mail',
  'outlook_verlauf',
  'outlook_anhaenge',
  'outlook_anhang',
  'outlook_fahne',
  'outlook_gelesen',
  'outlook_verschieben',
  'outlook_offene_punkte',
  'outlook_ablegen',
  'outlook_mayer_regel',
  'outlook_mayer_regel_speichern',
])

const FELDER = 'id,conversationId,internetMessageId,subject,from,sender,replyTo,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,isRead,webLink,inferenceClassification,flag,parentFolderId'
const ALS_TEXT = { prefer: 'outlook.body-content-type="text"' }
const ANHANG_ABLAGE = 'postfach-anhaenge'
const ANHANG_HOECHSTENS = 12 * 1024 * 1024
const ANHAENGE_JE_MAIL = 16 * 1024 * 1024
const UNTERHALTUNGEN_HOECHSTENS = 5000
const UNTERHALTUNGEN_ALTER_MS = 20 * 60 * 1000

type Mail = GraphMail & {
  id: string
  internetMessageId?: string
  webLink?: string
  parentFolderId?: string
  body?: { content?: string; contentType?: string }
}

// ---------- Mayer-Regel ----------

type Einstellungen = { mayer_domains: string[] | null; mayer_adressen: string[] }

async function ladeEinstellungen(admin: Db, ich: string): Promise<Einstellungen> {
  const { data } = await admin.from('privat_einstellungen').select('mayer_domains, mayer_adressen').eq('login_email', ich).maybeSingle()
  return { mayer_domains: data?.mayer_domains ?? null, mayer_adressen: data?.mayer_adressen ?? [] }
}

/** Vorgaben aus dem CRM: Adressen aller Postfächer und Mitarbeiter (ohne die eigene), Firmen-Domains ohne Freemail. */
async function vorgaben(admin: Db, ich: string): Promise<{ domains: string[]; adressen: string[] }> {
  const [{ data: postfaecher }, { data: leute }, { data: konto }] = await Promise.all([
    admin.from('postfaecher').select('adresse'),
    admin.from('mitarbeiter').select('email'),
    admin.from('ms_konten').select('ms_adresse').eq('login_email', ich).maybeSingle(),
  ])
  const msAdresse = String(konto?.ms_adresse ?? '').toLowerCase()
  const eigene = new Set([ich, msAdresse].filter(Boolean))
  const pf = ((postfaecher ?? []) as { adresse: string }[]).map((p) => String(p.adresse).toLowerCase())
  const ma = ((leute ?? []) as { email: string }[]).map((m) => String(m.email ?? '').toLowerCase()).filter((e) => e.includes('@'))
  const adressen = [...new Set([...pf, ...ma])].filter((a) => !eigene.has(a)).sort()
  // Nur die Domain des verbundenen Microsoft-Kontos selbst ausnehmen (falls privat und keine Freemail-Domain) —
  // nie eine Firmen-Domain, unter der ein CRM-Postfach läuft. Die Domain des CRM-Logins bleibt Mayer-Domain.
  const pfDomains = new Set(pf.map((a) => a.split('@')[1] ?? ''))
  const msDomain = msAdresse.split('@')[1] ?? ''
  const ausnahmen = msDomain && !pfDomains.has(msDomain) ? [msDomain] : []
  return { domains: standardMayerDomains(pf, ma, ausnahmen), adressen }
}

async function ladeKontoStand(admin: Db, ich: string): Promise<Record<string, unknown>> {
  const { data } = await admin.from('ms_konten').select('stand').eq('login_email', ich).maybeSingle()
  return (data?.stand ?? {}) as Record<string, unknown>
}

async function speichereKontoStand(admin: Db, ich: string, aenderung: Record<string, unknown>): Promise<void> {
  const stand = await ladeKontoStand(admin, ich)
  await admin.from('ms_konten').update({ stand: { ...stand, ...aenderung } }).eq('login_email', ich)
}

/** Die Mayer-Regel für diesen Login; frischt die gemerkten Mayer-Unterhaltungen aus „Gesendet“ auf, wenn sie älter als 20 Min. sind. */
export async function ladeMayerRegel(admin: Db, ich: string): Promise<MayerRegel> {
  const [e, v, stand] = await Promise.all([ladeEinstellungen(admin, ich), vorgaben(admin, ich), ladeKontoStand(admin, ich)])
  const regel: MayerRegel = {
    domains: e.mayer_domains ?? v.domains,
    adressen: [...new Set([...v.adressen, ...e.mayer_adressen.map((a) => a.toLowerCase())])],
    unterhaltungen: new Set((stand.mayerUnterhaltungen as string[] | undefined) ?? []),
  }
  const zuletzt = Date.parse(String(stand.mayerStand ?? '')) || 0
  if (Date.now() - zuletzt > UNTERHALTUNGEN_ALTER_MS) {
    try {
      // Erster Lauf: das letzte Jahr; danach nur, was seit dem letzten Blick gesendet wurde (mit Überlappung).
      const ab = zuletzt ? new Date(zuletzt - 60 * 60 * 1000) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      const gesendet = await graphAlle<Mail>(
        admin,
        ich,
        `/me/mailFolders/sentitems/messages?$select=conversationId,toRecipients,ccRecipients,bccRecipients&$top=100&$filter=sentDateTime ge ${ab.toISOString()}`,
        2000,
      )
      for (const k of mayerUnterhaltungenAus(gesendet, regel)) regel.unterhaltungen.add(k)
      await speichereKontoStand(admin, ich, { mayerUnterhaltungen: [...regel.unterhaltungen].slice(-UNTERHALTUNGEN_HOECHSTENS), mayerStand: new Date().toISOString() })
    } catch (err) {
      // Ohne frische Liste trotzdem weiter — Absender/Empfänger-Regel greift ja weiterhin.
      console.error('Mayer-Unterhaltungen nicht aufgefrischt', err instanceof Error ? err.message : err)
    }
  }
  return regel
}

// ---------- Darstellung ----------

function adresse(a: { emailAddress?: { name?: string | null; address?: string | null } | null } | null | undefined) {
  return { name: a?.emailAddress?.name ?? '', adresse: String(a?.emailAddress?.address ?? '').toLowerCase() }
}

export function kurz(m: Mail) {
  return {
    id: m.id,
    unterhaltung: m.conversationId ?? '',
    betreff: m.subject || '(ohne Betreff)',
    von: adresse(m.from),
    an: (m.toRecipients ?? []).map(adresse),
    cc: (m.ccRecipients ?? []).map(adresse),
    datum: m.receivedDateTime ?? '',
    vorschau: (m.bodyPreview ?? '').slice(0, 240),
    hatAnhaenge: !!m.hasAttachments,
    gelesen: !!m.isRead,
    fahne: m.flag?.flagStatus ?? 'notFlagged',
    relevant: m.inferenceClassification !== 'other',
    art: einordnen(m),
    link: m.webLink ?? '',
  }
}

function voll(m: Mail) {
  return { ...kurz(m), text: String(m.body?.content ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() }
}

// ---------- Prüfungen ----------

const KENNUNG = /^[A-Za-z0-9=_\-+/]{8,400}$/
function kennung(x: unknown, was = 'Mail'): string {
  const s = String(x ?? '')
  if (!KENNUNG.test(s)) throw new MsFehler(400, `Ungültige ${was}-Kennung.`)
  return encodeURIComponent(s)
}
const ORDNER_NAMEN = new Set(['inbox', 'sentitems', 'drafts', 'deleteditems', 'junkemail', 'archive'])
function ordner(x: unknown): string {
  const s = String(x ?? 'inbox')
  return ORDNER_NAMEN.has(s.toLowerCase()) ? s.toLowerCase() : kennung(s, 'Ordner')
}

const AUSGEBLENDET = 'Diese Mail gehört zum Mayer-Geschäft und wird im privaten Bereich nicht angezeigt.'

async function ladeMail(admin: Db, ich: string, id: unknown, regel: MayerRegel, mitText = false): Promise<Mail> {
  const m = await graph<Mail>(admin, ich, `/me/messages/${kennung(id)}?$select=${FELDER}${mitText ? ',body' : ''}`, { kopf: mitText ? ALS_TEXT : undefined })
  if (istMayerMail(m, regel)) throw new MsFehler(404, AUSGEBLENDET)
  return m
}

// ---------- Aktionen ----------

export async function outlookAktion(admin: Db, ich: string, body: Record<string, unknown>): Promise<unknown> {
  const a = String(body.action)

  if (a === 'outlook_mayer_regel') {
    const [e, v] = await Promise.all([ladeEinstellungen(admin, ich), vorgaben(admin, ich)])
    const stand = await ladeKontoStand(admin, ich)
    return {
      domains: e.mayer_domains ?? v.domains,
      vorgabeDomains: v.domains,
      eigeneDomains: e.mayer_domains !== null,
      adressen: e.mayer_adressen,
      crmAdressen: v.adressen.length,
      unterhaltungen: ((stand.mayerUnterhaltungen as string[] | undefined) ?? []).length,
    }
  }

  if (a === 'outlook_mayer_regel_speichern') {
    const liste = (x: unknown, muster: RegExp) =>
      Array.isArray(x) ? [...new Set(x.map((d) => String(d ?? '').trim().toLowerCase().replace(/^@/, '')).filter((d) => muster.test(d)))].slice(0, 200) : []
    const domains = body.vorgabe === true ? null : liste(body.domains, /^[a-z0-9.-]+\.[a-z]{2,}$/)
    const adressen = liste(body.adressen, /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/)
    const { error } = await admin.from('privat_einstellungen').upsert({ login_email: ich, mayer_domains: domains, mayer_adressen: adressen, geaendert_am: new Date().toISOString() })
    if (error) throw new Error(error.message)
    return { ok: true }
  }

  if (a === 'outlook_ordner') {
    const ergebnis: { id: string; name: string; pfad: string; ungelesen: number; gesamt: number }[] = []
    const sammle = async (pfad: string, vorsatz: string, tiefe: number) => {
      for (const o of await graphAlle<Record<string, unknown>>(admin, ich, `${pfad}?$top=100&$select=id,displayName,childFolderCount,unreadItemCount,totalItemCount`, 300)) {
        const name = String(o.displayName ?? '')
        ergebnis.push({ id: String(o.id), name, pfad: `${vorsatz}${name}`, ungelesen: Number(o.unreadItemCount ?? 0), gesamt: Number(o.totalItemCount ?? 0) })
        if (Number(o.childFolderCount) > 0 && tiefe < 3) await sammle(`/me/mailFolders/${encodeURIComponent(String(o.id))}/childFolders`, `${vorsatz}${name} › `, tiefe + 1)
      }
    }
    await sammle('/me/mailFolders', '', 0)
    return { ordner: ergebnis }
  }

  const regel = await ladeMayerRegel(admin, ich)

  if (a === 'outlook_liste') {
    const anzahl = Math.min(Math.max(Number(body.anzahl) || 30, 5), 100)
    const ab = Math.max(Number(body.ab) || 0, 0)
    const nurUngelesen = body.nurUngelesen === true ? '&$filter=isRead eq false' : ''
    const daten = await graph<{ value?: Mail[]; '@odata.nextLink'?: string }>(
      admin,
      ich,
      `/me/mailFolders/${ordner(body.ordner)}/messages?$select=${FELDER}&$top=${anzahl}&$skip=${ab}&$orderby=receivedDateTime desc${nurUngelesen}`,
    )
    const { sichtbar, ausgeblendet } = filtereMayer(daten.value ?? [], regel)
    return { mails: sichtbar.map(kurz), ausgeblendet, weiter: !!daten['@odata.nextLink'], naechstesAb: ab + anzahl }
  }

  if (a === 'outlook_suche') {
    const begriff = String(body.begriff ?? '').replace(/["\\]/g, ' ').trim().slice(0, 200)
    if (begriff.length < 2) throw new MsFehler(400, 'Bitte mindestens zwei Zeichen eingeben.')
    const anzahl = Math.min(Math.max(Number(body.anzahl) || 50, 10), 250)
    // Volltextsuche über alle Ordner (Absender, Empfänger, Betreff, Text, Anhänge) — der ganze Verlauf, nicht nur Abgeholtes.
    const mails = await graphAlle<Mail>(admin, ich, `/me/messages?$search="${encodeURIComponent(begriff)}"&$select=${FELDER}&$top=50`, anzahl)
    mails.sort((x, y) => String(y.receivedDateTime ?? '').localeCompare(String(x.receivedDateTime ?? '')))
    const { sichtbar, ausgeblendet } = filtereMayer(mails, regel)
    return { mails: sichtbar.map(kurz), ausgeblendet }
  }

  if (a === 'outlook_mail') {
    const m = await ladeMail(admin, ich, body.id, regel, true)
    if (body.alsGelesen === true && !m.isRead) await graph(admin, ich, `/me/messages/${kennung(m.id)}`, { methode: 'PATCH', daten: { isRead: true } }).catch(() => undefined)
    return { mail: voll(m) }
  }

  if (a === 'outlook_verlauf') {
    const k = String(body.unterhaltung ?? '').replace(/'/g, "''")
    if (!k || k.length > 400) throw new MsFehler(400, 'Ungültige Unterhaltung.')
    if (regel.unterhaltungen.has(String(body.unterhaltung))) throw new MsFehler(404, AUSGEBLENDET)
    const mails = await graphAlle<Mail>(admin, ich, `/me/messages?$filter=${encodeURIComponent(`conversationId eq '${k}'`)}&$select=${FELDER},body&$top=50`, 100, ALS_TEXT)
    if (mails.some((m) => istMayerMail(m, regel))) throw new MsFehler(404, AUSGEBLENDET)
    mails.sort((x, y) => String(x.receivedDateTime ?? '').localeCompare(String(y.receivedDateTime ?? '')))
    return { mails: mails.map(voll) }
  }

  if (a === 'outlook_anhaenge') {
    const m = await ladeMail(admin, ich, body.id, regel)
    const liste = await graphAlle<Record<string, unknown>>(admin, ich, `/me/messages/${kennung(m.id)}/attachments?$select=id,name,contentType,size,isInline`, 100)
    return {
      anhaenge: liste
        .filter((x) => x['@odata.type'] === '#microsoft.graph.fileAttachment' && !x.isInline)
        .map((x) => ({ id: String(x.id), name: String(x.name ?? 'Anhang'), typ: String(x.contentType ?? ''), groesse: Number(x.size ?? 0) })),
    }
  }

  if (a === 'outlook_anhang') {
    const m = await ladeMail(admin, ich, body.id, regel)
    const x = await graph<Record<string, unknown>>(admin, ich, `/me/messages/${kennung(m.id)}/attachments/${kennung(body.anhangId, 'Anhang')}`)
    if (x['@odata.type'] !== '#microsoft.graph.fileAttachment') throw new MsFehler(400, 'Nur Datei-Anhänge lassen sich öffnen.')
    if (Number(x.size ?? 0) > 20 * 1024 * 1024) throw new MsFehler(413, 'Der Anhang ist zu groß (über 20 MB) — bitte in Outlook öffnen.')
    return { name: String(x.name ?? 'Anhang'), typ: String(x.contentType ?? 'application/octet-stream'), inhalt: String(x.contentBytes ?? '') }
  }

  if (a === 'outlook_fahne') {
    const status = String(body.status)
    if (!['complete', 'flagged', 'notFlagged'].includes(status)) throw new MsFehler(400, 'Ungültiger Status.')
    const m = await ladeMail(admin, ich, body.id, regel)
    await graph(admin, ich, `/me/messages/${kennung(m.id)}`, { methode: 'PATCH', daten: { flag: { flagStatus: status } } })
    return { ok: true }
  }

  if (a === 'outlook_gelesen') {
    const m = await ladeMail(admin, ich, body.id, regel)
    await graph(admin, ich, `/me/messages/${kennung(m.id)}`, { methode: 'PATCH', daten: { isRead: body.gelesen !== false } })
    return { ok: true }
  }

  if (a === 'outlook_verschieben') {
    // Löschen ist kein Verschieben: der Papierkorb (und alles darunter) geht nur über eine bestätigte Vormerkung.
    const ziel = String(body.ordner ?? '')
    if (['deleteditems', 'recoverableitemsdeletions'].includes(ziel.toLowerCase())) throw new MsFehler(400, 'Löschen nur nach Bestätigung.')
    if (!ORDNER_NAMEN.has(ziel.toLowerCase())) {
      const papierkorb = await graph<{ id: string }>(admin, ich, '/me/mailFolders/deleteditems?$select=id')
      let pruef: string | undefined = ziel
      for (let tiefe = 0; pruef && tiefe < 6; tiefe++) {
        if (pruef === papierkorb.id) throw new MsFehler(400, 'Löschen nur nach Bestätigung.')
        const o: { parentFolderId?: string } = await graph<{ parentFolderId?: string }>(admin, ich, `/me/mailFolders/${kennung(pruef, 'Ordner')}?$select=parentFolderId`).catch(() => ({}))
        pruef = o.parentFolderId && o.parentFolderId !== pruef ? o.parentFolderId : undefined
      }
    }
    const m = await ladeMail(admin, ich, body.id, regel)
    const neu = await graph<Mail>(admin, ich, `/me/messages/${kennung(m.id)}/move`, { methode: 'POST', daten: { destinationId: decodeURIComponent(ordner(body.ordner)) } })
    return { ok: true, id: neu.id }
  }

  if (a === 'outlook_offene_punkte') {
    const tage = Math.min(Math.max(Number(body.tage) || 60, 7), 365)
    const ab = new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString()
    const [posteingang, markiert] = await Promise.all([
      graphAlle<Mail>(admin, ich, `/me/mailFolders/inbox/messages?$select=${FELDER}&$top=100&$filter=receivedDateTime ge ${ab}&$orderby=receivedDateTime desc`, 600),
      graphAlle<Mail>(admin, ich, `/me/messages?$select=${FELDER}&$top=100&$filter=flag/flagStatus eq 'flagged'`, 300),
    ])
    const gesehen = new Set<string>()
    const alle = [...markiert, ...posteingang].filter((m) => (gesehen.has(m.id) ? false : (gesehen.add(m.id), true)))
    const { sichtbar, ausgeblendet } = filtereMayer(alle.filter(offenerPunkt), regel)
    sichtbar.sort((x, y) => String(y.receivedDateTime ?? '').localeCompare(String(x.receivedDateTime ?? '')))
    return { mails: sichtbar.map(kurz), ausgeblendet, tage }
  }

  if (a === 'outlook_ablegen') {
    const kundeId = String(body.kundeId ?? '')
    const { data: kunde } = await admin.from('kunden').select('id, firma, ansprechpartner, bereich, verantwortlich_email').eq('id', kundeId).maybeSingle()
    if (!kunde || kunde.bereich !== 'privat' || String(kunde.verantwortlich_email ?? '').toLowerCase() !== ich) throw new MsFehler(403, 'Ablegen geht nur bei deinen eigenen privaten Kontakten.')
    const m = await ladeMail(admin, ich, body.id, regel, true)
    const fach = `ms_${await kurzHash(ich)}`
    const messageId = `${fach}:${m.internetMessageId || m.id}`
    const kundeName = String(kunde.firma || kunde.ansprechpartner || 'Kontakt')
    const { data: schonDa } = await admin.from('eingegangene_emails').select('id').eq('message_id', messageId).maybeSingle()
    if (schonDa) {
      await admin.from('eingegangene_emails').update({ zugewiesener_kunde_id: kunde.id, zugewiesener_bereich: 'privat', zugewiesener_kunde_name: kundeName }).eq('id', schonDa.id).eq('besitzer_email', ich)
      return { ok: true, schonAbgelegt: true }
    }
    // Anhänge mitnehmen (wie beim persönlichen Postfach: nicht öffentliche Ablage, Link nur für den Besitzer).
    const anhaenge: { filename: string; size: number; contentType: string; url: string }[] = []
    const ausgelassen: string[] = []
    if (m.hasAttachments) {
      const liste = await graphAlle<Record<string, unknown>>(admin, ich, `/me/messages/${kennung(m.id)}/attachments?$select=id,name,contentType,size,isInline`, 50)
      let summe = 0
      const mailTeil = await kurzHash(m.id)
      for (const x of liste) {
        if (x['@odata.type'] !== '#microsoft.graph.fileAttachment' || x.isInline) continue
        const name = String(x.name ?? 'anhang')
        const groesse = Number(x.size ?? 0)
        if (groesse > ANHANG_HOECHSTENS || summe + groesse > ANHAENGE_JE_MAIL) {
          ausgelassen.push(`${name} (${(groesse / 1024 / 1024).toFixed(1)} MB)`)
          continue
        }
        const voll = await graph<Record<string, unknown>>(admin, ich, `/me/messages/${kennung(m.id)}/attachments/${kennung(x.id, 'Anhang')}`)
        const bytes = Uint8Array.from(atob(String(voll.contentBytes ?? '')), (c) => c.charCodeAt(0))
        summe += bytes.length
        const pfad = `${fach}/${mailTeil}/${anhaenge.length + 1}_${name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120)}`
        const { error } = await admin.storage.from(ANHANG_ABLAGE).upload(pfad, bytes, { contentType: String(x.contentType ?? 'application/octet-stream'), upsert: true })
        if (error) {
          ausgelassen.push(name)
          continue
        }
        anhaenge.push({ filename: name, size: bytes.length, contentType: String(x.contentType ?? ''), url: `privat:${pfad}` })
      }
    }
    const vermerk = ausgelassen.length ? `\n\n[Nicht ins CRM übernommen: ${ausgelassen.join(', ')}. Bitte in Outlook öffnen.]` : ''
    const text = String(m.body?.content ?? m.bodyPreview ?? '')
    const { error } = await admin.from('eingegangene_emails').insert({
      message_id: messageId,
      von: adresse(m.from).adresse || 'unbekannt',
      von_name: adresse(m.from).name || adresse(m.from).adresse || 'Unbekannt',
      betreff: m.subject || '(ohne Betreff)',
      mail_datum: m.receivedDateTime ?? new Date().toISOString(),
      ausschnitt: text.slice(0, 20000 - vermerk.length) + vermerk,
      anhaenge: anhaenge.length ? anhaenge : null,
      rohdaten: { quelle: 'microsoft', an: (m.toRecipients ?? []).map((r) => adresse(r).adresse).join(', '), cc: (m.ccRecipients ?? []).map((r) => adresse(r).adresse).join(', '), link: m.webLink ?? '' },
      postfach_id: fach,
      besitzer_email: ich,
      relevanz: 'kunde',
      zugewiesener_kunde_id: kunde.id,
      zugewiesener_bereich: 'privat',
      zugewiesener_kunde_name: kundeName,
    })
    if (error && error.code !== '23505') throw new Error(`Mail konnte nicht abgelegt werden: ${error.message}`)
    return { ok: true, anhaenge: anhaenge.length, ausgelassen }
  }

  throw new MsFehler(400, 'Unbekannte Aktion')
}

async function kurzHash(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
