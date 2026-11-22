// Stammdaten aus E-Mail-Signaturen (22.11.2026).
//
// 1. StammdatenVorschlaege: kleiner Hinweis in der Akte, wenn eine Signatur in einer Kunden-Mail eine andere
//    Telefonnummer, Anschrift oder E-Mail-Adresse nennt als die Akte („Neue Telefonnummer aus Mail vom …:
//    übernehmen / verwerfen“). Leere Felder füllt der Server selbst (email-gateway/stammdatenErgaenzen.ts),
//    hier geht es nur um Widersprüche — überschrieben wird nur auf Klick.
//    Die Spalte kunden.stammdaten_vorschlaege gehört nicht zum Speichern über crmSync (nicht in kundeToRow):
//    Dieser Hinweis liest und schreibt sie selbst. Das übernommene Feld und der Verlaufseintrag gehen über
//    UPDATE_KUNDE_IN_BEREICH wie jede Änderung in der Akte (crmSync schreibt nur geänderte Felder und führt
//    den Verlauf mit der Datenbank zusammen).
// 2. StammdatenNachtrag: Knopf für die Geschäftsführung — einmaliger Nachtrag über alle Akten mit Vorschau
//    (Aktion stammdaten_nachtrag im email-gateway); erst nach Bestätigung wird geschrieben.

