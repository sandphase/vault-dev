import { Router, Route, A } from "@solidjs/router";
import { onMount, Show } from "solid-js";
import {
  isSealed, setIsSealed, token, serverReachable, setServerReachable,
  setHasData, healthReady, setHealthReady, menuOpen, setMenuOpen
} from "./store";

import Sidebar from "./components/Sidebar";
import Unseal from "./pages/Unseal";
import Dashboard from "./pages/Dashboard";
import Apps from "./pages/Apps";
import Secrets from "./pages/Secrets";
import Access from "./pages/Access";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import Toaster from "./components/Toaster";
import { Menu, X, Shield } from "lucide-solid";

function Layout(props) {
  return (
    <div class="flex h-screen bg-[#0B1120] text-slate-300">
      <a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-cyan-500 focus:text-slate-950 focus:px-3 focus:py-2 focus:rounded-lg">
        Skip to content
      </a>
      <div class="hidden md:block">
        <Sidebar />
      </div>

      <Show when={menuOpen()}>
        <div class="md:hidden fixed inset-0 z-40">
          <button type="button" class="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div class="relative z-50 h-full w-72 max-w-[85vw] shadow-2xl">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      </Show>

      <div class="flex-1 flex flex-col min-w-0">
        <header class="md:hidden flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/80">
          <div class="flex items-center gap-2">
            <Shield class="w-5 h-5 text-cyan-400" aria-hidden="true" />
            <span class="font-semibold text-white">Titan Vault</span>
          </div>
          <button
            type="button"
            class="p-2 rounded-lg bg-slate-800 text-white min-w-10 min-h-10"
            aria-expanded={menuOpen()}
            aria-label={menuOpen() ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen(!menuOpen())}
          >
            {menuOpen() ? <X class="w-5 h-5" /> : <Menu class="w-5 h-5" />}
          </button>
        </header>
        <main id="main" class="flex-1 overflow-y-auto px-5 py-6 md:px-10 md:py-10 lg:px-14 lg:py-12">
          <div class="max-w-7xl mx-auto w-full relative">
            {props.children}
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

function Boot() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-[#0B1120] text-slate-300">
      <p class="text-slate-300">Connecting to Titan Vault…</p>
    </div>
  );
}

function ServerDown() {
  return (
    <div class="min-h-screen flex items-center justify-center bg-[#0B1120] p-4 text-center">
      <div class="max-w-lg bg-slate-900/80 backdrop-blur-md p-8 rounded-2xl border border-red-900/50 shadow-2xl shadow-red-900/10">
        <div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-white mb-2">Cannot reach the vault server</h1>
        <p class="text-slate-300 mb-4">The admin console could not load <code class="text-cyan-300">/sys/health</code>. If you are using Docker, start the stack and open this UI on port 8200.</p>
        <pre class="text-left text-xs bg-slate-950 border border-slate-800 rounded-xl p-4 text-cyan-300 overflow-x-auto mb-6">docker compose up --build</pre>
        <p class="text-sm text-slate-400 mb-6">Data persists in <code class="text-slate-300">./vault-data</code>. After it is healthy, unlock with the master password, then sign in (default token <code class="text-slate-300">root</code>).</p>
        <button type="button" onClick={() => window.location.reload()} class="px-6 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg font-semibold transition-colors">
          Try Again
        </button>
      </div>
      <Toaster />
    </div>
  );
}

function NotFound() {
  return (
    <div class="flex justify-center py-16">
      <div class="max-w-md w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-8 text-center shadow-lg shadow-black/20">
        <p class="text-6xl font-bold text-slate-500 mb-2">404</p>
        <h1 class="text-xl font-bold text-white mb-2">Page not found</h1>
        <p class="text-slate-300 mb-6">That route does not exist. Use the menu or pick a destination:</p>
        <div class="flex flex-col gap-2 text-sm">
          <A href="/" class="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold">Dashboard</A>
          <A href="/apps" class="px-4 py-2 rounded-lg bg-slate-800 text-white border border-slate-700">Apps</A>
          <A href="/secrets" class="px-4 py-2 rounded-lg bg-slate-800 text-white border border-slate-700">All secrets</A>
          <A href="/access" class="px-4 py-2 rounded-lg bg-slate-800 text-white border border-slate-700">Tokens</A>
          <A href="/logs" class="px-4 py-2 rounded-lg bg-slate-800 text-white border border-slate-700">Audit logs</A>
        </div>
      </div>
    </div>
  );
}

function App() {
  onMount(async () => {
    try {
      const res = await fetch("/sys/health");
      if (!res.ok) throw new Error("health failed");
      const data = await res.json();
      setIsSealed(!!data.sealed);
      if (data.has_data !== undefined) setHasData(!!data.has_data);
      setServerReachable(true);
    } catch (e) {
      console.error("Failed to check health", e);
      setServerReachable(false);
    } finally {
      setHealthReady(true);
    }
  });

  return (
    <Show when={healthReady()} fallback={<Boot />}>
      <Show when={serverReachable()} fallback={<ServerDown />}>
        <Show when={!isSealed()} fallback={<Unseal />}>
          <Show when={token()} fallback={<Unseal needToken />}>
            <Router root={Layout}>
              <Route path="/" component={Dashboard} />
              <Route path="/apps" component={Apps} />
              <Route path="/secrets" component={Secrets} />
              <Route path="/access" component={Access} />
              <Route path="/logs" component={Logs} />
              <Route path="/settings" component={Settings} />
              <Route path="*404" component={NotFound} />
            </Router>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

export default App;
