// Typen für Server-Code aus supabase/functions/_shared, den die Gesprächs-App mitbenutzt (findeBezug aus
// terminBriefingKern.ts → kiVerbrauch.ts). Zur Laufzeit lenkt vite.config.ts die Module um
// (npm:@supabase/supabase-js@… → @supabase/supabase-js, node:async_hooks → shims/asyncHooks.ts);
// Deno.env wird im Browser nie aufgerufen (dort mit typeof Deno geschützt bzw. nur im Server-Pfad).
declare module 'npm:@supabase/supabase-js@2.119.1' {
  export * from '@supabase/supabase-js'
}
declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, arbeit: () => R): R
    getStore(): T | undefined
  }
}
// deno-lint-ignore no-var
declare var Deno: { env: { get(name: string): string | undefined } }
