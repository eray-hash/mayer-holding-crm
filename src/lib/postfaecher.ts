// Die Postfächer, die der angemeldete Mitarbeiter benutzen darf (gemeinsame + sein eigenes).
// Einmal je Sitzung geladen und zwischen allen Stellen geteilt (Absender-Auswahl, privates Postfach,
// Profil); `neuLaden()` nach Verbinden/Trennen.
import { useEffect, useState } from 'react'
import { isEmailGatewayConfigured, ladePostfaecher, type PostfachInfo } from './emailGateway'
import { isSupabaseConfigured } from './supabaseClient'

let stand: PostfachInfo[] | null = null
let laeuft: Promise<PostfachInfo[]> | null = null
const hoerer = new Set<(p: PostfachInfo[] | null) => void>()

function melde(neu: PostfachInfo[] | null) {
  stand = neu
  hoerer.forEach((h) => h(neu))
}

export async function ladePostfaecherNeu(): Promise<PostfachInfo[]> {
  if (!isEmailGatewayConfigured || !isSupabaseConfigured) return []
  if (!laeuft) {
    laeuft = ladePostfaecher()
      .then((liste) => {
        melde(liste)
        return liste
      })
      .finally(() => {
        laeuft = null
      })
  }
  return laeuft
}

/** Beim Abmelden leeren, damit der nächste Nutzer am selben Gerät nichts vom vorigen sieht. */
export function vergissPostfaecher() {
  melde(null)
}

export function usePostfaecher(): { postfaecher: PostfachInfo[]; geladen: boolean; fehler: string; eigenes?: PostfachInfo; neuLaden: () => Promise<PostfachInfo[]> } {
  const [liste, setListe] = useState<PostfachInfo[] | null>(stand)
  const [fehler, setFehler] = useState('')

  useEffect(() => {
    hoerer.add(setListe)
    if (stand === null) ladePostfaecherNeu().catch((err) => setFehler(err instanceof Error ? err.message : 'Postfächer konnten nicht geladen werden.'))
    return () => {
      hoerer.delete(setListe)
    }
  }, [])

  const postfaecher = liste ?? []
  return { postfaecher, geladen: liste !== null, fehler, eigenes: postfaecher.find((p) => p.eigenes), neuLaden: ladePostfaecherNeu }
}

export function postfachBezeichnung(p: PostfachInfo): string {
  const name = p.anzeigeName ? `${p.anzeigeName} <${p.adresse}>` : p.adresse
  return p.eigenes ? `${name} — mein Postfach` : name
}

const MERKER = 'mh_absender_postfach'

export function gemerkterAbsender(): string | null {
  try {
    return localStorage.getItem(MERKER)
  } catch {
    return null
  }
}

export function merkeAbsender(id: string) {
  try {
    localStorage.setItem(MERKER, id)
  } catch {
    // ohne Speicher wird beim nächsten Mal wieder das Hauptpostfach vorgeschlagen
  }
}
