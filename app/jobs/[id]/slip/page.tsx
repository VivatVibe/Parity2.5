"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface JobSlip {
  id: number;
  job_number: string;
  job_type: "REPAIR" | "PROJECT" | "RETAINER";
  title: string;
  status: string;
  due_date?: string;
  total_quoted_amount: number;
  created_at: string;
  client?: {
    name: string;
    phone?: string;
    line_id?: string;
  };
  parsedMetadata?: any;
  payments: Array<{
    id: number;
    amount: number;
    payment_type: string;
    billing_period?: string;
    paid_at: string;
  }>;
  financialSummary: {
    totalQuotedAmount: number;
    totalPaid: number;
    balanceDue: number;
    isPaidInFull: boolean;
    currentCyclePaid?: boolean;
    currentCyclePeriod?: string;
  };
  photos?: Array<{
    id: number;
    r2_key: string;
    caption?: string;
  }>;
}

export default function JobSlipPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const resolvedParams = use(params as any) as { id: string };
  const jobId = resolvedParams.id;

  const [job, setJob] = useState<JobSlip | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        if (res.ok) setJob(data.job);
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };
    fetchJob();
  }, [jobId]);

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <p className="text-xs text-slate-500 font-medium">กำลังเตรียมสลิปดิจิทัล...</p>
      </main>
    );
  }

  if (!job) {
    return (
      <main className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 space-y-3">
        <p className="text-rose-600 text-xs font-bold">ไม่พบข้อมูลสลิปของงานนี้</p>
        <Link href="/" className="text-xs text-blue-600 underline">
          กลับหน้าหลัก
        </Link>
      </main>
    );
  }

  const { financialSummary, parsedMetadata, client } = job;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 antialiased p-3 sm:p-6 flex flex-col items-center justify-center print:bg-white print:p-0 print:text-black">
      <style>{`
        @media print {
          @page {
            margin: 10mm;
          }
        }
      `}</style>

      {/* Top Action Bar (Hidden in Print) */}
      <div className="w-full max-w-md flex items-center justify-between mb-3 text-xs print:hidden">
        <Link
          href={`/jobs/${job.id}`}
          className="text-slate-600 hover:text-slate-900 font-semibold flex items-center gap-1"
        >
          ← หน้ารายละเอียดงาน
        </Link>
        <div className="flex gap-2">
          <button
            onClick={handleCopyLink}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium px-3 py-1.5 rounded-lg shadow-sm transition"
          >
            {copied ? "✓ คัดลอกแล้ว" : "📋 ลิงก์"}
          </button>
          <button
            onClick={handlePrint}
            className="bg-slate-900 hover:bg-slate-800 text-white font-medium px-3 py-1.5 rounded-lg shadow-sm transition flex items-center gap-1"
          >
            <span>🖨️</span> พิมพ์ / PDF
          </button>
        </div>
      </div>

      {/* MOBILE DIGITAL SLIP CARD */}
      <div className="slip-container w-full max-w-md bg-white border border-slate-300 rounded-3xl p-6 sm:p-7 shadow-lg space-y-5 print:rounded-none print:border-none print:shadow-none print:max-w-none print:p-0">
        {/* Receipt Header */}
        <div className="text-center pb-4 border-b border-dashed border-slate-300 space-y-1">
          <div className="inline-block bg-slate-900 text-white font-black text-xs px-2.5 py-0.5 rounded tracking-widest uppercase mb-1">
            PARITY HUB
          </div>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">
            ใบรับงาน / สลิปดิจิทัล (Service Slip)
          </h1>
          <p className="text-[11px] text-slate-500">
            ออกเมื่อ: {new Date().toLocaleDateString("th-TH")} {new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <div className="pt-2">
            <span className="font-mono font-black text-xl bg-slate-100 text-slate-900 px-4 py-1 rounded-xl border border-slate-200 inline-block tracking-wider">
              {job.job_number}
            </span>
          </div>
        </div>

        {/* Customer & Job Info */}
        <div className="space-y-3 text-xs">
          <div className="flex justify-between items-start pb-2 border-b border-slate-100">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">ลูกค้า / ผู้ว่าจ้าง</span>
              <p className="font-bold text-slate-900 text-sm">{client?.name || "ลูกค้าทั่วไป"}</p>
            </div>
            <div className="text-right">
              {client?.phone && <p className="text-slate-600 font-medium">{client.phone}</p>}
              {client?.line_id && <p className="text-slate-500 text-[11px]">LINE: {client.line_id}</p>}
            </div>
          </div>

          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">ชื่องาน / รายการ</span>
            <p className="font-bold text-slate-900 text-sm mt-0.5">{job.title}</p>
            <div className="flex gap-2 mt-1">
              <span className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                ประเภท: {job.job_type}
              </span>
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                สถานะ: {job.status}
              </span>
            </div>
          </div>

          {/* Type-Specific Details (Safe: Strict Privacy - No Costs or Internal Notes) */}
          <div className="bg-slate-50 rounded-xl p-3.5 space-y-1.5 border border-slate-200/60 text-slate-700 text-xs">
            {job.job_type === "REPAIR" && parsedMetadata && (
              <>
                <p>
                  <strong>อุปกรณ์:</strong> {parsedMetadata.deviceModel}
                </p>
                {parsedMetadata.serialNumber && (
                  <p>
                    <strong>Serial Number:</strong> {parsedMetadata.serialNumber}
                  </p>
                )}
                <p>
                  <strong>อาการเสียที่แจ้ง:</strong> {parsedMetadata.symptom}
                </p>
                {parsedMetadata.accessories && (
                  <p>
                    <strong>อุปกรณ์ที่ติดมาด้วย:</strong> {parsedMetadata.accessories}
                  </p>
                )}
              </>
            )}

            {job.job_type === "PROJECT" && parsedMetadata && (
              <>
                {parsedMetadata.domainUrl && (
                  <p>
                    <strong>เว็บไซต์:</strong> {parsedMetadata.domainUrl}
                  </p>
                )}
                <p>
                  <strong>ขอบเขตงาน:</strong> {parsedMetadata.scopeSummary}
                </p>
                {parsedMetadata.deliverables && (
                  <p>
                    <strong>สิ่งที่ส่งมอบ:</strong> {parsedMetadata.deliverables}
                  </p>
                )}
              </>
            )}

            {job.job_type === "RETAINER" && parsedMetadata && (
              <>
                <p>
                  <strong>รอบตัดบิล:</strong> ทุกวันที่ {parsedMetadata.billingCycleDay} ของเดือน
                </p>
                <p>
                  <strong>ขอบเขตการดูแล:</strong> {parsedMetadata.serviceScope}
                </p>
                {financialSummary.currentCyclePeriod && (
                  <p className="font-semibold text-slate-900">
                    รอบบิล {financialSummary.currentCyclePeriod}:{" "}
                    {financialSummary.currentCyclePaid ? "✓ ชำระเรียบร้อย" : "⏳ รอการชำระ"}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Condition Photos (Safe: Only image & caption, no internal notes) */}
          {job.photos && job.photos.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">
                ภาพถ่ายสภาพอุปกรณ์ตอนรับเครื่อง ({job.photos.length} รูป)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {job.photos.map((photo) => (
                  <div key={photo.id} className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                    <img
                      src={`/api/jobs/${job.id}/photos/${photo.id}`}
                      alt={photo.caption || "ภาพสภาพอุปกรณ์"}
                      className="w-full aspect-video object-cover"
                      loading="lazy"
                    />
                    {photo.caption && (
                      <p className="p-1 text-[10px] text-slate-600 truncate">{photo.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Financial Breakdown (Customer View) */}
        <div className="space-y-2 pt-2 border-t border-slate-200 text-xs">
          <div className="flex justify-between items-center text-slate-600">
            <span>ยอดค่าบริการทั้งหมด:</span>
            <span className="font-mono font-bold text-slate-900">
              ฿{financialSummary.totalQuotedAmount.toLocaleString()}
            </span>
          </div>

          <div className="flex justify-between items-center text-emerald-700 font-semibold">
            <span>ยอดชำระแล้ว:</span>
            <span className="font-mono font-bold">
              -฿{financialSummary.totalPaid.toLocaleString()}
            </span>
          </div>

          {/* Prominent Stamp / Balance Due Display */}
          <div className="pt-3 pb-1 border-t border-dashed border-slate-300">
            {financialSummary.isPaidInFull ? (
              <div className="bg-emerald-50 border-2 border-emerald-500 rounded-2xl p-3.5 text-center space-y-0.5">
                <span className="font-mono font-black text-lg text-emerald-700 tracking-wider block">
                  ✓ PAID IN FULL
                </span>
                <p className="text-xs text-emerald-800 font-bold">ชำระเงินครบถ้วนเรียบร้อยแล้ว</p>
              </div>
            ) : (
              <div className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-200">
                <span className="font-bold text-slate-800 text-xs">ยอดคงเหลือที่ต้องชำระ:</span>
                <span className="font-mono font-black text-base text-rose-600">
                  ฿{financialSummary.balanceDue.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Payment History Log (Strictly Safe: Date, Type, Amount) */}
        {job.payments?.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-100 text-[11px]">
            <span className="text-[10px] font-bold uppercase text-slate-400 block">
              รายการชำระเงินที่บันทึกแล้ว
            </span>
            <div className="space-y-1">
              {job.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-slate-600">
                  <span>
                    {new Date(p.paid_at).toLocaleDateString("th-TH")} • {p.payment_type}
                    {p.billing_period ? ` (${p.billing_period})` : ""}
                  </span>
                  <span className="font-mono font-bold text-slate-800">
                    ฿{p.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer / Thank you */}
        <div className="text-center pt-4 border-t border-dashed border-slate-300 space-y-1">
          <p className="text-xs font-bold text-slate-800">ขอบคุณที่ไว้วางใจใช้บริการครับ 🙏</p>
          <p className="text-[10px] text-slate-400">
            กรุณาเก็บสลิปดิจิทัลหรือภาพถ่ายนี้ไว้เป็นหลักฐานอ้างอิง
          </p>
        </div>
      </div>
    </div>
  );
}
