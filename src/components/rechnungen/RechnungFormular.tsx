// Rechnung anlegen oder bearbeiten (21.11.2026): Positionen aus der Preisliste oder frei, Übernahme aus einem
// Kostenvoranschlag, Leistungszeitraum, Anschrift, Hinweis auf der Rechnung, interne Notiz. Ältere Rechnungen
// ohne Positionen behalten ihre von Hand eingetragenen Beträge, bis jemand Positionen hinzufügt.
import { useEffect, useMemo, useState } from 'react'
import { FileInput } from 'lucide-react'
import { useApp } from '../../context/AppContext'
import { Field, Modal, PrimaryButton, SecondaryButton, inputClass } from '../ui'
import { KvPositionenEditor, euroText, zahlAusText, type KvPositionenWert } from '../KvPositionenEditor'
import { findeAkte, akteName, useKvNutzer } from '../KostenvoranschlaegeSection'
import { KUNDEN_BEREICHE } from '../../data/kundenBereiche'
import { addDays, today, uid } from '../../lib/dates'
import { naechsteRechnungsnummer, rundeCent, summeAusPositionen, ustSatzVon } from '../../lib/rechnungen'
import { ladeKostenvoranschlaegeFuerKunde, preisMitAufschlag, type Kostenvoranschlag } from '../../lib/kostenvoranschlaege'
import { anschriftFuer } from './aktionen'
import { kuerzelSpeichern, ladeRechnungsKuerzel, nummerVorschlagFuer, type KuerzelZeile } from '../../lib/rechnungsnummer'
import type { Rechnung, RechnungStatus } from '../../types'

const alsText = (n: number) => (Number.isFinite(n) ? rundeCent(n).toFixed(2).replace('.', ',') : '')

