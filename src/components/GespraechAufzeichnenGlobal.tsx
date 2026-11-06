import { useMemo, useState } from 'react'
import { ArrowLeft, Phone, Search, UserPlus, Users } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { Modal, Field, inputClass, PrimaryButton, SecondaryButton } from './ui'
import { CallRecorder, type CallRecorderSave } from './CallRecorder'
import { suggestKundeByTelefon, suggestKundeKandidaten, type KundeMatch } from '../lib/matchKunde'
import { KUNDEN_BEREICHE } from '../data/kundenBereiche'
import { getHauptpfad } from '../data/statusNetworks'
import { today, uid } from '../lib/dates'
import type { Kunde, KundeBereich } from '../types'

// Reihenfolge, in der eine fertige Aufnahme einem Kunden/einer Notiz zugeordnet werden kann (siehe
// fuehreSpeicherung unten) — getrennt von KUNDEN_BEREICHE, da Privat hier bewusst einen eigenen,
// schnelleren Weg bekommt statt im Bereichs-Dropdown der "Neuer Kunde"-Option aufzutauchen.
const NEUER_KUNDE_BEREICHE = KUNDEN_BEREICHE.filter((b) => b.id !== 'privat')

type Ziel = { bereich: KundeBereich; kundeId: string; kundeName: string }

function protokollAus(aufnahme: CallRecorderSave, ziel: Ziel, verantwortlich: string) {
  return {
    id: uid('p'),
    bereich: ziel.bereich,
    kundeId: ziel.kundeId,
    datum: today(),
    teilnehmer: `${ziel.kundeName}, ${verantwortlich}`,
    betreff: aufnahme.summary ? 'Telefonat (KI-zusammengefasst)' : 'Telefonat (automatisch transkribiert)',
    text: aufnahme.transcript,
    kernthemen: aufnahme.summary?.kernthemen,
    vereinbarungen: aufnahme.summary?.vereinbarungen,
    offenePunkte: aufnahme.summary?.offene_punkte,
    stimmung: aufnahme.summary?.stimmung,
    kiZusammenfassung: aufnahme.summary?.zusammenfassung,
    dauerSekunden: aufnahme.dauerSekunden,
  }
}

// Globaler "Gespräch aufzeichnen"-Button (in der Topbar): erst wird aufgenommen/zusammengefasst,
// DANACH entscheidet der Mitarbeiter, was mit der fertigen Notiz passiert — einem bestehenden
// Kunden zuweisen, als neuen Kunden anlegen, oder sich selbst im Privat-Bereich merken. Vorher
// musste der Kunde VOR der Aufnahme gesucht werden — das war nicht das, was gebraucht wurde.
export function GespraechAufzeichnenGlobal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { dispatch } = useApp()
  const { mitarbeiter, session } = useAuth()
  const verantwortlich = mitarbeiter?.name ?? 'Ich'

  const [schritt, setSchritt] = useState<'aufnahme' | 'ziel' | 'zuweisen' | 'neuer_kunde' | 'privat'>('aufnahme')
  const [aufnahme, setAufnahme] = useState<CallRecorderSave | null>(null)

  function schliessen() {
    setSchritt('aufnahme')
    setAufnahme(null)
    onClose()
  }

  function speichernUndSchliessen(ziel: Ziel) {
    if (!aufnahme) return
    dispatch({ type: 'ADD_PROTOKOLL', protokoll: protokollAus(aufnahme, ziel, verantwortlich) })
    schliessen()
  }

  return (
    <Modal open={open} onClose={schliessen} title="Gespräch aufzeichnen" width="max-w-2xl">
      {schritt === 'aufnahme' && (
        <CallRecorder
          onCancel={schliessen}
          saveLabel="Weiter — Ziel wählen"
          onSave={(data) => {
            setAufnahme(data)
            setSchritt('ziel')
          }}
        />
      )}

      {schritt === 'ziel' && aufnahme && (
        <div>
          <AufnahmeRueckblick aufnahme={aufnahme} />
          <p className="mb-3 mt-5 text-sm font-medium text-slate-700">Was soll mit dieser Aufnahme passieren?</p>
          <div className="space-y-2">
            <ZielButton
              icon={<Search size={16} />}
              label="Bestehendem Kunden zuweisen"
              beschreibung="Per Telefonnummer oder Name suchen (über alle Bereiche)"
              onClick={() => setSchritt('zuweisen')}
            />
            <ZielButton
              icon={<UserPlus size={16} />}
              label="Als neuen Kunden anlegen"
              beschreibung="Legt einen neuen Lead/Kontakt in einem Bereich an und hängt die Notiz direkt an"
              onClick={() => setSchritt('neuer_kunde')}
            />
            <ZielButton
              icon={<Users size={16} />}
              label="Für mich selbst speichern"
              beschreibung="Landet als private Gesprächsnotiz in deinem Privat-Bereich, nur für dich sichtbar"
              onClick={() => setSchritt('privat')}
            />
          </div>
          <div className="mt-4 flex justify-start">
            <SecondaryButton onClick={() => setSchritt('aufnahme')}>
              <ArrowLeft size={14} /> Zurück zur Aufnahme
            </SecondaryButton>
          </div>
        </div>
      )}

      {schritt === 'zuweisen' && aufnahme && (
        <ZuweisenSchritt onZurueck={() => setSchritt('ziel')} onZiel={speichernUndSchliessen} />
      )}

      {schritt === 'neuer_kunde' && aufnahme && (
        <NeuerKundeSchritt onZurueck={() => setSchritt('ziel')} onZiel={speichernUndSchliessen} verantwortlich={verantwortlich} />
      )}

      {schritt === 'privat' && aufnahme && (
        <PrivatSchritt
          onZurueck={() => setSchritt('ziel')}
          onZiel={speichernUndSchliessen}
          verantwortlich={verantwortlich}
          verantwortlichEmail={session?.user.email}
        />
      )}
    </Modal>
  )
}

