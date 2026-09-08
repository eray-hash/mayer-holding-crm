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
} from '../types'
import { seedKunden, seedRechnungen, seedProtokolle, seedKonzepte, seedVertraege, seedVorlagen } from '../data/seedBeratung'
import { seedObjekte, seedFinanzierungen } from '../data/seedImmobilien'
import { seedVorlagenImmobilien } from '../data/seedVorlagenImmobilien'
import { getNextMainStep, BERATUNG_STATUS, IMMOBILIEN_STATUS } from '../data/statusNetworks'
import { uid, today } from '../lib/dates'
import { CURRENT_USER } from '../data/constants'

export type AppData = {
  bereich: Bereich
  kunden: Kunde[]
  rechnungen: Rechnung[]
  protokolle: Protokoll[]
  konzepte: Konzept[]
  vertraege: Beratungsvertrag[]
  vorlagenBeratung: Vorlage[]
  objekte: Objekt[]
  finanzierungen: Finanzierung[]
  vorlagenImmobilien: Vorlage[]
}

const STORAGE_KEY = 'mayer-holding-crm-data-v1'

function buildSeed(): AppData {
  return {
    bereich: 'beratung',
    kunden: seedKunden,
    rechnungen: seedRechnungen,
    protokolle: seedProtokolle,
    konzepte: seedKonzepte,
    vertraege: seedVertraege,
    vorlagenBeratung: seedVorlagen,
    objekte: seedObjekte,
    finanzierungen: seedFinanzierungen,
    vorlagenImmobilien: seedVorlagenImmobilien,
  }
}

function loadInitial(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppData
      if (parsed && Array.isArray(parsed.kunden) && Array.isArray(parsed.objekte)) {
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

function reducer(state: AppData, action: Action): AppData {
  switch (action.type) {
    case 'SET_BEREICH':
      return { ...state, bereich: action.bereich }
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
  }
}
