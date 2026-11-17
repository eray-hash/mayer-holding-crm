// Druckausgabe der Arbeitsblätter der Immobilienabteilung (Verkaufsdatenblatt, Vorab-Kurzprüfung):
// eine schlichte Seite in neuem Fenster, die der Browser druckt oder als PDF speichert.

export type DruckAbschnitt = {
  titel: string
  /** Zeilen "Bezeichnung → Wert", oder eine Tabelle mit Kopfzeile. */
  zeilen?: [string, string][]
  tabelle?: { kopf: string[]; zeilen: string[][] }
}

function html(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
}

export function druckeBlatt(titel: string, untertitel: string, abschnitte: DruckAbschnitt[]): void {
  const fenster = window.open('', '_blank')
  if (!fenster) return
  const teile = abschnitte
    .map((a) => {
      const inhalt = a.tabelle
        ? `<table><thead><tr>${a.tabelle.kopf.map((k) => `<th>${html(k)}</th>`).join('')}</tr></thead><tbody>${a.tabelle.zeilen
            .map((z) => `<tr>${z.map((w) => `<td>${html(w)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`
        : `<table>${(a.zeilen ?? []).map(([b, w]) => `<tr>${b ? `<td class="b">${html(b)}</td>` : ''}<td${b ? '' : ' colspan="2"'}>${html(w) || '&nbsp;'}</td></tr>`).join('')}</table>`
      return `<section><h2>${html(a.titel)}</h2>${inhalt}</section>`
    })
    .join('')
  fenster.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${html(titel)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;margin:28px;font-size:12px}
    h1{font-size:18px;margin:0 0 2px}p.u{color:#475569;margin:0 0 14px}
    section{margin:0 0 12px;break-inside:avoid}h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#475569;margin:0 0 4px;border-bottom:1px solid #94a3b8;padding-bottom:2px}
    table{border-collapse:collapse;width:100%}td,th{padding:3px 6px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
    th{font-size:11px;color:#64748b}td.b{width:32%;color:#475569}
    .fuss{margin-top:16px;color:#64748b;font-size:10px}
  </style></head><body><h1>${html(titel)}</h1><p class="u">${html(untertitel)}</p>${teile}<p class="fuss">Andreas Mayer Holding · Immobilienabteilung</p></body></html>`)
  fenster.document.close()
  fenster.focus()
  fenster.print()
}
