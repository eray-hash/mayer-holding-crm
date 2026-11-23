// Werkzeug aufgaben_uebersicht: wer muss was bis wann erledigen — dieselbe Zuordnung wie die Seite
// „Aufgaben nach Mitarbeiter“ im CRM (Kern in ../_shared/aufgabenKern.ts). Der Assistent arbeitet
// mit vollen Datenbankrechten, deshalb filtert diese Datei selbst nach den Rechten des Fragenden:
// Bereichs-To-dos, Kundenakten, Objekte und Projekte nur aus freigegebenen Bereichen; eigene
// To-do-Listen nur die eigene und die ausdrücklich für ihn freigegebenen; private Kontakte und private
// Objekte nur die eigenen (darfAkte / darfObjekt), die von Kollegen nie. Private Projekte
// (projekte.besitzer_email) nur ihr Besitzer. Im privaten Assistenten (nurPrivat) nur seine eigene
// To-do-Liste, seine privaten Kontakte, Objekte und Projekte — keine Bereichslisten, keine Listen von Kollegen.
// Offene Wiedervorlagen (Tabelle wiedervorlagen, je Kundenakte) nur aus freigegebenen Bereichen —
// darfBereich wie die Zeilenregel der Datenbank; private Kontakte haben keine.

import { alsIso, LAGE_TEXT, OBJEKT_ABGESCHLOSSEN, nachPerson, ordneAufgabenZu, ordneZu, personenNamen, type RohAufgabe } from '../_shared/aufgabenKern.ts'
import { darfAkte, darfBereich, darfObjekt, type RechteMitarbeiter } from './rechte.ts'
import { alleZeilen } from '../_shared/alleZeilen.ts'

const BEREICH_NAME: Record<string, string> = {
  beratung: 'Unternehmensberatung',
  immobilien: 'Immobilien',
  immobilienkunden: 'Immobilien (Kontakte)',
  erben: 'Erben',
  betriebsuebergabe: 'Betriebsübergabe',
  betriebsformen: 'Betriebsformen',
  akademie: 'Akademie',
  finanzierungen: 'Finanzierungen',
  privat: 'Privat (nur für dich)',
}

// deno-lint-ignore no-explicit-any
type Supa = any
type Fragender = RechteMitarbeiter & { name: string; email?: string | null }

