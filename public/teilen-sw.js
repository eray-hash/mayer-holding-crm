// Teilen-Ziel der installierten App (Android/Chrome): „Teilen → Mayer CRM" schickt die Dateien als
// POST (multipart) an ./teilen-ziel — siehe share_target im Manifest (vite.config.ts). Diese Datei
// wird vom erzeugten Service-Worker (vite-plugin-pwa, generateSW) per importScripts geladen; das
// Zwischenspeichern der App selbst (Workbox) bleibt unverändert. Workbox bedient nur GET-Anfragen,
// ein POST an ./teilen-ziel kommt also nur hier an.
//
// Ablauf: Dateien, Titel, Text und Internetadresse in einem eigenen Zwischenspeicher („mayer-geteilt")
// ablegen und die App auf #/ablegen umleiten. Die Seite (src/pages/ablegen/Ablegen.tsx) liest von
// dort, lädt beim Ablegen hoch und räumt danach auf. GitHub Pages selbst nimmt kein POST an — ohne
// aktiven Service-Worker würde das Teilen dort mit einem Fehler enden.
/* eslint-disable */
;(function () {
  var TEILEN_CACHE = 'mayer-geteilt'
  var PRAEFIX = '__geteilt/'

  function schluessel(name) {
    return new URL(PRAEFIX + name, self.registration.scope).href
  }

  async function leseListe(cache) {
    var antwort = await cache.match(schluessel('liste'))
    if (!antwort) return []
    try {
      var liste = await antwort.json()
      return Array.isArray(liste) ? liste : []
    } catch (e) {
      return []
    }
  }

  async function teilenEmpfangen(request) {
    var scope = self.registration.scope
    var stapel = String(Date.now())
    try {
      var form = await request.formData()
      var dateien = form.getAll('dateien').filter(function (f) {
        return f && typeof f === 'object' && typeof f.size === 'number' && f.size > 0
      })
      var text = function (feld) {
        var wert = form.get(feld)
        return typeof wert === 'string' ? wert.slice(0, 5000) : ''
      }
      var cache = await caches.open(TEILEN_CACHE)
      var eintrag = { stapel: stapel, am: new Date().toISOString(), titel: text('titel'), text: text('text'), adresse: text('adresse'), dateien: [] }
      for (var i = 0; i < dateien.length; i++) {
        var f = dateien[i]
        var key = schluessel(stapel + '/' + i)
        await cache.put(key, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }))
        eintrag.dateien.push({ schluessel: key, name: f.name || 'Datei ' + (i + 1), typ: f.type || '', groesse: f.size })
      }
      var liste = await leseListe(cache)
      liste.push(eintrag)
      await cache.put(schluessel('liste'), new Response(JSON.stringify(liste), { headers: { 'Content-Type': 'application/json' } }))
      return Response.redirect(scope + '#/ablegen?geteilt=' + stapel, 303)
    } catch (e) {
      return Response.redirect(scope + '#/ablegen?teilenFehler=1', 303)
    }
  }

  self.addEventListener('fetch', function (event) {
    var request = event.request
    if (request.method !== 'POST') return
    var url = new URL(request.url)
    if (url.pathname.slice(-'/teilen-ziel'.length) !== '/teilen-ziel') return
    event.respondWith(teilenEmpfangen(request))
  })
})()
