import { useEffect, useRef, useState, type UIEvent } from "react";
import type { FleetTableRow, Tone } from "../delivery/configuration";
import { ROW_HEIGHT, visibleRange } from "../delivery/window";
import { Card } from "../ui/kit";

const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
};

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "h-8 border-b border-line px-3.5 py-0 align-middle whitespace-nowrap overflow-hidden";

/** Environments table from bulk fleet rows (issue #45 pick A). */
export const FleetTable = ({
  rows,
  selected,
  onSelect,
  label,
}: {
  rows: FleetTableRow[];
  selected?: string | undefined;
  onSelect?: ((name: string) => void) | undefined;
  label: string;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const pending = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(480);

  useEffect(() => {
    const node = scroller.current;
    const observer = node ? new ResizeObserver(() => setViewHeight(node.clientHeight)) : undefined;
    if (node && observer) {
      setViewHeight(node.clientHeight);
      observer.observe(node);
    }
    return () => {
      observer?.disconnect();
      if (frame.current !== 0) {
        cancelAnimationFrame(frame.current);
      }
    };
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (node) {
      const maxScroll = Math.max(0, rows.length * ROW_HEIGHT - node.clientHeight);
      if (node.scrollTop > maxScroll) {
        node.scrollTop = maxScroll;
        setScrollTop(maxScroll);
      }
    }
  }, [rows.length]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    pending.current = event.currentTarget.scrollTop;
    if (frame.current !== 0) {
      return;
    }
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setScrollTop(pending.current);
    });
  };

  const { start, end } = visibleRange(rows.length, scrollTop, viewHeight);
  const slice = rows.slice(start, end);
  const top = start * ROW_HEIGHT;
  const bottom = (rows.length - end) * ROW_HEIGHT;

  return (
    <Card className="overflow-hidden">
      <div
        ref={scroller}
        role="region"
        aria-label={label}
        className="max-h-[min(70vh,40rem)] overflow-auto"
        onScroll={onScroll}
      >
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-card">
            <tr>
              <th className={th}>Name</th>
              <th className={th}>Status</th>
              <th className={th}>Release</th>
              <th className={th}>Health</th>
              <th className={th}>Last apply</th>
              <th className={th}>Drift</th>
            </tr>
          </thead>
          <tbody>
            {top > 0 && (
              <tr aria-hidden="true">
                <td colSpan={6} className="p-0" style={{ height: top }} />
              </tr>
            )}
            {slice.map((row) => (
              <tr
                key={row.name}
                aria-selected={onSelect ? row.name === selected : undefined}
                onClick={onSelect ? () => onSelect(row.name) : undefined}
                className={`h-8 ${onSelect ? "cursor-pointer" : ""} ${row.name === selected ? "bg-selected" : ""}`}
              >
                <td className={`${td} font-semibold`}>{row.name}</td>
                <td className={`${td} ${TEXT[row.statusTone]}`}>{row.status}</td>
                <td className={`${td} font-mono`}>{row.release}</td>
                <td className={`${td} ${TEXT[row.healthTone]}`}>{row.health}</td>
                <td className={td}>{row.lastApply}</td>
                <td className={`${td} font-mono`}>{row.drift}</td>
              </tr>
            ))}
            {bottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={6} className="p-0" style={{ height: bottom }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
