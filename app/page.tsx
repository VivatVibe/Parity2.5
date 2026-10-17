"use client";

import { useEffect, useState } from "react";

interface TracerState {
  authenticated: boolean;
  user?: {
    id: number;
    email: string;
    name: string;
    avatar_url?: string;
  };
  clientsCount: number;
  jobsCount: number;
  jobs: Array<{
    id: number;
    job_number: string;
    job_type: string;
    title: string;
    status: string;
    total_quoted_amount: number;
    metadata: string;
    created_at: string;
  }>;
}

export default function Home() {
  const [data, setData] = useState<TracerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/tracer");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleCreateTracerJob = async () => {
    try {
      setCreating(true);
      const res = await fetch("/api/tracer", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create tracer job");
      await fetchStatus();
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 antialiased p-4 sm:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-6 border-b border-slate-200 gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-blue-600 text-white font-bold text-xs px-2 py-1 rounded">v2.5</span>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
                Parity — Universal Solo Hub
              </h1>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Tracer-Bullet Verification: Next.js + Cloudflare D1 + Edge Auth
            </p>
          </div>

          {/* User Account / Auth Status */}
          {data?.user ? (
            <div className="flex items-center gap-3 bg-white border border-slate-200 px-3 py-2 rounded-xl shadow-sm">
              {data.user.avatar_url && (
                <img
                  src={data.user.avatar_url}
                  alt={data.user.name}
                  className="w-8 h-8 rounded-full border border-slate-200"
                />
              )}
              <div className="text-left text-xs">
                <p className="font-semibold text-slate-800">{data.user.name}</p>
                <p className="text-slate-400">{data.user.email}</p>
              </div>
              <a
                href="/api/auth/logout"
                className="text-xs text-rose-600 hover:text-rose-700 font-medium ml-2 px-2 py-1 rounded bg-rose-50"
              >
                Logout
              </a>
            </div>
          ) : (
            <a
              href="/api/auth/google"
              className="inline-flex items-center justify-center gap-2 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-800 transition"
            >
              Sign in with Google
            </a>
          )}
        </header>

        {/* Pipeline Status Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Edge D1 Database</span>
            <p className="text-lg font-bold text-emerald-600 mt-1 flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Connected
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Clients in D1</span>
            <p className="text-2xl font-black text-slate-800 mt-1">{data?.clientsCount ?? 0}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm col-span-2 sm:col-span-1">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Jobs Stored</span>
            <p className="text-2xl font-black text-blue-600 mt-1">{data?.jobsCount ?? 0}</p>
          </div>
        </section>

        {/* Action Button */}
        <div className="flex justify-between items-center bg-blue-50 border border-blue-200 p-4 rounded-xl">
          <div>
            <h2 className="font-bold text-sm text-blue-900">ทดสอบเพิ่มใบงาน (Tracer-Bullet)</h2>
            <p className="text-xs text-blue-700 mt-0.5">
              ทดสอบสร้าง Client $\rightarrow$ ออกรหัสงาน Atomic Counter $\rightarrow$ บันทึก JSON Metadata
            </p>
          </div>
          <button
            onClick={handleCreateTracerJob}
            disabled={creating || loading}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow disabled:opacity-50 transition"
          >
            {creating ? "กำลังบันทึก..." : "+ สร้าง 1 Dummy Job"}
          </button>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Jobs List */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            รายการงานที่บันทึกใน D1 ({data?.jobs?.length ?? 0})
          </h2>

          {loading && !data && (
            <div className="p-8 text-center text-slate-400 text-xs">กำลังโหลดข้อมูลจาก D1 Edge...</div>
          )}

          {data?.jobs?.length === 0 && !loading && (
            <div className="p-8 text-center text-slate-400 text-xs bg-white rounded-xl border border-dashed border-slate-200">
              ยังไม่มีงานในระบบ กดปุ่ม "+ สร้าง 1 Dummy Job" ด้านบนเพื่อทดสอบ
            </div>
          )}

          {data?.jobs?.map((job) => {
            let meta: any = {};
            try {
              meta = JSON.parse(job.metadata || "{}");
            } catch (e) {}

            return (
              <div
                key={job.id}
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-slate-300 transition space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs bg-slate-900 text-white px-2 py-0.5 rounded">
                      {job.job_number}
                    </span>
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                      {job.job_type}
                    </span>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      {job.status}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-slate-700">
                    ฿{job.total_quoted_amount?.toLocaleString()}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-slate-900">{job.title}</h3>

                {meta.deviceModel && (
                  <div className="bg-slate-50 p-2.5 rounded-lg text-xs text-slate-600 space-y-1 border border-slate-100">
                    <p>
                      <strong>อุปกรณ์:</strong> {meta.deviceModel} ({meta.serialNumber || "No S/N"})
                    </p>
                    <p>
                      <strong>อาการเสีย:</strong> {meta.symptom}
                    </p>
                    <p>
                      <strong>ต้นทุนอะไหล่:</strong> ฿{meta.partsCost?.toLocaleString()}
                    </p>
                  </div>
                )}

                <div className="text-[10px] text-slate-400 text-right">
                  บันทึกเมื่อ: {new Date(job.created_at).toLocaleString("th-TH")}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
