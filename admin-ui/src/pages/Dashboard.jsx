import { createResource, Show, For, Suspense } from "solid-js";
import { A } from "@solidjs/router";
import { addToast, vaultFetch } from "../store";
import { Activity, ShieldCheck, Key, Inbox } from "lucide-solid";

const fetchStats = async () => {
  const [logsRes, tokensRes, secretsRes] = await Promise.all([
    vaultFetch("/sys/audit"),
    vaultFetch("/sys/tokens"),
    vaultFetch("/secret/metadata")
  ]);

  if (!logsRes.ok || !tokensRes.ok || !secretsRes.ok) {
    const err = new Error("Failed to load dashboard data.");
    addToast(err.message, "error");
    throw err;
  }

  const logs = await logsRes.json();
  const tokens = await tokensRes.json();
  const secrets = await secretsRes.json();
  return {
    logs: Array.isArray(logs) ? logs : [],
    tokens: Array.isArray(tokens) ? tokens : [],
    secrets: Array.isArray(secrets) ? secrets : []
  };
};

function DashboardSkeleton() {
  return (
    <div class="animate-pulse space-y-6" aria-busy="true">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-slate-900/50 border border-slate-800/50 rounded-2xl h-24"></div>
        <div class="bg-slate-900/50 border border-slate-800/50 rounded-2xl h-24"></div>
        <div class="bg-slate-900/50 border border-slate-800/50 rounded-2xl h-24"></div>
      </div>
      <div class="bg-slate-900/50 border border-slate-800/50 rounded-2xl h-64 mt-8"></div>
    </div>
  );
}

export default function Dashboard() {
  const [data] = createResource(fetchStats);

  return (
    <div class="space-y-10">
      <div>
        <h1 class="text-3xl font-bold text-white tracking-tight">Dashboard</h1>
        <p class="text-slate-400 text-base mt-3 max-w-2xl leading-relaxed">Overview of secrets, tokens, and audit history.</p>
      </div>

      <Suspense fallback={<DashboardSkeleton />}>
        <Show
          when={!data.error}
          fallback={
            <div class="bg-slate-900/80 border border-red-900/40 rounded-2xl p-8 text-red-200">
              Could not load dashboard data. Sign in again or retry.
            </div>
          }
        >
          <Show when={data()}>
            <Show when={(data().secrets?.length || 0) === 0}>
              <div class="bg-cyan-500/10 border border-cyan-500/20 rounded-2xl p-8 text-sm text-slate-200">
                <p class="font-semibold text-white mb-2">First-run checklist</p>
                <ol class="list-decimal list-inside space-y-1 text-slate-300">
                  <li><A href="/apps" class="text-cyan-400 hover:underline">Add shared keys once</A>, then create an app and only override what is different.</li>
                  <li><A href="/access" class="text-cyan-400 hover:underline">Issue a limited token</A> for that app path instead of sharing <code>root</code>.</li>
                  <li><A href="/settings" class="text-cyan-400 hover:underline">Optional:</A> confirm Telegram alerts from env vars.</li>
                </ol>
              </div>
            </Show>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
              <A href="/apps" class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl shadow-lg shadow-black/20 p-8 flex items-start space-x-5 transition-transform hover:-translate-y-1">
                <div class="p-3 bg-cyan-500/10 text-cyan-400 rounded-xl shadow-inner"><Key class="w-6 h-6" aria-hidden="true" /></div>
                <div>
                  <p class="text-slate-300 text-sm font-medium">Apps & shared keys</p>
                  <h3 class="text-3xl font-bold text-white mt-1">{Math.max(0, (data().secrets || []).filter((s) => s.path !== "global").length)}</h3>
                  <p class="text-xs text-cyan-400 mt-2">Open Apps →</p>
                </div>
              </A>
              <A href="/access" class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl shadow-lg shadow-black/20 p-8 flex items-start space-x-5 transition-transform hover:-translate-y-1">
                <div class="p-3 bg-cyan-500/10 text-cyan-400 rounded-xl shadow-inner"><ShieldCheck class="w-6 h-6" aria-hidden="true" /></div>
                <div>
                  <p class="text-slate-300 text-sm font-medium">Active tokens</p>
                  <h3 class="text-3xl font-bold text-white mt-1">{data().tokens?.filter(t => t.is_active).length || 0}</h3>
                  <p class="text-xs text-cyan-400 mt-2">Open Tokens →</p>
                </div>
              </A>
              <A href="/logs" class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl shadow-lg shadow-black/20 p-8 flex items-start space-x-5 transition-transform hover:-translate-y-1">
                <div class="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl shadow-inner"><Activity class="w-6 h-6" aria-hidden="true" /></div>
                <div>
                  <p class="text-slate-300 text-sm font-medium">Audit logs</p>
                  <h3 class="text-3xl font-bold text-white mt-1">{data().logs?.length || 0}</h3>
                  <p class="text-xs text-cyan-400 mt-2">Open audit logs →</p>
                </div>
              </A>
            </div>

            <div class="bg-slate-900/80 backdrop-blur-sm border border-slate-800 rounded-2xl shadow-lg shadow-black/20 p-8">
              <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-bold text-white">Recent activity</h2>
                <A href="/logs" class="text-sm text-cyan-400 hover:underline">View all audit logs →</A>
              </div>
              <Show
                when={data().logs && data().logs.length > 0}
                fallback={
                  <div class="flex flex-col items-center justify-center py-12 text-slate-400">
                    <Inbox class="w-12 h-12 mb-4 opacity-50" aria-hidden="true" />
                    <p class="text-lg font-medium text-slate-300">No activity yet</p>
                    <p class="text-sm">Store a secret or issue a token to generate audit events.</p>
                  </div>
                }
              >
                <div class="overflow-x-auto">
                  <table class="w-full text-left border-collapse">
                    <thead>
                      <tr class="border-b border-slate-800 text-slate-300 text-sm">
                        <th class="pb-4 px-5 font-medium">Timestamp</th>
                        <th class="pb-4 px-5 font-medium">Action</th>
                        <th class="pb-4 px-5 font-medium">Resource</th>
                        <th class="pb-4 px-5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={data().logs?.slice(0, 5)}>
                        {(log) => (
                          <tr class="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/30 transition-colors">
                            <td class="py-4 px-5 text-sm text-slate-300 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                            <td class="py-4 px-5 text-sm font-mono text-cyan-400">{log.action}</td>
                            <td class="py-4 px-5 text-sm text-slate-300 truncate max-w-[12rem]" title={log.resource}>{log.resource}</td>
                            <td class="py-4 px-5 text-sm">
                              <span class={`px-2 py-1 rounded-md text-xs font-semibold tracking-wide ${log.status === "SUCCESS" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
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
          </Show>
        </Show>
      </Suspense>
    </div>
  );
}
