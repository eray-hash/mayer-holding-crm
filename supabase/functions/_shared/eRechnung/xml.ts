// Kleiner, nachsichtiger XML-Leser für E-Rechnungen (Modul „E-Rechnung“, 23.11.2026).
// Läuft gleich im Browser und auf dem Server (kein DOMParser nötig). Namensräume werden nur als Vorsilbe
// mitgeführt; gesucht wird über den lokalen Namen (z. B. „ram:Name“ und „cbc:Name“ → „Name“).

export type XmlKnoten = { name: string; lokal: string; attr: Record<string, string>; kinder: XmlKnoten[]; text: string }

const ENTITAETEN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function entschluessle(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ENTITAETEN[e.toLowerCase()] ?? _
  })
}

const lokalVon = (name: string) => (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name)

/** Liest ein XML-Dokument und gibt das Wurzelelement zurück; wirft bei kaputtem Aufbau. */
export function leseXml(quelle: string): XmlKnoten {
  const s = quelle.replace(/^﻿/, '')
  const wurzel: XmlKnoten = { name: '#dokument', lokal: '#dokument', attr: {}, kinder: [], text: '' }
  const stapel: XmlKnoten[] = [wurzel]
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt < 0) break
    if (lt > i) stapel[stapel.length - 1].text += entschluessle(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) {
      const ende = s.indexOf('-->', lt + 4)
      i = ende < 0 ? s.length : ende + 3
      continue
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const ende = s.indexOf(']]>', lt + 9)
      stapel[stapel.length - 1].text += s.slice(lt + 9, ende < 0 ? s.length : ende)
      i = ende < 0 ? s.length : ende + 3
      continue
    }
    if (s.startsWith('<?', lt) || s.startsWith('<!', lt)) {
      const ende = s.indexOf('>', lt + 2)
      i = ende < 0 ? s.length : ende + 1
      continue
    }
    const gt = s.indexOf('>', lt + 1)
    if (gt < 0) throw new Error('XML unvollständig')
    const roh = s.slice(lt + 1, gt)
    i = gt + 1
    if (roh.startsWith('/')) {
      const name = roh.slice(1).trim()
      // Bis zum passenden offenen Element schließen (nachsichtig bei falsch verschachtelten Dateien).
      for (let k = stapel.length - 1; k > 0; k--) {
        if (stapel[k].name === name) {
          stapel.length = k
          break
        }
      }
      continue
    }
    const selbst = roh.endsWith('/')
    const inhalt = selbst ? roh.slice(0, -1) : roh
    const m = inhalt.match(/^\s*([^\s/>]+)/)
    if (!m) continue
    const name = m[1]
    const attr: Record<string, string> = {}
    for (const a of inhalt.slice(m[0].length).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attr[a[1]] = entschluessle(a[3] ?? a[4] ?? '')
    const knoten: XmlKnoten = { name, lokal: lokalVon(name), attr, kinder: [], text: '' }
    stapel[stapel.length - 1].kinder.push(knoten)
    if (!selbst) stapel.push(knoten)
  }
  const erstes = wurzel.kinder[0]
  if (!erstes) throw new Error('Kein XML-Inhalt')
  return erstes
}

/** Erstes Kind mit diesem lokalen Namen; mit Pfad „A/B/C“ über mehrere Ebenen. */
export function kind(k: XmlKnoten | undefined, pfad: string): XmlKnoten | undefined {
  let akt = k
  for (const teil of pfad.split('/')) {
    if (!akt) return undefined
    akt = akt.kinder.find((c) => c.lokal === teil)
  }
  return akt
}

/** Alle Kinder mit diesem lokalen Namen (eine Ebene). */
export function kinder(k: XmlKnoten | undefined, name: string): XmlKnoten[] {
  return k ? k.kinder.filter((c) => c.lokal === name) : []
}

/** Getrimmter Text des Elements am Pfad, sonst ''. */
export function text(k: XmlKnoten | undefined, pfad?: string): string {
  const z = pfad ? kind(k, pfad) : k
  return (z?.text ?? '').trim()
}

/** Zeichen für XML-Text und -Attribute maskieren. */
export function maske(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
