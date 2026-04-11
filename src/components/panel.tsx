import { ReactNode } from "react";

interface PanelProps {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

function IconBtn({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button className="icon-btn" onClick={onClick}>
      {children}
    </button>
  );
}

export default function Panel({ title, actions, children, className = "" }: PanelProps) {
  return (
    <div className={`glass overflow-hidden ${className}`}>
      <div className="panel-header">
        <h3>{title}</h3>
        <div className="flex gap-1 items-center">
          {actions || (
            <>
              <IconBtn>↻</IconBtn>
              <IconBtn>↓</IconBtn>
              <IconBtn>✕</IconBtn>
            </>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export { IconBtn };
