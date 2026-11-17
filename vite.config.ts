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
      },
    }),
  ],
})
