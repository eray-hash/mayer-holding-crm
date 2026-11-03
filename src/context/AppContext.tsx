import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import type {
  Bereich,
  Kunde,
  Rechnung,
  Protokoll,
  Konzept,
  Beratungsvertrag,
  Vorlage,
  Objekt,
  Finanzierung,
  Dokument,
  DokumentOrdnerName,
  FollowUp,
  Prioritaet,
  FondsInvestor,
  FondsDokument,
  ObjektVorschlag,
  ImportiertesDokument,
  EingegangeneEmail,
  MailVorlage,
  Notiz,
  Abwesenheit,
  MitarbeiterProfil,
  KundeBereich,
  ActivityEntry,
  Kaeuferprofil,
  FragenkatalogFrage,
  Selbstauskunft,
} from '../types'
import { DEFAULT_FRAGENKATALOG } from '../data/fragenkataloge'
import { KUNDEN_BEREICHE, kundeBereichLabel } from '../data/kundenBereiche'
import { isSupabaseConfigured, hydrateFromSupabase, syncAfterDispatch, migriereLokaleDatenFallsLeer, type HydratedData } from '../lib/crmSync'
import type { Projekt, Aufgabe, AufgabenStatus, Meilenstein } from '../types/project'
import { seedKunden, seedRechnungen, seedProtokolle, seedKonzepte, seedVertraege, seedVorlagen } from '../data/seedBeratung'
import { seedObjekte, seedFinanzierungen } from '../data/seedImmobilien'
import { seedVorlagenImmobilien } from '../data/seedVorlagenImmobilien'
import { seedFondsInvestoren, seedFondsDokumenteAllgemein } from '../data/seedFonds'
import { seedProjekte } from '../data/seedProjekte'
import { seedErbenMandanten, seedVorlagenErben } from '../data/seedErben'
import { seedBetriebsuebergabeMandanten, seedVorlagenBetriebsuebergabe } from '../data/seedBetriebsuebergabe'
import { seedBetriebsformenMandanten, seedVorlagenBetriebsformen } from '../data/seedBetriebsformen'
import { seedAkademieTeilnehmer, seedVorlagenAkademie } from '../data/seedAkademie'
import { seedFinanzierungenMandanten, seedVorlagenFinanzierungen } from '../data/seedFinanzierungen'
import { seedMailVorlagen } from '../data/mailVorlagen'
import {
  getNextMainStep,
  BERATUNG_STATUS,
  IMMOBILIEN_STATUS,
  IMMOBILIEN_FOLGEAUFGABE,
  ERBEN_STATUS,
  BETRIEBSUEBERGABE_STATUS,
  BETRIEBSFORMEN_STATUS,
  AKADEMIE_STATUS,
  FINANZIERUNGEN_STATUS,
} from '../data/statusNetworks'
import { uid, today, addDays } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'

export type Rolle = 'geschaeftsfuehrung' | 'mitarbeiter'

export type AppData = {
  bereich: Bereich
  rolle: Rolle | null
  kunden: Kunde[]
  rechnungen: Rechnung[]
  protokolle: Protokoll[]
  konzepte: Konzept[]
  vertraege: Beratungsvertrag[]
  vorlagenBeratung: Vorlage[]
  objekte: Objekt[]
  finanzierungen: Finanzierung[]
  vorlagenImmobilien: Vorlage[]
  fondsInvestoren: FondsInvestor[]
  fondsDokumenteAllgemein: FondsDokument[]
  projekte: Projekt[]
  erbenMandanten: Kunde[]
  vorlagenErben: Vorlage[]
  betriebsuebergabeMandanten: Kunde[]
  vorlagenBetriebsuebergabe: Vorlage[]
  betriebsformenMandanten: Kunde[]
  vorlagenBetriebsformen: Vorlage[]
  akademieTeilnehmer: Kunde[]
  vorlagenAkademie: Vorlage[]
  finanzierungenMandanten: Kunde[]
  vorlagenFinanzierungen: Vorlage[]
  objektVorschlaege: ObjektVorschlag[]
  importierteDokumente: ImportiertesDokument[]
  eingegangeneEmails: EingegangeneEmail[]
  mailVorlagen: MailVorlage[]
  notizen: Notiz[]
  abwesenheiten: Abwesenheit[]
  profil: MitarbeiterProfil
  fragenkataloge: FragenkatalogFrage[]
}

const STORAGE_KEY = 'mayer-holding-crm-data-v1'

// Eigener, von AppData getrennter Key: merkt sich pro Browser, ob die einmalige Lokal-zu-Supabase-
// Migration (siehe migriereLokaleDatenFallsLeer) für dieses Gerät schon versucht wurde — unabhängig
// davon, ob die jeweilige Supabase-Tabelle GERADE leer ist. Ohne dieses Flag greift die Migration bei
// jedem Hydrate erneut, sobald eine Tabelle aus einem ganz legitimen Grund leer wird (z.B. nach einer
// echten Löschung) — und ein Browser, der die alten (ggf. längst überholten) lokalen Daten noch im
// Speicher hat, lädt sie dann einfach wieder hoch. Genau das ist am 2026-11-03 zweimal real passiert
// (eine gelöschte Test-Notiz kam über eine andere, noch nicht neu geladene Browser-Session zurück).
const MIGRATION_FLAG_KEY = 'mayer-holding-crm-migriert-v1'

// Alle über Supabase geteilten Entitäten kommen jetzt, sobald Supabase konfiguriert ist, aus der
// geteilten Datenbank (siehe lib/crmSync.ts) statt aus den lokalen Demo-Seed-Daten — sonst würde
// beim ersten Laden kurz Fake-Daten aufblitzen, und ein versehentliches "Daten zurücksetzen" könnte
// echte Daten lokal überschreiben.
function leereGeteilteEntities(data: AppData): AppData {
  if (!isSupabaseConfigured) return data
  return {
    ...data,
    kunden: [],
    erbenMandanten: [],
    betriebsuebergabeMandanten: [],
    betriebsformenMandanten: [],
    akademieTeilnehmer: [],
    finanzierungenMandanten: [],
    objekte: [],
    protokolle: [],
    objektVorschlaege: [],
    vorlagenBeratung: [],
    vorlagenImmobilien: [],
    vorlagenErben: [],
    vorlagenBetriebsuebergabe: [],
    vorlagenBetriebsformen: [],
    vorlagenAkademie: [],
    vorlagenFinanzierungen: [],
    rechnungen: [],
    konzepte: [],
    vertraege: [],
    finanzierungen: [],
    projekte: [],
    fondsInvestoren: [],
    fondsDokumenteAllgemein: [],
    importierteDokumente: [],
    mailVorlagen: [],
    notizen: [],
    abwesenheiten: [],
  }
}

