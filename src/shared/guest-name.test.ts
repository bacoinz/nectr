import { describe, expect, it } from "vitest";
import { checkGuestName } from "./guest-name";

describe("guest names", () => {
  it("accepts real names", () => {
    for (const n of ["Marta", "Rui Costa", "Ana-Rita", "João", "D'Ávila", "J. Silva", "Inês Lobo", "Jo", "Ty", "Zoë", "Lulu", "Nini", "Sasha", "Christopher", "Schmidt", "Francisca Gonçalves", "Pietro", "Zezé", "Yuri", "Yara"]) {
      expect(checkGuestName(n), n).toMatchObject({ ok: true });
    }
    expect(checkGuestName("  Rui   Costa ")).toEqual({ ok: true, name: "Rui Costa" });
  });

  it("refuses junk", () => {
    for (const n of ["", "a", "asd", "qwerty", "Sdf", "lkj", "aaaa", "teste", "xpto", "123", "Marta2", "www.x.com", "http://a", "@marta", "bcdfg", "ninguém", "um dois tres quatro cinco seis",
      "asdasd", "qweqwe", "jdjdjd", "hahaha", "lalala", "jdksjdka", "sdfkjl", "asdfgh", "ghjkl", "kjhgf", "dfgdfg", "Spam", "Fulano", "blabla", "Ana qwer", "aaskdj", "zxcvb", "poiuy", "yygnjy", "jyjyk"]) {
      expect(checkGuestName(n).ok, n).toBe(false);
    }
  });
});
