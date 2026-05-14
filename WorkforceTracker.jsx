import { useState, useEffect, useCallback, useRef } from "react";

const DEPARTMENTS = ["Molding", "VJ Assembly", "CNC", "Gasket", "Paint"];

function getWeekEnd(offset = 0) {
  const d = new Date();
  const sat = new Date(d);
  sat.setDate(d.getDate() + (6 - d.getDay()) + offset * 7);
  sat.setHours(0, 0, 0, 0);
  return sat;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const parts = iso.split("-");
  return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

function daysUntilBirthday(bday) {
  if (!bday) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = bday.split("-");
  const next = new Date(today.getFullYear(), +parts[1] - 1, +parts[2]);
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return Math.round((next - today) / 86400000);
}

function initials(name = "") {
  return name.trim().split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase();
}

export default function App() {
  const [gasUrl, setGasUrl] = useState(() => localStorage.getItem("wt_gasUrl") || "");
  const [urlDraft, setUrlDraft] = useState("");
  const [setupDone, setSetupDone] = useState(!!localStorage.getItem("wt_gasUrl"));
  const [tab, setTab] = useState("dashboard");
  const [employees, setEmployees] = useState([]);
  const [timesheets, setTimesheets] = useState([]);
  const [weekOff, setWeekOff] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [sending, setSending] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const toastTimer = useRef(null);

  const weekEnd = getWeekEnd(weekOff);
  const weekEndStr = weekEnd.toISOString().split("T")[0];

  const notify = (msg, type = "success") => {
    clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  const call = useCallback(async (params) => {
    const url = localStorage.getItem("wt_gasUrl");
    if (!url) return null;
    try {
      const u = new URL(url);
      Object.entries(params).forEach(([k, v]) =>
        u.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v))
      );
      const res = await fetch(u.toString(), { redirect: "follow" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) {
      notify("Connection error: " + e.message, "error");
      return null;
    }
  }, []);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    const d = await call({ action: "getEmployees" });
    if (d?.employees) setEmployees(d.employees);
    setLoading(false);
  }, [call]);

  const loadTimesheets = useCallback(async () => {
    const d = await call({ action: "getTimesheets", weekEnd: weekEndStr });
    if (d?.timesheets) setTimesheets(d.timesheets);
  }, [call, weekEndStr]);

  useEffect(() => {
    if (setupDone) loadEmployees();
  }, [setupDone, loadEmployees]);

  useEffect(() => {
    if (setupDone) loadTimesheets();
  }, [setupDone, loadTimesheets]);

  const connect = () => {
    if (!urlDraft.trim()) return;
    localStorage.setItem("wt_gasUrl", urlDraft.trim());
    setGasUrl(urlDraft.trim());
    setSetupDone(true);
  };

  const saveEmployee = async () => {
    if (!form.name || !form.eid || !form.department) {
      notify("Name, EID, and Department are required", "error");
      return;
    }
    const action = modal === "edit" ? "updateEmployee" : "addEmployee";
    const res = await call({ action, data: form });
    if (res?.success) {
      notify(modal === "edit" ? "Employee updated" : "Employee added");
      closeModal();
      loadEmployees();
    }
  };

  const deleteEmployee = async (eid, name) => {
    if (!confirm(`Remove ${name}?`)) return;
    const res = await call({ action: "deleteEmployee", eid });
    if (res?.success) { notify("Employee removed"); loadEmployees(); }
  };

  const tsFor = (eid) => timesheets.find(t => t.eid === eid) || {};

  const saveTs = async (emp, patch) => {
    const cur = tsFor(emp.eid);
    const data = {
      weekEnd: weekEndStr,
      eid: emp.eid,
      name: emp.name,
      department: emp.department,
      hours: cur.hours ?? 0,
      submitted: cur.submitted ?? false,
      submittedAt: cur.submittedAt ?? "",
      ...patch
    };
    if (patch.submitted === true && !cur.submitted) data.submittedAt = new Date().toISOString();
    if (patch.submitted === false) data.submittedAt = "";
    const res = await call({ action: "submitTimesheet", data });
    if (res?.success) loadTimesheets();
    else notify("Save failed", "error");
  };

  const sendReminder = async () => {
    setSending(true);
    const res = await call({ action: "sendReminder", weekEnd: weekEndStr });
    setSending(false);
    if (res?.success) notify("Reminder email sent!");
    else notify("Failed to send", "error");
  };

  const openAdd = () => {
    setForm({ department: DEPARTMENTS[0] });
    setModal("add");
    setOverlayVisible(true);
  };

  const openEdit = (emp) => {
    setForm({ ...emp });
    setModal("edit");
    setOverlayVisible(true);
  };

  const closeModal = () => {
    setOverlayVisible(false);
    setTimeout(() => setModal(null), 150);
  };

  // Computed
  const submitted = new Set(timesheets.filter(t => t.submitted).map(t => t.eid));
  const unsubmitted = employees.filter(e => !submitted.has(e.eid));
  const birthdays = employees
    .map(e => ({ ...e, days: daysUntilBirthday(e.birthday) }))
    .filter(e => e.days !== null && e.days <= 7)
    .sort((a, b) => a.days - b.days);

  const pct = employees.length ? Math.round((submitted.size / employees.length) * 100) : 0;

  // ─── Setup screen ──────────────────────────────────────────────────────────
  if (!setupDone) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 480, padding: "2rem", gap: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: "var(--border-radius-lg)", background: "var(--color-background-info)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
          <i className="ti ti-building-factory" aria-hidden="true" style={{ fontSize: 24, color: "var(--color-text-info)" }} />
        </div>
        <h2 style={{ margin: "0 0 6px", fontWeight: 500 }}>Workforce Tracker</h2>
        <p style={{ color: "var(--color-text-secondary)", fontSize: 14, margin: "0 0 28px", textAlign: "center", maxWidth: 380 }}>
          Paste your Google Apps Script web app URL to connect to your Google Sheet.
        </p>
        <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 500 }}>
          <input
            value={urlDraft}
            onChange={e => setUrlDraft(e.target.value)}
            onKeyDown={e => e.key === "Enter" && connect()}
            placeholder="https://script.google.com/macros/s/..."
            style={{ flex: 1 }}
          />
          <button onClick={connect}>Connect ↗</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 14 }}>
          See the included GAS setup file for instructions on deploying the backend.
        </p>
      </div>
    );
  }

  // ─── Main app ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", minHeight: 600, fontFamily: "var(--font-sans)" }}>

      {/* Nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: "0.5px solid var(--color-border-tertiary)", marginBottom: 24 }}>
        {[
          { id: "dashboard", icon: "ti-layout-dashboard", label: "Dashboard" },
          { id: "employees", icon: "ti-users", label: "Employees" },
          { id: "timesheets", icon: "ti-clipboard-check", label: "Timesheets" },
        ].map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              borderBottom: tab === id ? "2px solid var(--color-text-primary)" : "2px solid transparent",
              borderRadius: 0,
              color: tab === id ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontWeight: tab === id ? 500 : 400,
              fontSize: 14, cursor: "pointer",
              marginBottom: -1,
            }}
          >
            <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 15 }} />
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { setUrlDraft(gasUrl); setSetupDone(false); }}
          style={{ background: "transparent", border: "none", color: "var(--color-text-tertiary)", fontSize: 13, cursor: "pointer", padding: "6px 8px", display: "flex", alignItems: "center", gap: 4 }}
        >
          <i className="ti ti-settings" aria-hidden="true" style={{ fontSize: 14 }} />
        </button>
      </div>

      {/* ── DASHBOARD ──────────────────────────────────────────────────────── */}
      {tab === "dashboard" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

          {/* Submission card */}
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
            <p style={{ margin: "0 0 14px", fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: 0.6, fontWeight: 500 }}>THIS WEEK — TIMESHEETS</p>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 44, fontWeight: 500, lineHeight: 1, color: pct === 100 ? "var(--color-text-success)" : "var(--color-text-primary)" }}>
                {submitted.size}
              </span>
              <span style={{ fontSize: 18, color: "var(--color-text-secondary)" }}>/ {employees.length}</span>
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--color-text-secondary)" }}>submitted</p>
            <div style={{ height: 5, background: "var(--color-background-secondary)", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
              <div style={{
                height: 5,
                width: `${pct}%`,
                background: pct === 100 ? "var(--color-background-success)" : pct >= 50 ? "var(--color-background-warning)" : "var(--color-background-danger)",
                transition: "width 0.5s ease",
                borderRadius: 3
              }} />
            </div>
            {unsubmitted.length > 0 && (
              <div style={{ padding: "8px 12px", background: "var(--color-background-danger)", borderRadius: "var(--border-radius-md)", fontSize: 12, color: "var(--color-text-danger)", display: "flex", alignItems: "flex-start", gap: 6 }}>
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{unsubmitted.length} pending — deadline Tue 10:00 AM</span>
              </div>
            )}
          </div>

          {/* Birthdays */}
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
            <p style={{ margin: "0 0 14px", fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: 0.6, fontWeight: 500 }}>
              <i className="ti ti-cake" aria-hidden="true" style={{ fontSize: 12, marginRight: 5, verticalAlign: -1 }} />
              UPCOMING BIRTHDAYS (7 DAYS)
            </p>
            {birthdays.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-tertiary)" }}>No birthdays in the next 7 days</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {birthdays.map(e => (
                  <div key={e.eid} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 500, fontSize: 14 }}>{e.name}</p>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{e.department} · {fmtDate(e.birthday)}</p>
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: 500, padding: "3px 10px", borderRadius: "var(--border-radius-md)",
                      background: e.days === 0 ? "var(--color-background-success)" : "var(--color-background-info)",
                      color: e.days === 0 ? "var(--color-text-success)" : "var(--color-text-info)"
                    }}>
                      {e.days === 0 ? "Today!" : `In ${e.days}d`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dept breakdown */}
          <div style={{ gridColumn: "1/-1", background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem" }}>
            <p style={{ margin: "0 0 14px", fontSize: 11, color: "var(--color-text-tertiary)", letterSpacing: 0.6, fontWeight: 500 }}>DEPARTMENT BREAKDOWN</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {DEPARTMENTS.map(dept => {
                const dEmps = employees.filter(e => e.department === dept);
                const dSub = dEmps.filter(e => submitted.has(e.eid)).length;
                const dp = dEmps.length ? Math.round((dSub / dEmps.length) * 100) : 0;
                return (
                  <div key={dept} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "12px 14px" }}>
                    <p style={{ margin: "0 0 6px", fontSize: 10, color: "var(--color-text-tertiary)", fontWeight: 500, letterSpacing: 0.5 }}>{dept.toUpperCase()}</p>
                    <p style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 500 }}>
                      {dSub}<span style={{ fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 400 }}>/{dEmps.length}</span>
                    </p>
                    <div style={{ height: 3, background: "var(--color-border-tertiary)", borderRadius: 2 }}>
                      <div style={{ height: 3, width: `${dp}%`, borderRadius: 2, background: dp === 100 ? "var(--color-background-success)" : "var(--color-background-info)", transition: "width 0.4s" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── EMPLOYEES ──────────────────────────────────────────────────────── */}
      {tab === "employees" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-secondary)" }}>
              {loading ? "Loading..." : `${employees.length} employees · ${DEPARTMENTS.length} departments`}
            </p>
            <button onClick={openAdd} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 14 }} />
              Add employee
            </button>
          </div>

          {DEPARTMENTS.map(dept => {
            const dEmps = employees.filter(e => e.department === dept);
            if (!dEmps.length) return null;
            return (
              <div key={dept} style={{ marginBottom: 28 }}>
                <p style={{ margin: "0 0 10px", fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, letterSpacing: 0.6 }}>
                  {dept.toUpperCase()} · {dEmps.length}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
                  {dEmps.map(emp => (
                    <div key={emp.eid} style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "14px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--color-background-info)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 500, color: "var(--color-text-info)", flexShrink: 0 }}>
                          {initials(emp.name)}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: 0, fontWeight: 500, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{emp.name}</p>
                          <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>EID: {emp.eid}</p>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                        {emp.jobTitle && (
                          <span><i className="ti ti-briefcase" aria-hidden="true" style={{ fontSize: 12, marginRight: 5, verticalAlign: -1 }} />{emp.jobTitle}</span>
                        )}
                        {emp.hireDate && (
                          <span><i className="ti ti-calendar-plus" aria-hidden="true" style={{ fontSize: 12, marginRight: 5, verticalAlign: -1 }} />Hired {fmtDate(emp.hireDate)}</span>
                        )}
                        {emp.birthday && (
                          <span><i className="ti ti-cake" aria-hidden="true" style={{ fontSize: 12, marginRight: 5, verticalAlign: -1 }} />{fmtDate(emp.birthday)}</span>
                        )}
                        {emp.phone && (
                          <span><i className="ti ti-phone" aria-hidden="true" style={{ fontSize: 12, marginRight: 5, verticalAlign: -1 }} />{emp.phone}</span>
                        )}
                        {emp.email && (
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <i className="ti ti-mail" aria-hidden="true" style={{ fontSize: 12, marginRight: 5, verticalAlign: -1 }} />{emp.email}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => openEdit(emp)} style={{ fontSize: 12, padding: "5px 12px", flex: 1 }}>Edit</button>
                        <button onClick={() => deleteEmployee(emp.eid, emp.name)}
                          style={{ fontSize: 12, padding: "5px 10px", color: "var(--color-text-danger)", borderColor: "var(--color-border-danger)" }}>
                          <i className="ti ti-trash" aria-hidden="true" style={{ fontSize: 13 }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {!loading && employees.length === 0 && (
            <div style={{ textAlign: "center", padding: "4rem 2rem", color: "var(--color-text-tertiary)" }}>
              <i className="ti ti-users" aria-hidden="true" style={{ fontSize: 42, display: "block", marginBottom: 12 }} />
              <p style={{ margin: "0 0 16px", fontSize: 15 }}>No employees yet</p>
              <button onClick={openAdd}>Add your first employee</button>
            </div>
          )}
        </div>
      )}

      {/* ── TIMESHEETS ─────────────────────────────────────────────────────── */}
      {tab === "timesheets" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setWeekOff(w => w - 1)} style={{ padding: "7px 11px" }}>
                <i className="ti ti-chevron-left" aria-hidden="true" style={{ fontSize: 15 }} />
              </button>
              <div>
                <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-tertiary)" }}>Week ending</p>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 15 }}>
                  {weekEnd.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <button onClick={() => setWeekOff(w => w + 1)} style={{ padding: "7px 11px" }}>
                <i className="ti ti-chevron-right" aria-hidden="true" style={{ fontSize: 15 }} />
              </button>
              {weekOff !== 0 && (
                <button onClick={() => setWeekOff(0)} style={{ fontSize: 12 }}>Current week</button>
              )}
            </div>
            <button
              onClick={sendReminder}
              disabled={sending || unsubmitted.length === 0}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                color: sending || unsubmitted.length === 0 ? "var(--color-text-tertiary)" : "var(--color-text-danger)",
                borderColor: sending || unsubmitted.length === 0 ? "var(--color-border-tertiary)" : "var(--color-border-danger)",
              }}
            >
              <i className="ti ti-mail" aria-hidden="true" style={{ fontSize: 14 }} />
              {sending ? "Sending..." : `Send reminder${unsubmitted.length > 0 ? ` (${unsubmitted.length})` : ""}`}
            </button>
          </div>

          {/* Summary row */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Submitted", val: submitted.size, bg: "var(--color-background-success)", c: "var(--color-text-success)" },
              { label: "Pending", val: unsubmitted.length, bg: "var(--color-background-danger)", c: "var(--color-text-danger)" },
              { label: "Total employees", val: employees.length, bg: "var(--color-background-secondary)", c: "var(--color-text-secondary)" },
            ].map(({ label, val, bg, c }) => (
              <div key={label} style={{ background: bg, borderRadius: "var(--border-radius-md)", padding: "8px 14px" }}>
                <p style={{ margin: 0, fontSize: 11, color: c }}>{label}</p>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 500, color: c }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Table */}
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.2fr 90px 110px 1fr", gap: 8, padding: "10px 16px", fontSize: 11, color: "var(--color-text-tertiary)", fontWeight: 500, letterSpacing: 0.5, borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
              <span>EMPLOYEE</span><span>EID</span><span>DEPARTMENT</span><span>HOURS</span><span>SUBMITTED</span><span>TIMESTAMP</span>
            </div>
            {DEPARTMENTS.flatMap(dept => employees.filter(e => e.department === dept)).map((emp, i) => {
              const ts = tsFor(emp.eid);
              return (
                <div key={emp.eid} style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1.2fr 90px 110px 1fr",
                  gap: 8, padding: "10px 16px", alignItems: "center",
                  background: i % 2 === 1 ? "var(--color-background-secondary)" : "transparent",
                  fontSize: 13,
                }}>
                  <span style={{ fontWeight: 500 }}>{emp.name}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-text-secondary)" }}>{emp.eid}</span>
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>{emp.department}</span>
                  <input
                    type="number"
                    key={`${emp.eid}-${weekEndStr}-hrs`}
                    defaultValue={ts.hours != null && ts.hours !== "" ? ts.hours : ""}
                    min={0} max={80} step={0.5}
                    placeholder="0"
                    style={{ width: 72, fontFamily: "var(--font-mono)", fontSize: 13 }}
                    onBlur={e => {
                      const h = parseFloat(e.target.value);
                      if (!isNaN(h) && h >= 0) saveTs(emp, { hours: h });
                    }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!ts.submitted}
                      onChange={e => saveTs(emp, { submitted: e.target.checked })}
                    />
                    <span style={{
                      fontSize: 12, fontWeight: 500,
                      color: ts.submitted ? "var(--color-text-success)" : "var(--color-text-danger)"
                    }}>
                      {ts.submitted ? "Yes" : "No"}
                    </span>
                  </label>
                  <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                    {ts.submittedAt
                      ? new Date(ts.submittedAt).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </span>
                </div>
              );
            })}
            {employees.length === 0 && (
              <p style={{ padding: "24px 16px", color: "var(--color-text-tertiary)", fontSize: 13, margin: 0 }}>
                No employees found — add them in the Employees tab first.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Employee Modal ─────────────────────────────────────────────────── */}
      {modal && (
        <div
          style={{
            position: "absolute", inset: 0, zIndex: 50,
            background: overlayVisible ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0)",
            display: "flex", alignItems: "center", justifyContent: "center",
            minHeight: 600,
            transition: "background 0.15s",
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{
            background: "var(--color-background-primary)",
            border: "0.5px solid var(--color-border-secondary)",
            borderRadius: "var(--border-radius-lg)",
            padding: "24px",
            width: "100%",
            maxWidth: 440,
            maxHeight: "80vh",
            overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 500 }}>{modal === "edit" ? "Edit employee" : "Add employee"}</h2>
              <button onClick={closeModal} style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)", cursor: "pointer", padding: 4 }}>
                <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 18 }} />
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {[
                { f: "name", l: "Full name *", t: "text", span: 2 },
                { f: "eid", l: "Employee ID (EID) *", t: "text" },
                { f: "jobTitle", l: "Job title", t: "text" },
                { f: "phone", l: "Phone", t: "tel" },
                { f: "email", l: "Email", t: "email" },
                { f: "hireDate", l: "Hire date", t: "date" },
                { f: "birthday", l: "Birthday", t: "date" },
              ].map(({ f, l, t, span }) => (
                <div key={f} style={span ? { gridColumn: "1/-1" } : {}}>
                  <label style={{ display: "block", fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>{l}</label>
                  <input
                    type={t}
                    value={form[f] || ""}
                    onChange={e => setForm(p => ({ ...p, [f]: e.target.value }))}
                    style={{ width: "100%", boxSizing: "border-box" }}
                  />
                </div>
              ))}
              <div style={{ gridColumn: "1/-1" }}>
                <label style={{ display: "block", fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5 }}>Department *</label>
                <select value={form.department || ""} onChange={e => setForm(p => ({ ...p, department: e.target.value }))} style={{ width: "100%" }}>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <button onClick={closeModal}>Cancel</button>
              <button onClick={saveEmployee} style={{ background: "var(--color-background-info)", color: "var(--color-text-info)", borderColor: "var(--color-border-info)" }}>
                {modal === "edit" ? "Save changes" : "Add employee"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: "absolute", bottom: 20, right: 0, zIndex: 100,
          padding: "10px 16px", borderRadius: "var(--border-radius-md)",
          background: toast.type === "error" ? "var(--color-background-danger)" : "var(--color-background-success)",
          color: toast.type === "error" ? "var(--color-text-danger)" : "var(--color-text-success)",
          border: `0.5px solid ${toast.type === "error" ? "var(--color-border-danger)" : "var(--color-border-success)"}`,
          fontSize: 13, fontWeight: 500,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
