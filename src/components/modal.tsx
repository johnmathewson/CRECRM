"use client";

import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}

export default function Modal({ open, onClose, title, children, width = 520 }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="glass"
        style={{
          width,
          maxHeight: "85vh",
          overflow: "auto",
          animation: "fadeIn 0.15s ease",
        }}
      >
        <div className="panel-header">
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{title}</h3>
          <button
            onClick={onClose}
            className="icon-btn"
            style={{ fontSize: 14 }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// Reusable form field
export function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block",
        fontSize: 10.5,
        color: "rgba(240,237,228,0.45)",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: 500,
        marginBottom: 5,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// Reusable input style
export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 4,
  color: "#F0EDE4",
  fontSize: 12.5,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box" as const,
};

export const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none" as const,
  cursor: "pointer",
};

export const btnPrimary: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: 5,
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  color: "white",
  fontFamily: "inherit",
  background: "linear-gradient(135deg, #E07A5F, #E07A5FCC)",
  boxShadow: "0 3px 16px rgba(224,122,95,0.35)",
};

export const btnSecondary: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: 5,
  border: "1px solid rgba(255,255,255,0.08)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  color: "rgba(240,237,228,0.6)",
  fontFamily: "inherit",
  background: "rgba(255,255,255,0.03)",
};