function deDatum(iso?: string): string {
  const m = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Offene To-dos seitenweise (die Datenbank liefert höchstens 1000 Zeilen je Abfrage; Hasan hat über 2.600). */
// deno-lint-ignore no-explicit-any
async function alleOffenenTodos(supabase: any): Promise<{ data: any[] }> {
  // deno-lint-ignore no-explicit-any
  const alle: any[] = []
  const spalten = 'id, aufgabe, kunde_projekt, zustaendig, erledigen_bis, geplante_wiedervorlage, erledigt_am, bereich, besitzer_email'
  const basis = () => supabase.from('todos').select(spalten).is('erledigt_am', null)
  // Test-Doubles kennen order/range nicht — dann einfach die eine Abfrage.
  const probe = basis()
  if (typeof probe.order !== 'function' || typeof probe.order('id').range !== 'function') return { data: (await basis()).data ?? [] }
  for (let von = 0; von < 50_000; von += 1000) {
    const { data } = await basis().order('id', { ascending: true }).range(von, von + 999)
    alle.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { data: alle }
}

export async function aufgabenUebersicht(
  supabase: Supa,
  fragender: Fragender,
  // deno-lint-ignore no-explicit-any
  input: any,
  heute: string,
): Promise<string> {
  const [{ data: team }, { data: todos }, { data: freigaben }, { data: kunden }, objekteRes, { data: projekte }, wvRes] = await Promise.all([
    supabase.from('mitarbeiter').select('name, email').eq('aktiv', true),
    alleOffenenTodos(supabase),
    supabase.from('todo_freigaben').select('besitzer_email, empfaenger_email'),
    alleZeilen(() => supabase.from('kunden').select('id, bereich, firma, ansprechpartner, verantwortlich, follow_up, verantwortlich_email')),
    supabase.from('objekte').select('id, bezeichnung, verantwortlich, follow_up, status, privat_besitzer'),
    supabase.from('projekte').select('id, bereich, name, verantwortlich, meilensteine, besitzer_email'),
    // Im privaten Assistenten gibt es keine Wiedervorlagen (private Kontakte haben keine).
    fragender.nurPrivat === true ? Promise.resolve({ data: [] }) : alleZeilen(() => supabase.from('wiedervorlagen').select('id, kunde_id, bereich, titel, faellig, verantwortlich, quelle').is('erledigt_am', null)),
  ])
  const teamListe = ((team ?? []) as { name: string; email: string | null }[]).filter((m) => m.name)
  const nameZuEmail = new Map(teamListe.filter((m) => m.email).map((m) => [String(m.email).toLowerCase(), m.name]))
  const eigeneEmail = String(fragender.email ?? '').toLowerCase()
  const nurPrivat = fragender.nurPrivat === true
  const freigegeben = new Set(
    ((nurPrivat ? [] : freigaben ?? []) as { besitzer_email: string; empfaenger_email: string }[])
      .filter((f) => String(f.empfaenger_email).toLowerCase() === eigeneEmail)
      .map((f) => String(f.besitzer_email).toLowerCase()),
  )

  const roh: RohAufgabe[] = []
  // deno-lint-ignore no-explicit-any
  for (const t of (todos ?? []) as any[]) {
    if (t.bereich) {
      if (!darfBereich(fragender, t.bereich)) continue
    } else {
      const besitzer = String(t.besitzer_email ?? '').toLowerCase()
      if (!besitzer || (besitzer !== eigeneEmail && !freigegeben.has(besitzer))) continue
    }
    roh.push({
      id: `todo:${t.id}`,
      art: 'todo',
      titel: t.aufgabe || '(ohne Titel)',
      bezug: t.kunde_projekt || undefined,
      bereich: t.bereich ? BEREICH_NAME[t.bereich] ?? t.bereich : 'eigene To-do-Liste',
      zustaendig: t.zustaendig,
      ersatzPerson: t.bereich ? undefined : nameZuEmail.get(String(t.besitzer_email).toLowerCase()),
      datum: t.erledigen_bis || t.geplante_wiedervorlage,
      datumArt: t.erledigen_bis ? 'erledigen bis' : t.geplante_wiedervorlage ? 'Wiedervorlage' : undefined,
      privat: !t.bereich,
    })
  }
  // deno-lint-ignore no-explicit-any
  for (const k of (kunden ?? []) as any[]) {
    const fu = k.follow_up
    if (!fu || fu.done || !(String(fu.note ?? '').trim() || fu.date) || !darfAkte(fragender, k)) continue
    roh.push({
      id: `fu:${k.id}`,
      art: 'followup',
      titel: String(fu.note ?? '').trim() || 'Follow-up',
      bezug: [k.firma, k.ansprechpartner && k.ansprechpartner !== k.firma ? k.ansprechpartner : ''].filter(Boolean).join(' · '),
      bereich: BEREICH_NAME[k.bereich] ?? k.bereich,
      zustaendig: k.verantwortlich,
      datum: fu.date,
      datumArt: 'Follow-up',
    })
  }
  // Wiedervorlagen der Kundenakten (von Hand oder vom CRM selbst angelegt). Schlägt die Abfrage fehl,
  // bleibt die Übersicht wie bisher.
  // deno-lint-ignore no-explicit-any
  const kundeVon = new Map(((kunden ?? []) as any[]).map((k) => [k.id, k]))
  // deno-lint-ignore no-explicit-any
  for (const w of (wvRes?.data ?? []) as any[]) {
    if (!w || !darfBereich(fragender, w.bereich)) continue
    const k = kundeVon.get(w.kunde_id)
    roh.push({
      id: `wv:${w.id}`,
      art: 'followup',
      titel: `${String(w.titel ?? '').trim() || 'Wiedervorlage'}${w.quelle === 'regel' ? ' (automatisch)' : ''}`,
      bezug: k ? [k.firma, k.ansprechpartner && k.ansprechpartner !== k.firma ? k.ansprechpartner : ''].filter(Boolean).join(' · ') : undefined,
      bereich: BEREICH_NAME[w.bereich] ?? w.bereich,
      zustaendig: w.verantwortlich,
      ersatzPerson: k?.verantwortlich ?? undefined,
      datum: w.faellig,
      datumArt: 'Wiedervorlage',
    })
  }
  // deno-lint-ignore no-explicit-any
  for (const o of (objekteRes.data ?? []) as any[]) {
    const fu = o.follow_up
    if (!fu || fu.done || !(String(fu.note ?? '').trim() || fu.date) || OBJEKT_ABGESCHLOSSEN.includes(o.status) || !darfObjekt(fragender, o)) continue
    roh.push({ id: `fu:${o.id}`, art: 'followup', titel: String(fu.note ?? '').trim() || 'Follow-up', bezug: `Objekt ${o.bezeichnung}`, bereich: o.privat_besitzer ? 'Privat (nur für dich)' : 'Immobilien', zustaendig: o.verantwortlich, datum: fu.date, datumArt: 'Follow-up' })
  }
  // deno-lint-ignore no-explicit-any
  for (const p of (projekte ?? []) as any[]) {
    const projektBesitzer = String(p.besitzer_email ?? '').trim().toLowerCase()
    if (projektBesitzer ? projektBesitzer !== eigeneEmail || !eigeneEmail : !darfBereich(fragender, p.bereich)) continue
    // deno-lint-ignore no-explicit-any
    for (const m of (p.meilensteine ?? []) as any[]) {
      // deno-lint-ignore no-explicit-any
      for (const a of (m.aufgaben ?? []) as any[]) {
        if (a.status === 'erledigt') continue
        roh.push({
          id: `projekt:${p.id}:${a.id}`,
          art: 'projekt',
          titel: a.titel || '(ohne Titel)',
          bezug: `Projekt ${p.name}`,
          bereich: projektBesitzer ? 'Privat (nur für dich)' : BEREICH_NAME[p.bereich] ?? 'intern',
          zustaendig: a.zustaendig,
          ersatzPerson: p.verantwortlich,
          datum: a.wiedervorlage,
          datumArt: 'Wiedervorlage',
        })
      }
    }
  }

  let liste = ordneAufgabenZu(roh, teamListe.map((m) => m.name), heute)

  // Filter: Person
  const gefragt = String(input?.mitarbeiter ?? '').trim()
  let personText = 'alle Mitarbeiter'
  if (gefragt) {
    const ich = /^(ich|mir|mich|meine?|selbst)$/i.test(gefragt)
    const { personen } = ich ? { personen: [fragender.name] } : ordneZu(gefragt, personenNamen(teamListe.map((m) => m.name)))
    if (personen.length > 0) {
      liste = liste.filter((a) => personen.includes(a.person))
      personText = personen.join(', ')
    } else {
      const t = gefragt.toLowerCase()
      liste = liste.filter((a) => a.person.toLowerCase().includes(t))
      personText = `„${gefragt}“ (kein eindeutiger Mitarbeiter, gesucht nach dem Namen)`
    }
  }
  // Filter: bis Datum (Überfälliges zählt immer dazu)
  const bis = alsIso(input?.bis_datum)
  if (bis) liste = liste.filter((a) => a.datumIso && a.datumIso <= bis)
  else if (input?.ohne_datum === false) liste = liste.filter((a) => a.datumIso)
  // Filter: Art
  const arten = Array.isArray(input?.arten) ? (input.arten as string[]) : null
  if (arten && arten.length) liste = liste.filter((a) => arten.includes(a.art))

  const gruppen = nachPerson(liste)
  const kopf = [
    `Heute: ${deDatum(heute)}. Offene Aufgaben für ${personText}${bis ? `, fällig bis ${deDatum(bis)} (inkl. überfällig)` : ''}.`,
    'Quellen: To-do-Listen, Follow-ups und Wiedervorlagen in Kunden- und Objektakten, Projektaufgaben — nur, was dieser Mitarbeiter sehen darf. Im CRM: Seite „Aufgaben nach Mitarbeiter“ (Symbol mit Häkchenliste oben rechts).',
  ]
  if (gruppen.length === 0) return [...kopf, '', 'Keine offenen Aufgaben für diese Auswahl.'].join('\n')
  const zeilen: string[] = [...kopf]
  const ART: Record<string, string> = { todo: 'To-do', followup: 'Follow-up', projekt: 'Projekt' }
  for (const g of gruppen) {
    zeilen.push('', `${g.person.toUpperCase()}: ${g.aufgaben.length} offen${g.ueberfaellig ? `, ${g.ueberfaellig} überfällig` : ''}${g.heute ? `, ${g.heute} heute fällig` : ''}`)
    const max = 40
    for (const a of g.aufgaben.slice(0, max)) {
      const datum = a.datumIso ? `${a.datumArt ?? 'fällig'} ${deDatum(a.datumIso)}${a.lage === 'ueberfaellig' || a.lage === 'heute' ? ` (${LAGE_TEXT[a.lage]})` : ''}` : 'ohne Datum'
      const andere = a.allePersonen.filter((p) => p !== a.person)
      // Kennung für todo_erledigen / todo_aendern bzw. wiedervorlage_erledigen / _verschieben, damit der Assistent nicht erneut suchen muss.
      const kennung = a.id.startsWith('todo:') ? ` · todo_id=${a.id.slice(5)}` : a.id.startsWith('wv:') ? ` · wiedervorlage id=${a.id.slice(3)}` : ''
      zeilen.push(`- ${datum}: ${a.titel} · ${ART[a.art]}${a.bezug ? ` · ${a.bezug}` : ''}${a.bereich ? ` · ${a.bereich}` : ''}${andere.length ? ` · auch: ${andere.join(', ')}` : ''}${kennung}`)
    }
    if (g.aufgaben.length > max) zeilen.push(`- … und ${g.aufgaben.length - max} weitere (vollständig im CRM unter „Aufgaben nach Mitarbeiter“)`)
  }
  const text = zeilen.join('\n')
  // Nie stillschweigend abschneiden: Ist die Liste zu lang, sagt das Ergebnis es ausdrücklich.
  return text.length > 24000 ? `${text.slice(0, 24000)}\n… ACHTUNG: Die Übersicht ist hier abgeschnitten, es gibt WEITERE Aufgaben. Nicht als vollständig darstellen — nach Person oder Zeitraum eingrenzen und erneut abfragen.` : text
}
