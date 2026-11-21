// Detailfenster einer Rechnung (21.11.2026, Wunsch von Eray: „Man muss damit was machen können“).
// Alles an einer Stelle: Beträge, Positionen, Fristen, Zahlungen, Mahnungen — und die Knöpfe zum Senden,
// PDF, Zahlung erfassen, Mahnen, Bearbeiten und Löschen. Auf dem Handy untereinander, Knöpfe oben.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, BellRing, Download, ExternalLink, FileText, Pencil, Send, Trash2, X } from 'lucide-react'
import { Modal } from '../ui'
import { RechnungStatusBadge } from '../../pages/beratung/KundenDetail'
import { euroText } from '../KvPositionenEditor'
import { akteName, aktePfad, findeAkte, oeffneKvDokument } from '../KostenvoranschlaegeSection'
import { nextMahnstufe } from '../../data/constants'
import { herunterladen } from '../../lib/briefe'
import {
  aktuelleFrist,
  angezeigterStatus,
  bezahlteSumme,
  faelligkeitText,
  istUeberfaellig,
  mahngebuehren,
  offenerBetrag,
  positionenFuerAnzeige,
  rundeCent,
  tageBisFrist,
  ustSatzVon,
  vollstaendigBezahlt,
} from '../../lib/rechnungen'
import { deDatum, erzeugeRechnungPdf, mahnstufeName, rechnungPdfDateiname } from '../../lib/rechnungPdf'
import { empfaengerZeilen, useRechnungAktionen } from './aktionen'
import { RechnungFormular } from './RechnungFormular'
import { MahnungModal, RechnungSendenModal, ZahlungErfassenModal } from './RechnungDialoge'

type Dialog = 'senden' | 'zahlung' | 'mahnung' | 'bearbeiten' | null

