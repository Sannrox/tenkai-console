import { PRESET_COPY, hasConflicts, parseConfigPresets } from "../delivery/config-presets";
import { Card } from "../ui/kit";

/**
 * Plan-time preset sources and conflicts above the approval controls. A
 * conflict stays until a later plan; this view never applies a rebase.
 */
export const ConfigPresets = ({ plan }: { plan: unknown }) => {
  const rows = parseConfigPresets(plan);
  return (
    <section aria-label="Config presets" className="mb-4">
      <h2 className="mt-0 mb-2 text-[13px] font-semibold">Config</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-xs text-muted">{PRESET_COPY.none}</p>
      ) : (
        <Card>
          <div className="px-3.5 py-3 font-mono text-xs leading-[1.7]">
            {rows.map((row) => (
              <div
                key={row.product}
                className="border-t border-line pt-2 first:border-t-0 first:pt-0"
              >
                <div>
                  {row.product} preset {row.preset}
                </div>
                {row.fromPreset.length > 0 && (
                  <div className="text-muted">
                    {PRESET_COPY.fromPreset}: {row.fromPreset.join(", ")}
                  </div>
                )}
                {row.overridden.length > 0 && (
                  <div>
                    {PRESET_COPY.overridden}: {row.overridden.join(", ")}
                  </div>
                )}
                {row.conflicts.map((conflict) => (
                  <div key={`${row.product}:${conflict.key}`} className="text-danger" role="alert">
                    {PRESET_COPY.conflict}: {conflict.text}
                  </div>
                ))}
              </div>
            ))}
            {hasConflicts(rows) && <div className="mt-1 text-muted">{PRESET_COPY.unchanged}</div>}
          </div>
        </Card>
      )}
    </section>
  );
};
