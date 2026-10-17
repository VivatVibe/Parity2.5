/**
 * Client-side payment executor with persisted idempotency key retry.
 * Handles lost network responses, server errors, and genuine partial payments.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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

export async function executePaymentWithRetry(options: PaymentExecutionOptions): Promise<{
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
  idempotencyKey: string;
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

  const storageKey = `parity_pending_pay_${jobId}_${billingPeriod || "single"}`;
  let idempotencyKey = storage ? storage.getItem(storageKey) : null;

  if (!idempotencyKey) {
    const opId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    idempotencyKey = `pay-${jobId}-${billingPeriod || "single"}-${opId}`;
    if (storage) {
      storage.setItem(storageKey, idempotencyKey);
    }
  }

  try {
    const res = await fetchFn(`/api/jobs/${jobId}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        amount,
        parts_cost: partsCost,
        payment_type: paymentType,
        billing_period: billingPeriod,
        note,
        idempotency_key: idempotencyKey,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      // Confirmed resolved! Clear pending key so subsequent operations generate a new key
      if (storage) {
        storage.removeItem(storageKey);
      }
      return { ok: true, status: res.status, data: body, idempotencyKey };
    } else {
      // If 409 conflict, clear the key so client can start a fresh operation
      if (res.status === 409 && storage) {
        storage.removeItem(storageKey);
      }
      return { ok: false, status: res.status, error: body.error || "Payment failed", idempotencyKey };
    }
  } catch (err: any) {
    // Uncertain network response or timeout: key remains in storage for retry!
    return { ok: false, status: 0, error: err.message || "Network error", idempotencyKey };
  }
}
