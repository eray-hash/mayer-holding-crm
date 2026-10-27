import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
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
  MitarbeiterProfil,
  KundeBereich,
  ActivityEntry,
  Kaeuferprofil,
} from '../types'
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
  ERBEN_STATUS,
  BETRIEBSUEBERGABE_STATUS,
  BETRIEBSFORMEN_STATUS,
  AKADEMIE_STATUS,
  FINANZIERUNGEN_STATUS,
} from '../data/statusNetworks'
import { uid, today } from '../lib/dates'
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
  profil: MitarbeiterProfil
}

const STORAGE_KEY = 'mayer-holding-crm-data-v1'

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
    profil: {
      name: CURRENT_USER,
      telefon: '',
      email: '',
      signaturHtml: `<p><strong>${CURRENT_USER}</strong><br/>Mayer Holding</p>`,
    },
  }
}

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
        if (!parsed.profil) {
          parsed.profil = {
            name: CURRENT_USER,
            telefon: '',
            email: '',
            signaturHtml: `<p><strong>${CURRENT_USER}</strong><br/>Mayer Holding</p>`,
          }
        }
        return parsed
      }
    }
  } catch {
    // ignore, fall back to seed
  }
  return buildSeed()
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
  | { type: 'ADD_NOTIZ'; notiz: Notiz }
  | { type: 'TOGGLE_NOTIZ'; id: string }
  | { type: 'DELETE_NOTIZ'; id: string }
  | { type: 'UPDATE_PROFIL'; patch: Partial<MitarbeiterProfil> }

// Hängt eine Aktivität an den Kunden/Mandanten im richtigen Bereichs-Array — zentrale Stelle, da
// jeder KundeBereich sein eigenes AppData-Feld hat (siehe kundenBereiche.ts für die Lese-Seite).
// extraPatch erlaubt, in derselben Operation weitere Felder zu setzen (z.B. followUp).
function appendKundeActivity(state: AppData, bereich: KundeBereich, kundeId: string, activity: ActivityEntry, extraPatch: Partial<Kunde> = {}): AppData {
  const patch = (list: Kunde[]) => list.map((k) => (k.id === kundeId ? { ...k, ...extraPatch, activities: [activity, ...k.activities] } : k))
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

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SET_BEREICH':
      return { ...state, bereich: action.bereich }
    case 'SET_ROLLE':
      return { ...state, rolle: action.rolle }
    case 'RESET':
      return buildSeed()
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
          return {
            ...o,
            status: action.status,
            followUp: action.followUp ?? o.followUp,
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
      const bekannteIds = new Set(state.eingegangeneEmails.map((e) => e.messageId))
      const neue = action.emails.filter((e) => !bekannteIds.has(e.messageId))
      return { ...state, eingegangeneEmails: [...neue, ...state.eingegangeneEmails] }
    }
    case 'ASSIGN_EINGEGANGENE_EMAIL': {
      const mail = state.eingegangeneEmails.find((e) => e.id === action.id)
      if (!mail) return state
      const zugewiesenMail = { bereich: action.bereich, kundeId: action.kundeId, kundeName: action.kundeName }
      const activity: ActivityEntry = {
        id: uid('act'),
        date: today(),
        text: `E-Mail zugeordnet: „${mail.betreff}" von ${mail.vonName}`,
        user: CURRENT_USER,
      }
      return {
        ...appendKundeActivity(state, action.bereich, action.kundeId, activity),
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
    case 'ADD_NOTIZ':
      return { ...state, notizen: [action.notiz, ...state.notizen] }
    case 'TOGGLE_NOTIZ':
      return { ...state, notizen: state.notizen.map((n) => (n.id === action.id ? { ...n, erledigt: !n.erledigt } : n)) }
    case 'DELETE_NOTIZ':
      return { ...state, notizen: state.notizen.filter((n) => n.id !== action.id) }
    case 'UPDATE_PROFIL':
      return { ...state, profil: { ...state.profil, ...action.patch } }
    default:
      return state
  }
}

type Ctx = {
  state: AppData
  dispatch: React.Dispatch<Action>
}

const AppContext = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const value = useMemo(() => ({ state, dispatch }), [state])

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