function buildSeed(): AppData {
  return {
    bereich: 'beratung',
    rolle: null,
    kunden: seedKunden,
    rechnungen: seedRechnungen,
    protokolle: seedProtokolle,
    konzepte: seedKonzepte,
    vertraege: seedVertraege,
    vorlagenBeratung: seedVorlagen,
    objekte: seedObjekte,
    finanzierungen: seedFinanzierungen,
    vorlagenImmobilien: seedVorlagenImmobilien,
    fondsInvestoren: seedFondsInvestoren,
    fondsDokumenteAllgemein: seedFondsDokumenteAllgemein,
    projekte: seedProjekte,
    erbenMandanten: seedErbenMandanten,
    vorlagenErben: seedVorlagenErben,
    betriebsuebergabeMandanten: seedBetriebsuebergabeMandanten,
    vorlagenBetriebsuebergabe: seedVorlagenBetriebsuebergabe,
    betriebsformenMandanten: seedBetriebsformenMandanten,
    vorlagenBetriebsformen: seedVorlagenBetriebsformen,
    akademieTeilnehmer: seedAkademieTeilnehmer,
    vorlagenAkademie: seedVorlagenAkademie,
    finanzierungenMandanten: seedFinanzierungenMandanten,
    vorlagenFinanzierungen: seedVorlagenFinanzierungen,
    objektVorschlaege: [],
    importierteDokumente: [],
    eingegangeneEmails: [],
    mailVorlagen: seedMailVorlagen,
    notizen: [],
    abwesenheiten: [],
    profil: {
      name: CURRENT_USER,
      telefon: '',
      email: '',
      signaturHtml: `<p><strong>${CURRENT_USER}</strong><br/>Mayer Holding</p>`,
    },
    fragenkataloge: DEFAULT_FRAGENKATALOG,
  }
}

// Momentaufnahme des rohen localStorage-Stands BEVOR leereGeteilteEntities() die per Supabase
// geteilten Felder auf [] setzt — Grundlage für die einmalige Migration lokal vorhandener Daten
// nach Supabase (siehe migriereLokaleDatenFallsLeer in crmSync.ts). Muss synchron beim ersten
// loadInitial()-Aufruf eingefangen werden: ein erneutes Lesen von localStorage später (z.B. im
// Hydrate-Effekt) wäre zu spät, da der "state nach localStorage schreiben"-Effekt bereits vorher
// greift und den bereits geleerten State zurückschreibt — real beim Testen aufgetreten.
let lokalerStandVorSync: Partial<AppData> | null = null

function loadInitial(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      if (parsed && Array.isArray(parsed.kunden) && Array.isArray(parsed.objekte)) {
        // Ältere localStorage-Stände kennen den Fonds-Investorenbereich noch nicht
        if (!Array.isArray(parsed.fondsInvestoren)) parsed.fondsInvestoren = seedFondsInvestoren
        if (!Array.isArray(parsed.fondsDokumenteAllgemein)) parsed.fondsDokumenteAllgemein = seedFondsDokumenteAllgemein
        if (parsed.rolle === undefined) parsed.rolle = null
        if (!Array.isArray(parsed.projekte)) parsed.projekte = seedProjekte
        if (!Array.isArray(parsed.erbenMandanten)) parsed.erbenMandanten = seedErbenMandanten
        if (!Array.isArray(parsed.vorlagenErben)) parsed.vorlagenErben = seedVorlagenErben
        if (!Array.isArray(parsed.betriebsuebergabeMandanten)) parsed.betriebsuebergabeMandanten = seedBetriebsuebergabeMandanten
        if (!Array.isArray(parsed.vorlagenBetriebsuebergabe)) parsed.vorlagenBetriebsuebergabe = seedVorlagenBetriebsuebergabe
        if (!Array.isArray(parsed.betriebsformenMandanten)) parsed.betriebsformenMandanten = seedBetriebsformenMandanten
        if (!Array.isArray(parsed.vorlagenBetriebsformen)) parsed.vorlagenBetriebsformen = seedVorlagenBetriebsformen
        if (!Array.isArray(parsed.akademieTeilnehmer)) parsed.akademieTeilnehmer = seedAkademieTeilnehmer
        if (!Array.isArray(parsed.vorlagenAkademie)) parsed.vorlagenAkademie = seedVorlagenAkademie
        if (!Array.isArray(parsed.finanzierungenMandanten)) parsed.finanzierungenMandanten = seedFinanzierungenMandanten
        if (!Array.isArray(parsed.vorlagenFinanzierungen)) parsed.vorlagenFinanzierungen = seedVorlagenFinanzierungen
        if (!Array.isArray(parsed.objektVorschlaege)) parsed.objektVorschlaege = []
        if (!Array.isArray(parsed.importierteDokumente)) parsed.importierteDokumente = []
        if (!Array.isArray(parsed.eingegangeneEmails)) parsed.eingegangeneEmails = []
        if (!Array.isArray(parsed.mailVorlagen)) parsed.mailVorlagen = seedMailVorlagen
        if (!Array.isArray(parsed.notizen)) parsed.notizen = []
        if (!Array.isArray(parsed.abwesenheiten)) parsed.abwesenheiten = []
        if (!parsed.profil) {
          parsed.profil = {
            name: CURRENT_USER,
            telefon: '',
            email: '',
            signaturHtml: `<p><strong>${CURRENT_USER}</strong><br/>Mayer Holding</p>`,
          }
        }
        if (!Array.isArray(parsed.fragenkataloge)) parsed.fragenkataloge = DEFAULT_FRAGENKATALOG
        lokalerStandVorSync = parsed
        return leereGeteilteEntities(parsed)
      }
    }
  } catch {
    // ignore, fall back to seed
  }
  return leereGeteilteEntities(buildSeed())
}

