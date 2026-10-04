import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "../vendor/fflate/esm/browser.js";
import { unpackArchive, crc32 } from "../archives.js";

function firstCentral(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let n = bytes.length - 22; n >= 0; n--)
    if (view.getUint32(n, true) === 0x06054b50)
      return view.getUint32(n + 16, true);
  throw new Error("No directory");
}
test("streaming ZIP roundtrip measures full compressed output and checks CRC", () => {
  const body = new Uint8Array(1024 * 1024).fill(65),
    archive = zipSync(
      { "originals/paper.txt": body, "manifest.json": strToU8("{}") },
      { level: 6 },
    ),
    result = unpackArchive(archive);
  assert.equal(result["originals/paper.txt"].length, body.length);
  assert.deepEqual(result["originals/paper.txt"], body);
  assert.equal((crc32(strToU8("123456789")) ^ 0xffffffff) >>> 0, 0xcbf43926);
});
test("forged small directory size cannot silently truncate a much larger DEFLATE stream", () => {
  const bytes = zipSync(
    {
      "originals/paper.txt": new Uint8Array(1024 * 1024).fill(65),
      "manifest.json": strToU8("{}"),
    },
    { level: 6 },
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    central = firstCentral(bytes),
    local = view.getUint32(central + 42, true);
  view.setUint32(central + 24, 1, true);
  view.setUint32(local + 22, 1, true);
  // Both headers now agree; the measured stream still has a million bytes.
  assert.throws(() => unpackArchive(bytes), /Actual ZIP output exceeds/);
});
test("mismatched headers, corrupted stored bytes and traversal are rejected", () => {
  const forged = zipSync(
      { "file.txt": strToU8("abc"), "manifest.json": strToU8("{}") },
      { level: 0 },
    ),
    view = new DataView(forged.buffer),
    central = firstCentral(forged);
  view.setUint32(central + 24, 1, true);
  assert.throws(() => unpackArchive(forged), /Mismatched/);
  const corrupted = zipSync(
      { "file.txt": strToU8("abc"), "manifest.json": strToU8("{}") },
      { level: 0 },
    ),
    dataView = new DataView(corrupted.buffer),
    local = dataView.getUint32(firstCentral(corrupted) + 42, true),
    payload =
      local +
      30 +
      dataView.getUint16(local + 26, true) +
      dataView.getUint16(local + 28, true);
  corrupted[payload] ^= 1;
  assert.throws(() => unpackArchive(corrupted), /CRC integrity/);
  assert.throws(
    () => unpackArchive(zipSync({ "../file.txt": strToU8("x") }, { level: 0 })),
    /Unsafe/,
  );
});
