// Alle Zeilen einer Supabase-Abfrage seitenweise lesen (die Datenbank liefert höchstens 1000 Zeilen je Abfrage,
// ohne Fehler — der Rest fehlt still; ein `.limit(5000)` hilft nicht). Eine einzige Umsetzung für Browser und
// Server: supabase/functions/_shared/alleZeilen.ts (dort Benutzung und Regeln).
//
//   const { data, error } = await alleZeilen(() => supabase.from('todos').select('*').is('erledigt_am', null))
export { alleZeilen, alleZeilenOderFehler, schluesselVon, SEITE, HOECHSTENS } from '../../supabase/functions/_shared/alleZeilen.ts'
export type { AlleZeilenErgebnis, AlleZeilenOptionen, ZeilenFehler, Abfrage } from '../../supabase/functions/_shared/alleZeilen.ts'
