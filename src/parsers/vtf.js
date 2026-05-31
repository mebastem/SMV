import * as THREE from 'three'

// ── VTF image format IDs ──────────────────────────────────────────────────────
const FMT = {
  RGBA8888:         0,
  ABGR8888:         1,
  RGB888:           2,
  BGR888:           3,
  I8:               5,
  IA88:             6,
  A8:               7,
  RGB888_BLUESCREEN:8,
  BGR888_BLUESCREEN:9,
  ARGB8888:        10,
  BGRA8888:        11,
  DXT1:            13,
  DXT3:            14,
  DXT5:            15,
  BGRX8888:        16,
  BGR565:          17,
  BGRA5551:        21,
  DXT1_ONEBITALPHA:20,
  RGBA16161616F:   24,
  RGBA16161616:    25,
}

// ── Bytes per pixel / block ───────────────────────────────────────────────────
function imageDataSize(w, h, fmt) {
  if (!w || !h) return 0
  switch (fmt) {
    case FMT.DXT1:
    case FMT.DXT1_ONEBITALPHA:
      return Math.ceil(w / 4) * Math.ceil(h / 4) * 8
    case FMT.DXT3:
    case FMT.DXT5:
      return Math.ceil(w / 4) * Math.ceil(h / 4) * 16
    case FMT.RGB888:
    case FMT.BGR888:
    case FMT.RGB888_BLUESCREEN:
    case FMT.BGR888_BLUESCREEN:
      return w * h * 3
    case FMT.RGBA16161616F:
      return w * h * 8
    default:
      return w * h * 4
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────
export function parseVTF(buffer) {
  const view = new DataView(buffer)
  const u8   = new Uint8Array(buffer)

  const sig = view.getUint32(0, true)
  if (sig !== 0x00465456) throw new Error('Invalid VTF signature')

  const headerSize     = view.getUint32(12, true)
  const width          = view.getUint16(16, true)
  const height         = view.getUint16(18, true)
  // imageFormat is at offset 52, NOT 24 (24 = frames field)
  const imageFormat    = view.getUint32(52, true)
  const mipmapCount    = view.getUint8(56)
  const lowResFormat   = view.getUint32(57, true)
  const lowResWidth    = view.getUint8(61)
  const lowResHeight   = view.getUint8(62)

  // Skip thumbnail
  let offset = headerSize
  offset += imageDataSize(lowResWidth, lowResHeight, lowResFormat)

  // Mipmaps are stored smallest-first → skip all but mip0
  for (let m = mipmapCount - 1; m > 0; m--) {
    offset += imageDataSize(Math.max(1, width >> m), Math.max(1, height >> m), imageFormat)
  }

  const rgba = decodeImage(u8, offset, width, height, imageFormat)
  if (!rgba) return null

  const tex = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat)
  tex.colorSpace  = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.flipY       = true
  tex.needsUpdate = true
  return tex
}

// ── Image decoder dispatcher ──────────────────────────────────────────────────
function decodeImage(u8, offset, w, h, fmt) {
  const rgba = new Uint8Array(w * h * 4)
  const src  = u8.subarray(offset)

  switch (fmt) {
    case FMT.DXT1:
    case FMT.DXT1_ONEBITALPHA: decodeDXT1(src, rgba, w, h); return rgba
    case FMT.DXT3:              decodeDXT3(src, rgba, w, h); return rgba
    case FMT.DXT5:              decodeDXT5(src, rgba, w, h); return rgba
    default: return decodeUncompressed(src, rgba, w, h, fmt)
  }
}

function decodeUncompressed(src, rgba, w, h, fmt) {
  const n = w * h
  for (let i = 0; i < n; i++) {
    const d = i * 4
    switch (fmt) {
      case FMT.RGBA8888:
        rgba[d]=src[i*4]; rgba[d+1]=src[i*4+1]; rgba[d+2]=src[i*4+2]; rgba[d+3]=src[i*4+3]
        break
      case FMT.ABGR8888:
        rgba[d]=src[i*4+3]; rgba[d+1]=src[i*4+2]; rgba[d+2]=src[i*4+1]; rgba[d+3]=src[i*4]
        break
      case FMT.BGR888:
      case FMT.BGR888_BLUESCREEN:
        rgba[d]=src[i*3+2]; rgba[d+1]=src[i*3+1]; rgba[d+2]=src[i*3]; rgba[d+3]=255
        break
      case FMT.RGB888:
      case FMT.RGB888_BLUESCREEN:
        rgba[d]=src[i*3]; rgba[d+1]=src[i*3+1]; rgba[d+2]=src[i*3+2]; rgba[d+3]=255
        break
      case FMT.BGRA8888:
      case FMT.BGRX8888:
        rgba[d]=src[i*4+2]; rgba[d+1]=src[i*4+1]; rgba[d+2]=src[i*4]; rgba[d+3]=src[i*4+3]
        break
      case FMT.ARGB8888:
        rgba[d]=src[i*4+1]; rgba[d+1]=src[i*4+2]; rgba[d+2]=src[i*4+3]; rgba[d+3]=src[i*4]
        break
      case FMT.I8:
        rgba[d]=rgba[d+1]=rgba[d+2]=src[i]; rgba[d+3]=255
        break
      case FMT.IA88:
        rgba[d]=rgba[d+1]=rgba[d+2]=src[i*2]; rgba[d+3]=src[i*2+1]
        break
      case FMT.BGR565: {
        const v = src[i*2] | (src[i*2+1] << 8)
        rgba[d]  = (v >> 11 & 31) * 255 / 31 | 0
        rgba[d+1]= (v >> 5  & 63) * 255 / 63 | 0
        rgba[d+2]= (v       & 31) * 255 / 31 | 0
        rgba[d+3]= 255
        break
      }
      default:
        // Fallback: magenta so the user can see something is missing
        rgba[d]=200; rgba[d+1]=0; rgba[d+2]=200; rgba[d+3]=255
    }
  }
  return rgba
}

// ── DXT helpers ───────────────────────────────────────────────────────────────
function rgb565(c) {
  return [
    (c >> 11 & 31) * 255 / 31 | 0,
    (c >> 5  & 63) * 255 / 63 | 0,
    (c       & 31) * 255 / 31 | 0,
  ]
}

function decodeDXT1(src, dst, w, h) {
  let s = 0
  for (let by = 0; by < Math.ceil(h / 4); by++) {
    for (let bx = 0; bx < Math.ceil(w / 4); bx++) {
      const c0v = src[s] | src[s+1] << 8
      const c1v = src[s+2] | src[s+3] << 8
      const c0  = rgb565(c0v), c1 = rgb565(c1v)
      const col = [c0, c1, [], []]

      if (c0v > c1v) {
        col[2] = [c0[0]*2/3+c1[0]/3|0, c0[1]*2/3+c1[1]/3|0, c0[2]*2/3+c1[2]/3|0]
        col[3] = [c0[0]/3+c1[0]*2/3|0, c0[1]/3+c1[1]*2/3|0, c0[2]/3+c1[2]*2/3|0]
      } else {
        col[2] = [(c0[0]+c1[0])>>1, (c0[1]+c1[1])>>1, (c0[2]+c1[2])>>1]
        col[3] = [0, 0, 0]
      }

      const bits = src[s+4] | src[s+5]<<8 | src[s+6]<<16 | src[s+7]*16777216
      s += 8

      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = bx*4+px, y = by*4+py
        if (x >= w || y >= h) continue
        const idx = (bits >> (py*4+px)*2) & 3
        const d   = (y*w+x)*4
        dst[d]=col[idx][0]; dst[d+1]=col[idx][1]; dst[d+2]=col[idx][2]
        dst[d+3] = (c0v <= c1v && idx === 3) ? 0 : 255
      }
    }
  }
}

