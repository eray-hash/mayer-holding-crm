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
} from '../types'
import type { Projekt, Aufgabe, AufgabenStatus, Meilenstein } from '../types/project'
import { seedKunden, seedRechnungen, seedProtokolle, seedKonzepte, seedVertraege, seedVorlagen } from '../data/seedBeratung'
import { seedObjekte, seedFinanzierungen } from '../data/seedImmobilien'
import { seedVorlagenImmobilien } from '../data/seedVorlagenImmobilien'
import { seedFondsInvestoren, seedFondsDokumenteAllgemein } from '../data/seedFonds'
import { seedProjekte } from '../data/seedProjekte'
import { seedErbenMandanten, seedVorlagenErben } from '../data/seedErben'
import { seedBetriebsuebergabeMandanten, seedVorlagenBetriebsuebergabe } from '../data/seedBetriebsuebergabe'
import { getNextMainStep, BERATUNG_STATUS, IMMOBILIEN_STATUS, ERBEN_STATUS, BETRIEBSUEBERGABE_STATUS } from '../data/statusNetworks'
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
    case 'ADD_PROTOKOLL':
      return { ...state, protokolle: [action.protokoll, ...state.protokolle] }
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
  }
}