type Action =
  | { type: 'SET_BEREICH'; bereich: Bereich }
  | { type: 'SET_ROLLE'; rolle: Rolle | null }
  | { type: 'RESET' }
  | { type: 'ADD_KUNDE'; kunde: Kunde }
  | { type: 'UPDATE_KUNDE'; id: string; patch: Partial<Kunde> }
  | { type: 'SET_KUNDE_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_KUNDE_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_KUNDE_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_RECHNUNG'; rechnung: Rechnung }
  | { type: 'UPDATE_RECHNUNG'; id: string; patch: Partial<Rechnung> }
  | { type: 'ADD_PROTOKOLL'; protokoll: Protokoll }
  | { type: 'ADD_OBJEKT'; objekt: Objekt }
  | { type: 'UPDATE_OBJEKT'; id: string; patch: Partial<Objekt> }
  | { type: 'SET_OBJEKT_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_OBJEKT_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_OBJEKT_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_FINANZIERUNG'; finanzierung: Finanzierung }
  | { type: 'ADD_DOKUMENT'; objektId: string; ordner: DokumentOrdnerName; dokument: Dokument }
  | { type: 'ADD_PROJEKT'; projekt: Projekt }
  | { type: 'ADD_MEILENSTEIN'; projektId: string; meilenstein: Meilenstein }
  | { type: 'ADD_AUFGABE'; projektId: string; meilensteinId: string; aufgabe: Aufgabe }
  | { type: 'UPDATE_AUFGABE'; projektId: string; meilensteinId: string; aufgabeId: string; patch: Partial<Aufgabe> }
  | { type: 'MOVE_AUFGABE'; projektId: string; meilensteinId: string; aufgabeId: string; status: AufgabenStatus }
  | { type: 'ADD_ERBEN_MANDANT'; kunde: Kunde }
  | { type: 'UPDATE_ERBEN_MANDANT'; id: string; patch: Partial<Kunde> }
  | { type: 'SET_ERBEN_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_ERBEN_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_ERBEN_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_BETRIEBSUEBERGABE_MANDANT'; kunde: Kunde }
  | { type: 'UPDATE_BETRIEBSUEBERGABE_MANDANT'; id: string; patch: Partial<Kunde> }
  | { type: 'SET_BETRIEBSUEBERGABE_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_BETRIEBSUEBERGABE_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_BETRIEBSUEBERGABE_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_BETRIEBSFORMEN_MANDANT'; kunde: Kunde }
  | { type: 'UPDATE_BETRIEBSFORMEN_MANDANT'; id: string; patch: Partial<Kunde> }
  | { type: 'SET_BETRIEBSFORMEN_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_BETRIEBSFORMEN_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_BETRIEBSFORMEN_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_AKADEMIE_TEILNEHMER'; kunde: Kunde }
  | { type: 'UPDATE_AKADEMIE_TEILNEHMER'; id: string; patch: Partial<Kunde> }
  | { type: 'SET_AKADEMIE_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_AKADEMIE_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_AKADEMIE_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_FINANZIERUNGEN_MANDANT'; kunde: Kunde }
  | { type: 'UPDATE_FINANZIERUNGEN_MANDANT'; id: string; patch: Partial<Kunde> }
  | { type: 'SET_FINANZIERUNGEN_STATUS'; id: string; status: string; followUp?: FollowUp }
  | { type: 'SET_FINANZIERUNGEN_FOLLOWUP'; id: string; followUp: FollowUp }
  | { type: 'SET_FINANZIERUNGEN_PRIORITAET'; id: string; prioritaet: Prioritaet }
  | { type: 'ADD_OBJEKT_VORSCHLAG'; vorschlag: ObjektVorschlag }
  | { type: 'ACCEPT_OBJEKT_VORSCHLAG'; id: string }
  | { type: 'REJECT_OBJEKT_VORSCHLAG'; id: string }
  | { type: 'ADD_IMPORTIERTES_DOKUMENT'; dokument: ImportiertesDokument }
  | { type: 'ASSIGN_IMPORTIERTES_DOKUMENT'; id: string; bereich: KundeBereich; kundeId: string; kundeName: string }
  | { type: 'ADD_EINGEGANGENE_EMAILS'; emails: EingegangeneEmail[] }
  | { type: 'ASSIGN_EINGEGANGENE_EMAIL'; id: string; bereich: KundeBereich; kundeId: string; kundeName: string }
  | { type: 'IGNORE_EINGEGANGENE_EMAIL'; id: string }
  | { type: 'ADD_MAIL_VORLAGE'; vorlage: MailVorlage }
  | { type: 'UPDATE_MAIL_VORLAGE'; id: string; patch: Partial<MailVorlage> }
  | { type: 'DELETE_MAIL_VORLAGE'; id: string }
  | { type: 'ADD_VOICE_TASK'; bereich: KundeBereich; kundeId: string; text: string; followUp?: FollowUp }
  | { type: 'ADD_POTENZIAL_NOTIZ'; bereich: KundeBereich; kundeId: string; titel: string; begruendung: string; followUp?: FollowUp }
  | { type: 'SET_KAEUFERPROFIL'; bereich: KundeBereich; kundeId: string; profil: Kaeuferprofil }
  | { type: 'ADD_FRAGE'; frage: FragenkatalogFrage }
  | { type: 'UPDATE_FRAGE'; id: string; patch: Partial<FragenkatalogFrage> }
  | { type: 'DELETE_FRAGE'; id: string }
  | { type: 'SET_SELBSTAUSKUNFT'; bereich: KundeBereich; kundeId: string; selbstauskunft: Selbstauskunft }
  | { type: 'PFLEGE_VERSCHIEBE_KUNDE'; id: string; vonBereich: KundeBereich; nachBereich: KundeBereich }
  | { type: 'PFLEGE_LOESCHE_KUNDE'; id: string; bereich: KundeBereich }
  | { type: 'PFLEGE_MERGE_KUNDEN'; bereich: KundeBereich; behalteId: string; loescheId: string }
  | { type: 'HYDRATE_SUPABASE'; data: HydratedData }
  | { type: 'ADD_NOTIZ'; notiz: Notiz }
  | { type: 'TOGGLE_NOTIZ'; id: string }
  | { type: 'DELETE_NOTIZ'; id: string }
  | { type: 'ADD_ABWESENHEIT'; abwesenheit: Abwesenheit }
  | { type: 'DELETE_ABWESENHEIT'; id: string }
  | { type: 'UPDATE_PROFIL'; patch: Partial<MitarbeiterProfil> }

// Hängt eine Aktivität an den Kunden/Mandanten im richtigen Bereichs-Array — zentrale Stelle, da
// jeder KundeBereich sein eigenes AppData-Feld hat (siehe kundenBereiche.ts für die Lese-Seite).
// extraPatch erlaubt, in derselben Operation weitere Felder zu setzen (z.B. followUp) — als Funktion
// übergeben, wenn der Patch vom bisherigen Kunden-Stand abhängt (z.B. an ein bestehendes Array anhängen).
function appendKundeActivity(
  state: AppData,
  bereich: KundeBereich,
  kundeId: string,
  activity: ActivityEntry,
  extraPatch: Partial<Kunde> | ((kunde: Kunde) => Partial<Kunde>) = {},
): AppData {
  const patch = (list: Kunde[]) =>
    list.map((k) => {
      if (k.id !== kundeId) return k
      const resolved = typeof extraPatch === 'function' ? extraPatch(k) : extraPatch
      return { ...k, ...resolved, activities: [activity, ...k.activities] }
    })
  switch (bereich) {
    case 'beratung':
      return { ...state, kunden: patch(state.kunden) }
    case 'erben':
      return { ...state, erbenMandanten: patch(state.erbenMandanten) }
    case 'betriebsuebergabe':
      return { ...state, betriebsuebergabeMandanten: patch(state.betriebsuebergabeMandanten) }
    case 'betriebsformen':
      return { ...state, betriebsformenMandanten: patch(state.betriebsformenMandanten) }
    case 'akademie':
      return { ...state, akademieTeilnehmer: patch(state.akademieTeilnehmer) }
    case 'finanzierungen':
      return { ...state, finanzierungenMandanten: patch(state.finanzierungenMandanten) }
    default:
      return state
  }
}

