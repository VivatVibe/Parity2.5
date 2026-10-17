"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import type { DashboardData, DashboardJobItem } from "@/src/lib/db";
import { executePaymentWithRetry } from "@/src/lib/payment-client";

export default function MissionControlDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [user, setUser] = useState<{ id: number; email: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllRepairs, setShowAllRepairs] = useState(false);
  const [updatingJobId, setUpdatingJobId] = useState<number | null>(null);
  const [collectingRetainerId, setCollectingRetainerId] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const fetchDashboard = async (q = "") => {
    try {
      setLoading(true);
      setError(null);
      const url = q.trim() ? `/api/dashboard?q=${encodeURIComponent(q.trim())}` : "/api/dashboard";
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const json = await res.json();
      setData(json);
      if (json.user) setUser(json.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard(searchQuery);
  }, [searchQuery]);

  // 1-Click Status Update directly on Dashboard
  const handleUpdateStatus = async (jobId: number, newStatus: string) => {
    try {
      setUpdatingJobId(jobId);
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      await fetchDashboard(searchQuery);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setUpdatingJobId(null);
    }
  };

  // 1-Click Collect Retainer Payment for Current Month
  const handleCollectRetainer = async (job: DashboardJobItem) => {
    const monthlyRate = Number(job.parsedMetadata?.monthlyRate) || job.total_quoted_amount;
    const period = job.currentCyclePeriod || "";
    const amountToCollect = job.balanceDue > 0 ? job.balanceDue : monthlyRate;
    if (!confirm(`บันทึกรับเงินรอบบิล ${period} จำนวน ฿${amountToCollect.toLocaleString()} สำหรับ ${job.client.name}?`)) {
      return;
    }

    try {
      setCollectingRetainerId(job.id);
      const storage = typeof window !== "undefined" ? window.localStorage : null;
      const result = await executePaymentWithRetry({
        jobId: job.id,
        amount: amountToCollect,
        partsCost: 0,
        paymentType: "RETAINER_CYCLE",
        billingPeriod: period,
        note: "1-Click Collect from Dashboard",
        storage,
        fetchFn: fetch,
      });

      if (!result.ok) {
        throw new Error(result.error || "Failed to record retainer payment");
      }

      await fetchDashboard(searchQuery);
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setCollectingRetainerId(null);
    }
  };

  const repairsToDisplay = data?.zones.repairs.filter((r) => {
    if (showAllRepairs) return true;
    return r.status !== "DELIVERED" && r.status !== "CANCELLED";
  }) || [];

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 antialiased p-3 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-slate-900 text-white font-mono font-black text-xs px-2.5 py-1 rounded-lg">
                PARITY 2.5
              </span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                Mission Control Hub
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              ระบบรวมศูนย์งานช่าง IT ซ่อมคอมพิวเตอร์ • โปรเจกต์ดิจิทัล • บริการรายเดือน (Solo Worker Hub)
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/jobs/new"
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow transition flex items-center gap-1.5 whitespace-nowrap"
            >
              <span>+</span> เปิดใบงานใหม่ (Intake)
            </Link>

            {user && (
              <div className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="font-semibold text-slate-800">{user.name}</span>
                <a
                  href="/api/auth/logout"
                  className="text-slate-400 hover:text-rose-600 font-medium ml-1.5"
                  title="Logout"
                >
                  ออก
                </a>
              </div>
            )}
          </div>
        </header>

        {/* Global Instant Search Bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="🔍 ค้นหาด่วน: รหัสงาน (PR-, PJ-, RT-), ชื่องาน, ชื่อลูกค้า, เบอร์โทร, รุ่นอุปกรณ์, โดเมน..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 shadow-sm"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-3 text-xs text-slate-400 hover:text-slate-600 font-bold"
            >
              ✕ ล้างค้นหา
            </button>
          )}
        </div>

        {/* KPI Summary Ribbon (Calculated in Single D1 Aggregation) */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
            <span className="text-[11px] font-semibold text-slate-500 block uppercase tracking-wider">
              💼 งานที่กำลังทำอยู่
            </span>
            <p className="text-2xl font-black text-slate-900">
              {data?.kpis.activeJobsCount ?? 0} <span className="text-xs font-normal text-slate-400">งาน</span>
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
            <span className="text-[11px] font-semibold text-emerald-700 block uppercase tracking-wider">
              💰 รับชำระรอบเดือนนี้ ({data?.kpis.currentMonth || "-"})
            </span>
            <p className="text-2xl font-black text-emerald-700 font-mono">
              ฿{data?.kpis.monthlyRevenue?.toLocaleString() ?? 0}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
            <span className="text-[11px] font-semibold text-blue-700 block uppercase tracking-wider">
              📈 กำไรเบื้องต้นเดือนนี้ (Contribution Margin)
            </span>
            <p className="text-2xl font-black text-blue-700 font-mono">
              ฿{data?.kpis.monthlyProfit?.toLocaleString() ?? 0}
            </p>
            <p className="text-[10px] text-slate-400">รายรับหักต้นทุนอะไหล่ (ก่อนหักค่าโสหุ้ย)</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-1">
            <span className="text-[11px] font-semibold text-amber-700 block uppercase tracking-wider">
              ⏳ ยอดค้างชำระทั้งหมด
            </span>
            <p className="text-2xl font-black text-amber-700 font-mono">
              ฿{data?.kpis.unpaidBalanceDue?.toLocaleString() ?? 0}
            </p>
          </div>
        </section>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
            Error: {error}
          </div>
        )}

        {/* 3-ZONE ACTION MISSION CONTROL */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* ========================================================= */}
          {/* ZONE 1: 🔧 HARDWARE REPAIRS */}
          {/* ========================================================= */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔧</span>
                <div>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight">งานซ่อมอุปกรณ์</h2>
                  <p className="text-[11px] text-slate-400">Active Repairs ({repairsToDisplay.length})</p>
                </div>
              </div>
              <button
                onClick={() => setShowAllRepairs(!showAllRepairs)}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
              >
                {showAllRepairs ? "ซ่อนงานที่เสร็จแล้ว" : "ดูประวัติทั้งหมด"}
              </button>
            </div>

            {repairsToDisplay.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                ไม่มีงานซ่อมที่ค้างอยู่
              </p>
            ) : (
              <div className="space-y-3">
                {repairsToDisplay.map((job) => (
                  <div
                    key={job.id}
                    className="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/80 rounded-xl transition space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-0.5 rounded">
                          {job.job_number}
                        </span>
                        <span className="text-[11px] font-bold text-slate-700 truncate max-w-[140px]">
                          {job.client.name}
                        </span>
                      </div>
                      <span
                        className={`text-xs font-mono font-bold ${
                          job.balanceDue > 0 ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {job.balanceDue > 0 ? `ค้าง ฿${job.balanceDue.toLocaleString()}` : "✓ จ่ายครบ"}
                      </span>
                    </div>

                    <div>
                      <h3 className="font-bold text-xs text-slate-900 line-clamp-1">{job.title}</h3>
                      {job.parsedMetadata?.deviceModel && (
                        <p className="text-[11px] text-slate-500 line-clamp-1">
                          {job.parsedMetadata.deviceModel} • อาการ: {job.parsedMetadata.symptom}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px]">
                      {/* Inline Status Dropdown */}
                      <select
                        value={job.status}
                        disabled={updatingJobId === job.id}
                        onChange={(e) => handleUpdateStatus(job.id, e.target.value)}
                        className="bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold py-1 px-2 rounded-lg cursor-pointer focus:outline-none"
                      >
                        <option value="RECEIVED">RECEIVED (รับเครื่อง)</option>
                        <option value="IN_PROGRESS">IN_PROGRESS (กำลังซ่อม)</option>
                        <option value="WAITING_PARTS">WAITING_PARTS (รออะไหล่)</option>
                        <option value="COMPLETED">COMPLETED (ซ่อมเสร็จ)</option>
                        <option value="DELIVERED">DELIVERED (ส่งมอบแล้ว)</option>
                        <option value="CANCELLED">CANCELLED (ยกเลิก)</option>
                      </select>

                      <div className="flex gap-1.5">
                        <Link
                          href={`/jobs/${job.id}/slip`}
                          className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-bold"
                        >
                          📄 สลิป
                        </Link>
                        <Link
                          href={`/jobs/${job.id}`}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm"
                        >
                          บัญชี →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ========================================================= */}
          {/* ZONE 2: 💻 ONLINE PROJECTS (BY DEADLINE) */}
          {/* ========================================================= */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">💻</span>
                <div>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight">โปรเจกต์ออนไลน์</h2>
                  <p className="text-[11px] text-slate-400">By Deadline ({data?.zones.projects.length ?? 0})</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                เรียงตามกำหนดส่ง
              </span>
            </div>

            {data?.zones.projects.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                ไม่มีโปรเจกต์ที่ดำเนินอยู่
              </p>
            ) : (
              <div className="space-y-3">
                {data?.zones.projects.map((job) => (
                  <div
                    key={job.id}
                    className={`p-3.5 border rounded-xl transition space-y-2.5 ${
                      job.isOverdue
                        ? "bg-rose-50/50 border-rose-200"
                        : "bg-slate-50 hover:bg-slate-100/80 border-slate-200/80"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-xs bg-blue-900 text-white px-2 py-0.5 rounded">
                          {job.job_number}
                        </span>
                        <span className="text-[11px] font-bold text-slate-700 truncate max-w-[130px]">
                          {job.client.name}
                        </span>
                      </div>
                      {job.due_date && (
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            job.isOverdue
                              ? "bg-rose-100 text-rose-700 font-black animate-pulse"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {job.isOverdue ? "⚠️ เลยกำหนด!" : `ส่ง: ${new Date(job.due_date).toLocaleDateString("th-TH")}`}
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="font-bold text-xs text-slate-900 line-clamp-1">{job.title}</h3>
                      {job.parsedMetadata?.domainUrl && (
                        <a
                          href={job.parsedMetadata.domainUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-blue-600 hover:underline block truncate"
                        >
                          🌐 {job.parsedMetadata.domainUrl}
                        </a>
                      )}
                    </div>

                    {/* Milestone Payment Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-500 font-semibold">
                        <span>ความคืบหน้างวดเงิน ({job.paymentProgress ?? 0}%)</span>
                        <span className="font-mono">
                          ฿{job.totalPaid.toLocaleString()} / ฿{job.total_quoted_amount.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-blue-600 h-full rounded-full transition-all"
                          style={{ width: `${job.paymentProgress ?? 0}%` }}
                        ></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 text-[11px]">
                      <select
                        value={job.status}
                        disabled={updatingJobId === job.id}
                        onChange={(e) => handleUpdateStatus(job.id, e.target.value)}
                        className="bg-white border border-slate-200 text-slate-700 text-[11px] font-semibold py-1 px-2 rounded-lg cursor-pointer focus:outline-none"
                      >
                        <option value="RECEIVED">RECEIVED (รับบรีฟ)</option>
                        <option value="IN_PROGRESS">IN_PROGRESS (กำลังพัฒนา)</option>
                        <option value="WAITING">WAITING (ตรวจงาน)</option>
                        <option value="COMPLETED">COMPLETED (ส่งมอบสำเร็จ)</option>
                        <option value="CANCELLED">CANCELLED (ยกเลิก)</option>
                      </select>

                      <div className="flex gap-1.5">
                        <Link
                          href={`/jobs/${job.id}/slip`}
                          className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-2 py-1 rounded-lg text-[10px] font-bold"
                        >
                          📄 สลิป
                        </Link>
                        <Link
                          href={`/jobs/${job.id}`}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded-lg text-[10px] font-bold shadow-sm"
                        >
                          งวดเงิน →
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ========================================================= */}
          {/* ZONE 3: 📅 RETAINER BILLING RADAR */}
          {/* ========================================================= */}
          <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">📡</span>
                <div>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight">เรดาร์ตัดรอบบิล</h2>
                  <p className="text-[11px] text-slate-400">
                    Retainer Radar ({data?.zones.retainers.length ?? 0})
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded">
                รอบ {data?.kpis.currentMonth}
              </span>
            </div>

            {data?.zones.retainers.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                ไม่มีลูกค้าดูแลระบบรายเดือน
              </p>
            ) : (
              <div className="space-y-3">
                {data?.zones.retainers.map((job) => {
                  const monthlyRate = Number(job.parsedMetadata?.monthlyRate) || job.total_quoted_amount;
                  const billingDay = job.parsedMetadata?.billingCycleDay || 1;

                  return (
                    <div
                      key={job.id}
                      className={`p-3.5 border rounded-xl transition space-y-2.5 ${
                        job.currentCyclePaid
                          ? "bg-slate-50 border-slate-200"
                          : "bg-amber-50/60 border-amber-300 shadow-sm"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-xs bg-purple-900 text-white px-2 py-0.5 rounded">
                            {job.job_number}
                          </span>
                          <span className="text-[11px] font-bold text-slate-800 truncate max-w-[130px]">
                            {job.client.name}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-purple-700 bg-purple-100/70 px-2 py-0.5 rounded">
                          ตัดรอบวันที่ {billingDay}
                        </span>
                      </div>

                      <div>
                        <h3 className="font-bold text-xs text-slate-900 line-clamp-1">{job.title}</h3>
                        <p className="text-[11px] text-slate-500 font-mono">
                          ค่าบริการ: <strong>฿{monthlyRate.toLocaleString()}</strong> / เดือน
                        </p>
                      </div>

                      {/* Current Month Status Badge */}
                      <div className="flex items-center justify-between pt-1">
                        {job.currentCyclePaid ? (
                          <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                            <span>✓</span> ได้รับชำระแล้ว ({data?.kpis.currentMonth})
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                            <span className="animate-ping w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            รอเรียกเก็บ ({data?.kpis.currentMonth})
                          </span>
                        )}

                        <Link
                          href={`/jobs/${job.id}`}
                          className="text-[11px] text-blue-600 hover:underline font-semibold"
                        >
                          ดูประวัติ →
                        </Link>
                      </div>

                      {/* 1-CLICK COLLECT BUTTON (FOR UNPAID RETAINERS) */}
                      {!job.currentCyclePaid && (
                        <button
                          type="button"
                          disabled={collectingRetainerId === job.id}
                          onClick={() => handleCollectRetainer(job)}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 px-3 rounded-lg shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-1"
                        >
                          {collectingRetainerId === job.id
                            ? "กำลังบันทึก..."
                            : `✓ เก็บเงินรอบนี้ (฿${monthlyRate.toLocaleString()})`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
