import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import { ImmobilienKundenDetail } from '../../immobilien/ImmobilienKundenDetail'
import { NurEigeneAnsicht } from './AnsichtAlsHinweis'
import { useApp } from '../../../context/AppContext'
import { useBereichsRechte } from '../../../lib/bereichsRechte'
import { uebernimmKontaktMails } from '../../../lib/emailGateway'
import { getHauptpfad, getStatusMap } from '../../../data/statusNetworks'
import { today, uid } from '../../../lib/dates'

/** Akte eines eigenen privaten Immobilien-Kunden (/privat/immobilien/kunden/:id), mit „Ins Mayer-CRM übernehmen“. */
export function PrivatImmoKundeDetail() {
  return (
    <NurEigeneAnsicht>
      <Uebernehmen />
      <ImmobilienKundenDetail privat />
    </NurEigeneAnsicht>
  )
}

function Uebernehmen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useApp()
  const { darf } = useBereichsRechte()
  const [arbeitet, setArbeitet] = useState(false)
  const kontakt = state.privatKunden.find((k) => k.id === id && k.privatArt === 'immobilienkunden')
  if (!kontakt) return null
  const erlaubt = darf('immobilien')

  function los() {
    if (!kontakt || !erlaubt) return
    if (!window.confirm(`„${kontakt.firma}“ mit Gesuchen, Protokollen, Dokumenten und abgelegten Mails ins Mayer-CRM (Immobilien-Kunden) übernehmen? Danach sehen ihn alle Kollegen mit Immobilien-Recht. Zurück in den privaten Bereich geht nicht.`)) return
    setArbeitet(true)
    dispatch({
      type: 'MOVE_KUNDE_BEREICH',
      von: 'privat',
      nach: 'immobilienkunden',
      id: kontakt.id,
      patch: {
        status: getStatusMap('immobilienkunden')[kontakt.status] ? kontakt.status : getHauptpfad('immobilienkunden')[0],
        verantwortlichEmail: undefined,
        privatArt: undefined,
        letzteAktivitaet: today(),
        activities: [{ id: uid('act'), date: today(), text: 'Aus dem privaten Bereich ins Mayer-CRM übernommen', user: kontakt.verantwortlich }, ...kontakt.activities],
      },
    })
    uebernimmKontaktMails(kontakt.id, 'immobilienkunden', kontakt.firma || kontakt.ansprechpartner)
      .then((r) => {
        if (!r.ok) window.alert(`Der Kunde ist übernommen, aber nicht alle Mails: ${r.fehler.join('; ')}`)
      })
      .catch((e) => window.alert(`Der Kunde ist übernommen, die Mails noch nicht: ${e instanceof Error ? e.message : e}`))
    navigate(`/immobilien/kunden/${kontakt.id}`)
  }

  return (
    <div className="mb-3 flex justify-end">
      <button
        onClick={los}
        disabled={!erlaubt || arbeitet}
        title={erlaubt ? undefined : 'Dafür brauchst du das Recht für den Bereich Immobilien.'}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        <ArrowRightLeft size={13} /> Ins Mayer-CRM übernehmen
      </button>
    </div>
  )
}
