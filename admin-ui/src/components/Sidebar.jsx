import { A, useLocation } from "@solidjs/router";
import { Shield, Key, Users, Activity, Settings, Lock, AlertTriangle, LogOut, Layers } from "lucide-solid";
import { saveToken, setIsSealed, addToast, vaultFetch } from "../store";
import { createSignal, onCleanup } from "solid-js";

export const navItems = [
  { path: "/", name: "Dashboard", hint: "Overview", icon: Shield },
  { path: "/apps", name: "Apps", hint: "Write once, override per app", icon: Layers },
  { path: "/secrets", name: "All secrets", hint: "Raw path editor", icon: Key },
  { path: "/access", name: "Tokens", hint: "Issue and list tokens", icon: Users },
  { path: "/logs", name: "Audit logs", hint: "History of actions", icon: Activity },
  { path: "/settings", name: "Settings", hint: "Alerts and lock vault", icon: Settings },
];

export default function Sidebar(props) {
  const location = useLocation();
  const [confirmSeal, setConfirmSeal] = createSignal(false);
  const [sealLeft, setSealLeft] = createSignal(10);
  let sealTimer;

  const clearSealTimer = () => {
    if (sealTimer) {
      clearInterval(sealTimer);
      sealTimer = null;
    }
  };

  onCleanup(clearSealTimer);

  const closeMobile = () => props.onNavigate?.();

  const handleLogout = () => {
    saveToken("");
    addToast("Signed out. The vault is still unlocked.", "success");
    closeMobile();
  };

  const handleSeal = async () => {
    if (!confirmSeal()) {
      setConfirmSeal(true);
      setSealLeft(10);
      clearSealTimer();
      sealTimer = setInterval(() => {
        setSealLeft((n) => {
          if (n <= 1) {
            clearSealTimer();
            setConfirmSeal(false);
            return 10;
          }
          return n - 1;
        });
      }, 1000);
      return;
    }

    clearSealTimer();
    try {
      const res = await vaultFetch("/sys/seal", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to lock the vault");
      }
      try { sessionStorage.setItem("vault_just_sealed", "1"); } catch (e) {}
      setIsSealed(true);
      saveToken("");
      addToast("Vault locked. Session cleared. Unlock with the master password, then sign in.", "success");
      window.location.href = "/";
    } catch (e) {
      addToast(e.message || "Failed to lock the vault", "error");
      setConfirmSeal(false);
    }
  };

  return (
    <div class="w-72 bg-slate-900/50 backdrop-blur-md border-r border-slate-800 flex flex-col h-full shadow-2xl">
      <div class="px-6 pt-8 pb-6 flex items-center space-x-3">
        <div class="p-2.5 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-slate-700/50 rounded-xl shadow-inner">
          <Shield class="w-7 h-7 text-cyan-400" aria-hidden="true" />
        </div>
        <div>
          <span class="text-xl font-bold text-white tracking-tight block">Titan Vault</span>
          <span class="text-xs uppercase tracking-widest text-slate-400 font-semibold">Admin Console</span>
        </div>
      </div>

      <nav class="flex-1 px-4 space-y-2 mt-2" aria-label="Main">
        {navItems.map((item) => {
          const active = () => location.pathname === item.path;
          return (
            <A
              href={item.path}
              onClick={closeMobile}
              aria-current={active() ? "page" : undefined}
              class={`flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all ${active() ? "bg-cyan-500/10 text-cyan-400 font-semibold shadow-inner border border-cyan-500/10" : "text-slate-300 hover:text-white hover:bg-slate-800/50 font-medium"}`}
            >
              <item.icon class="w-5 h-5 flex-shrink-0" aria-hidden="true" />
              <span class="flex flex-col gap-0.5 min-w-0">
                <span>{item.name}</span>
                <span class="text-xs font-normal text-slate-400 leading-snug">{item.hint}</span>
              </span>
            </A>
          );
        })}
      </nav>

      <div class="p-6 border-t border-slate-800/50 bg-slate-900/30 space-y-3">
        <button
          type="button"
          onClick={handleLogout}
          class="w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl font-semibold text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 transition-all"
        >
          <LogOut class="w-4 h-4" aria-hidden="true" />
          <span>Sign out</span>
        </button>
        <button
          type="button"
          onClick={handleSeal}
          aria-live="polite"
          class={`w-full flex items-center justify-center space-x-2 px-4 py-3 rounded-xl transition-all font-semibold ${
            confirmSeal()
              ? "bg-red-500 text-slate-950 shadow-red-500/30 hover:bg-red-400"
              : "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20"
          }`}
        >
          {confirmSeal() ? <AlertTriangle class="w-4 h-4" aria-hidden="true" /> : <Lock class="w-4 h-4" aria-hidden="true" />}
          <span>{confirmSeal() ? `Click again to lock (${sealLeft()}s)` : "Lock vault"}</span>
        </button>
        <p class="text-xs text-slate-400 leading-snug">
          Lock drops the key from memory. Secrets stay encrypted on disk. You will need the master password and a token to return. Sign out only clears this browser session.
        </p>
      </div>
    </div>
  );
}
