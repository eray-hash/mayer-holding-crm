// Abgleich Microsoft To Do ↔ persönliche CRM-Aufgaben (Bereich Privat: todos mit bereich IS NULL des Besitzers).
//
// - Beide Richtungen (Entscheidung vom 20.11.2026). Microsoft-Seite über die Änderungsabfrage (…/tasks/delta) je Liste,
//   Stand in ms_konten.stand.todoDelta. CRM-Seite: Spalten ms_id, ms_liste_id, ms_liste_name, ms_geaendert, ms_hash,
//   ms_crm_geaendert (Auslöser todo_ms_aenderung setzt sie bei jeder Änderung eines abgeglichenen Feldes).
// - Geändert = Inhalt weicht vom Stand des letzten Abgleichs ab (ms_hash). Beide Seiten geändert: die jüngere gewinnt.
// - Löschen: in To Do gelöscht → im CRM gelöscht (nur wenn dort seitdem unverändert). Im CRM gelöscht → Auslöser
//   todo_ms_loeschung merkt es in ms_loeschungen → in To Do gelöscht. Wandert eine Aufgabe in einen Mayer-Bereich,
//   verschwindet sie aus To Do (Mayer-Daten gehören nicht ins private Microsoft-Konto).
// - Neu aus To Do kommen nur offene Aufgaben; neue CRM-Aufgaben landen in der Standardliste von To Do.
import { graph, graphAlle, isoZuMsZeit, MsFehler, msZeitZuIso } from '../_shared/microsoft.ts'

// deno-lint-ignore no-explicit-any
type Db = any

export type MsAufgabe = {
  id: string
  title?: string
  status?: string
  importance?: string
  body?: { content?: string; contentType?: string }
  dueDateTime?: { dateTime?: string; timeZone?: string } | null
  reminderDateTime?: { dateTime?: string; timeZone?: string } | null
  isReminderOn?: boolean
  completedDateTime?: { dateTime?: string; timeZone?: string } | null
  lastModifiedDateTime?: string
  '@removed'?: { reason?: string }
}

export type CrmAufgabe = {
  id: string
  aufgabe: string
  erledigt_am: string | null
  erledigen_bis: string | null
  prio: string | null
  aktueller_stand: string | null
  erinnern_um: string | null
  bereich?: string | null
  besitzer_email?: string
  ms_id?: string | null
  ms_liste_id?: string | null
  ms_hash?: string | null
  ms_geaendert?: string | null
  ms_crm_geaendert?: string | null
}

/** Datum (JJJJ-MM-TT) eines Zeitpunkts in deutscher Zeit. */
export function berlinDatum(iso: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso))
}

/** Die abgeglichenen Felder in vergleichbarer Form (Wichtigkeit nur hoch/nicht hoch, Erinnerung auf die Minute). */
export function kern(a: Pick<CrmAufgabe, 'aufgabe' | 'erledigt_am' | 'erledigen_bis' | 'prio' | 'aktueller_stand' | 'erinnern_um'>) {
  return {
    t: (a.aufgabe ?? '').trim(),
    e: a.erledigt_am ? 1 : 0,
    f: a.erledigen_bis ?? '',
    w: a.prio === 'A' ? 1 : 0,
    n: (a.aktueller_stand ?? '').trim(),
    r: a.erinnern_um ? new Date(a.erinnern_um).toISOString().slice(0, 16) : '',
  }
}

export async function abgleichHash(a: Parameters<typeof kern>[0]): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(kern(a)))))
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** To-Do-Aufgabe → CRM-Felder. `bisher` = vorhandene CRM-Aufgabe (für Priorität und Erledigt-Datum). */
export function ausMicrosoft(t: MsAufgabe, bisher?: Partial<CrmAufgabe>) {
  const erledigt = t.status === 'completed'
  const faellig = msZeitZuIso(t.dueDateTime)
  const erinnerung = t.isReminderOn ? msZeitZuIso(t.reminderDateTime) : null
  const fertigAm = msZeitZuIso(t.completedDateTime)
  const hoch = t.importance === 'high'
  const prio = hoch ? 'A' : bisher?.prio === 'A' ? 'B' : (bisher?.prio ?? null)
  return {
    aufgabe: (t.title ?? '').trim() || '(ohne Titel)',
    erledigt_am: erledigt ? (bisher?.erledigt_am ?? (fertigAm ? berlinDatum(fertigAm) : berlinDatum(new Date().toISOString()))) : null,
    erledigen_bis: faellig ? berlinDatum(faellig) : null,
    prio,
    aktueller_stand: (t.body?.content ?? '').trim() || null,
    erinnern_um: erinnerung,
  }
}

