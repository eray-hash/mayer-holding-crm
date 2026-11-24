// Entgangene Klienten (24.11.2026) — Anbindung des CRM an den gemeinsamen Kern
// supabase/functions/_shared/entgangenKern.ts: Akte als entgangen markieren, wieder aufnehmen,
// KI-Vorschlag für den Grund holen. Beides schreibt über den normalen Weg (UPDATE_KUNDE_IN_BEREICH →
// feldweises Speichern in crmSync): status, verloren, activities, letzteAktivitaet.
import type { Dispatch } from 'react'
import type { Kunde, KundeBereich, StatusNode } from '../types'
import { getStatusMap } from '../data/statusNetworks'
import { today, uid } from './dates'
import { call } from './emailGateway'
import {
  baueVerloren,
  type EntgangenGrund,
  leseGrund,
  statusNachWiederAufnahme,
  type Verloren,
  verlaufTextMarkiert,
  verlaufTextWiederAufgenommen,
} from '../../supabase/functions/_shared/entgangenKern.ts'

export * from '../../supabase/functions/_shared/entgangenKern.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDispatch = Dispatch<any>

/** Statusnetz einer Akte (privat mit Art: das Netz dieses Bereichs). */
export function statusMapFuer(bereich: KundeBereich, kunde: Pick<Kunde, 'privatArt'>): Record<string, StatusNode> {
  return getStatusMap(bereich === 'privat' ? (kunde.privatArt ?? 'privat') : bereich)
}

export function statusLabelFuer(bereich: KundeBereich, kunde: Pick<Kunde, 'privatArt'>, status: string | undefined): string {
  if (!status) return ''
  return statusMapFuer(bereich, kunde)[status]?.label ?? status
}

/** Gibt es in diesem Statusnetz den Stand „verloren“? */
export function kenntVerloren(bereich: KundeBereich, kunde: Pick<Kunde, 'privatArt'>): boolean {
  return !!statusMapFuer(bereich, kunde).verloren
}

export type VerlorenEingabe = { grund: EntgangenGrund; notiz: string; wertNetto?: number }

/** Setzt die Akte auf „verloren“ und trägt Grund, vorige Phase, Betrag und Vermittler ein. */
export function markiereEntgangen(dispatch: AnyDispatch, bereich: KundeBereich, kunde: Kunde, e: VerlorenEingabe, wer: string): Verloren {
  const verloren = baueVerloren({
    grund: e.grund,
    notiz: e.notiz,
    am: today(),
    von: wer,
    phaseVorher: kunde.status,
    wertNetto: e.wertNetto,
    vermittler: kunde.vermittler?.name,
  })
  const vorherName = statusLabelFuer(bereich, kunde, kunde.status)
  const neuName = statusLabelFuer(bereich, kunde, 'verloren')
  // Steht die Akte schon auf „verloren“ (Grund nachtragen), gibt es keinen Statuswechsel.
  const text = kunde.status === 'verloren'
    ? `Grund nachgetragen durch ${wer} — ${verlaufTextMarkiert(verloren)}`
    : `Status: ${vorherName} → ${neuName} am ${today()} durch ${wer} — ${verlaufTextMarkiert(verloren, vorherName)}`
  dispatch({
    type: 'UPDATE_KUNDE_IN_BEREICH',
    bereich,
    id: kunde.id,
    patch: {
      status: 'verloren',
      verloren,
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text, user: wer }, ...kunde.activities],
    },
  })
  return verloren
}

/** Holt eine verlorene Akte zurück: voriger Stand (sonst Wiedervorlage), Feld verloren wird geleert, Historie im Verlauf. */
export function nimmWiederAuf(dispatch: AnyDispatch, bereich: KundeBereich, kunde: Kunde, wer: string, ziel?: string): string | undefined {
  const map = statusMapFuer(bereich, kunde)
  const neu = ziel && map[ziel] ? ziel : statusNachWiederAufnahme(kunde.verloren ?? undefined, (s) => !!map[s]) ?? Object.keys(map)[0]
  if (!neu) return undefined
  const text = verlaufTextWiederAufgenommen(kunde.verloren ?? undefined, map[neu]?.label ?? neu) + ` — durch ${wer}`
  dispatch({
    type: 'UPDATE_KUNDE_IN_BEREICH',
    bereich,
    id: kunde.id,
    patch: {
      status: neu,
      verloren: null,
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text, user: wer }, ...kunde.activities],
    },
  })
  return neu
}

export type GrundVorschlag = { grund: EntgangenGrund; satz: string }

/** KI-Vorschlag (Server liest Verlauf und Protokolle der Akte). */
export async function holeGrundVorschlag(kundeId: string): Promise<GrundVorschlag> {
  const data = await call({ action: 'entgangen_grund_vorschlag', kundeId })
  const grund = leseGrund(data?.grund) ?? 'sonstiges'
  return { grund, satz: String(data?.satz ?? '').trim() }
}
