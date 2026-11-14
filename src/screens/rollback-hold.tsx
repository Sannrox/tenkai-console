/**
 * Hold choice on a rollback-only plan's apply. The hold is on by default;
 * turning it off asks for the reason the server records.
 */
export const RollbackHold = ({
  environment,
  hold,
  reason,
  onHold,
  onReason,
}: {
  environment: string;
  hold: boolean;
  reason: string;
  onHold: (hold: boolean) => void;
  onReason: (reason: string) => void;
}) => (
  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={hold} onChange={(event) => onHold(event.target.checked)} />
      Hold {environment} after rollback
    </label>
    {!hold && (
      <input
        aria-label="Reason to skip the hold"
        placeholder="Reason to skip the hold"
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted"
      />
    )}
  </div>
);
