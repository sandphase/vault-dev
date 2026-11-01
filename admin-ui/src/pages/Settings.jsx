import { createResource, Show, createSignal, onCleanup } from "solid-js";
import { AlertTriangle, Bell, Lock } from "lucide-solid";
import { vaultFetch, addToast, saveToken, setIsSealed, setMenuOpen } from "../store";

const fetchSettings = async () => {
  const res = await vaultFetch("/sys/settings");
  if (!res.ok) throw new Error("Failed to load settings");
  return await res.json();
};

export default function Settings() {
  const [settings] = createResource(fetchSettings);
  const [confirmSeal, setConfirmSeal] = createSignal(false);
  const [sealLeft, setSealLeft] = createSignal(10);
  let sealTimer;

  onCleanup(() => { if (sealTimer) clearInterval(sealTimer); });

  const handleSeal = async () => {
    if (!confirmSeal()) {
      setConfirmSeal(true);
      setSealLeft(10);
      if (sealTimer) clearInterval(sealTimer);
      sealTimer = setInterval(() => {
        setSealLeft((n) => {
          if (n <= 1) {
            clearInterval(sealTimer);
            setConfirmSeal(false);
            return 10;
          }
          return n - 1;
        });
      }, 1000);
      return;
    }
    if (sealTimer) clearInterval(sealTimer);
    try {
      const res = await vaultFetch("/sys/seal", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to lock the vault");
      }
      try { sessionStorage.setItem("vault_just_sealed", "1"); } catch (e) {}
      setIsSealed(true);
      saveToken("");
      setMenuOpen(false);
      addToast("Vault locked. Session cleared.", "success");
      window.location.href = "/";
    } catch (e) {
      addToast(e.message, "error");
      setConfirmSeal(false);
    }
  };

  return (
    <div class="space-y-10">
      <div>
        <h1 class="text-3xl font-bold text-white tracking-tight">Settings</h1>
        <p class="text-slate-400 text-base mt-3 leading-relaxed">Optional alerts, trap credential, and lock vault.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl p-8 space-y-5 shadow-lg shadow-black/20">
          <div class="flex items-center space-x-3 mb-4">
            <Bell class="w-6 h-6 text-cyan-400" aria-hidden="true" />
            <h2 class="text-xl font-bold text-white">Telegram alerts (optional)</h2>
          </div>
          <p class="text-sm text-slate-300">Not editable here. Set them on the container, then restart:</p>
          <pre class="text-xs bg-slate-950 border border-slate-800 rounded-xl p-3 text-cyan-300 overflow-x-auto">TELEGRAM_BOT_TOKEN=…
TELEGRAM_CHAT_ID=…</pre>
          <dl class="space-y-3">
            <div class="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-4 py-3">
              <dt class="text-sm text-slate-300">Bot token</dt>
              <dd>
                <Show when={!settings.loading} fallback={<span class="text-slate-400 text-sm">Checking…</span>}>
                  <span class={`text-xs font-semibold px-2 py-1 rounded-md ${settings()?.telegram_bot_configured ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-400"}`}>
                    {settings()?.telegram_bot_configured ? "Configured" : "Not set"}
                  </span>
                </Show>
              </dd>
            </div>
            <div class="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg px-4 py-3">
              <dt class="text-sm text-slate-300">Chat ID</dt>
              <dd>
                <Show when={!settings.loading} fallback={<span class="text-slate-400 text-sm">Checking…</span>}>
                  <span class={`text-xs font-semibold px-2 py-1 rounded-md ${settings()?.telegram_chat_configured ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-400"}`}>
                    {settings()?.telegram_chat_configured ? "Configured" : "Not set"}
                  </span>
                </Show>
              </dd>
            </div>
          </dl>
        </div>

        <div class="bg-slate-900/80 backdrop-blur-sm border border-red-900/30 rounded-2xl p-8 space-y-5 relative overflow-hidden shadow-lg shadow-black/20">
          <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-600 to-orange-500"></div>
          <div class="flex items-center space-x-3 mb-4">
            <AlertTriangle class="w-6 h-6 text-red-500" aria-hidden="true" />
            <h2 class="text-xl font-bold text-white">Trap credential (do not use)</h2>
          </div>
          <p class="text-slate-300 text-sm">
            Off by default. Reads return a clean JSON object so any app can use the spec.
            Optional bait: set <code class="text-slate-200">TITAN_INJECT_HONEYTOKEN=1</code> and <code class="text-slate-200">TITAN_HONEYTOKEN_VALUE</code>.
            Using that value as a login token locks the vault
            {settings()?.honeytoken_injected ? " — bait is on for this process." : "."}
          </p>
          <div class="p-4 bg-slate-950 border border-red-900/40 rounded-lg text-sm text-red-200">
            Do not turn this on unless you want to mutate every GET. The standard payload has no trap fields.
          </div>
        </div>
      </div>

      <div class="bg-slate-900/80 border border-red-900/40 rounded-2xl p-8 shadow-lg shadow-black/20">
        <h2 class="text-xl font-bold text-white mb-2">Danger zone</h2>
        <p class="text-sm text-slate-300 mb-4">Lock drops the encryption key from memory. Secrets stay encrypted on disk. You will need the master password and a token to return. This is not the same as Sign out.</p>
        <button
          type="button"
          onClick={handleSeal}
          class={`inline-flex items-center gap-2 px-5 py-3 rounded-xl font-semibold ${
            confirmSeal() ? "bg-red-500 text-slate-950" : "bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20"
          }`}
        >
          <Lock class="w-4 h-4" aria-hidden="true" />
          {confirmSeal() ? `Click again to lock (${sealLeft()}s)` : "Lock vault"}
        </button>
      </div>
    </div>
  );
}
