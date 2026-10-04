import { Inflate, strFromU8 } from "./vendor/fflate/esm/browser.js";
import { MAX_FILE, MAX_TOTAL, MAX_RECORDS, isSafeArchivePath } from "./core.js";
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes, initial = 0xffffffff) {
  let value = initial;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return value >>> 0;
}

// Parse the directory before decoding, then measure actual streaming output. A decoder
// given a fixed claimed output buffer can truncate forged DEFLATE streams silently.
export function unpackArchive(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 22 ||
    bytes.length > MAX_TOTAL + 55 * 1024 * 1024
  )
    throw new Error("Invalid ZIP size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u16 = (offset) => view.getUint16(offset, true),
    u32 = (offset) => view.getUint32(offset, true);
  let end = -1;
  for (
    let index = bytes.length - 22;
    index >= Math.max(0, bytes.length - 65557);
    index--
  )
    if (
      u32(index) === 0x06054b50 &&
      index + 22 + u16(index + 20) === bytes.length
    ) {
      end = index;
      break;
    }
  if (end < 0) throw new Error("Missing ZIP directory");
  const count = u16(end + 10),
    directorySize = u32(end + 12),
    directoryOffset = u32(end + 16);
  if (
    u16(end + 4) ||
    u16(end + 6) ||
    u16(end + 8) !== count ||
    count > MAX_RECORDS + 1 ||
    count === 65535 ||
    directoryOffset + directorySize !== end
  )
    throw new Error("Unsupported ZIP directory");
  const descriptors = [],
    seen = new Set();
  let cursor = directoryOffset,
    declaredTotal = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50)
      throw new Error("Malformed ZIP directory");
    const flags = u16(cursor + 8),
      method = u16(cursor + 10),
      crc = u32(cursor + 16),
      compressed = u32(cursor + 20),
      size = u32(cursor + 24),
      nameLength = u16(cursor + 28),
      extraLength = u16(cursor + 30),
      commentLength = u16(cursor + 32),
      localOffset = u32(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      u16(cursor + 34) ||
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      localOffset === 0xffffffff ||
      flags & 65 ||
      ![0, 8].includes(method)
    )
      throw new Error("Unsupported ZIP entry");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      name =
        flags & 2048
          ? new TextDecoder("utf-8", { fatal: true }).decode(nameBytes)
          : strFromU8(nameBytes, true);
    if (!isSafeArchivePath(name) || seen.has(name))
      throw new Error("Unsafe or duplicate ZIP path");
    seen.add(name);
    declaredTotal += size;
    const limit = name === "manifest.json" ? 50 * 1024 * 1024 : MAX_FILE;
    if (size > limit || declaredTotal > MAX_TOTAL + 50 * 1024 * 1024)
      throw new Error("ZIP exceeds safe extraction limits");
    if (localOffset + 30 > directoryOffset || u32(localOffset) !== 0x04034b50)
      throw new Error("Missing ZIP local header");
    const localFlags = u16(localOffset + 6),
      localMethod = u16(localOffset + 8),
      localNameLength = u16(localOffset + 26),
      localExtraLength = u16(localOffset + 28),
      dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (
      dataOffset + compressed > directoryOffset ||
      localFlags !== flags ||
      localMethod !== method ||
      localNameLength !== nameLength ||
      nameBytes.some((byte, n) => byte !== bytes[localOffset + 30 + n])
    )
      throw new Error("Mismatched ZIP headers");
    if (
      !(flags & 8) &&
      (u32(localOffset + 14) !== crc ||
        u32(localOffset + 18) !== compressed ||
        u32(localOffset + 22) !== size)
    )
      throw new Error("Mismatched ZIP sizes or CRC headers");
    if (method === 0 && compressed !== size)
      throw new Error("Invalid stored ZIP length");
    descriptors.push({
      name,
      method,
      crc,
      size,
      compressed,
      dataOffset,
      localOffset,
      limit,
    });
    cursor = next;
  }
  if (cursor !== end) throw new Error("Unexpected ZIP directory contents");
  const spans = [...descriptors].sort((a, b) => a.localOffset - b.localOffset);
  for (let index = 1; index < spans.length; index++)
    if (
      spans[index].localOffset <
      spans[index - 1].dataOffset + spans[index - 1].compressed
    )
      throw new Error("Overlapping ZIP entries");
  const entries = Object.create(null);
  let actualTotal = 0;
  for (const descriptor of descriptors) {
    const { name, size, dataOffset, compressed, method, limit } = descriptor,
      output = new Uint8Array(size);
    let produced = 0,
      crc = 0xffffffff;
    const receive = (chunk) => {
      produced += chunk.length;
      actualTotal += chunk.length;
      if (
        produced > size ||
        produced > limit ||
        actualTotal > MAX_TOTAL + 50 * 1024 * 1024
      )
        throw new Error(
          "Actual ZIP output exceeds its declared size or safe limits",
        );
      crc = crc32(chunk, crc);
      output.set(chunk, produced - chunk.length);
    };
    if (method === 0)
      receive(bytes.subarray(dataOffset, dataOffset + compressed));
    else {
      const inflater = new Inflate(receive);
      // Small compressed chunks bound temporary expansion before our callback can reject it.
      for (let offset = 0; offset < compressed; offset += 1024)
        inflater.push(
          bytes.subarray(
            dataOffset + offset,
            dataOffset + Math.min(offset + 1024, compressed),
          ),
          offset + 1024 >= compressed,
        );
      if (!compressed) inflater.push(new Uint8Array(), true);
    }
    if (produced !== size)
      throw new Error(
        "Actual ZIP output length differs from its declared size",
      );
    if ((crc ^ 0xffffffff) >>> 0 !== descriptor.crc)
      throw new Error("ZIP CRC integrity check failed");
    entries[name] = output;
  }
  if (!entries["manifest.json"]) throw new Error("Missing manifest.json");
  return entries;
}
