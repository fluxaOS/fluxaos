// src/components/confirm-modal/ConfirmModal.tsx
'use client';

import { useEffect, useState } from 'react';

type ConfirmRequest = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Resolver = (confirmed: boolean) => void;

// Module-level singleton: one host mounted per client island, one open
// modal at a time. The Wave 2 spec accepts this — operators never need
// nested confirms in the Projects form path. If a future page needs
// concurrent modals, swap the singleton for a queue.
let resolveQueue: Resolver | null = null;
let setRequestQueue: ((req: ConfirmRequest | null) => void) | null = null;

/**
 * Promise-based confirm modal (FLX-226). Mount <ConfirmModalHost />
 * once at the project-scoped client boundary; any client component
 * inside it can then call `await openConfirmModal({...})`.
 *
 * Throws if called before the host has mounted (no fallback rendering;
 * a missing host is a wiring bug, not a runtime path to absorb).
 */
export function openConfirmModal(req: ConfirmRequest): Promise<boolean> {
  if (!setRequestQueue) {
    throw new Error(
      'openConfirmModal called before <ConfirmModalHost /> mounted'
    );
  }
  return new Promise((resolve) => {
    resolveQueue = resolve;
    setRequestQueue?.(req);
  });
}

export function ConfirmModalHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    setRequestQueue = setRequest;
    return () => {
      setRequestQueue = null;
    };
  }, []);

  if (!request) return null;

  const confirm = (value: boolean) => {
    const resolve = resolveQueue;
    resolveQueue = null;
    setRequest(null);
    resolve?.(value);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm"
      onClick={() => confirm(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') confirm(false);
      }}
    >
      <div
        className="card-static p-6 max-w-md w-full mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="text-base font-semibold text-white"
        >
          {request.title}
        </h2>
        <p className="text-sm text-slate-300">{request.body}</p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => confirm(false)}
            className="px-3 py-1.5 text-sm text-slate-300 hover:text-white"
            data-testid="confirm-modal-cancel"
          >
            {request.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={() => confirm(true)}
            className={
              request.destructive
                ? 'px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-md'
                : 'px-3 py-1.5 text-sm font-medium text-white bg-electric-violet hover:bg-accent-hover rounded-md'
            }
            data-testid="confirm-modal-confirm"
          >
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
