"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface JobDetail {
  id: number;
  user_id: number;
  client_id: number;
  job_number: string;
  job_type: "REPAIR" | "PROJECT" | "RETAINER";
  title: string;
  status: string;
  due_date?: string;
  total_quoted_amount: number;
  metadata: string;
  created_at: string;
  updated_at: string;
  client?: {
    id: number;
    name: string;
    phone?: string;
    line_id?: string;
  };
  parsedMetadata?: any;
  payments: Array<{
    id: number;
    amount: number;
    parts_cost: number;
    payment_type: string;
    billing_period?: string;
    paid_at: string;
    note?: string;
  }>;
  financialSummary: {
    totalQuotedAmount: number;
    totalPaid: number;
    totalPartsCost: number;
    balanceDue: number;
    netProfit: number;
    isPaidInFull: boolean;
    currentCyclePaid?: boolean;
    currentCyclePeriod?: string;
  };
}

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolvedParams = use(params as any) as { id: string };
  const jobId = resolvedParams.id;
  const router = useRouter();

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status updating state
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState<number | "">("");
  const [partsCost, setPartsCost] = useState<number | "">("");
  const [paymentType, setPaymentType] = useState<"DEPOSIT" | "MILESTONE" | "FINAL" | "RETAINER_CYCLE">("FINAL");
  const [billingPeriod, setBillingPeriod] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const fetchJob = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const data = await res.json();
      setJob(data.job);

      // Auto-set payment type & billing period defaults
      if (data.job?.job_type === "RETAINER") {
        setPaymentType("RETAINER_CYCLE");
        const now = new Date();
        const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        setBillingPeriod(currentPeriod);
        if (data.job.financialSummary?.totalQuotedAmount) {
          setPaymentAmount(data.job.financialSummary.totalQuotedAmount);
        }
      } else {
        if (data.job?.financialSummary?.balanceDue > 0) {
          setPaymentAmount(data.job.financialSummary.balanceDue);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJob();
  }, [jobId]);

  // Handle status update
  const handleUpdateStatus = async (newStatus: string) => {
    try {
      setUpdatingStatus(true);
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setJob(data.job);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Handle payment logging
  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);

    if (paymentAmount === "" || Number(paymentAmount) <= 0) {
      setPaymentError("กรุณาระบุจำนวนเงินที่ถูกต้อง");
      return;
    }

    try {
      setRecordingPayment(true);
      const res = await fetch(`/api/jobs/${jobId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(paymentAmount),
          parts_cost: partsCost === "" ? 0 : Number(partsCost),
          payment_type: paymentType,
          billing_period: paymentType === "RETAINER_CYCLE" ? billingPeriod : undefined,
          note: paymentNote,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record payment");

      // Reset form & reload
      setPaymentAmount("");
      setPartsCost("");
      setPaymentNote("");
      await fetchJob();
    } catch (err: any) {
      setPaymentError(err.message);
    } finally {
      setRecordingPayment(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <p className="text-xs text-slate-500 font-medium">กำลังโหลดรายละเอียดงานและประวัติการเงิน...</p>
      </main>
    );
  }

  if (error || !job) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex flex-col items-center justify-center space-y-4">
        <p className="text-rose-600 text-sm font-bold">เกิดข้อผิดพลาด: {error || "ไม่พบงานนี้"}</p>
        <Link href="/" className="text-xs text-blue-600 hover:underline">
          ← กลับหน้าหลัก
        </Link>
      </main>
    );
  }

  const { financialSummary, parsedMetadata } = job;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 antialiased p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Top Navigation */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
          >
            ← กลับหน้าหลัก
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href={`/jobs/${job.id}/slip`}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl shadow transition flex items-center gap-1.5"
            >
              <span>📄</span> ใบเสร็จดิจิทัลสำหรับลูกค้า (Digital Slip)
            </Link>
          </div>
        </div>

        {/* Header Card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-slate-900 text-white font-mono font-bold text-sm px-2.5 py-1 rounded-lg">
                  {job.job_number}
                </span>
                <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg">
                  {job.job_type}
                </span>
                {financialSummary.isPaidInFull && (
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    ✓ PAID IN FULL
                  </span>
                )}
              </div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">{job.title}</h1>
            </div>

            {/* Status Selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500 font-medium">สถานะงาน:</label>
              <select
                value={job.status}
                disabled={updatingStatus}
                onChange={(e) => handleUpdateStatus(e.target.value)}
                className="bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold py-2 px-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
              >
                <option value="RECEIVED">RECEIVED (รับงาน)</option>
                <option value="IN_PROGRESS">IN_PROGRESS (กำลังทำ)</option>
                <option value="WAITING">WAITING (รอดำเนินการ)</option>
                <option value="WAITING_PARTS">WAITING_PARTS (รออะไหล่)</option>
                <option value="COMPLETED">COMPLETED (เสร็จเรียบร้อย)</option>
                <option value="DELIVERED">DELIVERED (ส่งมอบแล้ว)</option>
                <option value="ACTIVE">ACTIVE (กำลังดูแล - รายเดือน)</option>
                <option value="PAUSED">PAUSED (พักบริการ)</option>
                <option value="CANCELLED">CANCELLED (ยกเลิก)</option>
              </select>
            </div>
          </div>

          {/* Client & Timing Meta */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
            <div className="space-y-1">
              <p className="text-slate-400 font-medium">ข้อมูลลูกค้า / ผู้ว่าจ้าง</p>
              <p className="font-bold text-slate-800">{job.client?.name || "ไม่ระบุ"}</p>
              <p className="text-slate-500">
                เบอร์: {job.client?.phone || "-"} {job.client?.line_id && `• LINE: ${job.client.line_id}`}
              </p>
            </div>
            <div className="space-y-1 sm:text-right">
              <p className="text-slate-400 font-medium">วันที่บันทึก / กำหนดส่ง</p>
              <p className="text-slate-700">เปิดงาน: {new Date(job.created_at).toLocaleDateString("th-TH")}</p>
              <p className="text-slate-700">
                กำหนดส่ง: {job.due_date ? new Date(job.due_date).toLocaleDateString("th-TH") : "ไม่ระบุ"}
              </p>
            </div>
          </div>

          {/* Type-Specific Details Box */}
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs space-y-2">
            <p className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
              รายละเอียดเฉพาะ ({job.job_type})
            </p>

            {job.job_type === "REPAIR" && parsedMetadata && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600">
                <p>
                  <strong>รุ่นเครื่อง:</strong> {parsedMetadata.deviceModel}
                </p>
                <p>
                  <strong>S/N:</strong> {parsedMetadata.serialNumber || "-"}
                </p>
                <p className="sm:col-span-2">
                  <strong>อาการเสีย:</strong> {parsedMetadata.symptom}
                </p>
                <p>
                  <strong>อุปกรณ์ที่ติดมา:</strong> {parsedMetadata.accessories || "-"}
                </p>
                <p>
                  <strong>ประมาณการค่าอะไหล่:</strong> ฿{Number(parsedMetadata.partsCost || 0).toLocaleString()}
                </p>
              </div>
            )}

            {job.job_type === "PROJECT" && parsedMetadata && (
              <div className="space-y-1.5 text-slate-600">
                {parsedMetadata.domainUrl && (
                  <p>
                    <strong>โดเมน:</strong>{" "}
                    <a
                      href={parsedMetadata.domainUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {parsedMetadata.domainUrl}
                    </a>
                  </p>
                )}
                <p>
                  <strong>ขอบเขตงาน:</strong> {parsedMetadata.scopeSummary}
                </p>
                {parsedMetadata.repoUrl && (
                  <p>
                    <strong>ลิงก์ส่งมอบ/ไฟล์:</strong>{" "}
                    <a
                      href={parsedMetadata.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline break-all"
                    >
                      {parsedMetadata.repoUrl}
                    </a>
                  </p>
                )}
                {parsedMetadata.deliverables && (
                  <p>
                    <strong>ผลลัพธ์ที่ต้องส่ง:</strong> {parsedMetadata.deliverables}
                  </p>
                )}
              </div>
            )}

            {job.job_type === "RETAINER" && parsedMetadata && (
              <div className="space-y-1.5 text-slate-600">
                <div className="flex gap-4">
                  <p>
                    <strong>วันตัดรอบบิล:</strong> ทุกวันที่ {parsedMetadata.billingCycleDay} ของเดือน
                  </p>
                  <p>
                    <strong>ค่าบริการรายเดือน:</strong> ฿{Number(parsedMetadata.monthlyRate || 0).toLocaleString()}
                  </p>
                </div>
                <p>
                  <strong>ขอบเขตการดูแล:</strong> {parsedMetadata.serviceScope}
                </p>
                {financialSummary.currentCyclePeriod && (
                  <p className="font-semibold text-slate-800 pt-1">
                    รอบบิลปัจจุบัน ({financialSummary.currentCyclePeriod}):{" "}
                    {financialSummary.currentCyclePaid ? (
                      <span className="text-emerald-600">✓ ได้รับชำระแล้ว</span>
                    ) : (
                      <span className="text-amber-600">⏳ ยังไม่ได้รับชำระของเดือนนี้</span>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* FINANCIAL LEDGER BOX (Owner Only) */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                สมุดบัญชีการเงิน & บันทึกรับเงิน (Financial Ledger)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                เห็นเฉพาะเจ้าของร้าน/ช่าง คำนวณหักต้นทุนอะไหล่และกำไรสุทธิแบบ Realtime
              </p>
            </div>
            <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded uppercase">
              Owner Eyes Only
            </span>
          </div>

          {/* Financial Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5">
              <span className="text-[11px] font-semibold text-slate-500 block">ยอดรวมประเมิน</span>
              <p className="text-lg font-black text-slate-900 mt-1">
                ฿{financialSummary.totalQuotedAmount.toLocaleString()}
              </p>
            </div>
            <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-3.5">
              <span className="text-[11px] font-semibold text-emerald-700 block">รับชำระแล้วทั้งหมด</span>
              <p className="text-lg font-black text-emerald-800 mt-1">
                ฿{financialSummary.totalPaid.toLocaleString()}
              </p>
            </div>
            <div className="bg-rose-50/60 border border-rose-200/80 rounded-xl p-3.5">
              <span className="text-[11px] font-semibold text-rose-700 block">
                {job.job_type === "RETAINER" ? "ต้นทุน/ค่าใช้จ่าย" : "ต้นทุนอะไหล่รวม"}
              </span>
              <p className="text-lg font-black text-rose-800 mt-1">
                ฿{financialSummary.totalPartsCost.toLocaleString()}
              </p>
            </div>
            <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3.5">
              <span className="text-[11px] font-semibold text-blue-700 block">กำไรสุทธิ (Net Profit)</span>
              <p className="text-lg font-black text-blue-900 mt-1">
                ฿{financialSummary.netProfit.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Balance Due Notification */}
          {job.job_type !== "RETAINER" && (
            <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <span className="font-medium text-slate-600">ยอดคงเหลือที่ต้องชำระ (Balance Due):</span>
              <span
                className={`font-mono font-bold text-sm ${
                  financialSummary.balanceDue > 0 ? "text-amber-600" : "text-emerald-600"
                }`}
              >
                ฿{financialSummary.balanceDue.toLocaleString()}
              </span>
            </div>
          )}

          {/* Record New Payment Form */}
          <form onSubmit={handleRecordPayment} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              + บันทึกยอดรับเงินใหม่ (Record Payment)
            </h3>

            {paymentError && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg font-medium">
                {paymentError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 mb-1 block">ประเภทการชำระ *</label>
                <select
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value as any)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-medium"
                >
                  <option value="DEPOSIT">DEPOSIT (เงินมัดจำ)</option>
                  <option value="MILESTONE">MILESTONE (ตามงวดงาน)</option>
                  <option value="FINAL">FINAL (ยอดปิดงาน/ส่วนที่เหลือ)</option>
                  <option value="RETAINER_CYCLE">RETAINER_CYCLE (รอบบิลรายเดือน)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 mb-1 block">จำนวนเงินรับชำระ (฿) *</label>
                <input
                  type="number"
                  min="1"
                  required
                  placeholder="0"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                >
                </input>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 mb-1 block">
                  ต้นทุนอะไหล่ในบิลนี้ (฿)
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="0 (ถ้ามี)"
                  value={partsCost}
                  onChange={(e) => setPartsCost(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                />
              </div>
            </div>

            {paymentType === "RETAINER_CYCLE" && (
              <div>
                <label className="text-[11px] font-semibold text-slate-600 mb-1 block">
                  รอบบิลประจำเดือน (YYYY-MM) *
                </label>
                <input
                  type="text"
                  required
                  pattern="^\d{4}-\d{2}$"
                  placeholder="เช่น 2026-10"
                  value={billingPeriod}
                  onChange={(e) => setBillingPeriod(e.target.value)}
                  className="w-full sm:w-1/3 bg-white border border-slate-200 rounded-lg p-2 text-xs"
                />
              </div>
            )}

            <div>
              <label className="text-[11px] font-semibold text-slate-600 mb-1 block">หมายเหตุ / วิธีโอนเงิน</label>
              <input
                type="text"
                placeholder="เช่น โอนเข้า กสิกร, เงินสด, บัตรเครดิต"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>

            <button
              type="submit"
              disabled={recordingPayment}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 px-4 rounded-xl shadow transition disabled:opacity-50"
            >
              {recordingPayment ? "กำลังบันทึก..." : "✓ บันทึกรับเงินเข้าสมุดบัญชี"}
            </button>
          </form>

          {/* Payment History List */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              ประวัติการรับเงิน ({job.payments?.length ?? 0} รายการ)
            </h3>

            {job.payments?.length === 0 ? (
              <p className="text-xs text-slate-400 py-3 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                ยังไม่มีรายการชำระเงิน บันทึกรับเงินครั้งแรกจากฟอร์มด้านบน
              </p>
            ) : (
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden bg-white">
                {job.payments.map((p) => (
                  <div key={p.id} className="p-3 text-xs flex justify-between items-center hover:bg-slate-50 transition">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{p.payment_type}</span>
                        {p.billing_period && (
                          <span className="text-[10px] font-semibold bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">
                            รอบ: {p.billing_period}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-400">
                          {new Date(p.paid_at).toLocaleString("th-TH")}
                        </span>
                      </div>
                      {p.note && <p className="text-slate-500 text-[11px]">{p.note}</p>}
                      {p.parts_cost > 0 && (
                        <p className="text-rose-600 text-[11px]">
                          หักต้นทุนอะไหล่: -฿{p.parts_cost.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-bold text-emerald-700 text-sm">
                        +฿{p.amount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
