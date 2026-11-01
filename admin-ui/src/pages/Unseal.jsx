import { createSignal, Show, onMount } from "solid-js";
import { Shield, KeyRound, ArrowRight, Info } from "lucide-solid";
import { setIsSealed, saveToken, addToast, hasData } from "../store";

export default function Unseal(props) {
  const [password, setPassword] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [fieldError, setFieldError] = createSignal("");
  const [sealedBanner, setSealedBanner] = createSignal(false);

  onMount(() => {
    try {
      if (sessionStorage.getItem("vault_just_sealed")) {
        setSealedBanner(true);
        sessionStorage.removeItem("vault_just_sealed");
      }
    } catch (e) {}
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldError("");
    if (!password().trim()) {
      setFieldError(props.needToken ? "Enter a token to continue." : "Enter the master password.");
      return;
    }

    setLoading(true);
    try {
      if (!props.needToken) {
        const res = await fetch("/sys/unseal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ master_password: password() })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || "Wrong master password, or the vault could not unlock.");

        setIsSealed(false);
        addToast("Vault unlocked. Next: sign in with a token.", "success");
      } else {
        const candidate = password().trim();
        const res = await fetch("/sys/audit", { headers: { "x-vault-token": candidate } });
        if (res.status === 401 || res.status === 403) {
          throw new Error("Invalid token. On a new install the default is root.");
        }
        if (!res.ok) throw new Error("Could not verify this token against the server.");
        saveToken(candidate);
        addToast("Signed in.", "success");
      }
    } catch (err) {
      setFieldError(err.message);
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="min-h-screen bg-[#0B1120] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none"></div>
      {props.needToken && (
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-purple-500/10 blur-[100px] rounded-full pointer-events-none"></div>
      )}

      <div class="max-w-md w-full bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-black/50 relative z-10">
        <p class="text-center text-xs uppercase tracking-widest text-slate-400 mb-6 font-semibold">
          {props.needToken ? "Step 2 of 2 — Sign in" : "Step 1 of 2 — Unlock"}
        </p>

        <Show when={sealedBanner() && !props.needToken}>
          <div class="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-200">
            Vault locked. Session cleared. Unlock with the master password, then sign in.
          </div>
        </Show>

        <div class="flex justify-center mb-8">
          <div class={`p-5 rounded-2xl border shadow-inner ${
            props.needToken
              ? "bg-purple-500/10 border-purple-500/20 text-purple-400"
              : "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
          }`}>
            {props.needToken ? <KeyRound class="w-10 h-10" aria-hidden="true" /> : <Shield class="w-10 h-10" aria-hidden="true" />}
          </div>
        </div>

        <h1 class="text-2xl font-bold text-center text-white mb-3 tracking-tight">
          {props.needToken ? "Sign in with a token" : "Vault is locked"}
        </h1>

        <p class="text-slate-300 text-center mb-8 text-sm">
          {props.needToken
            ? "Unlocking only decrypts data in memory. A token proves who you are before you can manage secrets."
            : "Unlocking loads the encryption key into memory so the vault can read and write secrets."}
        </p>

        <Show when={props.needToken}>
          <div class="mb-6 p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl flex items-start space-x-3 text-sm">
            <Info class="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p class="text-slate-200">
              <span class="font-semibold text-white">First time?</span> Use the bootstrap admin token <code class="bg-slate-950 px-1.5 py-0.5 rounded text-purple-300 border border-slate-800">root</code> unless you set <code class="text-slate-300">VAULT_ROOT_TOKEN</code>.
            </p>
          </div>
        </Show>
        <Show when={!props.needToken}>
          <div class="mb-6 p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl flex items-start space-x-3 text-sm">
            <Info class="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p class="text-slate-200">
              <Show when={hasData()} fallback={
                <span><span class="font-semibold text-white">Create a master password</span> and write it down. This is the only unlock secret. If this directory is empty, the password you enter now encrypts all new secrets.</span>
              }>
                <span><span class="font-semibold text-white">Returning vault.</span> Enter the same master password used when this data was created. A different password will be rejected.</span>
              </Show>
            </p>
          </div>
        </Show>

        <form onSubmit={handleSubmit} class="space-y-5">
          <div>
            <label for="vault-secret" class="block text-sm font-medium text-slate-300 mb-2 ml-1">
              {props.needToken ? "Admin access token" : "Master password"}
            </label>
            <input
              id="vault-secret"
              type="password"
              autocomplete={props.needToken ? "off" : "current-password"}
              value={password()}
              onInput={(e) => { setPassword(e.target.value); setFieldError(""); }}
              placeholder={props.needToken ? "root" : "Your master password"}
              class={`w-full bg-slate-950/50 border rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 transition-all font-mono text-sm shadow-inner ${
                props.needToken
                  ? "border-slate-800 focus:border-purple-500 focus:ring-purple-500"
                  : "border-slate-800 focus:border-cyan-500 focus:ring-cyan-500"
              }`}
            />
            <Show when={fieldError()}>
              <p class="mt-2 text-sm text-red-300" role="alert">{fieldError()}</p>
            </Show>
            <Show when={!password().trim()}>
              <p class="mt-2 text-xs text-slate-400">{props.needToken ? "Enter a token to enable Sign in." : "Enter the master password to enable Unlock."}</p>
            </Show>
          </div>

          <button
            type="submit"
            disabled={loading() || !password().trim()}
            class={`w-full font-semibold py-3 rounded-xl transition-all flex items-center justify-center group disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
              props.needToken
                ? "bg-purple-500 hover:bg-purple-400 text-slate-950 shadow-purple-500/20"
                : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20"
            }`}
          >
            <span>{loading() ? "Verifying..." : (props.needToken ? "Sign in" : "Unlock vault")}</span>
            {!loading() && <ArrowRight class="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" aria-hidden="true" />}
          </button>
        </form>
      </div>
    </div>
  );
}
