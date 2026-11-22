import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, PenLine, Phone, UserCheck } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { Card, Field, inputClass } from './ui'
import { ladeFirmenKontaktCrm, ladeProfilZusatz, speichereFirmenKontakt } from '../lib/meinProfilZusatz'
import {
  firmenKontaktAus,
  profilLuecken,
  pruefeTelefon,
  type FirmenKontakt,
  type ProfilFeld,
  type ProfilLuecke,
} from '../../supabase/functions/_shared/profilKern.ts'

// Profil-Vollständigkeit (Runde 5, 22.11.2026): Was in „Mein Profil“ fehlt und warum es wichtig ist —
// vor allem die Telefonnummer, die in automatischen Mails an Interessenten ({{Makler-Telefon}}), im
// Kundenbereich und im Exposé erscheint. Regeln und Texte: supabase/functions/_shared/profilKern.ts.
// - ProfilLueckenKarte: reine Anzeige (Mein Profil)
// - ProfilVollstaendigkeitHeute: lädt selbst, zeigt nur Wichtiges, „Später“ blendet 7 Tage aus (Heute)
// - FirmenTelefonEinstellung: Ersatznummer für alle ohne eigene Nummer (nur Geschäftsführung/Admin)

const SYMBOL: Record<ProfilFeld, typeof Phone> = { telefon: Phone, signatur: PenLine, position: Briefcase }

