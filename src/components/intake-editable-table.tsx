"use client";

import { useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────
export interface IntakeUnit {
  unit_number: string | null;
  tenant_name: string | null;
  suite: string | null;
  square_footage: number | null;
  lease_rate: number | null;
  lease_type: string | null;
  lease_start: string | null;
  lease_end: string | null;
  monthly_rent: number | null;
  annual_rent: number | null;
  escalation_pct: number | null;
  is_vacant: boolean;
  notes: string | null;
}

// ── Helpers ────────────────────────────────────────────────
const C = {
  coral: "#E07A5F",
  teal: "#4ECDC4",
  green: "#6BCB77",
  amber: "#F2C94C",
  red: "#E74C3C",
};

const fmt = (n: number | null) => {
  if (n == null || isNaN(n)) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtSF = (n: number | null) => {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const fmtRate = (n: number | null) => {
  if (n == null || isNaN(n)) return "—";
  return "$" + n.toFixed(2);
};

const fmtPct = (n: number | null) => {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(1) + "%";
};

const LEASE_TYPES = ["NNN", "Gross", "Modified Gross", ""];

type Col = {
  key: keyof IntakeUnit;
  label: string;
  width: number;
  align: "left" | "right" | "center";
  type: "text" | "number" | "date" | "select" | "bool";
  format?: (v: any) => string;
};

const COLUMNS: Col[] = [
  { key: "unit_number", label: "Unit", width: 65, align: "left", type: "text" },
  { key: "tenant_name", label: "Tenant", width: 155, align: "left", type: "text" },
  { key: "suite", label: "Suite", width: 60, align: "left", type: "text" },
  { key: "square_footage", label: "SF", width: 80, align: "right", type: "number", format: fmtSF },
  { key: "lease_rate", label: "Rate/SF", width: 78, align: "right", type: "number", format: fmtRate },
  { key: "lease_type", label: "Type", width: 90, align: "center", type: "select" },
  { key: "lease_start", label: "Start", width: 95, align: "center", type: "date" },
  { key: "lease_end", label: "End", width: 95, align: "center", type: "date" },
  { key: "monthly_rent", label: "Monthly", width: 95, align: "right", type: "number", format: fmt },
  { key: "annual_rent", label: "Annual", width: 100, align: "right", type: "number", format: fmt },
  { key: "is_vacant", label: "Vacant", width: 55, align: "center", type: "bool" },
];

const inputBase: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(224,122,95,0.3)",
  borderRadius: 3,
  color: "#F0EDE4",
  fontSize: 11.5,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

// ── Component ──────────────────────────────────────────────
interface Props {
  units: IntakeUnit[];
  onChange: (units: IntakeUnit[]) => void;
}

export default function IntakeEditableTable({ units, onChange }: Props) {
  const [editCell, setEditCell] = useState<{ row: number; col: keyof IntakeUnit } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = useCallback((row: number, col: Col, unit: IntakeUnit) => {
    if (col.type === "bool") return;
    const raw = unit[col.key];
    setEditCell({ row, col: col.key });
    setEditValue(raw == null ? "" : String(raw));
  }, []);

  const commitEdit = useCallback(() => {
    if (!editCell) return;
    const { row, col } = editCell;
    const updated = [...units];
    const unit = { ...updated[row] };

    const colDef = COLUMNS.find((c) => c.key === col)!;

    if (colDef.type === "number") {
      const num = parseFloat(editValue);
      (unit as any)[col] = isNaN(num) ? null : num;

      // Auto-calculate related fields
      if (col === "square_footage" || col === "lease_rate") {
        const sf = col === "square_footage" ? (isNaN(num) ? null : num) : unit.square_footage;
        const rate = col === "lease_rate" ? (isNaN(num) ? null : num) : unit.lease_rate;
        if (sf && rate) {
          unit.annual_rent = Math.round(sf * rate * 100) / 100;
          unit.monthly_rent = Math.round((sf * rate / 12) * 100) / 100;
        }
      }
      if (col === "monthly_rent" && !isNaN(num)) {
        unit.annual_rent = Math.round(num * 12 * 100) / 100;
        if (unit.square_footage && unit.square_footage > 0) {
          unit.lease_rate = Math.round((unit.annual_rent / unit.square_footage) * 100) / 100;
        }
      }
      if (col === "annual_rent" && !isNaN(num)) {
        unit.monthly_rent = Math.round(num / 12 * 100) / 100;
        if (unit.square_footage && unit.square_footage > 0) {
          unit.lease_rate = Math.round((num / unit.square_footage) * 100) / 100;
        }
      }
    } else {
      (unit as any)[col] = editValue || null;
    }

    updated[row] = unit;
    onChange(updated);
    setEditCell(null);
  }, [editCell, editValue, units, onChange]);

  const toggleVacant = useCallback((row: number) => {
    const updated = [...units];
    updated[row] = { ...updated[row], is_vacant: !updated[row].is_vacant };
    if (updated[row].is_vacant && !updated[row].tenant_name) {
      updated[row].tenant_name = "VACANT";
    }
    onChange(updated);
  }, [units, onChange]);

  const addRow = useCallback(() => {
    onChange([
      ...units,
      {
        unit_number: null, tenant_name: null, suite: null, square_footage: null,
        lease_rate: null, lease_type: null, lease_start: null, lease_end: null,
        monthly_rent: null, annual_rent: null, escalation_pct: null,
        is_vacant: false, notes: null,
      },
    ]);
  }, [units, onChange]);

  const removeRow = useCallback((idx: number) => {
    onChange(units.filter((_, i) => i !== idx));
  }, [units, onChange]);

  return (
    <div>
      <div className="overflow-x-auto" style={{ borderRadius: 6 }}>
        <table className="w-full" style={{ borderCollapse: "separate", borderSpacing: "0 2px" }}>
          <thead>
            <tr className="text-[10px] text-cream-subtle uppercase tracking-wider">
              <th className="px-1.5 pb-2 font-medium text-center" style={{ width: 32 }}>#</th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`px-1.5 pb-2 font-medium text-${col.align}`}
                  style={{ width: col.width, minWidth: col.width }}
                >
                  {col.label}
                </th>
              ))}
              <th className="px-1.5 pb-2 font-medium text-center" style={{ width: 32 }} />
            </tr>
          </thead>
          <tbody>
            {units.map((unit, ri) => (
              <tr key={ri}>
                {/* Row number */}
                <td
                  className="px-1.5 py-1.5 text-[10.5px] text-cream-subtle text-center"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: "4px 0 0 4px",
                  }}
                >
                  {ri + 1}
                </td>

                {/* Data cells */}
                {COLUMNS.map((col, ci) => {
                  const isEditing =
                    editCell?.row === ri && editCell?.col === col.key;
                  const val = unit[col.key];

                  return (
                    <td
                      key={col.key}
                      className={`px-1.5 py-1.5 text-${col.align}`}
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        cursor: col.type === "bool" ? "pointer" : "text",
                      }}
                      onClick={() => {
                        if (col.type === "bool") {
                          toggleVacant(ri);
                        } else {
                          startEdit(ri, col, unit);
                        }
                      }}
                    >
                      {col.type === "bool" ? (
                        <div className="flex justify-center">
                          <span
                            className="inline-flex items-center justify-center"
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 3,
                              border: `1px solid ${val ? C.coral : "rgba(255,255,255,0.12)"}`,
                              background: val ? "rgba(224,122,95,0.2)" : "transparent",
                              fontSize: 10,
                              color: C.coral,
                            }}
                          >
                            {val ? "✓" : ""}
                          </span>
                        </div>
                      ) : isEditing ? (
                        col.type === "select" ? (
                          <select
                            style={{ ...inputBase, padding: "3px 4px", fontSize: 11 }}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            autoFocus
                          >
                            <option value="">—</option>
                            {LEASE_TYPES.filter(Boolean).map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            style={inputBase}
                            type={col.type === "date" ? "date" : col.type === "number" ? "number" : "text"}
                            step={col.type === "number" ? "any" : undefined}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitEdit();
                              if (e.key === "Escape") setEditCell(null);
                            }}
                            autoFocus
                          />
                        )
                      ) : (
                        <span
                          className={`text-[11.5px] ${
                            col.key === "annual_rent" || col.key === "monthly_rent" || col.key === "lease_rate"
                              ? "font-semibold tnum"
                              : col.key === "square_footage"
                              ? "tnum"
                              : ""
                          }`}
                          style={{
                            color:
                              col.key === "annual_rent" || col.key === "monthly_rent"
                                ? C.coral
                                : col.key === "lease_rate"
                                ? C.teal
                                : undefined,
                          }}
                        >
                          {col.format ? col.format(val) : val ?? "—"}
                        </span>
                      )}
                    </td>
                  );
                })}

                {/* Delete button */}
                <td
                  className="px-1 py-1.5 text-center"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: "0 4px 4px 0",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRow(ri);
                    }}
                    className="opacity-0 hover:opacity-100 transition-opacity"
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgba(240,237,228,0.3)",
                      cursor: "pointer",
                      fontSize: 11,
                      padding: "2px 4px",
                      fontFamily: "inherit",
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLElement).style.opacity = "1";
                      (e.target as HTMLElement).style.color = C.red;
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLElement).style.opacity = "0";
                      (e.target as HTMLElement).style.color = "rgba(240,237,228,0.3)";
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add row */}
      <button
        onClick={addRow}
        className="glass-inner w-full mt-1 px-3 py-2 text-[11px] text-cream-muted font-medium cursor-pointer text-center"
        style={{
          border: "1px dashed rgba(255,255,255,0.06)",
          borderRadius: 4,
          background: "rgba(255,255,255,0.015)",
          fontFamily: "inherit",
        }}
      >
        + Add Row
      </button>

      {/* Summary footer */}
      <div className="glass-inner flex justify-between items-center mt-2 px-3.5 py-2.5">
        <span className="text-xs font-semibold">
          {units.length} units · {units.filter((u) => !u.is_vacant).length} occupied
        </span>
        <div className="flex gap-5 text-xs tnum">
          <span>
            Total SF:{" "}
            <span className="font-bold">
              {fmtSF(units.reduce((s, u) => s + (u.square_footage || 0), 0))}
            </span>
          </span>
          <span>
            Annual:{" "}
            <span className="font-bold" style={{ color: C.coral }}>
              {fmt(units.reduce((s, u) => s + (u.annual_rent || 0), 0))}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
