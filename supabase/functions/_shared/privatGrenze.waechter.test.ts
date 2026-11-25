// Wächter gegen künftige Lecks privater Termine (25.11.2026): Jede Datei unter supabase/functions, die aus der Tabelle
// `termine` liest, muss hier eingeordnet sein. „mayer“ = gibt Termine Mayer-seitig aus und MUSS _shared/privatGrenze.ts
// nutzen; „privat“ = privater Assistent; „unbedenklich“ = mit Grund (z. B. nur Termine mit Mayer-Akte, nur Belegung
// ohne Angaben, nur Schreiben). Eine neue Datei mit `termine` lässt diesen Test scheitern, bis sie eingeordnet ist —
// dann bitte prüfen, ob private Termine (istPrivaterTermin) Mayer-seitig erscheinen können.
//
//   npx -y deno test --allow-all --no-check _shared/privatGrenze.waechter.test.ts
import { assert } from 'jsr:@std/assert@1'

type Art = 'mayer' | 'privat' | 'unbedenklich'

const KATALOG: Record<string, [Art, string]> = {
  // Mayer-seitig, mit privatGrenze.ts
  '_shared/tagesplanLaden.ts': ['mayer', 'Mayer-Tagesplan (Seite „Tagesablauf & Woche“, Mayer-Bot)'],
  '_shared/terminZuordnungKern.ts': ['mayer', 'Termin → Akte: private Termine nie auf Mayer-Akten'],
  'email-gateway/abendRueckblick.ts': ['mayer', 'Abend-Rückblick im Mayer-Bot'],
  'email-gateway/bitteBestaetigen.ts': ['mayer', '„Bitte bestätigen“ im Mayer-Bot'],
  'email-gateway/checklisteVorschlag.ts': ['mayer', 'Checklisten-Vorschlag (nur Termine der Akte; persönliche Post nach privatGrenze)'],
  'email-gateway/kalender.ts': ['mayer', 'Überschneidungen nennen Kollegen; private Termine eines Kollegen nicht'],
  'email-gateway/kalenderAbo.ts': ['mayer', 'Kalender-Abo „Mayer Holding CRM“'],
  'email-gateway/nachTermin.ts': ['mayer', '„Wie lief der Termin?“ im Mayer-Bot'],
  'email-gateway/superuser.ts': ['mayer', 'Superuser-Verlauf (andere Personen)'],
  'email-gateway/tagesmeldung.ts': ['mayer', 'Morgen-Übersicht im Mayer-Bot'],
  'email-gateway/terminBriefing.ts': ['mayer', 'Briefing/Morgenliste/Erinnerung — private Termine nur über den privaten Bot'],
  'email-gateway/wochenrueckblick.ts': ['mayer', 'Wochenrückblick (Zahl der Kundentermine)'],
  'telegram-gateway/bitteBestaetigenWerkzeug.ts': ['mayer', 'vorschlaege_bestaetigen im Mayer-Bot'],
  'telegram-gateway/briefingWerkzeug.ts': ['mayer', 'termin_briefing im Mayer-Bot'],
  'telegram-gateway/index.ts': ['mayer', 'termine_zeigen, termin_absagen/aendern im Mayer-Bot'],
  'telegram-gateway/kalenderZeiten.ts': ['mayer', 'freie_zeiten: Kollegen und eigene private Termine ohne Titel'],
  'telegram-gateway/tagesplanWerkzeuge.ts': ['mayer', 'Tagesplan eines Kollegen bzw. der eigene im Mayer-Bot'],
  // Privater Assistent
  'email-gateway/privatTagesplan.ts': ['privat', 'privater Morgenplan'],
  'email-gateway/privatWoche.ts': ['privat', 'private Woche'],
  'email-gateway/terminAusMail.ts': ['privat', 'Termine aus Mails, Bestätigung im privaten Bot'],
  'telegram-gateway/personUeberblick.ts': ['privat', 'nur im privaten Bot angeboten'],
  // Unbedenklich
  '_shared/chanceKern.ts': ['unbedenklich', 'nur Termine mit Mayer-kunde_id, nur das Datum'],
  '_shared/dublettenLaden.ts': ['unbedenklich', 'zählt je kunde_id'],
  '_shared/einladung.ts': ['unbedenklich', 'Import von Einladungen, gibt nichts aus'],
  '_shared/kundenberichtKern.ts': ['unbedenklich', 'nur Termine der Akte (kunde_id), nur Datum'],
  'email-gateway/buchung.ts': ['unbedenklich', 'nur belegte Zeiten ohne Angaben (Buchungsseite; private Termine müssen blockieren)'],
  'email-gateway/gespraechPipeline.ts': ['unbedenklich', 'eigene Aufnahme des Besitzers'],
  'email-gateway/gespraechUebernehmen.ts': ['unbedenklich', 'eigene Gesprächs-App, Termin des Besitzers'],
  'email-gateway/kalenderAbgleich.ts': ['unbedenklich', 'Abgleich mit dem eigenen Outlook (schreibt)'],
  'email-gateway/kundenPortal.ts': ['unbedenklich', 'nur Termine der Akte mit eingeladenem Gast'],
  'email-gateway/objektPortal.ts': ['unbedenklich', 'nur Belegung ohne Angaben'],
  'email-gateway/statusVorschlag.ts': ['unbedenklich', 'nur Termine mit Mayer-kunde_id'],
  'email-gateway/terminZuordnung.ts': ['unbedenklich', 'Bewertung in _shared/terminZuordnungKern.ts (mayer)'],
  'telegram-gateway/besichtigungWerkzeuge.ts': ['unbedenklich', 'prüft nur den Besitz, gibt keinen Inhalt aus'],
  'telegram-gateway/pflegeWerkzeuge.ts': ['unbedenklich', 'schreibt kunde_* beim Umzug einer Akte'],
  'telegram-gateway/terminZuordnungWerkzeug.ts': ['unbedenklich', 'Besitzer ordnet selbst zu; Vorschlagstext nur über das gefilterte termine_zeigen'],
  'telegram-gateway/umsatzZielWerkzeug.ts': ['unbedenklich', 'nur Termine mit kunde_id, Zählung'],
}

