import { it, expect } from "vitest";
import { cellRect, makeTemplate, paperName } from "../src/core/paper";
import { newProject, validateProject } from "../src/core/model";
it("versions printable geometry while keeping old saved mappings usable", () => {
  const p = newProject("Sheets", [32, 65, 66, 65]);
  const t = makeTemplate(p, p.characters);
  expect(t.version).toBe(2);
  expect(t.characters).toEqual([65, 66]);
  expect(cellRect(0, 1)).toEqual({ x: 42, y: 112, w: 96, h: 96 });
  expect(cellRect(29, 1)).toEqual({ x: 474, y: 632, w: 96, h: 96 });
  expect(cellRect(29, 2)).toEqual({ x: 474, y: 644, w: 82, h: 82 });
  p.templates.push(t, { ...structuredClone(t), version: 1 });
  validateProject(p);
  expect(paperName(65, "LATIN CAPITAL LETTER A")).toBe("Uppercase A");
  expect(paperName(97, "LATIN SMALL LETTER A")).toBe("Lowercase a");
});
