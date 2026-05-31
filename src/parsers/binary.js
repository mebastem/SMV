/** Read a fixed-length null-terminated ASCII string from a Uint8Array. */
export function readStr(u8, offset, maxLen) {
  let s = '';
  for (let i = 0; i < maxLen; i++) {
    const c = u8[offset + i];
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/** Read a null-terminated ASCII string from a Uint8Array at a given byte offset. */
export function readCStr(u8, offset) {
  let s = '';
  for (let i = offset; i < u8.length; i++) {
    if (!u8[i]) break;
    s += String.fromCharCode(u8[i]);
  }
  return s;
}

/** Read a 3-component float vector from a DataView. */
export function readVec3(view, offset) {
  return [
    view.getFloat32(offset,     true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
}
