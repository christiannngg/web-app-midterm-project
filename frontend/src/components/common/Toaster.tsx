import { useToastStore } from "@/store/toastStore";

/**
 * Presentational host for toasts. Errors are `role="alert"` (announced at once); the rest are
 * `role="status"` (announced politely). Every toast can be dismissed with the keyboard.
 */
export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="toaster" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
