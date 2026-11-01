import { createResource, createSignal, Show, For, createMemo, onMount } from "solid-js";
import { addToast, vaultFetch, encodeSecretPath } from "../store";
import { Layers, Plus, RefreshCw, Trash2, Lock, Copy, Check } from "lucide-solid";

const SHARED_PATH = "global";

const fetchMeta = async () => {
  const res = await vaultFetch("/secret/metadata");
  if (!res.ok) throw new Error("Failed to load apps");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

const apiError = async (res, fallback) => {
  const data = await res.json().catch(() => ({}));
  const d = data.detail;
  if (typeof d === "string" && d.trim()) return d;
  return fallback;
};

const fetchResolved = async (path) => {
  const res = await vaultFetch(`/secret/resolved/${encodeSecretPath(path)}`);
  if (!res.ok) throw new Error(await apiError(res, "Could not load keys for this app"));
  return await res.json();
};

const savePath = async (path, obj) => {
  const res = await vaultFetch(`/secret/data/${encodeSecretPath(path)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: JSON.stringify(obj) })
  });
  if (!res.ok) throw new Error(await apiError(res, "Save failed"));
};

const slugify = (raw) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");

const pairsFromObj = (obj) => {
  const entries = Object.entries(obj || {});
  if (!entries.length) return [{ id: Date.now(), key: "", value: "" }];
  return entries.map(([key, value], i) => ({
    id: Date.now() + i,
    key,
    value: value == null || typeof value === "object" ? JSON.stringify(value) : String(value)
  }));
};

const objFromPairs = (pairs) => {
  const out = {};
  const seen = new Set();
  for (const p of pairs) {
    const k = p.key.trim();
    if (!k) continue;
    if (seen.has(k)) throw new Error(`Duplicate key “${k}”`);
    seen.add(k);
    out[k] = p.value;
  }
  return out;
};

const inputClass =
  "w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3.5 text-white font-mono text-sm focus:outline-none focus:border-cyan-500";

function KvEditor(props) {
  return (
    <div class="space-y-4">
      <For each={props.pairs()}>
        {(pair, index) => (
          <div class="flex flex-col xl:flex-row xl:items-center gap-4 py-1">
            <input
              type="text"
              placeholder="KEY"
              value={pair.key}
              onInput={(e) => props.onChange(pair.id, "key", e.target.value)}
              class={`${inputClass} xl:w-64 xl:flex-none`}
            />
            <input
              type="text"
              placeholder="value"
              value={pair.value}
              onInput={(e) => props.onChange(pair.id, "value", e.target.value)}
              class={`${inputClass} flex-1 min-w-0`}
            />
            <div class="flex items-center gap-2 flex-shrink-0">
              <Show when={props.onShare && pair.key.trim()}>
                <button
                  type="button"
                  onClick={() => props.onShare(pair.key, pair.value)}
                  class="h-11 px-4 rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                >
                  Share
                </button>
              </Show>
              <button
                type="button"
                onClick={() => props.onRemove(pair.id)}
                disabled={props.pairs().length === 1}
                aria-label={`Remove key ${index() + 1}`}
                class="h-11 w-11 flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-xl disabled:opacity-30"
              >
                <Trash2 class="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </For>
      <button type="button" onClick={props.onAdd} class="text-cyan-400 hover:text-cyan-300 text-sm font-medium inline-flex items-center gap-2 py-2">
        <Plus class="w-4 h-4" aria-hidden="true" /> Add key
      </button>
    </div>
  );
}

export default function Apps() {
  const [meta, { refetch: refetchMeta }] = createResource(fetchMeta);
  const [selected, setSelected] = createSignal("shared");
  const [newName, setNewName] = createSignal("");
  const [pairs, setPairs] = createSignal([{ id: 1, key: "", value: "" }]);
  const [loading, setLoading] = createSignal(false);
  const [copied, setCopied] = createSignal("");
  const [confirmDelete, setConfirmDelete] = createSignal("");
  const [resolved, setResolved] = createSignal(null);
  const [resolving, setResolving] = createSignal(false);
  const [baseline, setBaseline] = createSignal("");
  const [layerError, setLayerError] = createSignal("");
  const [showApi, setShowApi] = createSignal(false);

  const apps = createMemo(() =>
    (meta() || [])
      .filter((s) => s.path && s.path !== SHARED_PATH)
      .sort((a, b) => a.path.localeCompare(b.path))
  );

  const liveOverrides = createMemo(() => {
    try {
      return objFromPairs(pairs());
    } catch (e) {
      return resolved()?.overrides || {};
    }
  });

  const inheritedKeys = createMemo(() => {
    const live = liveOverrides();
    return Object.entries(resolved()?.shared || {}).filter(([k]) => !(k in live));
  });

  const loadLayer = async (sel) => {
    const path = sel === "shared" ? SHARED_PATH : sel;
    setResolving(true);
    try {
      const data = await fetchResolved(path);
      setLayerError("");
      setResolved(data);
      const next = pairsFromObj(sel === "shared" ? data.shared : data.overrides);
      setPairs(next);
      setBaseline(JSON.stringify(objFromPairs(next)));
    } catch (e) {
      setLayerError(e.message || "Could not load keys");
      addToast(e.message || "Could not load keys", "error");
      setResolved({
        path,
        shared: {},
        overrides: {},
        merged: {},
        sources: {}
      });
      const empty = [{ id: Date.now(), key: "", value: "" }];
      setPairs(empty);
      setBaseline(JSON.stringify({}));
    } finally {
      setResolving(false);
    }
  };

  const select = async (sel) => {
    setSelected(sel);
    setConfirmDelete("");
    setShowApi(false);
    await loadLayer(sel);
  };

  const changePair = (id, field, val) => {
    setPairs(pairs().map((p) => (p.id === id ? { ...p, [field]: val } : p)));
  };
  const addPair = () => setPairs([...pairs(), { id: Date.now(), key: "", value: "" }]);
  const removePair = (id) => {
    if (pairs().length === 1) return;
    setPairs(pairs().filter((p) => p.id !== id));
  };

  const handleCreateApp = async (e) => {
    e.preventDefault();
    const slug = slugify(newName());
    if (!slug) {
      addToast("Give the app a name, like encuesta-prod", "warning");
      return;
    }
    if (slug === SHARED_PATH) {
      addToast("That name is reserved for shared keys", "warning");
      return;
    }
    if ((meta() || []).some((s) => s.path === slug)) {
      addToast("That app already exists", "warning");
      setNewName("");
      await select(slug);
      return;
    }
    setLoading(true);
    try {
      const res = await vaultFetch(`/secret/data/${encodeSecretPath(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "{}" })
      });
      if (!res.ok) throw new Error("Could not create app");
      setNewName("");
      addToast(`${slug} created. It already inherits every shared key.`, "success");
      await refetchMeta();
      await select(slug);
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const dirty = createMemo(() => {
    try {
      return JSON.stringify(objFromPairs(pairs())) !== baseline();
    } catch (e) {
      return true;
    }
  });

  const handleSave = async () => {
    if (layerError()) {
      addToast(layerError(), "error");
      return;
    }
    let obj;
    try {
      obj = objFromPairs(pairs());
    } catch (err) {
      addToast(err.message, "error");
      return;
    }
    const path = selected() === "shared" ? SHARED_PATH : selected();
    if (selected() === "shared" && !Object.keys(obj).length) {
      addToast("Add at least one shared key, or delete unused rows", "warning");
      return;
    }
    setLoading(true);
    try {
      await savePath(path, obj);
      addToast(selected() === "shared" ? "Shared keys saved. Apps inherit these unless they override." : "Saved. Other apps are unchanged.", "success");
      await refetchMeta();
      await loadLayer(selected());
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteApp = async (path) => {
    if (confirmDelete() !== path) {
      setConfirmDelete(path);
      setTimeout(() => setConfirmDelete((c) => (c === path ? "" : c)), 5000);
      return;
    }
    try {
      const res = await vaultFetch(`/secret/data/${encodeSecretPath(path)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      addToast(`Removed ${path}. Shared keys are untouched.`, "success");
      setConfirmDelete("");
      await refetchMeta();
      await select("shared");
    } catch (err) {
      addToast(err.message, "error");
    }
  };

  const startOverride = (key, currentValue) => {
    const existing = pairs().find((p) => p.key.trim() === key);
    if (existing) {
      addToast(`${key} is already an override`, "warning");
      return;
    }
    const next = pairs().filter((p) => p.key.trim());
    next.push({ id: Date.now(), key, value: currentValue == null ? "" : String(currentValue) });
    setPairs(next.length ? next : [{ id: Date.now(), key, value: "" }]);
    addToast(`Change ${key} below, then save. Other apps stay on Shared.`, "success");
  };

  const scalar = (value) => {
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const shareKeyWithAll = async (key, value) => {
    if (dirty()) {
      addToast("Save this app first, then share the key.", "warning");
      return;
    }
    setLoading(true);
    try {
      const shared = { ...(resolved()?.shared || {}), [key]: scalar(value) };
      const overrides = { ...(resolved()?.overrides || {}) };
      delete overrides[key];
      await savePath(SHARED_PATH, shared);
      await savePath(selected(), overrides);
      addToast(`${key} is now Shared. Other apps inherit it.`, "success");
      await refetchMeta();
      await loadLayer(selected());
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const shareAllToShared = async () => {
    if (dirty()) {
      addToast("Save this app first, then move keys to Shared.", "warning");
      return;
    }
    const overrides = resolved()?.overrides || {};
    if (!Object.keys(overrides).length) {
      addToast("This app has no keys of its own to share.", "warning");
      return;
    }
    if (!window.confirm("Copy every key from this app into Shared? This app will inherit them. Other apps will see them too.")) {
      return;
    }
    setLoading(true);
    try {
      const shared = { ...(resolved()?.shared || {}), ...overrides };
      await savePath(SHARED_PATH, shared);
      await savePath(selected(), {});
      addToast("Moved to Shared. Override a key only when this app must differ.", "success");
      await refetchMeta();
      await loadLayer(selected());
    } catch (err) {
      addToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const copyValue = async (key, value) => {
    try {
      await navigator.clipboard.writeText(String(value ?? ""));
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch (e) {
      addToast("Could not copy", "error");
    }
  };

  const readExample = createMemo(
    () => `curl -sS -H "x-vault-token: YOUR_TOKEN" http://localhost:8200/secret/data/${selected()}`
  );

  const refreshAll = async () => {
    await refetchMeta();
    await loadLayer(selected());
  };

  onMount(() => {
    loadLayer("shared");
  });

  const railBtn = (active) =>
    `w-full text-left px-5 py-4 rounded-2xl border transition-all ${
      active
        ? "bg-cyan-500/10 border-cyan-500/30"
        : "bg-slate-900/50 border-transparent hover:border-slate-800 hover:bg-slate-900/80"
    }`;

  return (
    <div class="space-y-10">
      <div class="flex items-end justify-between gap-6">
        <div class="max-w-xl">
          <h1 class="text-3xl font-bold text-white tracking-tight">Apps</h1>
          <p class="text-slate-400 text-base mt-3 leading-relaxed">
            Shared keys are written once. An app only stores what must be different.
          </p>
        </div>
        <button type="button" onClick={refreshAll} aria-label="Refresh apps" class="h-11 w-11 flex items-center justify-center bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300">
          <RefreshCw class={`w-5 h-5 ${resolving() ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)] gap-10 xl:gap-14 items-start">
        <aside class="space-y-6 lg:sticky lg:top-0">
          <button type="button" onClick={() => select("shared")} class={railBtn(selected() === "shared")}>
            <div class="flex items-center gap-4">
              <div class="h-11 w-11 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center flex-shrink-0">
                <Layers class="w-5 h-5" aria-hidden="true" />
              </div>
              <div class="min-w-0">
                <p class="font-semibold text-white">Shared</p>
                <p class="text-sm text-slate-400 mt-0.5">Every app inherits these</p>
              </div>
            </div>
          </button>

          <div class="space-y-2">
            <p class="text-xs uppercase tracking-[0.16em] text-slate-500 font-semibold px-2">Apps</p>
            <Show when={apps().length === 0}>
              <p class="text-sm text-slate-500 px-2 leading-relaxed">Create an app. It starts empty and inherits Shared.</p>
            </Show>
            <For each={apps()}>
              {(app) => (
                <button type="button" onClick={() => select(app.path)} class={railBtn(selected() === app.path)}>
                  <p class="font-mono text-sm text-white truncate">{app.path}</p>
                </button>
              )}
            </For>
          </div>

          <form onSubmit={handleCreateApp} class="px-1 space-y-3">
            <label for="new-app-name" class="text-sm text-slate-400">New app</label>
            <div class="flex gap-2">
              <input
                id="new-app-name"
                value={newName()}
                onInput={(e) => setNewName(e.target.value)}
                placeholder="encuesta-prod"
                class="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
              <button type="submit" disabled={loading()} aria-label="Create app" class="h-12 w-12 flex-shrink-0 flex items-center justify-center bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl disabled:opacity-50">
                <Plus class="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </form>
        </aside>

        <section class="min-w-0">
          <Show when={selected() === "shared"}>
            <div class="space-y-8">
              <div>
                <h2 class="text-2xl font-semibold text-white">Shared keys</h2>
                <p class="text-slate-400 mt-2 leading-relaxed max-w-2xl">
                  Common values live here. If one app needs another <span class="font-mono text-slate-300">DATABASE_URL</span>, override only that key on the app.
                </p>
              </div>
              <KvEditor pairs={pairs} onChange={changePair} onAdd={addPair} onRemove={removePair} />
              <div class="flex flex-wrap items-center gap-4 pt-2">
                <button type="button" onClick={handleSave} disabled={loading()} class="inline-flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold h-12 px-6 rounded-xl disabled:opacity-50">
                  <Lock class="w-4 h-4" aria-hidden="true" /> {loading() ? "Saving…" : "Save shared keys"}
                </button>
                <Show when={dirty()}>
                  <p class="text-sm text-amber-300">Unsaved — apps still see the last saved Shared.</p>
                </Show>
              </div>
            </div>
          </Show>

          <Show when={selected() !== "shared"}>
            <div class="space-y-10">
              <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-6">
                <div class="min-w-0">
                  <h2 class="text-2xl font-semibold text-white font-mono truncate">{selected()}</h2>
                  <p class="text-slate-400 mt-2 leading-relaxed">
                    Reads <span class="font-mono text-slate-300">/secret/data/{selected()}</span> — Shared plus this app’s overrides.
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-3 flex-shrink-0">
                  <Show when={!layerError() && Object.keys(resolved()?.overrides || {}).length > 0}>
                    <button type="button" onClick={shareAllToShared} disabled={loading()} class="h-11 px-4 rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-50">
                      Move all to Shared
                    </button>
                  </Show>
                  <button
                    type="button"
                    onClick={() => setShowApi(!showApi())}
                    class="h-11 px-4 rounded-xl text-sm font-medium border border-slate-700 text-slate-200 hover:bg-slate-800"
                  >
                    {showApi() ? "Hide API" : "How to read"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteApp(selected())}
                    class={`h-11 px-4 rounded-xl text-sm font-semibold ${confirmDelete() === selected() ? "bg-red-500 text-slate-950" : "text-red-300 border border-red-500/30 hover:bg-red-500/10"}`}
                  >
                    {confirmDelete() === selected() ? "Confirm delete" : "Delete"}
                  </button>
                </div>
              </div>

              <Show when={showApi()}>
                <pre class="text-sm leading-relaxed bg-slate-950 border border-slate-800 rounded-2xl px-5 py-4 text-cyan-300 overflow-x-auto">{readExample()}</pre>
              </Show>

              <Show when={layerError()}>
                <div class="px-5 py-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-sm text-red-200 leading-relaxed">
                  {layerError()} Saving would encrypt a new version with this unlock key and leave the old one unreadable.
                </div>
              </Show>

              <Show when={resolving()}>
                <p class="text-slate-400">Loading…</p>
              </Show>

              <Show when={!resolving() && inheritedKeys().length > 0}>
                <div class="space-y-4">
                  <h3 class="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">From Shared</h3>
                  <ul class="divide-y divide-slate-800/80 border border-slate-800/80 rounded-2xl overflow-hidden">
                    <For each={inheritedKeys()}>
                      {([key, value]) => (
                        <li class="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-8 px-6 py-5">
                          <p class="font-mono text-sm text-cyan-300 lg:w-56 flex-shrink-0 truncate" title={key}>{key}</p>
                          <p class="font-mono text-sm text-slate-300 flex-1 min-w-0 truncate" title={String(value)}>{String(value)}</p>
                          <div class="flex items-center gap-2 flex-shrink-0">
                            <span class="inline-flex items-center h-8 px-3 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-slate-800 text-slate-300 whitespace-nowrap">Shared</span>
                            <button type="button" class="h-10 w-10 flex items-center justify-center text-slate-400 hover:text-white rounded-xl hover:bg-slate-800" aria-label={`Copy ${key}`} onClick={() => copyValue(key, value)}>
                              {copied() === key ? <Check class="w-4 h-4 text-emerald-400" /> : <Copy class="w-4 h-4" />}
                            </button>
                            <button type="button" class="h-10 px-3 rounded-xl text-sm font-medium text-cyan-400 hover:bg-slate-800 whitespace-nowrap" onClick={() => startOverride(key, value)}>
                              Different value
                            </button>
                          </div>
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Show>

              <div class="space-y-5">
                <div>
                  <h3 class="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Only this app</h3>
                  <p class="text-slate-400 text-sm mt-2 leading-relaxed">Overrides and private keys. Saving never changes Shared or other apps.</p>
                </div>
                <Show when={!resolving() && !layerError() && inheritedKeys().length === 0 && !pairs().some((p) => p.key.trim())}>
                  <p class="text-slate-500 leading-relaxed">Nothing here yet. Add a key, or put common ones in Shared.</p>
                </Show>
                <KvEditor pairs={pairs} onChange={changePair} onAdd={addPair} onRemove={removePair} onShare={shareKeyWithAll} />
                <div class="flex flex-wrap items-center gap-4 pt-2">
                  <button type="button" onClick={handleSave} disabled={loading() || !!layerError()} class="inline-flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold h-12 px-6 rounded-xl disabled:opacity-50">
                    <Lock class="w-4 h-4" aria-hidden="true" /> {loading() ? "Saving…" : "Save this app"}
                  </button>
                  <Show when={dirty()}>
                    <p class="text-sm text-amber-300">Unsaved — Shared and other apps are not touched until you save.</p>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </section>
      </div>
    </div>
  );
}