import { useEffect, useState } from 'react'
import { Contact, Loader2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabaseClient'
import { callAuthenticated } from '../lib/emailGateway'
import { today } from '../lib/dates'
import type { Kunde, KundeBereich } from '../types'
import {
  alsVorschlaege,
  erledige,
  FELD_NAME,
  offeneVorschlaege,
  type StammdatenVorschlag,
  uebernommenText,
  vorschlagText,
} from '../../supabase/functions/_shared/stammdatenVorschlag.ts'

async function ladeListe(kundeId: string): Promise<StammdatenVorschlag[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('kunden').select('stammdaten_vorschlaege').eq('id', kundeId).maybeSingle()
  if (error) return [] // z. B. Spalte noch nicht angelegt: dann einfach kein Hinweis
  return alsVorschlaege(data?.stammdaten_vorschlaege)
}

export function StammdatenVorschlaege({ bereich, kunde, nutzerName, nurLesen = false }: { bereich: KundeBereich; kunde: Kunde; nutzerName: string; nurLesen?: boolean }) {
  const { dispatch } = useApp()
  const [offen, setOffen] = useState<StammdatenVorschlag[]>([])
  const [laeuft, setLaeuft] = useState('')
  const [meldung, setMeldung] = useState('')

  useEffect(() => {
    let aktiv = true
    ladeListe(kunde.id).then((l) => aktiv && setOffen(l.filter((v) => v.status === 'offen')))
    return () => {
      aktiv = false
    }
  }, [kunde.id])

  if (bereich === 'privat' || offen.length === 0) return null

  async function entscheide(v: StammdatenVorschlag, uebernehmen: boolean) {
    if (!supabase) return
    setLaeuft(v.id)
    setMeldung('')
    try {
      // Liste direkt vor dem Schreiben frisch lesen (Server oder Assistent können sie inzwischen geändert haben).
      const liste = await ladeListe(kunde.id)
      const neu = erledige(liste, v.id, uebernehmen ? 'uebernommen' : 'verworfen', nutzerName, today())
      if (!neu) {
        setOffen(offeneVorschlaege(liste))
        setMeldung('Dieser Vorschlag ist schon erledigt.')
        return
      }
      const { error } = await supabase.from('kunden').update({ stammdaten_vorschlaege: neu }).eq('id', kunde.id)
      if (error) throw new Error(error.message)
      if (uebernehmen) {
        const eintrag = { id: crypto.randomUUID(), date: today(), text: uebernommenText(v, nutzerName), user: nutzerName }
        dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich, id: kunde.id, patch: { [v.feld]: v.wert, activities: [eintrag, ...kunde.activities] } as Partial<Kunde> })
        setMeldung(`${FELD_NAME[v.feld]} übernommen.`)
      }
      setOffen(offeneVorschlaege(neu))
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Das hat nicht geklappt.')
    } finally {
      setLaeuft('')
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {offen.map((v) => (
        <div key={v.id} className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">
          <p className="flex items-start gap-2">
            <Contact size={15} className="mt-0.5 shrink-0" />
            <span>{vorschlagText(v)}</span>
          </p>
          {!nurLesen && (
            <div className="mt-1 flex gap-3 pl-6 text-xs font-medium">
              <button disabled={!!laeuft} onClick={() => entscheide(v, true)} className="hover:underline disabled:opacity-50">
                {laeuft === v.id ? 'Speichert …' : 'Übernehmen'}
              </button>
              <button disabled={!!laeuft} onClick={() => entscheide(v, false)} className="hover:underline disabled:opacity-50">
                Verwerfen
              </button>
            </div>
          )}
        </div>
      ))}
      {meldung && <p className="pl-1 text-xs text-slate-500">{meldung}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Einmaliger Nachtrag für alle Akten (Geschäftsführung)

type NachtragZeile = {
  kundeId: string
  name: string
  bereich: string
  ergaenzen: { feld: keyof typeof FELD_NAME; wert: string; mailDatum: string }[]
  vorschlaege: { feld: keyof typeof FELD_NAME; wert: string; bisher: string; mailDatum: string }[]
}

function deDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

export function StammdatenNachtrag() {
  const [zeilen, setZeilen] = useState<NachtragZeile[] | null>(null)
  const [geprueft, setGeprueft] = useState(0)
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [laeuft, setLaeuft] = useState<'' | 'vorschau' | 'ausfuehren'>('')
  const [meldung, setMeldung] = useState('')

  async function vorschau() {
    setLaeuft('vorschau')
    setMeldung('')
    try {
      const r = await callAuthenticated({ action: 'stammdaten_nachtrag', schritt: 'vorschau' })
      const liste = (r.zeilen ?? []) as NachtragZeile[]
      setZeilen(liste)
      setGeprueft(Number(r.geprueft ?? 0))
      setGewaehlt(new Set(liste.map((z) => z.kundeId)))
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Die Vorschau ließ sich nicht laden.')
    } finally {
      setLaeuft('')
    }
  }

  async function ausfuehren() {
    if (!gewaehlt.size) return
    setLaeuft('ausfuehren')
    setMeldung('')
    try {
      const r = await callAuthenticated({ action: 'stammdaten_nachtrag', schritt: 'ausfuehren', kundeIds: [...gewaehlt] })
      const fehler = Array.isArray(r.fehler) && r.fehler.length ? ` ${r.fehler.length} Akte(n) ließen sich nicht speichern.` : ''
      setMeldung(`Fertig: ${r.ergaenzt ?? 0} Feld(er) in ${r.akten ?? 0} Akte(n) ergänzt, ${r.vorgeschlagen ?? 0} Vorschlag/Vorschläge angelegt.${fehler} Neu laden zeigt die Werte in den Akten.`)
      setZeilen(null)
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : 'Der Nachtrag hat nicht geklappt.')
    } finally {
      setLaeuft('')
    }
  }

  const umschalten = (id: string) =>
    setGewaehlt((alt) => {
      const neu = new Set(alt)
      if (neu.has(id)) neu.delete(id)
      else neu.add(id)
      return neu
    })

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">Stammdaten aus E-Mail-Signaturen nachtragen</h3>
      <p className="mt-1 text-xs text-slate-500">
        Liest die Signaturen in den Mails aller Kunden und zeigt, welche leeren Felder (Telefon, Anschrift, E-Mail-Adresse) sich füllen lassen. Vorhandene Angaben werden nie
        überschrieben — weicht eine Signatur ab, entsteht nur ein Hinweis in der Akte. Das CRM macht das ohnehin laufend selbst; dieser Knopf erledigt alle Akten auf einmal.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={vorschau}
          disabled={!!laeuft}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {laeuft === 'vorschau' && <Loader2 size={14} className="animate-spin" />}
          Vorschau anzeigen
        </button>
        {zeilen && zeilen.length > 0 && (
          <button
            onClick={ausfuehren}
            disabled={!!laeuft || gewaehlt.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {laeuft === 'ausfuehren' && <Loader2 size={14} className="animate-spin" />}
            {gewaehlt.size} Akte(n) übernehmen
          </button>
        )}
      </div>
      {meldung && <p className="mt-2 text-sm text-slate-600">{meldung}</p>}
      {zeilen && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-slate-500">
            {geprueft} Akten geprüft, bei {zeilen.length} gibt es etwas zu tun. Häkchen entfernen, um eine Akte auszulassen.
          </p>
          {zeilen.length > 0 && (
            <ul className="max-h-[28rem] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 text-sm">
              {zeilen.map((z) => (
                <li key={z.kundeId} className="flex gap-3 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={gewaehlt.has(z.kundeId)} onChange={() => umschalten(z.kundeId)} />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700">{z.name}</p>
                    {z.ergaenzen.map((e, i) => (
                      <p key={`e${i}`} className="text-xs text-emerald-700">
                        {FELD_NAME[e.feld]} ergänzen: {e.wert} <span className="text-slate-400">(Mail vom {deDatum(e.mailDatum)})</span>
                      </p>
                    ))}
                    {z.vorschlaege.map((v, i) => (
                      <p key={`v${i}`} className="text-xs text-sky-700">
                        Hinweis in der Akte: {FELD_NAME[v.feld]} {v.wert} statt {v.bisher} <span className="text-slate-400">(Mail vom {deDatum(v.mailDatum)})</span>
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