export function ProfilLueckenKarte({
  luecken,
  signaturTelefon,
  onTelefonUebernehmen,
  zumProfil,
  onSpaeter,
}: {
  luecken: ProfilLuecke[]
  /** In der Signatur gefundene Nummer (Angebot „übernehmen“), sonst leer. */
  signaturTelefon?: string
  onTelefonUebernehmen?: (nummer: string) => void
  /** Heute: Knopf „Profil ergänzen“. */
  zumProfil?: () => void
  onSpaeter?: () => void
}) {
  if (luecken.length === 0) return null
  const wichtig = luecken.some((l) => l.wichtig)
  return (
    <Card className={`mb-5 p-5 ${wichtig ? 'border-amber-200 bg-amber-50/40' : ''}`}>
      <h2 className={`mb-1 flex items-center gap-1.5 text-sm font-semibold ${wichtig ? 'text-amber-800' : 'text-slate-700'}`}>
        <UserCheck size={14} /> Dein Profil ist noch nicht vollständig
      </h2>
      <p className={`mb-3 text-xs ${wichtig ? 'text-amber-700/80' : 'text-slate-400'}`}>
        Diese Angaben nutzt das CRM in Mails, im Kundenbereich und im Exposé.
      </p>
      <ul className="mb-1 space-y-2.5">
        {luecken.map((l) => {
          const Symbol = SYMBOL[l.feld]
          return (
            <li key={l.feld} className="flex items-start gap-2.5 text-sm">
              <Symbol size={15} className={`mt-0.5 flex-shrink-0 ${l.wichtig ? 'text-amber-600' : 'text-slate-400'}`} />
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{l.titel}</span>
                {!l.wichtig && <span className="ml-1.5 text-xs text-slate-400">(freiwillig)</span>}
                <span className="block text-xs text-slate-500">{l.warum}</span>
                {l.feld === 'telefon' && signaturTelefon && onTelefonUebernehmen && (
                  <button onClick={() => onTelefonUebernehmen(signaturTelefon)} className="mt-1 text-xs font-medium text-accent-600 hover:underline">
                    Nummer aus deiner Signatur übernehmen: {signaturTelefon}
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {(zumProfil || onSpaeter) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {zumProfil && (
            <button onClick={zumProfil} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700">
              Profil ergänzen
            </button>
          )}
          {onSpaeter && (
            <button onClick={onSpaeter} className="text-xs font-medium text-slate-500 hover:underline">
              In einer Woche wieder zeigen
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

const SPAETER_SCHLUESSEL = 'profil-luecken-spaeter'
const SPAETER_TAGE = 7

function spaeterBis(email: string): number {
  try {
    return Number(localStorage.getItem(`${SPAETER_SCHLUESSEL}:${email}`) ?? 0) || 0
  } catch {
    return 0
  }
}

/** Karte für den Heute-Bildschirm: nur sichtbar, wenn Wichtiges fehlt (Telefon oder Signatur). */
export function ProfilVollstaendigkeitHeute() {
  const { state } = useApp()
  const { mitarbeiter } = useAuth()
  const navigate = useNavigate()
  const [zusatz, setZusatz] = useState<{ mobil: string; position: string } | null>(null)
  const [firma, setFirma] = useState<FirmenKontakt>(firmenKontaktAus(null))
  const [ausgeblendet, setAusgeblendet] = useState(false)
  const email = (mitarbeiter?.email ?? '').toLowerCase()

  useEffect(() => {
    if (!isSupabaseConfigured || !mitarbeiter?.id) return
    let aktiv = true
    setAusgeblendet(spaeterBis(email) > Date.now())
    Promise.all([ladeProfilZusatz(mitarbeiter.id), ladeFirmenKontaktCrm()])
      .then(([z, f]) => {
        if (!aktiv) return
        setZusatz(z)
        setFirma(f)
      })
      .catch(() => {
        // Tabelle noch nicht da oder kurz nicht erreichbar: dann eben ohne Karte.
      })
    return () => {
      aktiv = false
    }
  }, [mitarbeiter?.id, email])

  if (!isSupabaseConfigured || !mitarbeiter || !zusatz || ausgeblendet) return null
  const luecken = profilLuecken(
    {
      telefon: state.profil.telefon || mitarbeiter.telefon,
      mobil: zusatz.mobil,
      signatur: state.profil.signaturHtml || mitarbeiter.signatur_html,
      position: zusatz.position,
    },
    firma,
  )
  if (!luecken.some((l) => l.wichtig)) return null

  function spaeter() {
    try {
      localStorage.setItem(`${SPAETER_SCHLUESSEL}:${email}`, String(Date.now() + SPAETER_TAGE * 86_400_000))
    } catch {
      // Ohne Browserspeicher bleibt die Karte eben sichtbar.
    }
    setAusgeblendet(true)
  }

  return (
    <ProfilLueckenKarte
      luecken={luecken.filter((l) => l.wichtig)}
      zumProfil={() => navigate('/profil')}
      onSpaeter={spaeter}
    />
  )
}

/** Ersatznummer für Mails, Kundenbereich und Exposé, wenn ein Mitarbeiter keine eigene Nummer hat. */
export function FirmenTelefonEinstellung() {
  const { mitarbeiter } = useAuth()
  const darf = mitarbeiter?.rolle === 'geschaeftsfuehrung' || !!mitarbeiter?.ist_admin
  const [kontakt, setKontakt] = useState<FirmenKontakt | null>(null)
  const [telefon, setTelefon] = useState('')
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)
  const [speichert, setSpeichert] = useState(false)

  useEffect(() => {
    if (!darf || !isSupabaseConfigured) return
    let aktiv = true
    ladeFirmenKontaktCrm()
      .then((k) => {
        if (!aktiv) return
        setKontakt(k)
        setTelefon(k.telefon)
      })
      .catch(() => setMeldung({ ok: false, text: 'Die Einstellung konnte nicht geladen werden.' }))
    return () => {
      aktiv = false
    }
  }, [darf])

  if (!darf || !kontakt) return meldung && darf ? <p className="mb-5 text-xs font-medium text-rose-600">{meldung.text}</p> : null

  async function speichern(patch: { an?: boolean; telefon?: string }) {
    if (!kontakt) return
    if (patch.telefon !== undefined) {
      const p = pruefeTelefon(patch.telefon)
      if (!p.ok || !p.wert) {
        setMeldung({ ok: false, text: p.ok ? 'Bitte eine Nummer eintragen.' : p.grund })
        return
      }
      patch = { ...patch, telefon: p.wert }
    }
    setSpeichert(true)
    setMeldung(null)
    try {
      await speichereFirmenKontakt(patch, mitarbeiter?.name ?? '')
      const neu = { ...kontakt, ...patch } as FirmenKontakt
      setKontakt(neu)
      setTelefon(neu.telefon)
      setMeldung({ ok: true, text: 'Gespeichert.' })
    } catch {
      setMeldung({ ok: false, text: 'Nicht gespeichert. Bitte später noch einmal versuchen.' })
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <Card className="mb-5 p-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
        <Phone size={14} /> Firmennummer als Ersatz
      </h3>
      <p className="mb-3 text-xs text-slate-400">
        Hat ein Mitarbeiter keine Telefonnummer im Profil, steht diese Nummer in automatischen Mails an Interessenten und
        Seminarteilnehmer, im Kundenbereich und im Exposé. Nur Geschäftsführung und Admins können sie ändern.
      </p>
      <label className="mb-3 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={kontakt.an} disabled={speichert} onChange={(e) => speichern({ an: e.target.checked })} />
        <span>
          Firmennummer einsetzen, wenn eine eigene Nummer fehlt
          <span className="block text-xs text-slate-500">Ausgeschaltet fällt die Telefonzeile in diesen Fällen weg.</span>
        </span>
      </label>
      <Field label="Firmennummer">
        <div className="flex gap-2">
          <input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} disabled={!kontakt.an} />
          <button
            onClick={() => speichern({ telefon })}
            disabled={speichert || !kontakt.an || telefon.trim() === kontakt.telefon}
            className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Speichern
          </button>
        </div>
      </Field>
      {meldung && <p className={`text-xs font-medium ${meldung.ok ? 'text-emerald-600' : 'text-rose-600'}`}>{meldung.text}</p>}
    </Card>
  )
}
