// Dialoge an einer Rechnung (21.11.2026): Rechnung senden/als PDF, Zahlung erfassen, Mahnschreiben erstellen.
import { useMemo, useState } from 'react'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from '../ui'
import { euroText, zahlAusText } from '../KvPositionenEditor'
import { findeAkte } from '../KostenvoranschlaegeSection'
import { MAHNSTUFEN, nextMahnstufe } from '../../data/constants'
import { addDays, today, uid } from '../../lib/dates'
import { offenerBetrag, rundeCent, bezahlteSumme, vollstaendigBezahlt } from '../../lib/rechnungen'
import {
  deDatum,
  erzeugeMahnungPdf,
  erzeugeRechnungPdf,
  mahnBetraege,
  mahnVorlage,
  mahnstufeName,
  mahnungPdfDateiname,
  rechnungPdfDateiname,
} from '../../lib/rechnungPdf'
import { empfaengerZeilen, useRechnungAktionen } from './aktionen'
import { PdfVersandModal } from './PdfVersandModal'
import type { MahnstufeId, Rechnung, RechnungMahnung } from '../../types'

const ANREDE = 'Sehr geehrte Damen und Herren,'

// ---------------------------------------------------------------------------------------------
// Rechnung senden oder als PDF erstellen

export function RechnungSendenModal({ rechnung, onClose }: { rechnung: Rechnung; onClose: () => void }) {
  const { state, dispatch, nutzer, briefkopf, vermerk } = useRechnungAktionen()
  const akte = findeAkte(state, rechnung.kundeId)
  const [anrede, setAnrede] = useState(ANREDE)
  const [absender, setAbsender] = useState(nutzer.name)
  const empfaenger = empfaengerZeilen(rechnung, akte)
  const offen = offenerBetrag(rechnung) || rechnung.betragBrutto
  const dateiname = rechnungPdfDateiname(rechnung)

  const mailText = `${ANREDE}\n\nanbei erhalten Sie unsere Rechnung Nr. ${rechnung.nummer} vom ${deDatum(rechnung.datum)} über ${euroText(rechnung.betragBrutto)}.\nBitte überweisen Sie den Betrag von ${euroText(offen)} bis zum ${deDatum(rechnung.zahlungsziel)} auf das in der Rechnung genannte Konto.\n\nBei Fragen zur Rechnung sind wir gerne für Sie da.\n\nMit freundlichen Grüßen\n${nutzer.name}`

  return (
    <PdfVersandModal
      titel={`Rechnung ${rechnung.nummer} senden`}
      kundeId={rechnung.kundeId}
      standardEmail={akte?.kunde.email?.trim() ?? ''}
      standardBetreff={`Rechnung ${rechnung.nummer}`}
      standardMailText={mailText}
      dateiname={dateiname}
      erzeugePdf={() => erzeugeRechnungPdf(rechnung, { briefkopf, empfaenger, absender: absender.trim() || nutzer.name, anrede })}
      pruefen={() => (empfaenger.length < 2 ? 'Auf der Rechnung fehlt die Anschrift des Kunden. Bitte erst unter „Bearbeiten“ eintragen.' : '')}
      nurPdfHinweis="Das PDF wird heruntergeladen und in der Akte abgelegt. Die Rechnung gilt danach als versendet (z. B. per Post oder von Hand übergeben)."
      oben={
        <div className="mb-3 rounded-lg border border-slate-200 p-3">
          <div className="mb-2 text-xs font-medium text-slate-500">Empfänger auf der Rechnung</div>
          {empfaenger.length ? (
            <p className="mb-2 whitespace-pre-line text-sm text-slate-700">{empfaenger.join('\n')}</p>
          ) : (
            <p className="mb-2 text-sm text-amber-700">Kein Empfänger — bitte die Rechnung bearbeiten.</p>
          )}
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <Field label="Anrede auf der Rechnung">
              <input className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)} />
            </Field>
            <Field label="Name unter dem Gruß">
              <input className={inputClass} value={absender} onChange={(e) => setAbsender(e.target.value)} />
            </Field>
          </div>
        </div>
      }
      onErledigt={({ weg, an, dokument }) => {
        dispatch({
          type: 'UPDATE_RECHNUNG',
          id: rechnung.id,
          patch: {
            status: rechnung.status === 'Entwurf' ? 'Versendet' : rechnung.status,
            versendetAm: today(),
            versendetAn: weg === 'email' ? an : 'als PDF (Post/persönlich)',
            ...(dokument ? { dokument } : {}),
          },
        })
        vermerk(rechnung.kundeId, weg === 'email' ? `Rechnung ${rechnung.nummer} über ${euroText(rechnung.betragBrutto)} per E-Mail an ${an} gesendet` : `Rechnung ${rechnung.nummer} über ${euroText(rechnung.betragBrutto)} als PDF erstellt (Versand per Post/persönlich)`)
      }}
      onClose={onClose}
    />
  )
}

