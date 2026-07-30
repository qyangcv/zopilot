import { assert } from "chai";
import { sha256Hex } from "../../../src/runtime/crypto/sha256.ts";

describe("sha256Hex", function () {
  it("hashes bytes backed by a SharedArrayBuffer", async function () {
    const buffer = new SharedArrayBuffer(3);
    const bytes = new Uint8Array(buffer);
    bytes.set([0x61, 0x62, 0x63]);

    assert.equal(
      await sha256Hex(bytes),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