function decodeDXT3(src, dst, w, h) {
  let s = 0
  for (let by = 0; by < Math.ceil(h / 4); by++) {
    for (let bx = 0; bx < Math.ceil(w / 4); bx++) {
      const alphaBlock = src.slice(s, s+8); s += 8

      const c0v = src[s] | src[s+1]<<8, c1v = src[s+2] | src[s+3]<<8
      const c0 = rgb565(c0v), c1 = rgb565(c1v)
      const col = [c0, c1,
        [c0[0]*2/3+c1[0]/3|0, c0[1]*2/3+c1[1]/3|0, c0[2]*2/3+c1[2]/3|0],
        [c0[0]/3+c1[0]*2/3|0, c0[1]/3+c1[1]*2/3|0, c0[2]/3+c1[2]*2/3|0],
      ]
      const bits = src[s+4] | src[s+5]<<8 | src[s+6]<<16 | src[s+7]*16777216
      s += 8

      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = bx*4+px, y = by*4+py
        if (x >= w || y >= h) continue
        const ci = (bits >> (py*4+px)*2) & 3
        const ai = py*4+px
        const alpha = ((alphaBlock[ai>>1] >> ((ai&1)*4)) & 0xf) * 17
        const d = (y*w+x)*4
        dst[d]=col[ci][0]; dst[d+1]=col[ci][1]; dst[d+2]=col[ci][2]; dst[d+3]=alpha
      }
    }
  }
}

function decodeDXT5(src, dst, w, h) {
  let s = 0
  for (let by = 0; by < Math.ceil(h / 4); by++) {
    for (let bx = 0; bx < Math.ceil(w / 4); bx++) {
      const a0 = src[s], a1 = src[s+1]
      const alut = [a0, a1, 0, 0, 0, 0, 0, 0]
      if (a0 > a1) {
        for (let i = 2; i < 8; i++) alut[i] = ((8-i)*a0 + (i-1)*a1) / 7 | 0
      } else {
        for (let i = 2; i < 6; i++) alut[i] = ((6-i)*a0 + (i-1)*a1) / 5 | 0
        alut[6] = 0; alut[7] = 255
      }
      // 6 bytes = 48 bits of 3-bit indices
      let abits = 0n
      for (let i = 0; i < 6; i++) abits |= BigInt(src[s+2+i]) << BigInt(i*8)
      s += 8

      const c0v = src[s] | src[s+1]<<8, c1v = src[s+2] | src[s+3]<<8
      const c0 = rgb565(c0v), c1 = rgb565(c1v)
      const col = [c0, c1,
        [c0[0]*2/3+c1[0]/3|0, c0[1]*2/3+c1[1]/3|0, c0[2]*2/3+c1[2]/3|0],
        [c0[0]/3+c1[0]*2/3|0, c0[1]/3+c1[1]*2/3|0, c0[2]/3+c1[2]*2/3|0],
      ]
      const bits = src[s+4] | src[s+5]<<8 | src[s+6]<<16 | src[s+7]*16777216
      s += 8

      for (let py = 0; py < 4; py++) for (let px = 0; px < 4; px++) {
        const x = bx*4+px, y = by*4+py
        if (x >= w || y >= h) continue
        const ci    = (bits >> (py*4+px)*2) & 3
        const ai    = py*4+px
        const alpha = Number((abits >> BigInt(ai*3)) & 7n)
        const d     = (y*w+x)*4
        dst[d]=col[ci][0]; dst[d+1]=col[ci][1]; dst[d+2]=col[ci][2]; dst[d+3]=alut[alpha]
      }
    }
  }
}
