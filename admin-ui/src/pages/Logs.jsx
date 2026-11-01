import { createResource, Show, For } from "solid-js";
import { vaultFetch } from "../store";
import { RefreshCw, Inbox } from "lucide-solid";

const fetchLogs = async () => {
  const res = await vaultFetch("/sys/audit");
  if (!res.ok) throw new Error("Failed to load audit logs");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export default function Logs() {
  const [logs, { refetch }] = createResource(fetchLogs);

  return (
    <div class="space-y-10">
      <div class="flex items-start justify-between gap-6">
        <div>
          <h1 class="text-3xl font-bold text-white tracking-tight">Audit logs</h1>
          <p class="text-slate-400 text-base mt-3 leading-relaxed">History of vault actions.</p>
        </div>
        <button
          type="button"
          onClick={refetch}
          disabled={logs.loading}
          aria-label="Refresh audit logs"
          title="Refresh audit logs"
          class="p-2 min-w-10 min-h-10 hover:bg-slate-800 rounded-lg text-slate-300 hover:text-white transition-colors"
        >
          <RefreshCw class={`w-5 h-5 ${logs.loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </div>

      <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl p-8 shadow-lg shadow-black/20">
        <Show when={logs.loading}>
          <p class="text-slate-300" aria-busy="true">Loading audit events…</p>
        </Show>
        <Show when={logs.error}>
          <p class="text-red-300" role="alert">Could not load audit logs. Check your session and try refresh.</p>
        </Show>
        <Show when={!logs.loading && !logs.error && logs() && logs().length === 0}>
          <div class="flex flex-col items-center justify-center py-16 text-slate-400">
            <Inbox class="w-12 h-12 mb-4 opacity-50 text-cyan-500" aria-hidden="true" />
            <p class="text-lg font-medium text-slate-200">No audit events yet</p>
            <p class="text-sm mt-2">Store a secret or issue a token to generate the first events.</p>
          </div>
        </Show>
        <Show when={Array.isArray(logs()) && logs().length > 0}>
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-slate-800 text-slate-300 text-sm">
                  <th class="pb-4 px-5 font-medium">Timestamp</th>
                  <th class="pb-4 px-5 font-medium">Accessor</th>
                  <th class="pb-4 px-5 font-medium">Action</th>
                  <th class="pb-4 px-5 font-medium">Resource</th>
                  <th class="pb-4 px-5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                <For each={logs()}>
                  {(log) => (
                    <tr class="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20">
                      <td class="py-4 px-5 text-sm text-slate-300 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                      <td class="py-4 px-5 text-sm font-mono text-slate-400 truncate max-w-[8rem]" title={log.token_id}>{log.token_id}</td>
                      <td class="py-4 px-5 text-sm font-mono text-cyan-400">{log.action}</td>
                      <td class="py-4 px-5 text-sm text-slate-300 truncate max-w-[12rem]" title={log.resource}>{log.resource}</td>
                      <td class="py-4 px-5 text-sm">
                        <span class={`px-2 py-1 rounded text-xs font-medium ${log.status === "SUCCESS" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </div>
  );
}
