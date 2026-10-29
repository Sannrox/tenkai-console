/** Row window for the fleet table: keep off-screen environments out of the DOM. */
export const ROW_HEIGHT = 32;
export const OVERSCAN = 12;

export const visibleRange = (
  count: number,
  scrollTop: number,
  viewHeight: number,
): { start: number; end: number } => {
  const windowSize = Math.ceil(viewHeight / ROW_HEIGHT) + OVERSCAN * 2;
  const start = Math.max(
    0,
    Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN, Math.max(0, count - windowSize)),
  );
  return { start, end: Math.min(count, start + windowSize) };
};