// Schreib-Gegenstück zu KUNDEN_BEREICHE's .get() — für Pflege-Modus-Aktionen, die einen Kunden
// komplett aus seinem bisherigen Bereichs-Array entfernen oder in ein anderes verschieben (anders
// als appendKundeActivity oben, das nur innerhalb eines Bereichs patcht).
function setKundenListe(state: AppData, bereich: KundeBereich, liste: Kunde[]): AppData {
  switch (bereich) {
    case 'beratung':
      return { ...state, kunden: liste }
    case 'erben':
      return { ...state, erbenMandanten: liste }
    case 'betriebsuebergabe':
      return { ...state, betriebsuebergabeMandanten: liste }
    case 'betriebsformen':
      return { ...state, betriebsformenMandanten: liste }
    case 'akademie':
      return { ...state, akademieTeilnehmer: liste }
    case 'finanzierungen':
      return { ...state, finanzierungenMandanten: liste }
    default:
      return state
  }
}

function getKundenListe(state: AppData, bereich: KundeBereich): Kunde[] {
  return KUNDEN_BEREICHE.find((b) => b.id === bereich)!.get(state)
}

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SET_BEREICH':
      return { ...state, bereich: action.bereich }
    case 'SET_ROLLE':
      return { ...state, rolle: action.rolle }
    case 'RESET':
      return leereGeteilteEntities(buildSeed())
    case 'ADD_KUNDE':
      return { ...state, kunden: [action.kunde, ...state.kunden] }
    case 'UPDATE_KUNDE':
      return {
        ...state,
        kunden: state.kunden.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)),
      }
    case 'SET_KUNDE_STATUS': {
      return {
        ...state,
        kunden: state.kunden.map((k) => {
          if (k.id !== action.id) return k
          const oldLabel = BERATUNG_STATUS[k.status]?.label ?? k.status
          const newLabel = BERATUNG_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          return {
            ...k,
            status: action.status,
            followUp: action.followUp ?? k.followUp,
            letzteAktivitaet: today(),
            activities: [activity, ...k.activities],
          }
        }),
      }
    }
    case 'SET_KUNDE_FOLLOWUP':
      return {
        ...state,
        kunden: state.kunden.map((k) => (k.id === action.id ? { ...k, followUp: action.followUp } : k)),
      }
    case 'SET_KUNDE_PRIORITAET':
      return {
        ...state,
        kunden: state.kunden.map((k) => (k.id === action.id ? { ...k, prioritaet: action.prioritaet } : k)),
      }
    case 'ADD_RECHNUNG':
      return { ...state, rechnungen: [action.rechnung, ...state.rechnungen] }
    case 'UPDATE_RECHNUNG':
      return {
        ...state,
        rechnungen: state.rechnungen.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r)),
      }
    case 'ADD_PROTOKOLL': {
      const activity = {
        id: uid('act'),
        date: today(),
        text: `Gesprächsprotokoll erfasst: „${action.protokoll.betreff}" (Teilnehmer: ${action.protokoll.teilnehmer})`,
        user: CURRENT_USER,
      }
      return {
        ...appendKundeActivity(state, action.protokoll.bereich, action.protokoll.kundeId, activity),
        protokolle: [action.protokoll, ...state.protokolle],
      }
    }
    case 'ADD_OBJEKT':
      return { ...state, objekte: [action.objekt, ...state.objekte] }
    case 'UPDATE_OBJEKT':
      return {
        ...state,
        objekte: state.objekte.map((o) => (o.id === action.id ? { ...o, ...action.patch } : o)),
      }
    case 'SET_OBJEKT_STATUS': {
      return {
        ...state,
        objekte: state.objekte.map((o) => {
          if (o.id !== action.id) return o
          const oldLabel = IMMOBILIEN_STATUS[o.status]?.label ?? o.status
          const newLabel = IMMOBILIEN_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          // "Aufgaben dürfen nicht mehr vom Mitarbeiter abhängen" (Quirin Lutzenberger) — wird beim
          // Statuswechsel kein eigenes Follow-up mitgegeben, erzeugt das System automatisch eins
          // passend zur neu erreichten Stufe (siehe IMMOBILIEN_FOLGEAUFGABE), statt das bisherige
          // Follow-up unverändert (und damit faktisch veraltet) stehen zu lassen.
          const folgeaufgabe = IMMOBILIEN_FOLGEAUFGABE[action.status]
          const automatischesFollowUp: FollowUp | undefined = folgeaufgabe
            ? { date: addDays(today(), folgeaufgabe.tageBisFaellig), note: folgeaufgabe.note, done: false }
            : undefined
          return {
            ...o,
            status: action.status,
            followUp: action.followUp ?? automatischesFollowUp ?? o.followUp,
            activities: [activity, ...o.activities],
          }
        }),
      }
    }
    case 'SET_OBJEKT_FOLLOWUP':
      return {
        ...state,
        objekte: state.objekte.map((o) => (o.id === action.id ? { ...o, followUp: action.followUp } : o)),
      }
    case 'SET_OBJEKT_PRIORITAET':
      return {
        ...state,
        objekte: state.objekte.map((o) => (o.id === action.id ? { ...o, prioritaet: action.prioritaet } : o)),
      }
    case 'ADD_FINANZIERUNG':
      return { ...state, finanzierungen: [action.finanzierung, ...state.finanzierungen] }
    case 'ADD_DOKUMENT':
      return {
        ...state,
        objekte: state.objekte.map((o) => {
          if (o.id !== action.objektId) return o
          const existing = o.dokumente[action.ordner] ?? []
          return { ...o, dokumente: { ...o.dokumente, [action.ordner]: [action.dokument, ...existing] } }
        }),
      }
    case 'ADD_PROJEKT':
      return { ...state, projekte: [action.projekt, ...state.projekte] }
    case 'ADD_MEILENSTEIN':
      return {
        ...state,
        projekte: state.projekte.map((p) =>
          p.id !== action.projektId ? p : { ...p, meilensteine: [...p.meilensteine, action.meilenstein] },
        ),
      }
    case 'ADD_AUFGABE':
      return {
        ...state,
        projekte: state.projekte.map((p) =>
          p.id !== action.projektId
            ? p
            : {
                ...p,
                meilensteine: p.meilensteine.map((m) =>
                  m.id !== action.meilensteinId ? m : { ...m, aufgaben: [...m.aufgaben, action.aufgabe] },
                ),
              },
        ),
      }
    case 'UPDATE_AUFGABE':
      return {
        ...state,
        projekte: state.projekte.map((p) =>
          p.id !== action.projektId
            ? p
            : {
                ...p,
                meilensteine: p.meilensteine.map((m) =>
                  m.id !== action.meilensteinId
                    ? m
                    : {
                        ...m,
                        aufgaben: m.aufgaben.map((a) => (a.id !== action.aufgabeId ? a : { ...a, ...action.patch })),
                      },
                ),
              },
        ),
      }
    case 'MOVE_AUFGABE': {
      const patch: Partial<Aufgabe> =
        action.status === 'erledigt' ? { status: action.status, erledigtAm: today() } : { status: action.status }
      return {
        ...state,
        projekte: state.projekte.map((p) =>
          p.id !== action.projektId
            ? p
            : {
                ...p,
                meilensteine: p.meilensteine.map((m) =>
                  m.id !== action.meilensteinId
                    ? m
                    : {
                        ...m,
                        aufgaben: m.aufgaben.map((a) => (a.id !== action.aufgabeId ? a : { ...a, ...patch })),
                      },
                ),
              },
        ),
      }
    }
    case 'ADD_ERBEN_MANDANT':
      return { ...state, erbenMandanten: [action.kunde, ...state.erbenMandanten] }
    case 'UPDATE_ERBEN_MANDANT':
      return {
        ...state,
        erbenMandanten: state.erbenMandanten.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)),
      }
    case 'SET_ERBEN_STATUS': {
      return {
        ...state,
        erbenMandanten: state.erbenMandanten.map((k) => {
          if (k.id !== action.id) return k
          const oldLabel = ERBEN_STATUS[k.status]?.label ?? k.status
          const newLabel = ERBEN_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          return {
            ...k,
            status: action.status,
            followUp: action.followUp ?? k.followUp,
            letzteAktivitaet: today(),
            activities: [activity, ...k.activities],
          }
        }),
      }
    }
    case 'SET_ERBEN_FOLLOWUP':
      return {
        ...state,
        erbenMandanten: state.erbenMandanten.map((k) => (k.id === action.id ? { ...k, followUp: action.followUp } : k)),
      }
    case 'SET_ERBEN_PRIORITAET':
      return {
        ...state,
        erbenMandanten: state.erbenMandanten.map((k) => (k.id === action.id ? { ...k, prioritaet: action.prioritaet } : k)),
      }
    case 'ADD_BETRIEBSUEBERGABE_MANDANT':
      return { ...state, betriebsuebergabeMandanten: [action.kunde, ...state.betriebsuebergabeMandanten] }
    case 'UPDATE_BETRIEBSUEBERGABE_MANDANT':
      return {
        ...state,
        betriebsuebergabeMandanten: state.betriebsuebergabeMandanten.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)),
      }
    case 'SET_BETRIEBSUEBERGABE_STATUS': {
      return {
        ...state,
        betriebsuebergabeMandanten: state.betriebsuebergabeMandanten.map((k) => {
          if (k.id !== action.id) return k
          const oldLabel = BETRIEBSUEBERGABE_STATUS[k.status]?.label ?? k.status
          const newLabel = BETRIEBSUEBERGABE_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          return {
            ...k,
            status: action.status,
            followUp: action.followUp ?? k.followUp,
            letzteAktivitaet: today(),
            activities: [activity, ...k.activities],
          }
        }),
      }
    }
    case 'SET_BETRIEBSUEBERGABE_FOLLOWUP':
      return {
        ...state,
        betriebsuebergabeMandanten: state.betriebsuebergabeMandanten.map((k) => (k.id === action.id ? { ...k, followUp: action.followUp } : k)),
      }
    case 'SET_BETRIEBSUEBERGABE_PRIORITAET':
      return {
        ...state,
        betriebsuebergabeMandanten: state.betriebsuebergabeMandanten.map((k) => (k.id === action.id ? { ...k, prioritaet: action.prioritaet } : k)),
      }
    case 'ADD_BETRIEBSFORMEN_MANDANT':
      return { ...state, betriebsformenMandanten: [action.kunde, ...state.betriebsformenMandanten] }
    case 'UPDATE_BETRIEBSFORMEN_MANDANT':
      return {
        ...state,
        betriebsformenMandanten: state.betriebsformenMandanten.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)),
      }
    case 'SET_BETRIEBSFORMEN_STATUS': {
      return {
        ...state,
        betriebsformenMandanten: state.betriebsformenMandanten.map((k) => {
          if (k.id !== action.id) return k
          const oldLabel = BETRIEBSFORMEN_STATUS[k.status]?.label ?? k.status
          const newLabel = BETRIEBSFORMEN_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          return {
            ...k,
            status: action.status,
            followUp: action.followUp ?? k.followUp,
            letzteAktivitaet: today(),
            activities: [activity, ...k.activities],
          }
        }),
      }
    }
    case 'SET_BETRIEBSFORMEN_FOLLOWUP':
      return {
        ...state,
        betriebsformenMandanten: state.betriebsformenMandanten.map((k) => (k.id === action.id ? { ...k, followUp: action.followUp } : k)),
      }
    case 'SET_BETRIEBSFORMEN_PRIORITAET':
      return {
        ...state,
        betriebsformenMandanten: state.betriebsformenMandanten.map((k) => (k.id === action.id ? { ...k, prioritaet: action.prioritaet } : k)),
      }
    case 'ADD_AKADEMIE_TEILNEHMER':
      return { ...state, akademieTeilnehmer: [action.kunde, ...state.akademieTeilnehmer] }
    case 'UPDATE_AKADEMIE_TEILNEHMER':
      return {
        ...state,
        akademieTeilnehmer: state.akademieTeilnehmer.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)),
      }
    case 'SET_AKADEMIE_STATUS': {
      return {
        ...state,
        akademieTeilnehmer: state.akademieTeilnehmer.map((k) => {
          if (k.id !== action.id) return k
          const oldLabel = AKADEMIE_STATUS[k.status]?.label ?? k.status
          const newLabel = AKADEMIE_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          return {
            ...k,
            status: action.status,
            followUp: action.followUp ?? k.followUp,
            letzteAktivitaet: today(),
            activities: [activity, ...k.activities],
          }
        }),
      }
    }
    case 'SET_AKADEMIE_FOLLOWUP':
      return {
        ...state,
        akademieTeilnehmer: state.akademieTeilnehmer.map((k) => (k.id === action.id ? { ...k, followUp: action.followUp } : k)),
      }
    case 'SET_AKADEMIE_PRIORITAET':
      return {
        ...state,
        akademieTeilnehmer: state.akademieTeilnehmer.map((k) => (k.id === action.id ? { ...k, prioritaet: action.prioritaet } : k)),
      }
    case 'ADD_FINANZIERUNGEN_MANDANT':
      return { ...state, finanzierungenMandanten: [action.kunde, ...state.finanzierungenMandanten] }
    case 'UPDATE_FINANZIERUNGEN_MANDANT':
      return {
        ...state,
        finanzierungenMandanten: state.finanzierungenMandanten.map((k) => (k.id === action.id ? { ...k, ...action.patch } : k)),
      }
    case 'SET_FINANZIERUNGEN_STATUS': {
      return {
        ...state,
        finanzierungenMandanten: state.finanzierungenMandanten.map((k) => {
          if (k.id !== action.id) return k
          const oldLabel = FINANZIERUNGEN_STATUS[k.status]?.label ?? k.status
          const newLabel = FINANZIERUNGEN_STATUS[action.status]?.label ?? action.status
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Status: ${oldLabel} → ${newLabel} am ${today()} durch ${CURRENT_USER}`,
            user: CURRENT_USER,
          }
          return {
            ...k,
            status: action.status,
            followUp: action.followUp ?? k.followUp,
            letzteAktivitaet: today(),
            activities: [activity, ...k.activities],
          }
        }),
      }
    }
    case 'SET_FINANZIERUNGEN_FOLLOWUP':
      return {
        ...state,
        finanzierungenMandanten: state.finanzierungenMandanten.map((k) => (k.id === action.id ? { ...k, followUp: action.followUp } : k)),
      }
    case 'SET_FINANZIERUNGEN_PRIORITAET':
      return {
        ...state,
        finanzierungenMandanten: state.finanzierungenMandanten.map((k) => (k.id === action.id ? { ...k, prioritaet: action.prioritaet } : k)),
      }
    case 'ADD_OBJEKT_VORSCHLAG':
      return { ...state, objektVorschlaege: [action.vorschlag, ...state.objektVorschlaege] }
    case 'ACCEPT_OBJEKT_VORSCHLAG': {
      const vorschlag = state.objektVorschlaege.find((v) => v.id === action.id)
      if (!vorschlag) return state
      return {
        ...state,
        objektVorschlaege: state.objektVorschlaege.map((v) =>
          v.id === action.id ? { ...v, status: 'akzeptiert', beantwortetAm: today() } : v,
        ),
        objekte: state.objekte.map((o) => {
          if (o.id !== vorschlag.objektId) return o
          const activity = {
            id: uid('act'),
            date: today(),
            text: `Exposé von ${vorschlag.kundeName} angenommen — Objekt dem Kunden-Portfolio zugewiesen.`,
            user: `${vorschlag.kundeName} (Formular)`,
          }
          return {
            ...o,
            zugewiesenerKunde: { bereich: vorschlag.kundeBereich, kundeId: vorschlag.kundeId, kundeName: vorschlag.kundeName },
            activities: [activity, ...o.activities],
          }
        }),
      }
    }
    case 'REJECT_OBJEKT_VORSCHLAG':
      return {
        ...state,
        objektVorschlaege: state.objektVorschlaege.map((v) =>
          v.id === action.id ? { ...v, status: 'abgelehnt', beantwortetAm: today() } : v,
        ),
      }
    case 'ADD_IMPORTIERTES_DOKUMENT':
      return { ...state, importierteDokumente: [action.dokument, ...state.importierteDokumente] }
    case 'ASSIGN_IMPORTIERTES_DOKUMENT': {
      const dok = state.importierteDokumente.find((d) => d.id === action.id)
      if (!dok) return state
      const zugewiesen = { bereich: action.bereich, kundeId: action.kundeId, kundeName: action.kundeName }
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: `Importiertes Dokument zugewiesen: „${dok.dateiname}"`,
        user: CURRENT_USER,
      }
      return {
        ...appendKundeActivity(state, action.bereich, action.kundeId, activity),
        importierteDokumente: state.importierteDokumente.map((d) => (d.id === action.id ? { ...d, zugewiesen } : d)),
      }
    }
    case 'ADD_EINGEGANGENE_EMAILS': {
      // Bisher wurden bereits lokal bekannte Mails beim erneuten Laden komplett verworfen statt
      // aktualisiert — eine Zuordnung/Ignorieren-Markierung, die ein Kollege auf einem anderen Gerät
      // gesetzt hat, blieb dadurch auch nach "Aktualisieren" unsichtbar (unterlief den Sync-Fix vom
      // 2026-11-02, der genau dieses Problem beheben sollte). Jetzt: bekannte Mails werden mit dem
      // frisch geladenen Serverstand überschrieben, die lokal erzeugte id bleibt erhalten, damit eine
      // gerade geöffnete Mail (selectedId) nicht durch den Refresh "verschwindet".
      const vorhandeneNachMessageId = new Map(state.eingegangeneEmails.map((e) => [e.messageId, e]))
      const aktualisierteMessageIds = new Set(action.emails.map((e) => e.messageId))
      const aktualisiert = action.emails.map((e) => {
        const vorhanden = vorhandeneNachMessageId.get(e.messageId)
        return vorhanden ? { ...e, id: vorhanden.id } : e
      })
      const unveraendert = state.eingegangeneEmails.filter((e) => !aktualisierteMessageIds.has(e.messageId))
      return { ...state, eingegangeneEmails: [...aktualisiert, ...unveraendert] }
    }
    case 'ASSIGN_EINGEGANGENE_EMAIL': {
      const mail = state.eingegangeneEmails.find((e) => e.id === action.id)
      if (!mail) return state
      const zugewiesenMail = { bereich: action.bereich, kundeId: action.kundeId, kundeName: action.kundeName }
      const hatAnhaenge = mail.anhaenge && mail.anhaenge.length > 0
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: hatAnhaenge
          ? `E-Mail zugeordnet: „${mail.betreff}" von ${mail.vonName} (${mail.anhaenge!.length} Anhang/Anhänge in Dokumente abgelegt)`
          : `E-Mail zugeordnet: „${mail.betreff}" von ${mail.vonName}`,
        user: CURRENT_USER,
      }
      const neueDokumente: Dokument[] = (mail.anhaenge ?? []).map((a) => ({
        id: uid('dok'),
        name: a.filename,
        typ: a.contentType,
        datum: today(),
        groesse: a.size < 1024 * 1024 ? `${Math.round(a.size / 1024)} KB` : `${(a.size / (1024 * 1024)).toFixed(1)} MB`,
        url: a.url,
      }))
      return {
        ...appendKundeActivity(
          state,
          action.bereich,
          action.kundeId,
          activity,
          hatAnhaenge ? (kunde) => ({ dokumente: [...neueDokumente, ...(kunde.dokumente ?? [])] }) : {},
        ),
        eingegangeneEmails: state.eingegangeneEmails.map((e) => (e.id === action.id ? { ...e, zugewiesen: zugewiesenMail } : e)),
      }
    }
    case 'IGNORE_EINGEGANGENE_EMAIL':
      return {
        ...state,
        eingegangeneEmails: state.eingegangeneEmails.map((e) => (e.id === action.id ? { ...e, ignoriert: true } : e)),
      }
    case 'ADD_MAIL_VORLAGE':
      return { ...state, mailVorlagen: [action.vorlage, ...state.mailVorlagen] }
    case 'UPDATE_MAIL_VORLAGE':
      return {
        ...state,
        mailVorlagen: state.mailVorlagen.map((v) => (v.id === action.id ? { ...v, ...action.patch } : v)),
      }
    case 'DELETE_MAIL_VORLAGE':
      return { ...state, mailVorlagen: state.mailVorlagen.filter((v) => v.id !== action.id) }
    case 'ADD_VOICE_TASK': {
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: `Notiz per KI-Assistent erfasst: „${action.text}"`,
        user: CURRENT_USER,
      }
      return appendKundeActivity(state, action.bereich, action.kundeId, activity, action.followUp ? { followUp: action.followUp } : {})
    }
    case 'ADD_POTENZIAL_NOTIZ': {
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: `KI-Potenzialanalyse: „${action.titel}" — ${action.begruendung}`,
        user: CURRENT_USER,
      }
      return appendKundeActivity(state, action.bereich, action.kundeId, activity, action.followUp ? { followUp: action.followUp } : {})
    }
    case 'SET_KAEUFERPROFIL': {
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: 'Käuferprofil erfasst/aktualisiert',
        user: CURRENT_USER,
      }
      return appendKundeActivity(state, action.bereich, action.kundeId, activity, { kaeuferprofil: action.profil })
    }
    case 'PFLEGE_VERSCHIEBE_KUNDE': {
      const quelle = getKundenListe(state, action.vonBereich)
      const kunde = quelle.find((k) => k.id === action.id)
      if (!kunde) return state
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: `Pflege-Modus: von „${kundeBereichLabel(action.vonBereich)}" nach „${kundeBereichLabel(action.nachBereich)}" verschoben durch ${CURRENT_USER}`,
        user: CURRENT_USER,
      }
      const verschoben: Kunde = { ...kunde, activities: [activity, ...kunde.activities] }
      const ohneQuelle = setKundenListe(state, action.vonBereich, quelle.filter((k) => k.id !== action.id))
      return setKundenListe(ohneQuelle, action.nachBereich, [verschoben, ...getKundenListe(ohneQuelle, action.nachBereich)])
    }
    case 'PFLEGE_LOESCHE_KUNDE': {
      const liste = getKundenListe(state, action.bereich)
      return setKundenListe(state, action.bereich, liste.filter((k) => k.id !== action.id))
    }
    case 'PFLEGE_MERGE_KUNDEN': {
      const liste = getKundenListe(state, action.bereich)
      const behalten = liste.find((k) => k.id === action.behalteId)
      const loeschen = liste.find((k) => k.id === action.loescheId)
      if (!behalten || !loeschen) return state
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: `Pflege-Modus: Dublette „${loeschen.firma}" zusammengeführt durch ${CURRENT_USER}`,
        user: CURRENT_USER,
      }
      const zusammengefuehrt: Kunde = { ...behalten, activities: [activity, ...behalten.activities, ...loeschen.activities] }
      const neueListe = liste.filter((k) => k.id !== action.loescheId).map((k) => (k.id === action.behalteId ? zusammengefuehrt : k))
      return setKundenListe(state, action.bereich, neueListe)
    }
    case 'HYDRATE_SUPABASE':
      return {
        ...state,
        kunden: action.data.kunden.beratung,
        erbenMandanten: action.data.kunden.erben,
        betriebsuebergabeMandanten: action.data.kunden.betriebsuebergabe,
        betriebsformenMandanten: action.data.kunden.betriebsformen,
        akademieTeilnehmer: action.data.kunden.akademie,
        finanzierungenMandanten: action.data.kunden.finanzierungen,
        objekte: action.data.objekte,
        protokolle: action.data.protokolle,
        objektVorschlaege: action.data.objektVorschlaege,
        vorlagenBeratung: action.data.vorlagen.beratung,
        vorlagenImmobilien: action.data.vorlagen.immobilien,
        vorlagenErben: action.data.vorlagen.erben,
        vorlagenBetriebsuebergabe: action.data.vorlagen.betriebsuebergabe,
        vorlagenBetriebsformen: action.data.vorlagen.betriebsformen,
        vorlagenAkademie: action.data.vorlagen.akademie,
        vorlagenFinanzierungen: action.data.vorlagen.finanzierungen,
        rechnungen: action.data.rechnungen,
        konzepte: action.data.konzepte,
        vertraege: action.data.vertraege,
        finanzierungen: action.data.finanzierungen,
        projekte: action.data.projekte,
        fondsInvestoren: action.data.fondsInvestoren,
        fondsDokumenteAllgemein: action.data.fondsDokumenteAllgemein,
        importierteDokumente: action.data.importierteDokumente,
        mailVorlagen: action.data.mailVorlagen,
        notizen: action.data.notizen,
        abwesenheiten: action.data.abwesenheiten,
      }
    case 'ADD_FRAGE':
      return { ...state, fragenkataloge: [...state.fragenkataloge, action.frage] }
    case 'UPDATE_FRAGE':
      return { ...state, fragenkataloge: state.fragenkataloge.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)) }
    case 'DELETE_FRAGE':
      return { ...state, fragenkataloge: state.fragenkataloge.filter((f) => f.id !== action.id) }
    case 'SET_SELBSTAUSKUNFT': {
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: 'Selbstauskunft digital eingereicht und unterschrieben',
        user: 'Kunde (Formular)',
      }
      return appendKundeActivity(state, action.bereich, action.kundeId, activity, { selbstauskunft: action.selbstauskunft })
    }
    case 'ADD_NOTIZ':
      return { ...state, notizen: [action.notiz, ...state.notizen] }
    case 'TOGGLE_NOTIZ':
      return { ...state, notizen: state.notizen.map((n) => (n.id === action.id ? { ...n, erledigt: !n.erledigt } : n)) }
    case 'DELETE_NOTIZ':
      return { ...state, notizen: state.notizen.filter((n) => n.id !== action.id) }
    case 'ADD_ABWESENHEIT':
      return { ...state, abwesenheiten: [action.abwesenheit, ...state.abwesenheiten] }
    case 'DELETE_ABWESENHEIT':
      return { ...state, abwesenheiten: state.abwesenheiten.filter((a) => a.id !== action.id) }
    case 'UPDATE_PROFIL':
      return { ...state, profil: { ...state.profil, ...action.patch } }
    default:
      return state
  }
}