/** CRM-Aufgabe → Inhalt für To Do (POST/PATCH). */
export function nachMicrosoft(a: CrmAufgabe): Record<string, unknown> {
  return {
    title: (a.aufgabe ?? '').slice(0, 255) || '(ohne Titel)',
    status: a.erledigt_am ? 'completed' : 'notStarted',
    importance: a.prio === 'A' ? 'high' : 'normal',
    body: { content: a.aktueller_stand ?? '', contentType: 'text' },
    dueDateTime: a.erledigen_bis ? { dateTime: `${a.erledigen_bis}T00:00:00`, timeZone: 'W. Europe Standard Time' } : null,
    isReminderOn: !!a.erinnern_um,
    reminderDateTime: a.erinnern_um ? isoZuMsZeit(a.erinnern_um) : null,
  }
}

const SPALTEN = 'id, aufgabe, erledigt_am, erledigen_bis, prio, aktueller_stand, erinnern_um, bereich, besitzer_email, ms_id, ms_liste_id, ms_hash, ms_geaendert, ms_crm_geaendert'

function neueId(): string {
  return `todo_ms${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
}

const heute = () => berlinDatum(new Date().toISOString())

export type TodoBericht = { vonMicrosoft: number; nachMicrosoft: number; geloescht: number; konflikte: number; fehler: string[] }

/** Ein Abgleichlauf für einen Login. Wirft nur, wenn Microsoft gar nicht erreichbar ist. */
export async function gleicheTodosAb(admin: Db, ich: string, budgetMs = 60_000): Promise<TodoBericht> {
  const start = Date.now()
  const b: TodoBericht = { vonMicrosoft: 0, nachMicrosoft: 0, geloescht: 0, konflikte: 0, fehler: [] }
  const { data: konto } = await admin.from('ms_konten').select('stand').eq('login_email', ich).maybeSingle()
  const stand = (konto?.stand ?? {}) as Record<string, unknown>
  const deltas = { ...((stand.todoDelta ?? {}) as Record<string, string>) }

  const listen = await graphAlle<{ id: string; displayName?: string; wellknownListName?: string }>(admin, ich, '/me/todo/lists?$top=100', 200)
  const standard = listen.find((l) => l.wellknownListName === 'defaultList') ?? listen[0]
  const listenName = new Map(listen.map((l) => [l.id, l.displayName ?? '']))

  // Eigene, abgeglichene CRM-Aufgaben (auch solche, die inzwischen in einem Bereich liegen).
  // Seitenweise: Die Datenbank liefert höchstens 1000 Zeilen je Abfrage (Hasan hat über 2.600 Aufgaben).
  const crm: CrmAufgabe[] = []
  for (let letzte = '', seite = 0; seite < 50; seite++) {
    let q = admin.from('todos').select(SPALTEN).eq('besitzer_email', ich).order('id', { ascending: true }).limit(1000)
    if (letzte) q = q.gt('id', letzte)
    const { data: zeilen, error } = await q
    if (error) throw new Error(`Aufgaben nicht lesbar: ${error.message}`)
    const teil = (zeilen ?? []) as CrmAufgabe[]
    crm.push(...teil)
    if (teil.length < 1000) break
    letzte = teil[teil.length - 1].id
  }
  const nachMsId = new Map(crm.filter((a) => a.ms_id).map((a) => [a.ms_id!, a]))
  const behandelt = new Set<string>()

  // ---- 1) Microsoft → CRM ----
  const entfernt: { id: string; liste: string }[] = []
  for (const liste of listen) {
    if (Date.now() - start > budgetMs) break
    let url = deltas[liste.id] ?? `/me/todo/lists/${encodeURIComponent(liste.id)}/tasks/delta`
    try {
      for (let seite = 0; seite < 40 && url; seite++) {
        const d = await graph<{ value?: MsAufgabe[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string }>(admin, ich, url)
        for (const t of d.value ?? []) {
          if (t['@removed']) {
            entfernt.push({ id: t.id, liste: liste.id })
            continue
          }
          const vorhanden = nachMsId.get(t.id)
          if (!vorhanden) {
            if (t.status === 'completed') continue // Erledigtes nicht nachträglich ins CRM holen
            const felder = ausMicrosoft(t)
            const zeile = { id: neueId(), besitzer_email: ich, bereich: null, erstellt_am: heute(), ...felder, ms_id: t.id, ms_liste_id: liste.id, ms_liste_name: listenName.get(liste.id) ?? '', ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString(), ms_hash: await abgleichHash(felder) }
            const { error } = await admin.from('todos').insert(zeile)
            if (error && error.code !== '23505') b.fehler.push(`Neu aus To Do: ${error.message}`)
            else if (!error) {
              b.vonMicrosoft++
              nachMsId.set(t.id, zeile as CrmAufgabe)
              behandelt.add(t.id)
            }
            continue
          }
          if (vorhanden.bereich) continue // liegt jetzt in einem Mayer-Bereich → wird unten aus To Do entfernt
          const msNeu = !vorhanden.ms_geaendert || Date.parse(t.lastModifiedDateTime ?? '') > Date.parse(vorhanden.ms_geaendert)
          if (!msNeu) continue
          const crmGeaendert = (await abgleichHash(vorhanden)) !== vorhanden.ms_hash
          if (crmGeaendert) {
            b.konflikte++
            const crmZeit = Date.parse(vorhanden.ms_crm_geaendert ?? '') || 0
            if (crmZeit > (Date.parse(t.lastModifiedDateTime ?? '') || 0)) {
              // CRM ist jünger → wird unten nach To Do geschrieben. Wurde die Aufgabe in To Do in eine andere Liste
              // verschoben, die neue Liste trotzdem merken (sonst gälte sie als gelöscht und entstünde doppelt).
              if (vorhanden.ms_liste_id !== liste.id) {
                await admin.from('todos').update({ ms_liste_id: liste.id, ms_liste_name: listenName.get(liste.id) ?? '' }).eq('id', vorhanden.id)
                vorhanden.ms_liste_id = liste.id
              }
              continue
            }
          }
          const felder = ausMicrosoft(t, vorhanden)
          const { error } = await admin
            .from('todos')
            .update({ ...felder, ms_liste_id: liste.id, ms_liste_name: listenName.get(liste.id) ?? '', ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString(), ms_hash: await abgleichHash(felder) })
            .eq('id', vorhanden.id)
          if (error) b.fehler.push(`Aus To Do: ${error.message}`)
          else {
            b.vonMicrosoft++
            behandelt.add(t.id)
            Object.assign(vorhanden, felder, { ms_hash: await abgleichHash(felder), ms_liste_id: liste.id })
          }
        }
        if (d['@odata.deltaLink']) deltas[liste.id] = d['@odata.deltaLink']
        url = d['@odata.nextLink'] ?? ''
      }
    } catch (e) {
      if (e instanceof MsFehler && e.status === 410) delete deltas[liste.id] // Stand abgelaufen → nächster Lauf beginnt neu
      b.fehler.push(`Liste „${liste.displayName}“: ${e instanceof Error ? e.message : e}`)
    }
  }
  // Gelöschte Listen: Stände aufräumen.
  for (const id of Object.keys(deltas)) if (!listenName.has(id)) delete deltas[id]

  // In To Do gelöscht (nicht nur in eine andere Liste verschoben): im CRM löschen, wenn dort seitdem unverändert.
  for (const r of entfernt) {
    const a = nachMsId.get(r.id)
    if (!a || behandelt.has(r.id) || a.ms_liste_id !== r.liste) continue
    if (a.bereich || (await abgleichHash(a)) !== a.ms_hash) {
      // Im CRM geändert oder schon in einem Bereich: nicht löschen, nur die Verknüpfung lösen (wird ggf. neu angelegt).
      await admin.from('todos').update({ ms_id: null, ms_liste_id: null, ms_hash: null, ms_geaendert: null }).eq('id', a.id)
      continue
    }
    // Löschen ohne neuen Eintrag in ms_loeschungen: erst Verknüpfung lösen, dann löschen.
    await admin.from('todos').update({ ms_id: null, ms_hash: null }).eq('id', a.id)
    const { error } = await admin.from('todos').delete().eq('id', a.id).eq('besitzer_email', ich)
    if (!error) b.geloescht++
  }

  // ---- 2) Im CRM gelöscht → in To Do löschen ----
  const { data: loeschungen } = await admin.from('ms_loeschungen').select('id, ms_id, ms_liste_id').eq('login_email', ich).eq('art', 'todo').limit(100)
  for (const l of (loeschungen ?? []) as { id: number; ms_id: string; ms_liste_id: string | null }[]) {
    try {
      if (l.ms_liste_id) await graph(admin, ich, `/me/todo/lists/${encodeURIComponent(l.ms_liste_id)}/tasks/${encodeURIComponent(l.ms_id)}`, { methode: 'DELETE' })
      b.geloescht++
    } catch (e) {
      if (!(e instanceof MsFehler && e.status === 404)) {
        b.fehler.push(`Löschen in To Do: ${e instanceof Error ? e.message : e}`)
        continue
      }
    }
    await admin.from('ms_loeschungen').delete().eq('id', l.id)
  }

  // ---- 3) CRM → Microsoft ----
  for (const a of crm) {
    if (Date.now() - start > budgetMs) break
    if (a.ms_id && behandelt.has(a.ms_id)) continue
    try {
      if (a.bereich) {
        // In einen Mayer-Bereich verschoben: aus dem privaten To Do nehmen.
        if (a.ms_id && a.ms_liste_id) {
          await graph(admin, ich, `/me/todo/lists/${encodeURIComponent(a.ms_liste_id)}/tasks/${encodeURIComponent(a.ms_id)}`, { methode: 'DELETE' }).catch((e) => {
            if (!(e instanceof MsFehler && e.status === 404)) throw e
          })
          await admin.from('todos').update({ ms_id: null, ms_liste_id: null, ms_liste_name: null, ms_hash: null, ms_geaendert: null }).eq('id', a.id)
          b.geloescht++
        }
        continue
      }
      const hash = await abgleichHash(a)
      if (!a.ms_id) {
        if (a.erledigt_am || !standard) continue // Erledigtes nicht nachträglich nach To Do
        const t = await graph<MsAufgabe>(admin, ich, `/me/todo/lists/${encodeURIComponent(standard.id)}/tasks`, { methode: 'POST', daten: nachMicrosoft(a) })
        await admin.from('todos').update({ ms_id: t.id, ms_liste_id: standard.id, ms_liste_name: standard.displayName ?? '', ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString(), ms_hash: hash }).eq('id', a.id)
        b.nachMicrosoft++
      } else if (hash !== a.ms_hash && a.ms_liste_id) {
        const t = await graph<MsAufgabe>(admin, ich, `/me/todo/lists/${encodeURIComponent(a.ms_liste_id)}/tasks/${encodeURIComponent(a.ms_id)}`, { methode: 'PATCH', daten: nachMicrosoft(a) })
        await admin.from('todos').update({ ms_geaendert: t.lastModifiedDateTime ?? new Date().toISOString(), ms_hash: hash }).eq('id', a.id)
        b.nachMicrosoft++
      }
    } catch (e) {
      if (e instanceof MsFehler && e.status === 404 && a.ms_id) {
        // In To Do nicht mehr da: Verknüpfung lösen, nächster Lauf legt sie neu an (falls noch offen).
        await admin.from('todos').update({ ms_id: null, ms_liste_id: null, ms_hash: null, ms_geaendert: null }).eq('id', a.id)
      } else b.fehler.push(`Nach To Do („${a.aufgabe.slice(0, 40)}“): ${e instanceof Error ? e.message : e}`)
    }
  }

  const { data: jetzt } = await admin.from('ms_konten').select('stand').eq('login_email', ich).maybeSingle()
  await admin
    .from('ms_konten')
    .update({ stand: { ...((jetzt?.stand ?? {}) as Record<string, unknown>), todoDelta: deltas, todoLauf: { am: new Date().toISOString(), ...b, fehler: b.fehler.slice(0, 5) } } })
    .eq('login_email', ich)
  return b
}

