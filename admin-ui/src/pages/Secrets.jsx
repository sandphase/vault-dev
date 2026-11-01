import { createResource, createSignal, Show, For, Suspense, createMemo } from "solid-js";
import { A } from "@solidjs/router";
import { addToast, vaultFetch, encodeSecretPath } from "../store";
import { Key, Plus, RefreshCw, Eye, EyeOff, Trash2, Folder, Edit2, Lock, Inbox } from "lucide-solid";

const fetchSecrets = async () => {
  const res = await vaultFetch("/secret/metadata");
  if (!res.ok) throw new Error("Failed to fetch secrets");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

function SecretsSkeleton() {
  return (
    <div class="animate-pulse space-y-6" aria-busy="true">
      <div class="bg-slate-900/50 border border-slate-800/50 rounded-2xl h-64"></div>
      <div class="bg-slate-900/50 border border-slate-800/50 rounded-2xl h-64"></div>
    </div>
  );
}

const formatValue = (v) => {
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export default function Secrets() {
  const [secrets, { refetch }] = createResource(fetchSecrets);
  const [newPath, setNewPath] = createSignal("");
  const [kvPairs, setKvPairs] = createSignal([{ id: 1, key: "", value: "" }]);
  const [loading, setLoading] = createSignal(false);
  const [viewing, setViewing] = createSignal({});
  const [decrypting, setDecrypting] = createSignal({});
  const [formError, setFormError] = createSignal("");
  const [confirmDelete, setConfirmDelete] = createSignal("");
  const [editingPath, setEditingPath] = createSignal("");

  const handleAddKv = () => {
    setKvPairs([...kvPairs(), { id: Date.now(), key: "", value: "" }]);
  };

  const handleRemoveKv = (id) => {
    if (kvPairs().length === 1) return;
    setKvPairs(kvPairs().filter((p) => p.id !== id));
  };

  const handleKvChange = (id, field, val) => {
    setKvPairs(kvPairs().map((p) => (p.id === id ? { ...p, [field]: val } : p)));
  };

  const pathExists = (path) => (secrets() || []).some((s) => s.path === path);

  const handleSave = async (e) => {
    e.preventDefault();
    if (loading()) return;
    setFormError("");
    const path = newPath().trim();
    if (!path) {
      setFormError("Path is required. Example: encuesta-prod");
      addToast("Path is required", "warning");
      return;
    }

    const payloadObj = {};
    const seen = new Set();
    let hasData = false;
    for (const p of kvPairs()) {
      const k = p.key.trim();
      if (!k) continue;
      if (seen.has(k)) {
        setFormError(`Duplicate key “${k}”. Each key can appear once.`);
        addToast("Duplicate keys are not allowed", "warning");
        return;
      }
      seen.add(k);
      payloadObj[k] = p.value;
      hasData = true;
    }

    if (!hasData) {
      setFormError("Add at least one key/value pair.");
      addToast("Please add at least one Key/Value pair", "warning");
      return;
    }

    if (pathExists(path) && !window.confirm(`Overwrite secret at ${path}? This creates a new version.`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await vaultFetch(`/secret/data/${encodeSecretPath(path)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: JSON.stringify(payloadObj) })
      });
      if (!res.ok) throw new Error("Failed to save secret");

      addToast(`Secret saved at ${path}`, "success");
      setNewPath("");
      setEditingPath("");
      setKvPairs([{ id: Date.now(), key: "", value: "" }]);
      refetch();
    } catch (err) {
      setFormError(err.message);
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const isRevealed = (path) => Object.prototype.hasOwnProperty.call(viewing(), path);

  const toggleView = async (path) => {
    if (isRevealed(path)) {
      const next = { ...viewing() };
      delete next[path];
      setViewing(next);
      return;
    }

    setDecrypting({ ...decrypting(), [path]: true });
    try {
      const res = await vaultFetch(`/secret/resolved/${encodeSecretPath(path)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Could not decrypt this secret");
      const layer = path === "global" ? data.shared : data.overrides;
      setViewing({ ...viewing(), [path]: layer && typeof layer === "object" ? layer : {} });
    } catch (err) {
      addToast(err.message.includes("Crypto") || err.message === ""
        ? "Could not read this secret. Lock the vault and unlock with the original master password."
        : err.message, "error");
    } finally {
      setDecrypting({ ...decrypting(), [path]: false });
    }
  };

  const handleEdit = (path) => {
    setNewPath(path);
    setEditingPath(path);
    const secretData = viewing()[path];
    if (secretData && typeof secretData === "object" && !Array.isArray(secretData)) {
      const pairs = Object.entries(secretData).map(([k, v], idx) => ({
        id: Date.now() + idx,
        key: k,
        value: formatValue(v)
      }));
      setKvPairs(pairs.length > 0 ? pairs : [{ id: Date.now(), key: "", value: "" }]);
    } else {
      setKvPairs([{ id: Date.now(), key: "value", value: secretData == null ? "" : formatValue(secretData) }]);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    addToast(`Editing ${path}. Save overwrites with a new version.`, "success");
    document.getElementById("secret-path")?.focus();
  };

  const handleDelete = async (path) => {
    if (confirmDelete() !== path) {
      setConfirmDelete(path);
      setTimeout(() => setConfirmDelete((cur) => (cur === path ? "" : cur)), 6000);
      return;
    }
    try {
      const res = await vaultFetch(`/secret/data/${encodeSecretPath(path)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete secret");
      addToast(`Deleted ${path}`, "success");
      setConfirmDelete("");
      const next = { ...viewing() };
      delete next[path];
      setViewing(next);
      refetch();
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const groupedSecrets = createMemo(() => {
    const list = secrets() || [];
    const groups = {};
    list.forEach((secret) => {
      const parts = secret.path.split("/");
      const namespace = parts.length > 1 ? parts[0] : "root";
      if (!groups[namespace]) groups[namespace] = [];
      groups[namespace].push(secret);
    });
    return groups;
  });

  return (
    <div class="space-y-10">
      <div class="flex items-start justify-between gap-6">
        <div>
          <h1 class="text-3xl font-bold text-white tracking-tight">All secrets</h1>
          <p class="text-slate-400 text-base mt-3 max-w-2xl leading-relaxed">Raw editor by path. Day-to-day work belongs in <A href="/apps" class="text-cyan-400 hover:underline">Apps</A>: write shared keys once, override per app.</p>
        </div>
        <button type="button" onClick={refetch} aria-label="Refresh secrets" title="Refresh secrets" class="p-2 min-w-10 min-h-10 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors">
          <RefreshCw class="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 shadow-lg shadow-black/20 rounded-2xl p-8">
        <h2 class="text-xl font-bold text-white mb-2">{editingPath() ? `Editing ${editingPath()}` : "Create or update secret"}</h2>
        <Show when={editingPath()}>
          <p class="text-sm text-cyan-300 mb-4">Saving overwrites this path with a new version.</p>
        </Show>
        <form onSubmit={handleSave} class="space-y-6">
          <div>
            <label for="secret-path" class="block text-sm font-medium text-slate-300 mb-2">Secret path</label>
            <div class="flex items-center bg-slate-950 border border-slate-800 rounded-lg overflow-hidden focus-within:border-cyan-500 focus-within:ring-1 focus-within:ring-cyan-500 transition-all">
              <span class="pl-4 pr-2 text-slate-400"><Folder class="w-4 h-4" aria-hidden="true" /></span>
              <input id="secret-path" type="text" value={newPath()} onInput={(e) => setNewPath(e.target.value)} placeholder="encuesta-prod" class="w-full bg-transparent px-2 py-3 text-white focus:outline-none font-mono text-sm" />
            </div>
            <p class="text-xs text-slate-400 mt-2">Prefer <A href="/apps" class="text-cyan-400 hover:underline">Apps</A> so you do not retype the same keys. Raw path example: <code class="text-slate-300">encuesta-prod</code>. Saving the same path creates a new version.</p>
          </div>

          <div>
            <p class="block text-sm font-medium text-slate-300 mb-2">Key / value data</p>
            <div class="space-y-4 bg-slate-950/50 p-5 rounded-xl border border-slate-800/50">
              <For each={kvPairs()}>
                {(pair, index) => (
                  <div class="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
                    <div class="flex-1 min-w-0">
                      <label for={`kv-key-${pair.id}`} class="sr-only">Key {index() + 1}</label>
                      <input id={`kv-key-${pair.id}`} type="text" placeholder="Key (e.g. DB_PASS)" value={pair.key} onInput={(e) => handleKvChange(pair.id, "key", e.target.value)} class="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm" />
                    </div>
                    <div class="flex-1 min-w-0">
                      <label for={`kv-val-${pair.id}`} class="sr-only">Value {index() + 1}</label>
                      <input id={`kv-val-${pair.id}`} type="text" placeholder="Value" value={pair.value} onInput={(e) => handleKvChange(pair.id, "value", e.target.value)} class="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm" />
                    </div>
                    <button type="button" onClick={() => handleRemoveKv(pair.id)} disabled={kvPairs().length === 1} aria-label="Remove this field (not yet saved)" title="Remove this field (not yet saved)" aria-disabled={kvPairs().length === 1} class="p-2 min-w-10 min-h-10 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-30 self-end sm:self-start">
                      <Trash2 class="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </For>
              <button type="button" onClick={handleAddKv} class="text-cyan-400 hover:text-cyan-300 text-sm font-medium flex items-center mt-4 transition-colors">
                <Plus class="w-4 h-4 mr-1" aria-hidden="true" /> Add another key
              </button>
            </div>
          </div>

          <Show when={formError()}>
            <p class="text-sm text-red-300" role="alert">{formError()}</p>
          </Show>

          <button type="submit" disabled={loading()} class="w-full md:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold px-6 py-3 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/20">
            {loading() ? <RefreshCw class="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Lock class="w-4 h-4 mr-2" aria-hidden="true" />}
            {loading() ? "Encrypting & Saving..." : "Save securely"}
          </button>
        </form>
      </div>

      <Suspense fallback={<SecretsSkeleton />}>
        <Show when={!secrets.error} fallback={<div class="bg-slate-900/80 border border-red-900/40 rounded-2xl p-8 text-red-200">Could not load secrets. Check your token and try refresh.</div>}>
          <Show
            when={secrets() && secrets().length > 0}
            fallback={
              <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center text-slate-400 shadow-lg shadow-black/20">
                <Inbox class="w-16 h-16 mb-4 opacity-50 text-cyan-500" aria-hidden="true" />
                <h3 class="text-xl font-bold text-slate-200 mb-2">No secrets yet</h3>
                <p class="text-center max-w-md text-slate-300">Your vault is empty. Open <A href="/apps" class="text-cyan-400 hover:underline">Apps</A> and write shared keys once, or use a path like <code class="text-cyan-300">encuesta-prod</code> here.</p>
              </div>
            }
          >
            <div class="space-y-6">
              <For each={Object.entries(groupedSecrets())}>
                {([namespace, nsSecrets]) => (
                  <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl overflow-hidden shadow-lg shadow-black/20">
                    <div class="bg-slate-800/40 px-6 py-4 border-b border-slate-800 flex items-center">
                      <Folder class="w-5 h-5 text-cyan-500 mr-3" aria-hidden="true" />
                      <h3 class="text-lg font-bold text-white capitalize">{namespace === "root" ? "/" : namespace}</h3>
                      <span class="ml-3 px-2 py-0.5 bg-slate-800 rounded-full text-xs text-slate-300">{nsSecrets.length} items</span>
                    </div>
                    <div class="divide-y divide-slate-800/50">
                      <For each={nsSecrets}>
                        {(secret) => (
                          <div class="px-6 py-4 hover:bg-slate-800/20 transition-colors">
                            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <div class="flex items-center min-w-0">
                                <Key class="w-4 h-4 text-slate-400 mr-3 flex-shrink-0" aria-hidden="true" />
                                <span class="font-mono text-sm text-cyan-400 font-medium truncate" title={secret.path}>{secret.path}</span>
                                <span class="ml-4 text-xs text-slate-400 border border-slate-700 px-2 py-0.5 rounded-full flex-shrink-0">v{secret.version}</span>
                              </div>
                              <div class="flex space-x-2 flex-shrink-0">
                                <button type="button" onClick={() => toggleView(secret.path)} disabled={decrypting()[secret.path]} aria-label={isRevealed(secret.path) ? "Hide secret" : "Decrypt and show values"} aria-pressed={isRevealed(secret.path)} title={isRevealed(secret.path) ? "Hide secret" : "Decrypt and show values"} class="p-2 min-w-10 min-h-10 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-cyan-400 transition-colors disabled:opacity-50">
                                  {decrypting()[secret.path] ? <RefreshCw class="w-4 h-4 animate-spin" aria-hidden="true" /> : (isRevealed(secret.path) ? <EyeOff class="w-4 h-4" aria-hidden="true" /> : <Eye class="w-4 h-4" aria-hidden="true" />)}
                                </button>
                                <Show when={isRevealed(secret.path)}>
                                  <button type="button" onClick={() => handleEdit(secret.path)} aria-label="Edit secret" title="Edit secret" class="p-2 min-w-10 min-h-10 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors">
                                    <Edit2 class="w-4 h-4" aria-hidden="true" />
                                  </button>
                                </Show>
                                <button type="button" onClick={() => handleDelete(secret.path)} aria-label={confirmDelete() === secret.path ? `Confirm delete ${secret.path}` : `Delete ${secret.path}`} title={confirmDelete() === secret.path ? "Click again to permanently delete" : "Delete secret"} class={`p-2 min-w-10 min-h-10 rounded-lg transition-colors ${confirmDelete() === secret.path ? "bg-red-500 text-slate-950" : "hover:bg-slate-800 text-slate-300 hover:text-red-400"}`}>
                                  <Trash2 class="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                            </div>

                            <Show when={isRevealed(secret.path)}>
                              <div class="mt-4 p-4 bg-[#050810] border border-slate-800 rounded-xl shadow-inner">
                                <p class="text-xs text-slate-400 mb-3">
                                  {secret.path === "global"
                                    ? "Keys stored in Shared. Apps inherit them unless they override. Visible in this browser — hide when done."
                                    : "Keys stored on this path only. A client read merges Shared underneath. Saving does not copy inherited keys. Visible in this browser — hide when done."}
                                </p>
                                <Show when={typeof viewing()[secret.path] === "object" && viewing()[secret.path] !== null} fallback={<div class="font-mono text-sm text-slate-200 break-all">{formatValue(viewing()[secret.path])}</div>}>
                                  <Show when={Object.keys(viewing()[secret.path] || {}).length === 0}>
                                    <p class="text-sm text-slate-400">Nothing stored on this path yet.</p>
                                  </Show>
                                  <div class="space-y-2">
                                    <For each={Object.entries(viewing()[secret.path] || {})}>
                                      {([k, v]) => (
                                        <div class="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 border-b border-slate-800/50 last:border-0 pb-2 last:pb-0">
                                          <span class="font-mono text-sm text-cyan-300 sm:w-1/3 break-all">{k}</span>
                                          <span class="font-mono text-sm text-emerald-400 sm:w-2/3 break-all">{formatValue(v)}</span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Suspense>
    </div>
  );
}