type Ctx = {
  state: AppData
  dispatch: React.Dispatch<Action>
  /** true sobald der geteilte Stand (Kunden/Objekte/Protokolle/Vorschläge) geladen ist — ohne
   * Supabase-Konfiguration sofort true (reiner Demo-/Lokalmodus wie bisher). */
  hydrated: boolean
  hydrateError: string | null
}

const AppContext = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatchRaw] = useReducer(reducer, undefined, loadInitial)
  const stateRef = useRef(state)
  const [hydrated, setHydrated] = useState(!isSupabaseConfigured)
  const [hydrateError, setHydrateError] = useState<string | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Schreibt nach jedem Dispatch zusätzlich die geänderten Kunden/Objekte/Protokolle/Vorschläge in
  // die geteilte Datenbank (siehe lib/crmSync.ts) — der eigentliche reducer()-Aufruf hier läuft rein
  // lokal für den Diff, useReducer führt ihn intern nochmal aus, das ist bewusst in Kauf genommen,
  // um ohne Eingriff in jeden einzelnen Action-Typ auszukommen.
  const dispatch = useCallback((action: Action) => {
    const prev = stateRef.current
    const next = reducer(prev, action)
    stateRef.current = next
    dispatchRaw(action)
    if (action.type !== 'HYDRATE_SUPABASE') syncAfterDispatch(prev, next)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    hydrateFromSupabase()
      .then(async (data) => {
        if (cancelled || !data) return
        const bereitsMigriert = localStorage.getItem(MIGRATION_FLAG_KEY) === 'true'
        const fertig = lokalerStandVorSync && !bereitsMigriert ? await migriereLokaleDatenFallsLeer(data, lokalerStandVorSync) : data
        if (!bereitsMigriert) localStorage.setItem(MIGRATION_FLAG_KEY, 'true')
        if (cancelled) return
        dispatch({ type: 'HYDRATE_SUPABASE', data: fertig })
        setHydrated(true)
      })
      .catch((err) => {
        if (cancelled) return
        setHydrateError(err instanceof Error ? err.message : 'Daten konnten nicht geladen werden.')
        setHydrated(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = useMemo(() => ({ state, dispatch, hydrated, hydrateError }), [state, hydrated, hydrateError])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp muss innerhalb von AppProvider verwendet werden')
  return ctx
}

// ---- Convenience-Helfer für Statuswechsel ----

export function useAdvanceStatus() {
  const { state, dispatch } = useApp()
  return {
    advanceKunde(id: string, followUp?: FollowUp) {
      const kunde = state.kunden.find((k) => k.id === id)
      if (!kunde) return
      const next = getNextMainStep('beratung', kunde.status)
      if (next) dispatch({ type: 'SET_KUNDE_STATUS', id, status: next, followUp })
    },
    setKundeStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_KUNDE_STATUS', id, status, followUp })
    },
    advanceObjekt(id: string, followUp?: FollowUp) {
      const obj = state.objekte.find((o) => o.id === id)
      if (!obj) return
      const next = getNextMainStep('immobilien', obj.status)
      if (next) dispatch({ type: 'SET_OBJEKT_STATUS', id, status: next, followUp })
    },
    setObjektStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_OBJEKT_STATUS', id, status, followUp })
    },
    advanceErbenMandant(id: string, followUp?: FollowUp) {
      const mandant = state.erbenMandanten.find((k) => k.id === id)
      if (!mandant) return
      const next = getNextMainStep('erben', mandant.status)
      if (next) dispatch({ type: 'SET_ERBEN_STATUS', id, status: next, followUp })
    },
    setErbenStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_ERBEN_STATUS', id, status, followUp })
    },
    advanceBetriebsuebergabeMandant(id: string, followUp?: FollowUp) {
      const mandant = state.betriebsuebergabeMandanten.find((k) => k.id === id)
      if (!mandant) return
      const next = getNextMainStep('betriebsuebergabe', mandant.status)
      if (next) dispatch({ type: 'SET_BETRIEBSUEBERGABE_STATUS', id, status: next, followUp })
    },
    setBetriebsuebergabeStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_BETRIEBSUEBERGABE_STATUS', id, status, followUp })
    },
    advanceBetriebsformenMandant(id: string, followUp?: FollowUp) {
      const mandant = state.betriebsformenMandanten.find((k) => k.id === id)
      if (!mandant) return
      const next = getNextMainStep('betriebsformen', mandant.status)
      if (next) dispatch({ type: 'SET_BETRIEBSFORMEN_STATUS', id, status: next, followUp })
    },
    setBetriebsformenStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_BETRIEBSFORMEN_STATUS', id, status, followUp })
    },
    advanceAkademieTeilnehmer(id: string, followUp?: FollowUp) {
      const teilnehmer = state.akademieTeilnehmer.find((k) => k.id === id)
      if (!teilnehmer) return
      const next = getNextMainStep('akademie', teilnehmer.status)
      if (next) dispatch({ type: 'SET_AKADEMIE_STATUS', id, status: next, followUp })
    },
    setAkademieStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_AKADEMIE_STATUS', id, status, followUp })
    },
    advanceFinanzierungenMandant(id: string, followUp?: FollowUp) {
      const mandant = state.finanzierungenMandanten.find((k) => k.id === id)
      if (!mandant) return
      const next = getNextMainStep('finanzierungen', mandant.status)
      if (next) dispatch({ type: 'SET_FINANZIERUNGEN_STATUS', id, status: next, followUp })
    },
    setFinanzierungenStatus(id: string, status: string, followUp?: FollowUp) {
      dispatch({ type: 'SET_FINANZIERUNGEN_STATUS', id, status, followUp })
    },
  }
}