function AufnahmeRueckblick({ aufnahme }: { aufnahme: CallRecorderSave }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      {aufnahme.summary ? (
        <p className="text-sm text-slate-700">{aufnahme.summary.zusammenfassung}</p>
      ) : (
        <p className="line-clamp-3 text-sm text-slate-600">{aufnahme.transcript}</p>
      )}
      <details className="mt-2 text-xs text-slate-400">
        <summary className="cursor-pointer select-none hover:text-slate-600">Volles Transkript anzeigen</summary>
        <p className="mt-1.5 whitespace-pre-line text-slate-500">{aufnahme.transcript}</p>
      </details>
    </div>
  )
}

function ZielButton({ icon, label, beschreibung, onClick }: { icon: React.ReactNode; label: string; beschreibung: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-slate-200 px-3.5 py-3 text-left hover:border-accent-300 hover:bg-accent-50"
    >
      <span className="mt-0.5 text-accent-600">{icon}</span>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-400">{beschreibung}</span>
      </span>
    </button>
  )
}

function ZuweisenSchritt({ onZurueck, onZiel }: { onZurueck: () => void; onZiel: (ziel: Ziel) => void }) {
  const { state } = useApp()
  const [suche, setSuche] = useState('')

  const kandidaten = useMemo<KundeMatch[]>(() => {
    const text = suche.trim()
    if (!text) return []
    const perTelefon = suggestKundeByTelefon(state, text)
    if (perTelefon.length > 0) return perTelefon
    return suggestKundeKandidaten(state, text)
  }, [state, suche])

  return (
    <div>
      <Field label="Telefonnummer oder Name des Kunden">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${inputClass} pl-9`}
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="z.B. 0731 123456 oder Mustermann"
            autoFocus
          />
        </div>
      </Field>
      {suche.trim() && (
        <div className="mt-2 space-y-1.5">
          {kandidaten.length === 0 && <p className="px-1 text-sm text-slate-400">Kein Kunde gefunden.</p>}
          {kandidaten.map((k) => (
            <button
              key={`${k.bereich}-${k.kundeId}`}
              onClick={() => onZiel(k)}
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-accent-300 hover:bg-accent-50"
            >
              <Phone size={14} className="flex-shrink-0 text-slate-400" />
              <span className="text-slate-700">{k.kundeName}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-start">
        <SecondaryButton onClick={onZurueck}>
          <ArrowLeft size={14} /> Zurück
        </SecondaryButton>
      </div>
    </div>
  )
}

function NeuerKundeSchritt({
  onZurueck,
  onZiel,
  verantwortlich,
}: {
  onZurueck: () => void
  onZiel: (ziel: Ziel) => void
  verantwortlich: string
}) {
  const { dispatch } = useApp()
  const [bereich, setBereich] = useState<KundeBereich>(NEUER_KUNDE_BEREICHE[0].id)
  const [firma, setFirma] = useState('')
  const [ansprechpartner, setAnsprechpartner] = useState('')
  const [telefon, setTelefon] = useState('')
  const [email, setEmail] = useState('')

  function submit() {
    if (!firma.trim()) return
    const id = uid('k')
    const kunde: Kunde = {
      id,
      firma,
      ansprechpartner,
      email,
      telefon,
      prioritaet: 'Mittel',
      status: getHauptpfad(bereich)[0],
      followUp: { date: today(), note: 'Erstkontakt aus Gesprächsaufzeichnung', done: false },
      verantwortlich,
      letzteAktivitaet: today(),
      activities: [{ id: uid('act'), date: today(), text: 'Als neuer Kunde aus Gesprächsaufzeichnung angelegt', user: verantwortlich }],
    }
    switch (bereich) {
      case 'beratung': dispatch({ type: 'ADD_KUNDE', kunde }); break
      case 'erben': dispatch({ type: 'ADD_ERBEN_MANDANT', kunde }); break
      case 'betriebsuebergabe': dispatch({ type: 'ADD_BETRIEBSUEBERGABE_MANDANT', kunde }); break
      case 'betriebsformen': dispatch({ type: 'ADD_BETRIEBSFORMEN_MANDANT', kunde }); break
      case 'akademie': dispatch({ type: 'ADD_AKADEMIE_TEILNEHMER', kunde }); break
      case 'finanzierungen': dispatch({ type: 'ADD_FINANZIERUNGEN_MANDANT', kunde }); break
    }
    onZiel({ bereich, kundeId: id, kundeName: `${firma} (${ansprechpartner || firma})` })
  }

  return (
    <div>
      <Field label="Bereich">
        <select className={inputClass} value={bereich} onChange={(e) => setBereich(e.target.value as KundeBereich)}>
          {NEUER_KUNDE_BEREICHE.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </Field>
      <Field label="Firma/Name"><input className={inputClass} value={firma} onChange={(e) => setFirma(e.target.value)} autoFocus /></Field>
      <Field label="Ansprechpartner"><input className={inputClass} value={ansprechpartner} onChange={(e) => setAnsprechpartner(e.target.value)} /></Field>
      <Field label="Telefon"><input className={inputClass} value={telefon} onChange={(e) => setTelefon(e.target.value)} /></Field>
      <Field label="E-Mail"><input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div className="mt-4 flex justify-between">
        <SecondaryButton onClick={onZurueck}>
          <ArrowLeft size={14} /> Zurück
        </SecondaryButton>
        <PrimaryButton onClick={submit} disabled={!firma.trim()}>Anlegen & Notiz speichern</PrimaryButton>
      </div>
    </div>
  )
}

function PrivatSchritt({
  onZurueck,
  onZiel,
  verantwortlich,
  verantwortlichEmail,
}: {
  onZurueck: () => void
  onZiel: (ziel: Ziel) => void
  verantwortlich: string
  verantwortlichEmail?: string
}) {
  const { state, dispatch } = useApp()
  const [suche, setSuche] = useState('')

  const treffer = useMemo(() => {
    const text = suche.trim().toLowerCase()
    if (!text) return state.privatKunden
    return state.privatKunden.filter((k) => k.firma.toLowerCase().includes(text) || k.ansprechpartner.toLowerCase().includes(text))
  }, [state.privatKunden, suche])

  function neuAnlegenUndZuweisen() {
    const name = suche.trim()
    if (!name) return
    const id = uid('priv')
    dispatch({
      type: 'ADD_PRIVAT_KONTAKT',
      kunde: {
        id,
        firma: name,
        ansprechpartner: '',
        email: '',
        telefon: '',
        prioritaet: 'Mittel',
        status: 'neu',
        followUp: { date: today(), note: 'Erstkontakt', done: false },
        verantwortlich,
        verantwortlichEmail,
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: 'Kontakt aus Gesprächsaufzeichnung angelegt', user: verantwortlich }],
      },
    })
    onZiel({ bereich: 'privat', kundeId: id, kundeName: name })
  }

  return (
    <div>
      <Field label="Für wen/welches Meeting? (bestehenden Kontakt suchen oder neuen anlegen)">
        <input className={inputClass} value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="z.B. Meeting mit Thomas" autoFocus />
      </Field>
      <div className="mt-2 space-y-1.5">
        {treffer.map((k) => (
          <button
            key={k.id}
            onClick={() => onZiel({ bereich: 'privat', kundeId: k.id, kundeName: `${k.firma} (${k.ansprechpartner || k.firma})` })}
            className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-accent-300 hover:bg-accent-50"
          >
            <Users size={14} className="flex-shrink-0 text-slate-400" />
            <span className="text-slate-700">{k.firma}{k.ansprechpartner ? ` (${k.ansprechpartner})` : ''}</span>
          </button>
        ))}
        {suche.trim() && !treffer.some((k) => k.firma.toLowerCase() === suche.trim().toLowerCase()) && (
          <button
            onClick={neuAnlegenUndZuweisen}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-accent-300 px-3 py-2 text-left text-sm text-accent-700 hover:bg-accent-50"
          >
            <UserPlus size={14} className="flex-shrink-0" />
            Neuen privaten Kontakt „{suche.trim()}" anlegen
          </button>
        )}
      </div>
      <div className="mt-4 flex justify-start">
        <SecondaryButton onClick={onZurueck}>
          <ArrowLeft size={14} /> Zurück
        </SecondaryButton>
      </div>
    </div>
  )
}
