/**
 * Client-side payment executor with persisted immutable operation retry.
 * Guarantees that unconfirmed payments retry with their exact original payload,
 * survives network timeouts, page reloads, and balance shifts,
 * and reconciles against the server without silent discarding.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedPaymentOperation {
  jobId: number;
  amount: number;
  partsCost: number;
  paymentType: "DEPOSIT" | "MILESTONE" | "FINAL" | "RETAINER_CYCLE";
  billingPeriod?: string;
  note?: string;
  idempotencyKey: string;
  createdAt: number;
}

export interface PaymentExecutionOptions {
  jobId: number;
  amount: number;
  partsCost?: number;
  paymentType: "DEPOSIT" | "MILESTONE" | "FINAL" | "RETAINER_CYCLE";
  billingPeriod?: string;
  note?: string;
  storage?: StorageLike | null;
  fetchFn: (url: string, init: any) => Promise<Response>;
}

export function getPendingPaymentOperation(
  storage: StorageLike | null | undefined,
  jobId: number,
  billingPeriod?: string
): PersistedPaymentOperation | null {
  if (!storage) return null;
  const storageKey = `parity_pending_pay_op_${jobId}_${billingPeriod || "single"}`;
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function cancelPendingPaymentOperation(
  storage: StorageLike | null | undefined,
  jobId: number,
  billingPeriod?: string
): void {
  if (!storage) return;
  const storageKey = `parity_pending_pay_op_${jobId}_${billingPeriod || "single"}`;
  storage.removeItem(storageKey);
}

export async function executePaymentWithRetry(options: PaymentExecutionOptions): Promise<{
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
  isConflict?: boolean;
  operation: PersistedPaymentOperation;
}> {
  const {
    jobId,
    amount,
    partsCost = 0,
    paymentType,
    billingPeriod,
    note,
    storage,
    fetchFn,
  } = options;

  const storageKey = `parity_pending_pay_op_${jobId}_${billingPeriod || "single"}`;
  let persistedOp: PersistedPaymentOperation | null = null;

  if (storage) {
    const raw = storage.getItem(storageKey);
    if (raw) {
      try {
        persistedOp = JSON.parse(raw);
      } catch {
        persistedOp = null;
      }
    }
  }

  // If no unresolved operation exists, create and persist a new immutable operation
  if (!persistedOp) {
    const opId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    persistedOp = {
      jobId,
      amount,
      partsCost,
      paymentType,
      billingPeriod,
      note,
      idempotencyKey: `pay-${jobId}-${billingPeriod || "single"}-${opId}`,
      createdAt: Date.now(),
    };

    if (storage) {
      storage.setItem(storageKey, JSON.stringify(persistedOp));
    }
  }

  // Always use the immutable persisted operation parameters for retries,
  // preventing balance shifts or reload drift from mutating the in-flight request
  const opToExecute = persistedOp;

  try {
    const res = await fetchFn(`/api/jobs/${opToExecute.jobId}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": opToExecute.idempotencyKey,
      },
      body: JSON.stringify({
        amount: opToExecute.amount,
        parts_cost: opToExecute.partsCost,
        payment_type: opToExecute.paymentType,
        billing_period: opToExecute.billingPeriod,
        note: opToExecute.note,
        idempotency_key: opToExecute.idempotencyKey,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      // Confirmed resolved on server! Clear operation from storage
      if (storage) {
        storage.removeItem(storageKey);
      }
      return { ok: true, status: res.status, data: body, operation: opToExecute };
    }

    if (res.status === 409) {
      // Reconcile against server: check if payment was committed under this idempotencyKey
      try {
        const checkRes = await fetchFn(
          `/api/jobs/${opToExecute.jobId}/payments?idempotency_key=${encodeURIComponent(
            opToExecute.idempotencyKey
          )}`,
          { method: "GET" }
        );
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.payment) {
            // Already committed on server! Safely resolve and clear storage.
            if (storage) {
              storage.removeItem(storageKey);
            }
            return {
              ok: true,
              status: 200,
              data: { success: true, payment: checkData.payment, isIdempotentReplay: true },
              operation: opToExecute,
            };
          }
        }
      } catch {
        // Reconciliation network check failed; retain operation for recovery
      }

      // Do NOT silently delete on unresolved 409 conflict. Retain for explicit inspection.
      return {
        ok: false,
        status: 409,
        isConflict: true,
        error: body.error || "Idempotency conflict",
        operation: opToExecute,
      };
    }

    return {
      ok: false,
      status: res.status,
      error: body.error || "Payment failed",
      operation: opToExecute,
    };
  } catch (err: any) {
    // Network drop or timeout: operation remains persisted in storage for safe retry
    return {
      ok: false,
      status: 0,
      error: err.message || "Network error",
      operation: opToExecute,
    };
  }
}
