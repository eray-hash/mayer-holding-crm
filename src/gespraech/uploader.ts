// Hochladen im Hintergrund der offenen App: arbeitet die Aufnahmen im Gerätespeicher der Reihe nach ab
// (Schritte und Wartezeiten: warteschlange.ts). Angestoßen beim Start der App, nach jedem fertigen Abschnitt,
// wenn das Netz zurückkommt, wenn die App wieder in den Vordergrund kommt und nach Ablauf einer Wartezeit.
// Ohne offene App lädt nichts hoch (das iPhone erlaubt Web-Apps kein Hochladen im Hintergrund) — darauf
// weist die Oberfläche hin. Mehrere Fenster: navigator.locks sorgt dafür, dass nur eins hochlädt.

import * as speicher from './speicher'
import * as server from './server'
import { abschlussNummern, markerJson, mitFoto, mitSegment, nachErfolg, nachFehler, naechsterSchritt, type LokaleAufnahme, type Schritt } from './warteschlange'

/** Fertig abgeschlossene Aufnahmen bleiben so lange als Eintrag (ohne Ton) auf dem Gerät. */
const EINTRAG_BEHALTEN_MS = 7 * 24 * 3600_000

let laeuft = false
let nochmal = false
/** Angemeldete Person — hochgeladen werden nur ihre eigenen Aufnahmen (gemeinsam genutztes Gerät). */
let person = ''

export function setzePerson(email: string | null | undefined): void {
  const neu = String(email ?? '').trim().toLowerCase()
  if (neu === person) return
  person = neu
  if (person) anstossen()
}

export function aktuellePerson(): string {
  return person
}
let wecker: number | null = null

export function anstossen(): void {
  if (laeuft) {
    nochmal = true
    return
  }
  void lauf()
}

async function lauf(): Promise<void> {
  laeuft = true
  try {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks
    if (locks?.request) await locks.request('mayer-gespraech-hochladen', { ifAvailable: true }, async (lock) => (lock ? await abarbeiten() : undefined))
    else await abarbeiten()
  } catch {
    // Fehler einzelner Schritte stehen an der Aufnahme; hier nur der Gerätespeicher selbst.
  } finally {
    laeuft = false
    if (nochmal) {
      nochmal = false
      anstossen()
    } else {
      await planeWecker()
    }
  }
}

async function abarbeiten(): Promise<void> {
  do {
    nochmal = false
    if (!person) return
    const alle = (await speicher.alleAufnahmen()).filter((a) => a.mitarbeiterEmail === person)
    for (const a of alle) await bearbeite(a)
    await aufraeumen(alle)
  } while (nochmal)
}

/** Führt für eine Aufnahme Schritt um Schritt aus, bis nichts mehr zu tun ist oder ein Schritt scheitert. */
async function bearbeite(start: LokaleAufnahme): Promise<void> {
  let a: LokaleAufnahme | null = start
  for (let runde = 0; a && runde < 200; runde++) {
    const s = naechsterSchritt(a, Date.now(), navigator.onLine !== false)
    if (s.art === 'nichts' || s.art === 'warten') return
    const lokalId = a.lokalId
    try {
      a = await fuehreAus(a, s)
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      await speicher.aktualisiere(lokalId, (x) => nachFehler(x, Date.now(), text))
      return
    }
  }
}

