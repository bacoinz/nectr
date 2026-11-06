import { describe, expect, it } from "vitest";
import { activeLine, isSynced, parseLrc, serializeLrc } from "./lrc";

describe("LRC", () => {
  it("reads the common forms and ignores tags", () => {
    const l = parseLrc("[ti:Maré]\r\n[ar:Inês]\n[00:12.5]Primeira\n[0:15]Segunda\n[00:18:20]Terceira\n[01:02.345]  Quarta  ");
    expect(l).toEqual([
      { t: 12.5, text: "Primeira" },
      { t: 15, text: "Segunda" },
      { t: 18.2, text: "Terceira" },
      { t: 62.345, text: "Quarta" },
    ]);
    expect(isSynced(l)).toBe(true);
  });

  it("expands repeated lines and keeps them in order", () => {
    const l = parseLrc("[00:10.00][00:30.00]Refrão\n[00:20.00]Verso");
    expect(l.map((x) => [x.t, x.text])).toEqual([[10, "Refrão"], [20, "Verso"], [30, "Refrão"]]);
  });

  it("applies the offset tag", () => {
    expect(parseLrc("[offset:+500]\n[00:10.00]A")[0]!.t).toBe(9.5);
  });

  it("keeps plain lyrics as they are, with stanza breaks", () => {
    const l = parseLrc("\nUm\nDois\n\nTrês\n\n");
    expect(l).toEqual([{ t: null, text: "Um" }, { t: null, text: "Dois" }, { t: null, text: "" }, { t: null, text: "Três" }]);
    expect(isSynced(l)).toBe(false);
  });

  it("writes it back the same way", () => {
    const lines = [{ t: 5.004, text: "A" }, { t: null, text: "" }, { t: 65.5, text: "B" }];
    const s = serializeLrc(lines, { title: "Maré", artist: "Inês" });
    expect(s).toBe("[ti:Maré]\n[ar:Inês]\n[00:05.00]A\n\n[01:05.50]B");
    expect(parseLrc(s)).toEqual([{ t: 5, text: "A" }, { t: null, text: "" }, { t: 65.5, text: "B" }]);
  });

  it("finds the line being sung", () => {
    const l = parseLrc("[00:01]A\n[00:05]B\n\n[00:09]C");
    expect([0, 1, 4.9, 5, 8, 20].map((t) => activeLine(l, t))).toEqual([-1, 0, 0, 1, 1, 3]);
  });
});
