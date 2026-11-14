import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { createId } from "../src/core/id";
import { newProject, addStyle, validateProject } from "../src/core/model";
import { decodeProject } from "../src/core/storage";

afterEach(() => vi.unstubAllGlobals());

describe("compatible project IDs", () => {
  it("calls the native implementation with its Crypto receiver", () => {
    const native = {
      randomUUID() {
        expect(this).toBe(native);
        return "bb619aad-5c24-47bc-9a5f-a854b1246139";
      },
    };
    vi.stubGlobal("crypto", native);
    expect(createId()).toBe("bb619aad-5c24-47bc-9a5f-a854b1246139");
  });

  it("sets UUID version and variant bits from random bytes without randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(bytes: Uint8Array) {
        bytes.set(Array.from({ length: 16 }, (_, i) => i));
        return bytes;
      },
    });
    expect(createId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("creates distinct project/style IDs and migrates old projects without randomUUID", () => {
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const p = newProject("Compatible", [65]);
    const regular = p.styleId;
    addStyle(p, "Bold", false);
    expect(new Set([p.id, regular, p.styleId]).size).toBe(3);
    for (const id of [p.id, regular, p.styleId])
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    validateProject(p);
    const legacy = { ...newProject("Compatible", [65]), styleId: undefined, styles: undefined, fonts: undefined };
    const restored = decodeProject(zipSync({ "project.json": strToU8(JSON.stringify(legacy)) }));
    expect(restored.name).toBe("Compatible");
    expect(restored.styleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(restored.styleId).not.toBe(p.styleId);
    validateProject(restored);
  });
});
