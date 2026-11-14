import { describe, expect, it } from "vitest";
import { graceWindow } from "./grace";

describe("graceWindow", () => {
  it("shows a declared window in its largest whole unit and unset as not set", () => {
    expect(graceWindow(undefined)).toBe("not set");
    expect(graceWindow(7 * 86_400_000)).toBe("7d");
    expect(graceWindow(36 * 3_600_000)).toBe("36h");
    expect(graceWindow(90 * 60_000)).toBe("90m");
    expect(graceWindow(1_500)).toBe("1500ms");
  });
});
