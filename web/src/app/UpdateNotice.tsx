import { useEffect } from "react";
import { useNavigate } from "react-router";
import { toast, Toaster } from "sonner";

import { useUpdate } from "../lib/update";

const SHOWN_KEY = "devdeck.update.toasted";

function shown(): string | null {
  try {
    return localStorage.getItem(SHOWN_KEY);
  } catch {
    return null;
  }
}

function markShown(version: string): void {
  try {
    localStorage.setItem(SHOWN_KEY, version);
  } catch {
    // not kept: the toast may show again next time, which is harmless
  }
}

/** Whether a newer devdeck is out (for the Settings badge in the sidebar). */
export function useUpdateAvailable(): boolean {
  const { data } = useUpdate();
  return Boolean(data && !data.dev && data.available);
}

/**
 * The toast that says a newer devdeck is out, once per version (this browser remembers which
 * versions it has shown). "View" opens Settings → About, where the update is installed. The
 * toasts themselves are drawn here too: flat and square, from the theme's tokens.
 */
export function UpdateNotice() {
  const { data } = useUpdate();
  const navigate = useNavigate();
  const latest = data && !data.dev && data.available ? data.latest : undefined;

  useEffect(() => {
    if (!latest || shown() === latest) return;
    markShown(latest);
    toast(`devdeck ${latest} is available`, {
      id: "update",
      description: "Install it from Settings → About.",
      duration: 12_000,
      action: { label: "View", onClick: () => navigate("/settings#about") },
    });
  }, [latest, navigate]);

  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex w-[356px] items-start gap-3 bg-surface-float p-3.5 text-[13px] text-ink shadow-[var(--shadow-float)]",
          title: "font-medium text-ink",
          description: "mt-0.5 text-ink-3",
          actionButton: "ms-auto shrink-0 font-semibold text-link hover:underline",
        },
      }}
    />
  );
}
