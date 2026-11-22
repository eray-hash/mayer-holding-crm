import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // base: './' + HashRouter heißt: alles läuft unter einem einzigen index.html, der
      // Service-Worker-Scope/start_url muss relativ zum GitHub-Pages-Unterpfad bleiben statt "/"
      // fest anzunehmen.
      base: './',
      manifest: {
        name: 'Mayer Holding CRM',
        short_name: 'Mayer Holding',
        description: 'Internes CRM der Andreas Mayer Holding',
        lang: 'de',
        start_url: './#/heute',
        scope: './',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#4f46e5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // „Teilen → Mayer CRM" (nur Android/Chrome mit installierter App; das iPhone kennt das nicht):
        // Der Service-Worker nimmt den POST in public/teilen-sw.js an, legt die Dateien zwischen und
        // leitet auf #/ablegen um. Die Adresse ist relativ zum Manifest, liegt also im Scope.
        share_target: {
          action: './teilen-ziel',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'titel',
            text: 'text',
            url: 'adresse',
            files: [
              {
                name: 'dateien',
                accept: [
                  'image/*',
                  'application/pdf',
                  'text/*',
                  'audio/*',
                  'message/rfc822',
                  'application/msword',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.ms-excel',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  '.pdf', '.jpg', '.jpeg', '.png', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.eml', '.csv',
                ],
              },
            ],
          },
        },
        // Langes Drücken auf das App-Symbol (Android) führt direkt zur Ablage-Seite.
        shortcuts: [{ name: 'Datei ablegen', short_name: 'Ablegen', url: './#/ablegen', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }],
      },
      workbox: {
        // App-Shell-Strategie: HashRouter-Routen sind alle derselbe index.html, es gibt also
        // keine weiteren HTML-Seiten, die vorab zwischengespeichert werden müssten.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Das Hauptprogramm ist über die Standardgrenze von 2 MiB gewachsen (17.11.2026). Ohne diese
        // Angabe bricht der Bau ab und nichts wird veröffentlicht — die Datei muss aber vorab
        // zwischengespeichert werden, sonst startet die installierte App ohne Netz nicht.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Teilen-Ziel (POST an ./teilen-ziel) — eigener Abschnitt neben Workbox, siehe public/teilen-sw.js.
        // Am Zwischenspeichern und am automatischen Aktualisieren (registerType: 'autoUpdate') ändert das nichts.
        importScripts: ['teilen-sw.js'],
      },
    }),
  ],
})
