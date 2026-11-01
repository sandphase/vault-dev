import { For } from "solid-js";
import { toasts, dismissToast } from "../store";

export default function Toaster() {
  return (
    <div class="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-[calc(100%-2rem)]" aria-live="polite" aria-relevant="additions">
      <For each={toasts()}>
        {(toast) => (
          <div
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            class={`px-4 py-3 rounded-lg shadow-lg border backdrop-blur-md text-sm font-medium flex items-start gap-3 ${
              toast.type === "error"
                ? "bg-red-950/80 border-red-900/50 text-red-200"
                : toast.type === "warning"
                ? "bg-orange-950/80 border-orange-900/50 text-orange-200"
                : "bg-emerald-950/80 border-emerald-900/50 text-emerald-200"
            }`}
          >
            {toast.type === "error" ? (
              <svg class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            ) : toast.type === "warning" ? (
              <svg class="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            ) : (
              <svg class="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
            )}
            <span class="flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
              class="ml-auto opacity-70 hover:opacity-100 transition-opacity p-1 min-w-8 min-h-8 flex items-center justify-center"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