export function RechnungDetail({ rechnungId, onClose }: { rechnungId: string; onClose: () => void }) {
  const { state, dispatch, nutzer, briefkopf, vermerk } = useRechnungAktionen()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loeschenFrage, setLoeschenFrage] = useState(false)
  const [fehler, setFehler] = useState('')
  const r = state.rechnungen.find((x) => x.id === rechnungId)
  if (!r) return null

  const akte = findeAkte(state, r.kundeId)
  const status = angezeigterStatus(r)
  const ueberfaellig = istUeberfaellig(r)
  const tage = tageBisFrist(r)
  const ust = ustSatzVon(r)
  const gezahlt = bezahlteSumme(r)
  const offen = offenerBetrag(r)
  const gebuehren = mahngebuehren(r)
  const naechste = nextMahnstufe(r.mahnstufe)
  const empfaenger = empfaengerZeilen(r, akte)
  const nurLesen = nutzer.nurLesen

  function pdfHerunterladen() {
    setFehler('')
    try {
      herunterladen(erzeugeRechnungPdf(r!, { briefkopf, empfaenger, absender: nutzer.name }), rechnungPdfDateiname(r!))
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Das PDF ließ sich nicht erstellen.')
    }
  }

  function zahlungEntfernen(id: string) {
    const zahlungen = (r!.zahlungen ?? []).filter((z) => z.id !== id)
    const summe = rundeCent(zahlungen.reduce((s, z) => s + z.betrag, 0))
    const bezahlt = zahlungen.length > 0 && vollstaendigBezahlt(r!, summe)
    const letzteMahnung = [...(r!.mahnungen ?? [])].pop()
    dispatch({
      type: 'UPDATE_RECHNUNG',
      id: r!.id,
      patch:
        r!.status === 'Bezahlt' && !bezahlt
          ? { zahlungen, status: letzteMahnung ? 'Überfällig' : 'Versendet', bezahltAm: undefined, mahnstufe: letzteMahnung?.stufe }
          : { zahlungen },
    })
    vermerk(r!.kundeId, `Zahlung zu Rechnung ${r!.nummer} wieder entfernt`)
  }

  function loeschen() {
    dispatch({ type: 'DELETE_RECHNUNG', id: r!.id })
    onClose()
  }

  const knopf = 'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <>
      <Modal open={dialog === null} onClose={onClose} title={`Rechnung ${r.nummer}`} width="max-w-3xl">
        {/* Kopf: Kunde, Status, Fälligkeit */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {akte ? (
              <Link to={aktePfad(akte.bereich, akte.kunde)} className="inline-flex items-center gap-1 text-base font-semibold text-slate-800 hover:text-accent-700">
                {akteName(akte.kunde)} <ExternalLink size={13} className="text-slate-400" />
              </Link>
            ) : (
              <span className="text-base font-semibold text-slate-500">Kunde nicht gefunden</span>
            )}
            <div className="mt-0.5 text-sm text-slate-500">
              {r.leistungBezeichnung || 'Rechnung'} · vom {deDatum(r.datum)}
            </div>
          </div>
          <div className="sm:text-right">
            <div className="text-xl font-semibold text-slate-900">{euroText(r.betragBrutto)}</div>
            <div className="mt-1 flex items-center gap-2 sm:justify-end">
              <RechnungStatusBadge status={status} />
            </div>
            <div className={`mt-1 text-xs ${ueberfaellig ? 'font-medium text-rose-600' : tage !== null && tage <= 3 && r.status !== 'Bezahlt' ? 'text-amber-600' : 'text-slate-500'}`}>{faelligkeitText(r)}</div>
          </div>
        </div>

        {/* Knöpfe */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" disabled={nurLesen} onClick={() => setDialog('senden')} className={`${knopf} border-accent-600 bg-accent-600 text-white hover:bg-accent-700`}>
            <Send size={15} /> {r.status === 'Entwurf' ? 'Rechnung senden' : 'Erneut senden'}
          </button>
          <button type="button" onClick={pdfHerunterladen} className={`${knopf} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            <Download size={15} /> PDF herunterladen
          </button>
          {r.status !== 'Bezahlt' && (
            <button type="button" disabled={nurLesen} onClick={() => setDialog('zahlung')} className={`${knopf} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
              <Banknote size={15} /> Zahlung erfassen
            </button>
          )}
          {ueberfaellig && (
            <button type="button" disabled={nurLesen} onClick={() => setDialog('mahnung')} className={`${knopf} border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100`}>
              <BellRing size={15} /> {naechste ? `${mahnstufeName(naechste)} erstellen` : 'Mahnwesen'}
            </button>
          )}
          <button type="button" disabled={nurLesen} onClick={() => setDialog('bearbeiten')} className={`${knopf} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            <Pencil size={15} /> Bearbeiten
          </button>
          {r.dokument && (
            <button
              type="button"
              onClick={() => oeffneKvDokument(state, r.dokument!).catch((e) => setFehler(e instanceof Error ? e.message : 'Die Datei ließ sich nicht öffnen.'))}
              className={`${knopf} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            >
              <FileText size={15} /> Gesendetes PDF
            </button>
          )}
        </div>
        {fehler && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{fehler}</p>}

        {empfaenger.length < 2 && (
          <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> Die Anschrift des Kunden fehlt — sie ist Pflicht auf der Rechnung. Bitte unter „Bearbeiten“ eintragen.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Abschnitt titel="Beträge">
            <Zeile label="Netto" wert={euroText(r.betragNetto)} />
            <Zeile label={`Umsatzsteuer ${ust} %`} wert={euroText(rundeCent(r.betragBrutto - r.betragNetto))} />
            <Zeile label="Rechnungsbetrag" wert={euroText(r.betragBrutto)} fett />
            {gezahlt > 0 && <Zeile label="Bereits gezahlt" wert={euroText(gezahlt)} farbe="text-emerald-700" />}
            {r.status !== 'Bezahlt' && <Zeile label="Noch offen" wert={euroText(offen)} fett farbe={ueberfaellig ? 'text-rose-600' : undefined} />}
            {gebuehren > 0 && <Zeile label="Mahngebühren (zusätzlich)" wert={euroText(gebuehren)} />}
          </Abschnitt>
          <Abschnitt titel="Angaben">
            <Zeile label="Rechnungsdatum" wert={deDatum(r.datum)} />
            <Zeile label="Leistung" wert={r.leistungszeitraum?.trim() || 'wie Rechnungsdatum'} />
            <Zeile label="Zahlungsziel" wert={deDatum(r.zahlungsziel)} farbe={ueberfaellig ? 'text-rose-600' : undefined} />
            {aktuelleFrist(r) !== r.zahlungsziel && <Zeile label="Neue Frist (Mahnung)" wert={deDatum(aktuelleFrist(r))} />}
            <Zeile label="Versendet" wert={r.versendetAm ? `${deDatum(r.versendetAm)}${r.versendetAn ? ` · ${r.versendetAn}` : ''}` : r.status === 'Entwurf' ? 'noch nicht' : 'ja (ohne Datum)'} />
            {r.bezahltAm && <Zeile label="Bezahlt am" wert={deDatum(r.bezahltAm)} farbe="text-emerald-700" />}
            {r.mahnstufe && <Zeile label="Mahnstufe" wert={mahnstufeName(r.mahnstufe)} farbe="text-rose-600" />}
          </Abschnitt>
        </div>

        <Abschnitt titel="Positionen">
          <div className="divide-y divide-slate-100">
            {positionenFuerAnzeige(r).map((p, i) => (
              <div key={p.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="mr-1 text-slate-400">{i + 1}.</span>
                  <span className="text-slate-700">{p.bezeichnung}</span>
                  <div className="text-xs text-slate-400">
                    {p.menge.toLocaleString('de-DE')} {p.einheit} × {euroText(p.einzelpreis)}
                  </div>
                </div>
                <div className="whitespace-nowrap font-medium text-slate-700">{euroText(rundeCent(p.menge * p.einzelpreis))}</div>
              </div>
            ))}
          </div>
          {!r.positionen?.length && <p className="mt-1 text-xs text-slate-400">Ältere Rechnung ohne Positionen — auf dem PDF steht eine Zeile mit dem Nettobetrag.</p>}
        </Abschnitt>

        <Abschnitt titel={`Zahlungen${r.zahlungen?.length ? ` (${r.zahlungen.length})` : ''}`}>
          {!r.zahlungen?.length ? (
            <p className="text-sm text-slate-400">{r.status === 'Bezahlt' ? `Als bezahlt markiert${r.bezahltAm ? ` am ${deDatum(r.bezahltAm)}` : ''}, ohne einzelne Zahlungen.` : 'Noch keine Zahlung erfasst.'}</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {r.zahlungen.map((z) => (
                <div key={z.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                  <div className="min-w-0">
                    <span className="text-slate-700">{deDatum(z.datum)}</span>
                    {z.notiz && <span className="text-slate-400"> · {z.notiz}</span>}
                    {z.erfasstVon && <div className="text-xs text-slate-400">erfasst von {z.erfasstVon}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap font-medium text-emerald-700">{euroText(z.betrag)}</span>
                    {!nurLesen && (
                      <button type="button" onClick={() => zahlungEntfernen(z.id)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Zahlung entfernen" aria-label="Zahlung entfernen">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Abschnitt>

        {(r.mahnungen?.length ?? 0) > 0 && (
          <Abschnitt titel="Mahnungen">
            <div className="divide-y divide-slate-100">
              {r.mahnungen!.map((m) => (
                <div key={m.id} className="py-1.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-700">{mahnstufeName(m.stufe)}</span>
                    <span className="text-slate-500">{deDatum(m.datum)}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {m.weg === 'email' ? `per E-Mail an ${m.an}` : m.weg === 'pdf' ? 'als PDF erstellt' : m.an ? `vermerkt (${m.an})` : 'vermerkt'}
                    {m.neueFrist ? ` · Frist ${deDatum(m.neueFrist)}` : ''}
                    {m.gebuehr ? ` · Gebühr ${euroText(m.gebuehr)}` : ''}
                    {m.von ? ` · ${m.von}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </Abschnitt>
        )}

        {(empfaenger.length > 0 || r.hinweis || r.notiz) && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {empfaenger.length > 0 && (
              <Abschnitt titel="Empfänger">
                <p className="whitespace-pre-line text-sm text-slate-700">{empfaenger.join('\n')}</p>
                {akte?.kunde.email && <p className="mt-1 text-xs text-slate-500">{akte.kunde.email}</p>}
              </Abschnitt>
            )}
            {(r.hinweis || r.notiz) && (
              <Abschnitt titel="Hinweise">
                {r.hinweis && <p className="text-sm text-slate-700">Auf der Rechnung: {r.hinweis}</p>}
                {r.notiz && <p className="mt-1 text-sm text-slate-500">Intern: {r.notiz}</p>}
              </Abschnitt>
            )}
          </div>
        )}

        <div className="mt-2 border-t border-slate-100 pt-3">
          {loeschenFrage ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600">Rechnung {r.nummer} wirklich löschen?</span>
              <button type="button" onClick={loeschen} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">
                Ja, löschen
              </button>
              <button type="button" onClick={() => setLoeschenFrage(false)} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
                Abbrechen
              </button>
            </div>
          ) : (
            <button type="button" disabled={nurLesen} onClick={() => setLoeschenFrage(true)} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600 disabled:opacity-50">
              <Trash2 size={13} /> Rechnung löschen
            </button>
          )}
        </div>
      </Modal>

      {dialog === 'senden' && <RechnungSendenModal rechnung={r} onClose={() => setDialog(null)} />}
      {dialog === 'zahlung' && <ZahlungErfassenModal rechnung={r} onClose={() => setDialog(null)} />}
      {dialog === 'mahnung' && <MahnungModal rechnung={r} onClose={() => setDialog(null)} />}
      {dialog === 'bearbeiten' && <RechnungFormular rechnung={r} onClose={() => setDialog(null)} />}
    </>
  )
}

function Abschnitt({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-slate-200 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{titel}</div>
      {children}
    </div>
  )
}

function Zeile({ label, wert, fett, farbe }: { label: string; wert: string; fett?: boolean; farbe?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right ${fett ? 'font-semibold' : ''} ${farbe ?? 'text-slate-800'}`}>{wert}</span>
    </div>
  )
}
