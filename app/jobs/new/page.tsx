"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Client {
  id: number;
  name: string;
  phone?: string;
  line_id?: string;
}

export default function NewJobPage() {
  const router = useRouter();

  // 1. Client selection / creation state
  const [clients, setClients] = useState<Client[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientLine, setNewClientLine] = useState("");
  const [savingClient, setSavingClient] = useState(false);

  // 2. Job Type state
  const [jobType, setJobType] = useState<"REPAIR" | "PROJECT" | "RETAINER">("REPAIR");

  // 3. Common Job Fields
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [totalQuotedAmount, setTotalQuotedAmount] = useState<number | "">("");

  // 4. Specific Metadata Fields
  // REPAIR
  const [deviceModel, setDeviceModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [symptom, setSymptom] = useState("");
  const [accessories, setAccessories] = useState("");
  const [partsCost, setPartsCost] = useState<number | "">("");

  // PROJECT
  const [domainUrl, setDomainUrl] = useState("");
  const [scopeSummary, setScopeSummary] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [deliverables, setDeliverables] = useState("");

  // RETAINER
  const [billingCycleDay, setBillingCycleDay] = useState<number | "">("");
  const [monthlyRate, setMonthlyRate] = useState<number | "">("");
  const [serviceScope, setServiceScope] = useState("");

  // Submission State
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successJob, setSuccessJob] = useState<any>(null);

  // Load clients
  const loadClients = async (q = "") => {
    try {
      const res = await fetch(`/api/clients?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (res.ok) setClients(data.clients || []);
    } catch (e) {}
  };

  useEffect(() => {
    loadClients(searchQuery);
  }, [searchQuery]);

  // Handle Create New Client
  const handleSaveNewClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return alert("กรุณาระบุชื่อลูกค้า");

    try {
      setSavingClient(true);
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newClientName,
          phone: newClientPhone,
          lineId: newClientLine,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");

      setSelectedClient(data.client);
      setShowNewClientForm(false);
      setNewClientName("");
      setNewClientPhone("");
      setNewClientLine("");
      await loadClients();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setSavingClient(false);
    }
  };

  // Handle Submit Job
  const handleSubmitJob = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedClient) {
      setError("กรุณาเลือกลูกค้า หรือกดสร้างลูกค้าใหม่");
      return;
    }
    if (!title.trim()) {
      setError("กรุณาระบุชื่องาน");
      return;
    }

    let metadata: any = {};
    if (jobType === "REPAIR") {
      if (!deviceModel.trim() || !symptom.trim()) {
        setError("กรุณาระบุรุ่นอุปกรณ์ และอาการเสีย");
        return;
      }
      metadata = {
        deviceModel,
        serialNumber,
        symptom,
        accessories,
        partsCost: partsCost === "" ? 0 : Number(partsCost),
      };
    } else if (jobType === "PROJECT") {
      if (!scopeSummary.trim()) {
        setError("กรุณาระบุสรุปขอบเขตงาน");
        return;
      }
      metadata = {
        domainUrl,
        scopeSummary,
        repoUrl,
        deliverables,
      };
    } else if (jobType === "RETAINER") {
      if (billingCycleDay === "" || monthlyRate === "" || !serviceScope.trim()) {
        setError("กรุณาระบุวันตัดรอบบิล (1-31), ค่าบริการรายเดือน, และขอบเขตงาน");
        return;
      }
      metadata = {
        billingCycleDay: Number(billingCycleDay),
        monthlyRate: Number(monthlyRate),
        serviceScope,
      };
    }

    const payload = {
      job_type: jobType,
      client_id: selectedClient.id,
      title,
      due_date: dueDate || undefined,
      total_quoted_amount: totalQuotedAmount === "" ? 0 : Number(totalQuotedAmount),
      metadata,
    };

    try {
      setSubmitting(true);
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create job");

      setSuccessJob(data.job);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 antialiased p-4 sm:p-6 lg:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
          >
            ← กลับหน้าหลัก
          </Link>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Ticket 2: Polymorphic Intake
          </span>
        </div>

        {/* Success Modal / Banner */}
        {successJob && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-4 shadow-sm">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-xl font-black">
              ✓
            </div>
            <div>
              <h2 className="text-lg font-black text-emerald-900">เปิดใบงานสำเร็จเรียบร้อย!</h2>
              <p className="text-xs text-emerald-700 mt-1">
                รหัสงานที่ได้รับ (Atomic Counter):
              </p>
              <div className="inline-block bg-slate-900 text-white font-mono font-bold text-lg px-4 py-1.5 rounded-xl mt-2 shadow">
                {successJob.job_number}
              </div>
            </div>
            <p className="text-xs text-slate-600">
              {successJob.title} — ลูกค้า: {selectedClient?.name}
            </p>
            <div className="flex gap-2 justify-center pt-2">
              <Link
                href="/"
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow transition"
              >
                กลับไปดูหน้ากระดานงาน
              </Link>
              <button
                onClick={() => {
                  setSuccessJob(null);
                  setTitle("");
                  setSymptom("");
                  setScopeSummary("");
                  setDeviceModel("");
                }}
                className="bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-bold px-4 py-2.5 rounded-xl transition"
              >
                + เปิดงานใหม่อีกใบ
              </button>
            </div>
          </div>
        )}

        {!successJob && (
          <form onSubmit={handleSubmitJob} className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                เปิดใบงานใหม่ (Unified Intake)
              </h1>

              {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs p-3.5 rounded-xl font-medium">
                  {error}
                </div>
              )}

              {/* SECTION 1: Client Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  1. เลือกลูกค้า / ผู้ว่าจ้าง *
                </label>

                {selectedClient ? (
                  <div className="flex items-center justify-between p-3.5 bg-blue-50 border border-blue-200 rounded-xl">
                    <div>
                      <p className="font-bold text-sm text-blue-950">{selectedClient.name}</p>
                      <p className="text-xs text-blue-700">
                        {selectedClient.phone || "ไม่มีเบอร์"} {selectedClient.line_id && `• LINE: ${selectedClient.line_id}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedClient(null)}
                      className="text-xs font-semibold text-rose-600 hover:text-rose-700 underline"
                    >
                      เปลี่ยนลูกค้า
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="พิมพ์ค้นหาชื่อ หรือเบอร์โทรลูกค้า..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewClientForm(!showNewClientForm)}
                        className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-3.5 py-2.5 rounded-xl whitespace-nowrap transition"
                      >
                        + ลูกค้าใหม่
                      </button>
                    </div>

                    {/* Inline Create Client Form */}
                    {showNewClientForm && (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                        <p className="text-xs font-bold text-slate-800">สร้างข้อมูลลูกค้าใหม่</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            placeholder="ชื่อลูกค้า *"
                            value={newClientName}
                            onChange={(e) => setNewClientName(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg p-2 text-xs"
                          />
                          <input
                            type="tel"
                            placeholder="เบอร์โทรศัพท์"
                            value={newClientPhone}
                            onChange={(e) => setNewClientPhone(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg p-2 text-xs"
                          />
                          <input
                            type="text"
                            placeholder="LINE ID"
                            value={newClientLine}
                            onChange={(e) => setNewClientLine(e.target.value)}
                            className="bg-white border border-slate-200 rounded-lg p-2 text-xs"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowNewClientForm(false)}
                            className="text-xs text-slate-500 px-3 py-1.5"
                          >
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveNewClient}
                            disabled={savingClient}
                            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-1.5 rounded-lg shadow"
                          >
                            {savingClient ? "กำลังบันทึก..." : "บันทึกและเลือกลูกค้านี้"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Search Results Dropdown List */}
                    {clients.length > 0 && (
                      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto bg-white shadow-sm">
                        {clients.map((c) => (
                          <div
                            key={c.id}
                            onClick={() => setSelectedClient(c)}
                            className="p-3 text-xs flex justify-between items-center hover:bg-blue-50 cursor-pointer transition"
                          >
                            <div>
                              <p className="font-bold text-slate-900">{c.name}</p>
                              <p className="text-[11px] text-slate-400">
                                {c.phone || "ไม่มีเบอร์"} {c.line_id && `• ${c.line_id}`}
                              </p>
                            </div>
                            <span className="text-blue-600 font-bold text-xs">เลือก →</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 2: Job Type Selector (Large Touch Targets) */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  2. เลือกประเภทงาน (Job Type) *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setJobType("REPAIR")}
                    className={`py-3 px-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition ${
                      jobType === "REPAIR"
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span className="text-base">🔧</span>
                    ซ่อมคอม/อุปกรณ์
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobType("PROJECT")}
                    className={`py-3 px-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition ${
                      jobType === "PROJECT"
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span className="text-base">💻</span>
                    โปรเจกต์ออนไลน์
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobType("RETAINER")}
                    className={`py-3 px-2 rounded-xl text-xs font-bold border flex flex-col items-center gap-1 transition ${
                      jobType === "RETAINER"
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    <span className="text-base">📅</span>
                    บริการรายเดือน
                  </button>
                </div>
              </div>

              {/* SECTION 3: Common Fields */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  3. ข้อมูลทั่วไปของงาน
                </label>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">ชื่องาน / สรุปสั้นๆ *</label>
                  <input
                    type="text"
                    required
                    placeholder={
                      jobType === "REPAIR"
                        ? "เช่น ซ่อมบอร์ด MacBook Air M1 เปิดไม่ติด"
                        : jobType === "PROJECT"
                        ? "เช่น ปรับแก้ On-page SEO + Speed Score เว็บคลินิก"
                        : "เช่น ดูแลระบบเว็บ WordPress ประจำเดือน + SEO"
                    }
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">
                      ยอดเงินประเมิน/ตกลง (฿)
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={totalQuotedAmount}
                      onChange={(e) => setTotalQuotedAmount(e.target.value === "" ? "" : Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 mb-1 block">กำหนดส่ง (Due Date)</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 4: Dynamic Polymorphic Metadata Fields */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  4. ข้อมูลเฉพาะทาง ({jobType})
                </label>

                {/* --- A: REPAIR FIELDS --- */}
                {jobType === "REPAIR" && (
                  <div className="space-y-3 bg-amber-50/50 border border-amber-200/60 p-4 rounded-xl">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">รุ่นอุปกรณ์ / Model *</label>
                        <input
                          type="text"
                          required
                          placeholder="เช่น Acer Nitro 5, iPad Air 4"
                          value={deviceModel}
                          onChange={(e) => setDeviceModel(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">Serial Number (S/N)</label>
                        <input
                          type="text"
                          placeholder="เช่น NHQ89ST001..."
                          value={serialNumber}
                          onChange={(e) => setSerialNumber(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700 mb-1 block">อาการเสียที่แจ้ง *</label>
                      <textarea
                        required
                        rows={2}
                        placeholder="ระบุอาการเสียอย่างละเอียด เช่น เปิดติดไม่มีภาพ, พัดลมหมุนเสียงดัง..."
                        value={symptom}
                        onChange={(e) => setSymptom(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">อุปกรณ์ที่ติดมาด้วย</label>
                        <input
                          type="text"
                          placeholder="เช่น สายชาร์จแท้, กระเป๋า, กล่อง"
                          value={accessories}
                          onChange={(e) => setAccessories(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">
                          ต้นทุนอะไหล่โดยประมาณ (฿)
                        </label>
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          value={partsCost}
                          onChange={(e) => setPartsCost(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* --- B: PROJECT FIELDS --- */}
                {jobType === "PROJECT" && (
                  <div className="space-y-3 bg-blue-50/50 border border-blue-200/60 p-4 rounded-xl">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">โดเมนเว็บไซต์ / URL</label>
                        <input
                          type="text"
                          placeholder="เช่น https://clientwebsite.com"
                          value={domainUrl}
                          onChange={(e) => setDomainUrl(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">
                          ลิงก์โฟลเดอร์/รีพอร์ต (Drive / Figma)
                        </label>
                        <input
                          type="text"
                          placeholder="เช่น https://drive.google.com/..."
                          value={repoUrl}
                          onChange={(e) => setRepoUrl(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700 mb-1 block">สรุปขอบเขตงาน (Scope) *</label>
                      <textarea
                        required
                        rows={2}
                        placeholder="สรุปงานที่จะทำ เช่น Audit ปัญหา Technical SEO 50 หน้า, แก้ไข Core Web Vitals"
                        value={scopeSummary}
                        onChange={(e) => setScopeSummary(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700 mb-1 block">สิ่งที่ต้องส่งมอบ (Deliverables)</label>
                      <input
                        type="text"
                        placeholder="เช่น รายงาน PDF 1 ฉบับ + ตารางคำค้นหา Google Sheet"
                        value={deliverables}
                        onChange={(e) => setDeliverables(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                      />
                    </div>
                  </div>
                )}

                {/* --- C: RETAINER FIELDS --- */}
                {jobType === "RETAINER" && (
                  <div className="space-y-3 bg-purple-50/50 border border-purple-200/60 p-4 rounded-xl">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">
                          วันตัดรอบบิลประจำเดือน (1 - 31) *
                        </label>
                        <input
                          type="number"
                          required
                          min="1"
                          max="31"
                          placeholder="เช่น 1 หรือ 25"
                          value={billingCycleDay}
                          onChange={(e) => setBillingCycleDay(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700 mb-1 block">
                          อัตราค่าบริการต่อเดือน (฿) *
                        </label>
                        <input
                          type="number"
                          required
                          min="0"
                          placeholder="เช่น 8500"
                          value={monthlyRate}
                          onChange={(e) => setMonthlyRate(e.target.value === "" ? "" : Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-medium text-slate-700 mb-1 block">
                        ขอบเขตการดูแลประจำเดือน *
                      </label>
                      <textarea
                        required
                        rows={2}
                        placeholder="เช่น อัปเดตปลั๊กอินความปลอดภัย, ตรวจสอบ uptime, เขียนบทความ SEO 4 ชิ้นต่อเดือน"
                        value={serviceScope}
                        onChange={(e) => setServiceScope(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm py-3 px-4 rounded-xl shadow transition disabled:opacity-50 mt-4"
              >
                {submitting ? "กำลังบันทึกข้อมูลและออกรหัสงาน..." : "✓ บันทึกเปิดใบงาน (Create Job)"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