async function fuehreAus(a: LokaleAufnahme, s: Schritt): Promise<LokaleAufnahme | null> {
  const id = a.serverId ?? ''
  switch (s.art) {
    case 'anlegen': {
      const serverId = await server.gespraechAnlegen({
        lokalId: a.lokalId,
        art: a.art,
        titel: a.titel || undefined,
        kundeId: a.kundeId,
        kundeBereich: a.kundeBereich,
        objektId: a.objektId,
        terminId: a.terminId,
        einwilligung: a.einwilligung,
        aufbewahrenTage: a.aufbewahrenTage,
      })
      return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, serverId }))
    }
    case 'segment_hochladen': {
      const seg = a.segmente.find((x) => x.nr === s.nr)!
      const datei = await speicher.holeSegment(a.lokalId, s.nr)
      if (!datei) {
        // Ton fehlt auf dem Gerät (sollte nicht vorkommen) — leeren Abschnitt nicht ewig versuchen.
        return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, segmente: x.segmente.filter((y) => y.nr !== s.nr) }))
      }
      const ziel = await server.gespraechUploadZiel(id, { nr: s.nr }, seg.mime || datei.type)
      await server.ladeHoch(ziel, datei, seg.mime || datei.type)
      return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg(mitSegment(x, s.nr, { status: 'hochgeladen', pfad: ziel.pfad, bytes: datei.size })))
    }
    case 'segment_melden': {
      const seg = a.segmente.find((x) => x.nr === s.nr)!
      await server.gespraechSegmentFertig(id, s.nr, seg.dauer_s, seg.bytes, seg.mime)
      const neu = await speicher.aktualisiere(a.lokalId, (x) => nachErfolg(mitSegment(x, s.nr, { status: 'gemeldet' })))
      // Der Server hat den Ton — auf dem Gerät Platz schaffen.
      await speicher.loescheSegment(a.lokalId, s.nr).catch(() => undefined)
      return neu
    }
    case 'foto_hochladen': {
      const foto = a.fotos.find((x) => x.n === s.n)!
      const datei = await speicher.holeFoto(a.lokalId, s.n)
      if (!datei) return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, fotos: x.fotos.filter((y) => y.n !== s.n) }))
      const ziel = await server.gespraechUploadZiel(id, { foto: s.n }, foto.mime || datei.type)
      await server.ladeHoch(ziel, datei, foto.mime || datei.type)
      return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg(mitFoto(x, s.n, { status: 'hochgeladen', pfad: ziel.pfad })))
    }
    case 'fotos_melden': {
      const neu = a.fotos.filter((f) => f.status === 'hochgeladen' && f.pfad)
      await server.gespraechNotiz(id, { fotos: neu.map((f) => ({ pfad: f.pfad!, name: f.name, sek: f.sek })) })
      const nummern = new Set(neu.map((f) => f.n))
      const erg = await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, fotos: x.fotos.map((f) => (nummern.has(f.n) ? { ...f, status: 'gemeldet' as const } : f)) }))
      for (const n of nummern) await speicher.loescheFoto(a.lokalId, n).catch(() => undefined)
      return erg
    }
    case 'marker': {
      const json = markerJson(a.marker)
      await server.gespraechMarker(id, a.marker)
      return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, markerGesendet: json }))
    }
    case 'notiz': {
      const text = a.notizen
      await server.gespraechNotiz(id, { notizen: text })
      return await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, notizenGesendet: text }))
    }
    case 'abschliessen': {
      await server.gespraechAbschliessen(id, a.dauer_s, abschlussNummern(a))
      const neu = await speicher.aktualisiere(a.lokalId, (x) => nachErfolg({ ...x, abgeschlossen: true }))
      await speicher.loescheDaten(a.lokalId).catch(() => undefined)
      return neu
    }
    default:
      return a
  }
}

/** Abgeschlossene Einträge nach einer Woche vom Gerät nehmen. */
async function aufraeumen(alle: LokaleAufnahme[]): Promise<void> {
  const grenze = Date.now() - EINTRAG_BEHALTEN_MS
  for (const a of alle) {
    if (a.abgeschlossen && new Date(a.erstelltAm).getTime() < grenze) await speicher.loescheAufnahme(a.lokalId).catch(() => undefined)
  }
}

/** Weckt das Hochladen, sobald die früheste Wartezeit abgelaufen ist. */
async function planeWecker(): Promise<void> {
  if (wecker !== null) window.clearTimeout(wecker)
  wecker = null
  let alle: LokaleAufnahme[] = []
  try {
    alle = await speicher.alleAufnahmen()
  } catch {
    return
  }
  const jetzt = Date.now()
  const bis = alle.filter((a) => a.mitarbeiterEmail === person && !a.abgeschlossen && a.naechsterVersuch > jetzt).map((a) => a.naechsterVersuch)
  if (bis.length === 0) return
  wecker = window.setTimeout(anstossen, Math.max(500, Math.min(...bis) - jetzt + 50))
}

let eingerichtet = false

/** Einmal beim Start der App: Netz zurück, App wieder sichtbar → weiter hochladen. */
export function richteHochladenEin(): void {
  if (eingerichtet) return
  eingerichtet = true
  window.addEventListener('online', () => {
    // Bei Netz sofort, ohne die Wartezeit abzuwarten.
    void speicher
      .alleAufnahmen()
      .then(async (alle) => {
        for (const a of alle) if (a.mitarbeiterEmail === person && !a.abgeschlossen && a.naechsterVersuch > 0) await speicher.aktualisiere(a.lokalId, (x) => ({ ...x, naechsterVersuch: 0 }))
      })
      .catch(() => undefined)
      .finally(anstossen)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') anstossen()
  })
  anstossen()
}