// ---------------------------------------------------------------------------------------------
// Zahlung erfassen (auch Teilzahlungen)

export function ZahlungErfassenModal({ rechnung, onClose }: { rechnung: Rechnung; onClose: () => void }) {
  const { dispatch, nutzer, vermerk } = useRechnungAktionen()
  const offen = offenerBetrag(rechnung)
  const [datum, setDatum] = useState(today())
  const [betrag, setBetrag] = useState(offen.toFixed(2).replace('.', ','))
  const [notiz, setNotiz] = useState('')
  const zahl = zahlAusText(betrag)
  const fehler = !datum ? 'Bitte das Datum des Zahlungseingangs eintragen.' : !Number.isFinite(zahl) || zahl <= 0 ? 'Bitte einen Betrag größer als 0 € eintragen.' : ''
  const nachher = Number.isFinite(zahl) ? rundeCent(bezahlteSumme(rechnung) + zahl) : 0
  const wirdBezahlt = Number.isFinite(zahl) && vollstaendigBezahlt(rechnung, nachher)

  function speichern() {
    if (fehler || nutzer.nurLesen) return
    const zahlungen = [...(rechnung.zahlungen ?? []), { id: uid('zahl'), datum, betrag: rundeCent(zahl), notiz: notiz.trim() || undefined, erfasstVon: nutzer.name }]
    dispatch({
      type: 'UPDATE_RECHNUNG',
      id: rechnung.id,
      patch: wirdBezahlt ? { zahlungen, status: 'Bezahlt', bezahltAm: datum, mahnstufe: undefined } : { zahlungen, status: rechnung.status === 'Entwurf' ? 'Versendet' : rechnung.status },
    })
    vermerk(
      rechnung.kundeId,
      wirdBezahlt
        ? `Zahlung über ${euroText(zahl)} zu Rechnung ${rechnung.nummer} erfasst — Rechnung vollständig bezahlt`
        : `Teilzahlung über ${euroText(zahl)} zu Rechnung ${rechnung.nummer} erfasst (noch offen: ${euroText(Math.max(0, rundeCent(rechnung.betragBrutto - nachher)))})`,
    )
    onClose()
  }

  return (
    <Modal open onClose={onClose} title={`Zahlung zu Rechnung ${rechnung.nummer} erfassen`}>
      <p className="mb-3 text-sm text-slate-600">
        Rechnungsbetrag {euroText(rechnung.betragBrutto)}
        {bezahlteSumme(rechnung) > 0 && <>, bereits gezahlt {euroText(bezahlteSumme(rechnung))}</>} — noch offen <span className="font-semibold text-slate-800">{euroText(offen)}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Zahlungseingang am">
          <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
        </Field>
        <Field label="Betrag (€)">
          <input inputMode="decimal" className={inputClass} value={betrag} onChange={(e) => setBetrag(e.target.value)} />
        </Field>
      </div>
      <Field label="Notiz (optional)">
        <input className={inputClass} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. Überweisung, bar, Verrechnung" />
      </Field>
      {!fehler && (
        <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${wirdBezahlt ? 'bg-emerald-50 text-emerald-800' : 'bg-sky-50 text-sky-800'}`}>
          {wirdBezahlt ? 'Damit ist die Rechnung vollständig bezahlt.' : `Teilzahlung — danach noch offen: ${euroText(Math.max(0, rundeCent(rechnung.betragBrutto - nachher)))}.`}
        </p>
      )}
      {fehler && <p className="mb-3 text-xs text-rose-600">{fehler}</p>}
      <div className="flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
        <PrimaryButton onClick={speichern} disabled={!!fehler || nutzer.nurLesen}>
          Zahlung speichern
        </PrimaryButton>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------------------------
// Zahlungserinnerung / 1. Mahnung / 2. Mahnung / Inkasso-Vermerk

export function MahnungModal({ rechnung, onClose }: { rechnung: Rechnung; onClose: () => void }) {
  const { state, dispatch, nutzer, briefkopf, vermerk } = useRechnungAktionen()
  const akte = findeAkte(state, rechnung.kundeId)
  const vorschlagStufe: MahnstufeId = nextMahnstufe(rechnung.mahnstufe) ?? 'inkasso'
  const [stufe, setStufe] = useState<MahnstufeId>(vorschlagStufe)
  const start = useMemo(() => mahnVorlage(rechnung, vorschlagStufe), [rechnung, vorschlagStufe])
  const [datum, setDatum] = useState(today())
  const [frist, setFrist] = useState(addDays(today(), start.tage || 7))
  const [gebuehr, setGebuehr] = useState(start.gebuehr.toFixed(2).replace('.', ','))
  const [anrede, setAnrede] = useState(ANREDE)
  const [text, setText] = useState(start.text)
  const [schluss, setSchluss] = useState(start.schluss)
  const [absender, setAbsender] = useState(nutzer.name)
  const [inkassoNotiz, setInkassoNotiz] = useState('')
  const empfaenger = empfaengerZeilen(rechnung, akte)

  function stufeWaehlen(s: MahnstufeId) {
    setStufe(s)
    const v = mahnVorlage(rechnung, s)
    if (s !== 'inkasso') {
      setFrist(addDays(datum || today(), v.tage))
      setGebuehr(v.gebuehr.toFixed(2).replace('.', ','))
      setText(v.text)
      setSchluss(v.schluss)
    }
  }

  const gebuehrZahl = gebuehr.trim() === '' ? 0 : zahlAusText(gebuehr)
  const betraege = mahnBetraege(rechnung, Number.isFinite(gebuehrZahl) ? gebuehrZahl : 0)
  const name = mahnstufeName(stufe)

  function eintragen(e: { weg: RechnungMahnung['weg']; an?: string; dokumentName?: string }) {
    const eintrag: RechnungMahnung = {
      id: uid('mahn'),
      datum,
      stufe,
      gebuehr: stufe === 'inkasso' ? 0 : rundeCent(gebuehrZahl || 0),
      neueFrist: stufe === 'inkasso' ? undefined : frist,
      weg: e.weg,
      an: e.an,
      dokumentName: e.dokumentName,
      von: nutzer.name,
    }
    dispatch({ type: 'UPDATE_RECHNUNG', id: rechnung.id, patch: { mahnungen: [...(rechnung.mahnungen ?? []), eintrag], mahnstufe: stufe, status: 'Überfällig' } })
    vermerk(
      rechnung.kundeId,
      stufe === 'inkasso'
        ? `Rechnung ${rechnung.nummer}: an Inkasso übergeben${inkassoNotiz.trim() ? ` (${inkassoNotiz.trim()})` : ''}`
        : `${name} zu Rechnung ${rechnung.nummer} ${e.weg === 'email' ? `per E-Mail an ${e.an} gesendet` : 'als PDF erstellt'} — neue Frist ${deDatum(frist)}, offen ${euroText(betraege.summe)}`,
    )
  }

  if (stufe === 'inkasso') {
    return (
      <Modal open onClose={onClose} title={`Rechnung ${rechnung.nummer}: Inkasso`}>
        <StufenWahl stufe={stufe} onStufe={stufeWaehlen} />
        <p className="mb-3 text-sm text-slate-600">
          Für die Übergabe an ein Inkassobüro wird kein Schreiben erzeugt. Hier wird nur vermerkt, dass und wann die Forderung übergeben wurde (offen: {euroText(betraege.summe)}).
        </p>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          <Field label="Übergeben am">
            <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
          </Field>
          <Field label="An wen / Aktenzeichen (optional)">
            <input className={inputClass} value={inkassoNotiz} onChange={(e) => setInkassoNotiz(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <PrimaryButton
            disabled={nutzer.nurLesen || !datum}
            onClick={() => {
              eintragen({ weg: 'vermerk', an: inkassoNotiz.trim() || undefined })
              onClose()
            }}
          >
            Übergabe vermerken
          </PrimaryButton>
        </div>
      </Modal>
    )
  }

  const dateiname = mahnungPdfDateiname(rechnung, stufe, datum)
  const mailText = `${ANREDE}\n\nanbei erhalten Sie unsere ${name} zu Rechnung Nr. ${rechnung.nummer} vom ${deDatum(rechnung.datum)}.\nBitte überweisen Sie den offenen Betrag von ${euroText(betraege.summe)} bis spätestens ${deDatum(frist)}.\n\nSollte sich Ihre Zahlung mit dieser Nachricht überschnitten haben, betrachten Sie sie bitte als gegenstandslos.\n\nMit freundlichen Grüßen\n${nutzer.name}`

  return (
    <PdfVersandModal
      titel={`${name} zu Rechnung ${rechnung.nummer}`}
      kundeId={rechnung.kundeId}
      standardEmail={akte?.kunde.email?.trim() ?? ''}
      standardBetreff={`${name} zu Rechnung ${rechnung.nummer}`}
      standardMailText={mailText}
      dateiname={dateiname}
      erzeugePdf={() =>
        erzeugeMahnungPdf(rechnung, { briefkopf, empfaenger, absender: absender.trim() || nutzer.name, stufe, datum, gebuehr: gebuehrZahl || 0, neueFrist: frist, anrede, text, schluss })
      }
      pruefen={() =>
        empfaenger.length < 2
          ? 'Es fehlt die Anschrift des Kunden. Bitte erst in der Rechnung unter „Bearbeiten“ eintragen.'
          : !frist || frist <= datum
            ? 'Die neue Frist muss nach dem Datum des Schreibens liegen.'
            : !Number.isFinite(gebuehrZahl) || gebuehrZahl < 0
              ? 'Bitte eine gültige Mahngebühr eintragen (0 für keine).'
              : ''
      }
      nurPdfHinweis="Das PDF wird heruntergeladen und in der Akte abgelegt; das Schreiben wird an der Rechnung vermerkt (z. B. für den Versand per Post)."
      oben={
        <div className="mb-3 rounded-lg border border-slate-200 p-3">
          <StufenWahl stufe={stufe} onStufe={stufeWaehlen} />
          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
            <Field label="Datum des Schreibens">
              <input type="date" className={inputClass} value={datum} onChange={(e) => setDatum(e.target.value)} />
            </Field>
            <Field label="Neue Frist">
              <input type="date" className={inputClass} value={frist} onChange={(e) => setFrist(e.target.value)} />
            </Field>
            <Field label="Mahngebühr (€)">
              <input inputMode="decimal" className={inputClass} value={gebuehr} onChange={(e) => setGebuehr(e.target.value)} />
            </Field>
          </div>
          <p className="-mt-1 mb-3 text-xs text-slate-500">
            Offener Rechnungsbetrag {euroText(Math.max(0, rundeCent(betraege.brutto - betraege.gezahlt)))}
            {betraege.fruehere > 0 && ` + frühere Mahngebühren ${euroText(betraege.fruehere)}`}
            {betraege.gebuehr > 0 && ` + Mahngebühr ${euroText(betraege.gebuehr)}`} = <span className="font-semibold text-slate-800">{euroText(betraege.summe)}</span>
          </p>
          <Field label="Anrede">
            <input className={inputClass} value={anrede} onChange={(e) => setAnrede(e.target.value)} />
          </Field>
          <Field label="Text vor der Aufstellung">
            <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Text nach der Aufstellung">
            <textarea className={inputClass} rows={3} value={schluss} onChange={(e) => setSchluss(e.target.value)} />
          </Field>
          <Field label="Name unter dem Gruß">
            <input className={inputClass} value={absender} onChange={(e) => setAbsender(e.target.value)} />
          </Field>
        </div>
      }
      onErledigt={({ weg, an, dokument }) => eintragen({ weg, an, dokumentName: dokument?.name ?? dateiname })}
      onClose={onClose}
    />
  )
}

function StufenWahl({ stufe, onStufe }: { stufe: MahnstufeId; onStufe: (s: MahnstufeId) => void }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {MAHNSTUFEN.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onStufe(m.id)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${stufe === m.id ? 'border-accent-600 bg-accent-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          {m.id === 'inkasso' ? 'An Inkasso übergeben' : m.label}
        </button>
      ))}
    </div>
  )
}
