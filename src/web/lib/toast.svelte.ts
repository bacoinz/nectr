// One toast at a time, optionally with an action ("Anular").

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

let current = $state<Toast | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const toasts = {
  get current() {
    return current;
  },
};

export function toast(message: string, action?: Toast["action"]) {
  clearTimeout(timer);
  current = { id: ++seq, message, action };
  timer = setTimeout(() => (current = null), action ? 6500 : 2800);
}

export function dismissToast() {
  clearTimeout(timer);
  current = null;
}

/** Shows an API error (already in pt-PT) or a generic message. */
export function toastError(e: unknown) {
  toast(e instanceof Error && e.message ? e.message : "Ocorreu um erro inesperado.");
}
