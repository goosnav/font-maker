import { describe, it, expect } from "vitest";
import {
  newProject,
  addStyle,
  activateStyle,
  allStyles,
  validateProject,
  History,
  parseCharacters,
} from "../src/core/model";
import { traceMask } from "../src/core/contours";
describe("font family", () => {
  it("keeps independent styles with the original as reference", () => {
    const p = newProject("Example", [65]);
    p.glyphs[65] = { cp: 65, advance: 1200, status: "drawn" };
    const regular = p.styleId;
    addStyle(p, "Bold", true);
    const bold = p.styleId;
    p.glyphs[65].advance = 1500;
    expect(p.settings.reference).toBe("style:" + regular);
    activateStyle(p, regular);
    expect(p.glyphs[65].advance).toBe(1200);
    expect(allStyles(p)).toHaveLength(2);
    activateStyle(p, bold);
    expect(p.glyphs[65].advance).toBe(1500);
    validateProject(p);
  });
  it("undoes without reusing a revision", () => {
    const p = newProject("Font", [65]);
    const h = new History(p, () => {});
    h.commit((n) => (n.name = "Edited"));
    h.undo();
    expect(h.project.name).toBe("Font");
    expect(h.project.revision).toBe(2);
    h.redo();
    expect(h.project.name).toBe("Edited");
  });
  it("parses non-BMP characters and rejects invalid scalars", () => {
    expect(parseCharacters("U+0041 U+1F680 U+D800")).toEqual([65, 0x1f680]);
    expect(parseCharacters("ΩΩЖ")).toEqual([937, 1046]);
  });
  it("validates inactive styles and rejects component cycles", () => {
    const p = newProject("Font", [65, 66]);
    addStyle(p, "Bold", false);
    const regular = Object.values(p.styles)[0];
    regular.settings.resolution = NaN;
    expect(() => validateProject(p)).toThrow("drawing settings");
    regular.settings.resolution = 16;
    regular.glyphs[65] = {
      cp: 65,
      advance: 1280,
      status: "drawn",
      components: [{ cp: 66, x: 0, y: 0 }],
    };
    regular.glyphs[66] = {
      cp: 66,
      advance: 1280,
      status: "drawn",
      components: [{ cp: 65, x: 0, y: 0 }],
    };
    expect(() => validateProject(p)).toThrow("Circular");
  });
  it("rejects malformed project settings", () => {
    const p = newProject("Font", []);
    p.settings.resolution = Infinity;
    expect(() => validateProject(p)).toThrow();
  });
});
describe("pixel outlines", () => {
  it("merges adjacent cells into one exact rectangle", () => {
    const contours = traceMask(new Uint8Array([255, 255, 0, 0]), 2, 2);
    expect(contours).toHaveLength(1);
    expect(contours[0]).toHaveLength(4);
    expect(
      contours[0].every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)),
    ).toBe(true);
  });
  it("keeps a counter and separate accents", () => {
    const mask = new Uint8Array([
      255, 255, 255, 0, 255, 0, 255, 0, 255, 255, 255, 0, 0, 0, 0, 255,
    ]);
    expect(traceMask(mask, 4, 4)).toHaveLength(3);
  });
});
