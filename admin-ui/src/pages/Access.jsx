import { createResource, createSignal, Show, For, Suspense } from "solid-js";
import { A } from "@solidjs/router";
import { addToast, vaultFetch } from "../store";
import { Plus, Key, Copy, Check, Shield, Inbox, Trash2 } from "lucide-solid";

const fetchTokens = async () => {
  const res = await vaultFetch("/sys/tokens");
  if (!res.ok) throw new Error("Failed to load tokens");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

function TokensSkeleton() {
  return (
    <div class="animate-pulse space-y-4" aria-busy="true">
      <div class="h-10 bg-slate-900/50 rounded border border-slate-800/50"></div>
      <div class="h-10 bg-slate-900/50 rounded border border-slate-800/50"></div>
      <div class="h-10 bg-slate-900/50 rounded border border-slate-800/50"></div>
    </div>
  );
}

const permHelp = {
  read: "Read secrets at this path",
  write: "Create or update secrets",
  admin: "Tokens, audit logs, and lock vault"
};

export default function Access() {
  const [tokens, { refetch }] = createResource(fetchTokens);
  const [name, setName] = createSignal("");
  const [policyRules, setPolicyRules] = createSignal([{ id: 1, path: "encuesta-prod", perm: "read" }]);
  const [loading, setLoading] = createSignal(false);
  const [newToken, setNewToken] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [acknowledged, setAcknowledged] = createSignal(false);
  const [formError, setFormError] = createSignal("");
  const [confirmRevoke, setConfirmRevoke] = createSignal("");

  const handleAddRule = () => {
    setPolicyRules([...policyRules(), { id: Date.now(), path: "", perm: "read" }]);
  };

  const handleRemoveRule = (id) => {
    if (policyRules().length === 1) return;
    setPolicyRules(policyRules().filter((p) => p.id !== id));
  };

  const handleRuleChange = (id, field, val) => {
    setPolicyRules(policyRules().map((p) => (p.id === id ? { ...p, [field]: val } : p)));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError("");
    const trimmedName = name().trim();
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }

    const policyObj = {};
    const seen = new Set();
    let hasData = false;
    for (const rule of policyRules()) {
      const p = rule.path.trim();
      if (!p) continue;
      if (seen.has(p)) {
        setFormError(`Duplicate policy path “${p}”. Last rule would win — remove the extra.`);
        return;
      }
      seen.add(p);
      policyObj[p] = rule.perm;
      hasData = true;
    }

    if (!hasData) {
      setFormError("Add at least one policy path (example: encuesta-prod).");
      addToast("Please add at least one policy rule", "warning");
      return;
    }

    if (policyObj["*"] === "admin" && !window.confirm("This token can do everything, including lock the vault and mint more tokens. Continue?")) {
      return;
    }

    setLoading(true);
    try {
      const res = await vaultFetch("/auth/token/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, policies: policyObj })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "API Error");

      setNewToken(data.token);
      setCopied(false);
      setAcknowledged(false);
      setName("");
      setPolicyRules([{ id: Date.now(), path: "encuesta-prod", perm: "read" }]);
      addToast("Token generated — copy it now, it will not be shown again.", "success");
      refetch();
      requestAnimationFrame(() => document.getElementById("issued-token")?.focus());
    } catch (err) {
      setFormError(err.message);
      addToast(`Error creating token: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(newToken());
      setCopied(true);
      addToast("Token copied to clipboard", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      addToast("Could not copy. Select the token and copy manually.", "error");
    }
  };

  const handleRevoke = async (accessor, tokenName) => {
    if (confirmRevoke() !== accessor) {
      setConfirmRevoke(accessor);
      setTimeout(() => setConfirmRevoke((cur) => (cur === accessor ? "" : cur)), 5000);
      return;
    }
    try {
      const res = await vaultFetch("/auth/token/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessor })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Revoke failed");
      }
      addToast(`Revoked ${tokenName}`, "success");
      setConfirmRevoke("");
      refetch();
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const policySummary = (policies) => {
    if (!policies || typeof policies !== "object") return "—";
    return Object.entries(policies).map(([p, perm]) => `${p} → ${perm}`).join(", ");
  };

  return (
    <div class="space-y-10">
      <div>
        <h1 class="text-3xl font-bold text-white tracking-tight">Tokens & policies</h1>
        <p class="text-slate-400 text-base mt-3 max-w-2xl leading-relaxed">Issue vault tokens and see who can read secrets. App names must match <A href="/apps" class="text-cyan-400 hover:underline">Apps</A> (exact path, not a glob).</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-1 space-y-6">
          <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl p-8 shadow-lg shadow-black/20">
            <h2 class="text-xl font-bold text-white mb-8 flex items-center">
              <Shield class="w-5 h-5 text-cyan-400 mr-2" aria-hidden="true" />
              Generate token
            </h2>
            <form onSubmit={handleCreate} class="space-y-5">
              <div>
                <label for="token-name" class="block text-sm font-medium text-slate-300 mb-2">Service / application name</label>
                <input
                  id="token-name"
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.target.value)}
                  maxlength="80"
                  placeholder="e.g. backend-api-prod"
                  class="w-full bg-slate-950/50 border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all shadow-inner"
                />
              </div>

              <div>
                <p class="block text-sm font-medium text-slate-300 mb-2">Security policies</p>
                <p class="text-xs text-slate-400 mb-3">Use the app name as the path (same as in Apps), e.g. <code class="text-slate-300">encuesta-prod</code>. <code class="text-slate-300">*</code> is everything. Read/write apply to secrets; admin can manage tokens and lock the vault.</p>
                <div class="space-y-4 bg-slate-950/30 p-5 rounded-xl border border-slate-800/50">
                  <For each={policyRules()}>
                    {(rule) => (
                      <div class="flex flex-col gap-2">
                        <div class="flex items-start gap-3">
                          <div class="flex-1 min-w-0">
                            <label for={`pol-path-${rule.id}`} class="sr-only">Policy path</label>
                            <input id={`pol-path-${rule.id}`} type="text" placeholder="App name (e.g. encuesta-prod)" value={rule.path} onInput={(e) => handleRuleChange(rule.id, "path", e.target.value)} class="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm" />
                          </div>
                          <div>
                            <label for={`pol-perm-${rule.id}`} class="sr-only">Permission</label>
                            <select id={`pol-perm-${rule.id}`} value={rule.perm} onChange={(e) => handleRuleChange(rule.id, "perm", e.target.value)} class="w-28 flex-shrink-0 bg-slate-900 border border-slate-800 rounded-lg px-2 py-3 text-white focus:outline-none focus:border-cyan-500 text-sm" title={permHelp[rule.perm]}>
                              <option value="read">Read</option>
                              <option value="write">Write</option>
                              <option value="admin">Admin</option>
                            </select>
                          </div>
                          <button type="button" onClick={() => handleRemoveRule(rule.id)} disabled={policyRules().length === 1} aria-label="Remove policy rule" title={policyRules().length === 1 ? "At least one rule required" : "Remove policy rule"} class="p-2 min-w-10 min-h-10 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30 flex-shrink-0">
                            <Trash2 class="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                        <p class="text-xs text-slate-400 leading-snug">{permHelp[rule.perm]}</p>
                      </div>
                    )}
                  </For>
                  <button type="button" onClick={handleAddRule} class="text-cyan-400 hover:text-cyan-300 text-sm font-medium flex items-center mt-3 transition-colors">
                    <Plus class="w-4 h-4 mr-1" aria-hidden="true" /> Add rule
                  </button>
                </div>
              </div>

              <Show when={formError()}>
                <p class="text-sm text-red-300" role="alert">{formError()}</p>
              </Show>

              <button type="submit" disabled={loading()} class="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold px-4 py-3 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 shadow-lg shadow-cyan-500/20">
                <Plus class="w-4 h-4 mr-2" aria-hidden="true" />
                {loading() ? "Generating..." : "Generate token"}
              </button>
            </form>

            <Show when={newToken()}>
              <div class="mt-6 p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <p class="text-sm font-semibold text-emerald-400 mb-3 flex items-center">
                  <Check class="w-4 h-4 mr-1" aria-hidden="true" /> Token issued — copy it now
                </p>
                <div class="flex items-center space-x-2">
                  <input id="issued-token" type="text" readOnly value={newToken()} class="flex-1 bg-slate-950 border border-dashed border-slate-700 shadow-inner rounded-lg px-3 py-2 text-emerald-300 font-mono text-sm selection:bg-emerald-500/30 cursor-text" onFocus={(e) => e.currentTarget.select()} />
                  <button type="button" onClick={copyToken} aria-label="Copy token" title="Copy token" class="p-2.5 min-w-10 min-h-10 bg-emerald-500/20 hover:bg-emerald-500/30 rounded-lg text-emerald-400 transition-colors">
                    {copied() ? <Check class="w-4 h-4" aria-hidden="true" /> : <Copy class="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
                <p class="text-xs text-emerald-200 mt-3 bg-emerald-500/5 p-2 rounded">
                  This secret is shown once. The vault stores only an accessor, not this token.
                </p>
                <button type="button" onClick={() => { setAcknowledged(true); setNewToken(""); }} disabled={!copied() && !acknowledged()} class="mt-3 w-full text-sm py-2 rounded-lg bg-slate-800 text-white border border-slate-700 disabled:opacity-40">
                  {copied() ? "I've saved it — hide token" : "Copy the token before hiding it"}
                </button>
              </div>
            </Show>
          </div>
        </div>

        <div class="lg:col-span-2">
          <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl p-8 shadow-lg shadow-black/20">
            <h2 class="text-xl font-bold text-white mb-8">Issued tokens</h2>

            <Suspense fallback={<TokensSkeleton />}>
              <Show when={!tokens.error} fallback={<p class="text-red-300">Could not load tokens. Check your session.</p>}>
                <Show
                  when={tokens() && tokens().length > 0}
                  fallback={
                    <div class="flex flex-col items-center justify-center py-16 text-slate-400">
                      <Inbox class="w-12 h-12 mb-4 opacity-30 text-cyan-500" aria-hidden="true" />
                      <p class="text-lg font-medium text-slate-300">No tokens yet</p>
                      <p class="text-sm text-center max-w-sm mt-2">Generate a token to grant an application access without sharing the root token.</p>
                    </div>
                  }
                >
                  <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                      <thead>
                        <tr class="border-b border-slate-800 text-slate-300 text-sm">
                          <th class="pb-4 px-5 font-medium">Accessor</th>
                          <th class="pb-4 px-5 font-medium">Name</th>
                          <th class="pb-4 px-5 font-medium">Policies</th>
                          <th class="pb-4 px-5 font-medium">Status</th>
                          <th class="pb-4 px-5 font-medium">Created</th>
                          <th class="pb-4 px-5 font-medium"><span class="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={tokens()}>
                          {(t) => (
                            <tr class="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                              <td class="py-4 px-5 text-sm font-mono text-slate-400">
                                <div class="flex items-center">
                                  <Key class="w-3 h-3 mr-2 opacity-50" aria-hidden="true" />
                                  <span class="truncate max-w-[7rem]" title={t.accessor}>{t.accessor}</span>
                                </div>
                              </td>
                              <td class="py-4 px-5 text-sm font-medium text-white truncate max-w-[10rem]" title={t.name}>{t.name}</td>
                              <td class="py-4 px-5 text-xs font-mono text-slate-300 max-w-[14rem] truncate" title={policySummary(t.policies)}>{policySummary(t.policies)}</td>
                              <td class="py-4 px-5 text-sm">
                                <span class={`px-2 py-1 rounded-md text-xs font-semibold tracking-wide ${t.is_active ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
                                  {t.is_active ? "Active" : "Revoked"}
                                </span>
                              </td>
                              <td class="py-4 px-5 text-sm text-slate-300 whitespace-nowrap">{t.created_at ? new Date(t.created_at).toLocaleDateString() : "—"}</td>
                              <td class="py-4 px-5">
                                <Show when={t.is_active}>
                                  <button type="button" onClick={() => handleRevoke(t.accessor, t.name)} class={`text-xs font-semibold px-3 py-1.5 rounded-lg ${confirmRevoke() === t.accessor ? "bg-red-500 text-slate-950" : "text-red-300 border border-red-500/30 hover:bg-red-500/10"}`}>
                                    {confirmRevoke() === t.accessor ? "Confirm revoke" : "Revoke"}
                                  </button>
                                </Show>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </Show>
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}