// vorlage (22.11.2026, Rechnungsvorschläge): Werte für eine NEUE Rechnung vorausfüllen (Kunde, Positionen, Steuersatz,
// Bezeichnung, Kostenvoranschlag, Notiz …); gilt nur ohne `rechnung`.
export function RechnungFormular({ rechnung, vorKundeId, vorlage, onClose, onGespeichert }: { rechnung?: Rechnung; vorKundeId?: string; vorlage?: Partial<Rechnung>; onClose: () => void; onGespeichert?: (id: string) => void }) {
  const { state, dispatch } = useApp()
  const nutzer = useKvNutzer()
  // Rechnungen der Holding gehen nie an private Kontakte (die Kollegen sähen nur „Kunde nicht gefunden“, die Rechnung
  // liefe trotzdem in Mahnwesen und Steuerberater-Export). Nur eine schon so verknüpfte Rechnung zeigt ihren Kontakt weiter.
  const anfangsKunde = rechnung?.kundeId ?? vorKundeId ?? vorlage?.kundeId
  const bereicheMitKunden = useMemo(
    () => KUNDEN_BEREICHE.map((b) => ({ ...b, kunden: b.id === 'privat' ? b.get(state).filter((k) => k.id === anfangsKunde) : b.get(state) })).filter((b) => b.kunden.length > 0),
    [state, anfangsKunde],
  )

  const [kundeId, setKundeId] = useState(rechnung?.kundeId ?? vorKundeId ?? vorlage?.kundeId ?? '')
  const [nummer, setNummer] = useState(rechnung?.nummer ?? naechsteRechnungsnummer(state.rechnungen))
  const [datum, setDatum] = useState(rechnung?.datum ?? today())
  const [leistungszeitraum, setLeistungszeitraum] = useState(rechnung?.leistungszeitraum ?? vorlage?.leistungszeitraum ?? '')
  const [status, setStatus] = useState<RechnungStatus>(rechnung?.status ?? 'Entwurf')
  const [zahlungsziel, setZahlungsziel] = useState(rechnung?.zahlungsziel ?? addDays(today(), 14))
  const [zielVonHand, setZielVonHand] = useState(!!rechnung && rechnung.zahlungsziel !== addDays(rechnung.datum, 14))
  // „Ohne Frist“ (GF 24.11.2026): kein „zahlbar bis“ auf Rechnung und Mail; intern Prüftag Rechnungsdatum + 30 Tage.
  const [ohneFrist, setOhneFrist] = useState(rechnung?.ohneZahlungsfrist === true)

  const [pos, setPos] = useState<KvPositionenWert>({
    positionen: rechnung?.positionen?.map((p) => ({ ...p })) ?? vorlage?.positionen?.map((p) => ({ ...p })) ?? [],
    aufschlagProzent: 0,
    ustSatz: rechnung ? ustSatzVon(rechnung) : (vorlage?.ustSatz ?? 19),
  })
  const [editorSchluessel, setEditorSchluessel] = useState(0)
  // Positionen oder (wie bei älteren Rechnungen) nur ein Betrag von Hand.
  const [positionenAn, setPositionenAn] = useState(rechnung ? !!rechnung.positionen?.length : true)
  // Ohne Positionen: Beträge von Hand (wie bisher).
  const [netto, setNetto] = useState(rechnung && !rechnung.positionen?.length ? alsText(rechnung.betragNetto) : '')
  const [brutto, setBrutto] = useState(rechnung && !rechnung.positionen?.length ? alsText(rechnung.betragBrutto) : '')
  const [bruttoVonHand, setBruttoVonHand] = useState(!!rechnung && !rechnung.positionen?.length && Math.abs(rundeCent(rechnung.betragNetto * (1 + ustSatzVon(rechnung) / 100)) - rechnung.betragBrutto) > 0.011)
  const [bezeichnung, setBezeichnung] = useState(rechnung?.leistungBezeichnung ?? vorlage?.leistungBezeichnung ?? '')

  const akte = findeAkte(state, kundeId)

  // Rechnungsnummer nach Vorgabe der Geschäftsführung (24.11.2026, src/lib/rechnungsnummer.ts): Kürzel des Kunden +
  // laufende Nummer, z. B. LSA-001. Nur für neue Rechnungen; das Feld bleibt änderbar. Lassen sich die Kürzel nicht
  // laden, bleibt der alte Vorschlag (RE-JJJJ-NNN).
  const [kuerzelListe, setKuerzelListe] = useState<KuerzelZeile[] | null>(null)
  const [nummerVonHand, setNummerVonHand] = useState(false)
  const [nummerMeldung, setNummerMeldung] = useState('')
  const [speichertGerade, setSpeichertGerade] = useState(false)
  useEffect(() => {
    if (rechnung) return
    let aktiv = true
    ladeRechnungsKuerzel().then((l) => {
      if (aktiv) setKuerzelListe(l)
    })
    return () => {
      aktiv = false
    }
  }, [rechnung])
  const nummerVorschlag = useMemo(
    () => (!rechnung && kuerzelListe && akte ? nummerVorschlagFuer(akte.kunde, kuerzelListe, state.rechnungen) : null),
    [rechnung, kuerzelListe, akte, state.rechnungen],
  )
  useEffect(() => {
    if (nummerVorschlag && !nummerVonHand) setNummer(nummerVorschlag.nummer)
  }, [nummerVorschlag, nummerVonHand])
  const [anschrift, setAnschrift] = useState(() => (rechnung ? anschriftFuer(rechnung, findeAkte(state, rechnung.kundeId)) : anschriftFuer({}, findeAkte(state, vorKundeId ?? vorlage?.kundeId))))
  const [anschriftSpeichern, setAnschriftSpeichern] = useState(true)
  const [hinweis, setHinweis] = useState(rechnung?.hinweis ?? vorlage?.hinweis ?? '')
  const [notiz, setNotiz] = useState(rechnung?.notiz ?? vorlage?.notiz ?? '')
  const [kvId, setKvId] = useState(rechnung?.kvId ?? vorlage?.kvId)

  const [kvListe, setKvListe] = useState<Kostenvoranschlag[] | null>(null)
  const [kvLaedt, setKvLaedt] = useState(false)
  const [kvFehler, setKvFehler] = useState('')
  const [kvMeldung, setKvMeldung] = useState('')

  function kundeWaehlen(id: string) {
    setKundeId(id)
    setKvListe(null)
    setKvMeldung('')
    if (!anschrift.trim() || (rechnung === undefined && anschrift === anschriftFuer({}, akte))) setAnschrift(anschriftFuer({}, findeAkte(state, id)))
  }

  function datumSetzen(neu: string) {
    setDatum(neu)
    if (!zielVonHand && neu) setZahlungsziel(addDays(neu, 14))
    // Neue Rechnung mit unveränderter Vorschlagsnummer: Nummer zum Jahr des Rechnungsdatums (z. B. im Januar eine
    // Rechnung vom 31.12. erfassen → RE-<Vorjahr>-…).
    if (!rechnung && /^\d{4}-\d{2}-\d{2}$/.test(neu) && nummer === naechsteRechnungsnummer(state.rechnungen, datum)) setNummer(naechsteRechnungsnummer(state.rechnungen, neu))
  }

  function nettoSetzen(text: string, satz = pos.ustSatz) {
    setNetto(text)
    const n = zahlAusText(text)
    if (!bruttoVonHand) setBrutto(Number.isFinite(n) ? alsText(n * (1 + satz / 100)) : '')
  }

  function posSetzen(w: KvPositionenWert) {
    if (w.ustSatz !== pos.ustSatz && !w.positionen.length && !bruttoVonHand) {
      const n = zahlAusText(netto)
      setBrutto(Number.isFinite(n) ? alsText(n * (1 + w.ustSatz / 100)) : '')
    }
    setPos(w)
  }

  async function kvLaden() {
    if (!kundeId) return
    setKvLaedt(true)
    setKvFehler('')
    try {
      setKvListe(await ladeKostenvoranschlaegeFuerKunde(kundeId))
    } catch (e) {
      setKvFehler(e instanceof Error ? e.message : 'Kostenvoranschläge ließen sich nicht laden.')
    } finally {
      setKvLaedt(false)
    }
  }

  function ausKv(id: string) {
    const kv = kvListe?.find((k) => k.id === id)
    if (!kv) return
    const auf = kv.aufschlagProzent ?? 0
    const positionen = kv.positionen?.length
      ? kv.positionen.map((p) => ({ ...p, id: uid('p'), einzelpreis: preisMitAufschlag(p.einzelpreis, auf) }))
      : [{ id: uid('p'), bezeichnung: kv.beschreibung || kv.name, menge: 1, einheit: 'Pauschal', einzelpreis: kv.betrag ?? 0 }]
    setPos({ positionen, aufschlagProzent: 0, ustSatz: kv.ustSatz ?? 19 })
    setPositionenAn(true)
    setEditorSchluessel((x) => x + 1)
    setKvId(kv.id)
    if (kv.beschreibung && !bezeichnung) setBezeichnung(kv.beschreibung)
    setKvMeldung(
      kv.positionen?.length
        ? `${positionen.length} Position${positionen.length === 1 ? '' : 'en'} aus „${kv.name}${kv.beschreibung ? ` – ${kv.beschreibung}` : ''}“ übernommen. Bitte prüfen und bei Bedarf anpassen.`
        : `Der Kostenvoranschlag hat keine Positionen — der Betrag wurde als eine Pauschale (netto) übernommen. Bitte prüfen.`,
    )
  }

  const mitPositionen = positionenAn && pos.positionen.length > 0

  function zuPositionen() {
    // Den von Hand eingetragenen Betrag als erste Position übernehmen.
    const n = zahlAusText(netto)
    if (!pos.positionen.length && Number.isFinite(n) && n > 0) {
      const menge = rechnung?.leistungMenge && bezeichnung === (rechnung.leistungBezeichnung ?? '') ? rechnung.leistungMenge : 1
      setPos({ ...pos, positionen: [{ id: uid('p'), bezeichnung: bezeichnung.trim() || 'Leistung', menge, einheit: menge !== 1 ? (rechnung?.leistungEinheit ?? 'Pauschal') : 'Pauschal', einzelpreis: rundeCent(n / menge) }] })
      setEditorSchluessel((x) => x + 1)
    }
    setPositionenAn(true)
  }
  const gebacken = pos.positionen.map((p) => ({ ...p, einzelpreis: preisMitAufschlag(p.einzelpreis, pos.aufschlagProzent) }))
  const ausPos = summeAusPositionen(gebacken, pos.ustSatz)
  const nettoZahl = mitPositionen ? ausPos.netto : zahlAusText(netto)
  const bruttoZahl = mitPositionen ? ausPos.brutto : zahlAusText(brutto)
  const nummerSauber = nummer.trim()
  const nummerVergeben = state.rechnungen.some((r) => r.id !== rechnung?.id && r.nummer.trim().toLowerCase() === nummerSauber.toLowerCase())
  const fehler = !kundeId
    ? 'Bitte einen Kunden wählen.'
    : !nummerSauber
      ? 'Bitte eine Rechnungsnummer eintragen.'
      : nummerVergeben
        ? `Die Rechnungsnummer ${nummerSauber} ist schon vergeben.`
        : !datum
          ? 'Bitte ein Rechnungsdatum eintragen.'
          : positionenAn && !pos.positionen.length
            ? 'Bitte mindestens eine Position anlegen (oder „nur einen Betrag eintragen“ wählen).'
            : mitPositionen && pos.positionen.some((p) => !p.bezeichnung.trim())
            ? 'Jede Position braucht eine Bezeichnung.'
            : !Number.isFinite(nettoZahl) || nettoZahl < 0
              ? 'Bitte Positionen anlegen oder einen gültigen Nettobetrag eintragen.'
              : !Number.isFinite(bruttoZahl) || bruttoZahl <= 0
                ? 'Der Rechnungsbetrag muss größer als 0 € sein.'
                : !zahlungsziel
                  ? 'Bitte ein Zahlungsziel eintragen.'
                  : ''

  async function speichern() {
    if (fehler || nutzer.nurLesen || speichertGerade) return
    // Erste Rechnung mit neuem Kürzel: das Kürzel vorher fest am Kunden speichern. War ein anderer schneller, neu rechnen.
    const kuerzelNeu = !rechnung && nummerVorschlag?.neu && nummerSauber.toUpperCase().startsWith(`${nummerVorschlag.kuerzel}-`) ? nummerVorschlag.kuerzel : ''
    if (kuerzelNeu) {
      setSpeichertGerade(true)
      const ergebnis = await kuerzelSpeichern(kundeId, kuerzelNeu)
      setSpeichertGerade(false)
      if (ergebnis !== 'ok') {
        if (ergebnis === 'vergeben') {
          setNummerVonHand(false)
          setKuerzelListe(await ladeRechnungsKuerzel())
          setNummerMeldung(`Das Kürzel ${kuerzelNeu} wurde gerade anders vergeben. Die Nummer ist neu vorgeschlagen — bitte prüfen und noch einmal anlegen.`)
        } else {
          setNummerMeldung('Das Rechnungskürzel ließ sich nicht speichern (keine Verbindung?). Bitte noch einmal versuchen.')
        }
        return
      }
    }
    const anschriftSauber = anschrift.split('\n').map((z) => z.trim()).filter(Boolean).join('\n')
    if (akte && anschriftSpeichern && anschriftSauber && anschriftSauber !== (akte.kunde.anschrift ?? '').trim()) {
      dispatch({ type: 'UPDATE_KUNDE_IN_BEREICH', bereich: akte.bereich, id: akte.kunde.id, patch: { anschrift: anschriftSauber } })
    }
    const bez = mitPositionen ? (bezeichnung.trim() || gebacken[0].bezeichnung.trim()) : bezeichnung.trim()
    const mengeBehalten = !mitPositionen && !!rechnung && bez === (rechnung.leistungBezeichnung ?? '')
    const werte: Partial<Rechnung> = {
      nummer: nummerSauber,
      kundeId,
      datum,
      betragNetto: rundeCent(nettoZahl),
      betragBrutto: rundeCent(bruttoZahl),
      status,
      zahlungsziel: ohneFrist ? addDays(datum, 30) : zahlungsziel,
      ohneZahlungsfrist: ohneFrist,
      leistungBezeichnung: bez || undefined,
      leistungEinheit: mengeBehalten ? rechnung?.leistungEinheit : undefined,
      leistungMenge: mengeBehalten ? rechnung?.leistungMenge : undefined,
      positionen: mitPositionen ? gebacken : undefined,
      ustSatz: pos.ustSatz,
      leistungszeitraum: leistungszeitraum.trim() || undefined,
      anschrift: anschriftSauber || undefined,
      hinweis: hinweis.trim() || undefined,
      notiz: notiz.trim() || undefined,
      kvId,
    }
    if (status === 'Bezahlt' && !rechnung?.bezahltAm) werte.bezahltAm = today()
    if (status !== 'Bezahlt' && rechnung?.status === 'Bezahlt') werte.bezahltAm = undefined
    if (rechnung) {
      const mahnstufeWeg = status === 'Bezahlt' || status === 'Entwurf'
      dispatch({ type: 'UPDATE_RECHNUNG', id: rechnung.id, patch: mahnstufeWeg ? { ...werte, mahnstufe: undefined } : werte })
      onGespeichert?.(rechnung.id)
    } else {
      const id = uid('r')
      dispatch({ type: 'ADD_RECHNUNG', rechnung: { ...(werte as Rechnung), id } })
      onGespeichert?.(id)
    }
    onClose()
  }

  const angenommen = (kvListe ?? []).filter((k) => k.status === 'angenommen')
  const sonstige = (kvListe ?? []).filter((k) => k.status === 'offen')

  return (
    <Modal
      open
      onClose={onClose}
      title={rechnung ? `Rechnung ${rechnung.nummer} bearbeiten` : 'Neue Rechnung'}
      width="max-w-3xl"
      aktionen={
        <PrimaryButton onClick={() => void speichern()} disabled={!!fehler || nutzer.nurLesen || speichertGerade}>
          {rechnung ? 'Speichern' : 'Anlegen'}
        </PrimaryButton>
      }
    >
      <Field label="Kunde">
        <select className={inputClass} value={kundeId} onChange={(e) => kundeWaehlen(e.target.value)}>
          <option value="">Bitte wählen …</option>
          {bereicheMitKunden.map((b) => (
            <optgroup key={b.id} label={b.label}>
              {b.kunden.map((k) => (
                <option key={k.id} value={k.id}>
                  {akteName(k)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
        <Field label="Rechnungsnummer">
          <input
            className={inputClass}
            value={nummer}
            onChange={(e) => {
              setNummer(e.target.value)
              setNummerVonHand(true)
              setNummerMeldung('')
            }}
            placeholder={kuerzelListe ? 'z. B. LSA-001' : 'z. B. RE-2026-001'}
          />
          {nummerVorschlag && (
            <span className="mt-1 block text-xs text-slate-400">
              {nummerVorschlag.neu ? `Neues Kürzel ${nummerVorschlag.kuerzel} für diesen Kunden (wird beim Anlegen fest vergeben)` : `Kürzel des Kunden: ${nummerVorschlag.kuerzel}`}
              {nummerVonHand && nummer !== nummerVorschlag.nummer && (
                <>
                  {' · '}
                  <button type="button" className="underline" onClick={() => setNummerVonHand(false)}>
                    Vorschlag {nummerVorschlag.nummer} übernehmen
                  </button>
                </>
              )}
            </span>
          )}
        </Field>
        <Field label="Rechnungsdatum">
          <input type="date" className={inputClass} value={datum} onChange={(e) => datumSetzen(e.target.value)} />
        </Field>
        <Field label="Zahlungsziel">
          <input
            type="date"
            className={inputClass}
            value={ohneFrist ? '' : zahlungsziel}
            disabled={ohneFrist}
            onChange={(e) => {
              setZahlungsziel(e.target.value)
              setZielVonHand(true)
            }}
          />
          <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-600" title="Auf Rechnung und Mail steht kein „zahlbar bis“. Den Geldeingang prüft das CRM intern nach 30 Tagen.">
            <input type="checkbox" checked={ohneFrist} onChange={(e) => setOhneFrist(e.target.checked)} /> ohne Frist (kein Zahlungsziel auf der Rechnung)
          </label>
        </Field>
      </div>
      <Field label="Leistungszeitraum oder Leistungsdatum">
        <input className={inputClass} value={leistungszeitraum} onChange={(e) => setLeistungszeitraum(e.target.value)} placeholder="z. B. 01.11.2026 – 15.11.2026 (leer = wie Rechnungsdatum)" />
      </Field>

      {/* Übernahme aus einem Kostenvoranschlag der Akte */}
      <div className="mb-3 rounded-lg border border-dashed border-slate-300 p-3">
        {kvListe === null ? (
          <button type="button" onClick={kvLaden} disabled={!kundeId || kvLaedt} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-700 hover:text-accent-800 disabled:text-slate-400">
            <FileInput size={15} /> {kvLaedt ? 'Lädt …' : 'Positionen aus einem Kostenvoranschlag übernehmen'}
          </button>
        ) : angenommen.length + sonstige.length === 0 ? (
          <p className="text-sm text-slate-500">In dieser Akte gibt es keinen angenommenen oder offenen Kostenvoranschlag.</p>
        ) : (
          <Field label="Kostenvoranschlag übernehmen">
            <select className={inputClass} value="" onChange={(e) => ausKv(e.target.value)}>
              <option value="">Bitte wählen …</option>
              {angenommen.length > 0 && (
                <optgroup label="Angenommen">
                  {angenommen.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                      {k.beschreibung ? ` – ${k.beschreibung}` : ''}
                      {k.betrag !== undefined ? ` · ${euroText(k.betrag)}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {sonstige.length > 0 && (
                <optgroup label="Noch nicht angenommen">
                  {sonstige.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                      {k.beschreibung ? ` – ${k.beschreibung}` : ''}
                      {k.betrag !== undefined ? ` · ${euroText(k.betrag)}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </Field>
        )}
        {!kundeId && kvListe === null && <p className="mt-1 text-xs text-slate-400">Erst einen Kunden wählen.</p>}
        {kvFehler && <p className="mt-1 text-xs text-rose-600">{kvFehler}</p>}
        {kvMeldung && <p className="mt-2 rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-800">{kvMeldung}</p>}
      </div>

      {positionenAn ? (
        <>
          <KvPositionenEditor key={editorSchluessel} wert={pos} onChange={posSetzen} nurLesen={nutzer.nurLesen} />
          {!pos.positionen.length && (
            <button type="button" onClick={() => setPositionenAn(false)} className="-mt-1 mb-3 text-xs font-medium text-slate-500 hover:text-accent-700">
              Ohne Positionen nur einen Betrag eintragen
            </button>
          )}
        </>
      ) : (
        <div className="mb-3 rounded-lg bg-slate-50 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">Ohne Positionen: Leistung und Betrag direkt eintragen.</p>
            <button type="button" onClick={zuPositionen} className="text-xs font-medium text-accent-600 hover:text-accent-700">
              Stattdessen Positionen anlegen
            </button>
          </div>
          <Field label="Leistung (Bezeichnung auf der Rechnung)">
            <input className={inputClass} value={bezeichnung} onChange={(e) => setBezeichnung(e.target.value)} placeholder="z. B. Vermögensschutzberatung" />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Betrag netto (€)">
              <input inputMode="decimal" className={inputClass} value={netto} onChange={(e) => nettoSetzen(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Betrag brutto (€)">
              <input
                inputMode="decimal"
                className={inputClass}
                value={brutto}
                onChange={(e) => {
                  setBrutto(e.target.value)
                  setBruttoVonHand(true)
                }}
                placeholder="0,00"
              />
            </Field>
            <Field label="Umsatzsteuer">
              <select className={inputClass} value={pos.ustSatz} onChange={(e) => posSetzen({ ...pos, ustSatz: Number(e.target.value) })}>
                <option value={19}>19 %</option>
                <option value={7}>7 %</option>
                <option value={0}>keine</option>
              </select>
            </Field>
          </div>
          {bruttoVonHand && (
            <button
              type="button"
              onClick={() => {
                setBruttoVonHand(false)
                const n = zahlAusText(netto)
                setBrutto(Number.isFinite(n) ? alsText(n * (1 + pos.ustSatz / 100)) : '')
              }}
              className="text-xs font-medium text-accent-600 hover:text-accent-700"
            >
              Brutto wieder aus Netto und {pos.ustSatz} % berechnen
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <div>
          <Field label="Anschrift des Kunden (Pflichtangabe auf der Rechnung)">
            <textarea className={inputClass} rows={3} value={anschrift} onChange={(e) => setAnschrift(e.target.value)} placeholder={'Straße Hausnummer\nPLZ Ort'} />
          </Field>
          {akte && anschrift.trim() && anschrift.split('\n').map((z) => z.trim()).filter(Boolean).join('\n') !== (akte.kunde.anschrift ?? '').trim() && (
            <label className="-mt-2 mb-3 flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={anschriftSpeichern} onChange={(e) => setAnschriftSpeichern(e.target.checked)} />
              Anschrift auch in der Akte {akteName(akte.kunde)} speichern
            </label>
          )}
          {!anschrift.trim() && <p className="-mt-2 mb-3 text-xs text-amber-700">Ohne Anschrift ist die Rechnung nicht vollständig.</p>}
        </div>
        <div>
          <Field label="Hinweis auf der Rechnung (optional)">
            <textarea
              className={inputClass}
              rows={3}
              value={hinweis}
              onChange={(e) => setHinweis(e.target.value)}
              placeholder={pos.ustSatz === 0 ? 'Bei 0 % bitte den Grund angeben, z. B. „Steuerfreie Leistung nach § 4 UStG“' : 'z. B. Bezug auf Vertrag oder Auftrag'}
            />
          </Field>
          {pos.ustSatz === 0 && !hinweis.trim() && <p className="-mt-2 mb-3 text-xs text-amber-700">Bei 0 % Umsatzsteuer muss der Grund auf der Rechnung stehen.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
        <Field label="Interne Notiz (nicht auf der Rechnung)">
          <textarea className={inputClass} rows={2} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
        </Field>
        {rechnung && (
          <Field label="Status">
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as RechnungStatus)}>
              <option value="Entwurf">Entwurf (noch nicht versendet)</option>
              <option value="Versendet">Versendet (offen)</option>
              <option value="Überfällig">Überfällig</option>
              <option value="Bezahlt">Bezahlt</option>
            </select>
          </Field>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-600">
          Rechnungsbetrag: <span className="font-semibold text-slate-900">{Number.isFinite(bruttoZahl) ? euroText(bruttoZahl) : '–'}</span>
          {Number.isFinite(nettoZahl) && <span className="text-slate-400"> (netto {euroText(nettoZahl)})</span>}
        </p>
        <div className="flex gap-2">
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <PrimaryButton onClick={() => void speichern()} disabled={!!fehler || nutzer.nurLesen || speichertGerade}>
            {rechnung ? 'Änderungen speichern' : 'Rechnung anlegen'}
          </PrimaryButton>
        </div>
      </div>
      {fehler && (kundeId || !!rechnung) && <p className="mt-2 text-xs text-rose-600">{fehler}</p>}
      {nummerMeldung && <p className="mt-2 text-xs text-amber-700">{nummerMeldung}</p>}
    </Modal>
  )
}