const WURZEL = new URL('../', import.meta.url)
const TABELLE_TERMINE = /['"`]termine['"`]/

async function* tsDateien(ordner: URL, pfad = ''): AsyncGenerator<string> {
  for await (const e of Deno.readDir(ordner)) {
    if (e.isDirectory) {
      if (e.name === 'node_modules' || e.name === 'supabase' || e.name.startsWith('.')) continue
      yield* tsDateien(new URL(`${e.name}/`, ordner), `${pfad}${e.name}/`)
    } else if (e.isFile && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      yield `${pfad}${e.name}`
    }
  }
}

Deno.test('Wächter: jede Datei, die aus `termine` liest, ist eingeordnet; Mayer-seitige nutzen privatGrenze.ts', async () => {
  const fehler: string[] = []
  const gefunden = new Set<string>()
  for await (const datei of tsDateien(WURZEL)) {
    const inhalt = await Deno.readTextFile(new URL(datei, WURZEL))
    if (datei === '_shared/privatGrenze.ts' || !TABELLE_TERMINE.test(inhalt)) continue
    gefunden.add(datei)
    const eintrag = KATALOG[datei]
    if (!eintrag) {
      fehler.push(`${datei}: liest aus \`termine\`, ist aber nicht eingeordnet. Prüfen, ob private Termine Mayer-seitig erscheinen können (istPrivaterTermin in _shared/privatGrenze.ts), dann hier eintragen.`)
      continue
    }
    if (eintrag[0] === 'mayer' && !/privatGrenze\.ts['"]/.test(inhalt)) fehler.push(`${datei}: Mayer-seitig, nutzt aber _shared/privatGrenze.ts nicht.`)
  }
  for (const datei of Object.keys(KATALOG)) if (!gefunden.has(datei)) fehler.push(`${datei}: steht im Katalog, liest aber nicht (mehr) aus \`termine\` — Eintrag entfernen.`)
  assert(fehler.length === 0, `\n${fehler.join('\n')}`)
})
