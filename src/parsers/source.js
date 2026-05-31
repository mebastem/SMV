import * as THREE from 'three'
import { readStr, readCStr } from './binary.js'
import { parseVTF } from './vtf.js'

/*
  Source engine MDL v44–49 parser.

  Requires three files:  .mdl + .vvd + .vtx
  Optionally accepts a map of basename → File for .vtf textures.

  Key structure sizes:
    MDL studiohdr_t      — variable, fields we need are at known offsets
    MDL mstudiobodyparts_t — 16 bytes  (sznameindex, nummodels, base, modelindex)
    MDL mstudiomodel_t   — 148 bytes
    MDL mstudiomesh_t    —  84 bytes
    MDL mstudiotexture_t —  64 bytes  (sznameindex, flags, used, unused1, …×10)

    VVD mstudiovertex_t  —  48 bytes  (boneweights[16] + pos[12] + nrm[12] + uv[8])
    VTX FileHeader_t     —  36 bytes
    VTX BodyPartHeader_t —   8 bytes
    VTX ModelHeader_t    —   8 bytes
    VTX ModelLODHeader_t —  12 bytes
    VTX MeshHeader_t     —   9 bytes  (packed)
    VTX StripGroupHeader_t— 25 bytes  (packed)
    VTX StripHeader_t    —  27 bytes  (packed)
    VTX Vertex_t         —   9 bytes  (packed)
*/

const Z_UP_ROTATION = -Math.PI / 2

// VTX structure sizes (all packed, no alignment padding)
const SZ = {
  MDL_BODYPART:   16,
  MDL_MODEL:     148,
  MDL_MESH:      116,  // 48 header + 36 mstudio_meshvertexdata_t + 32 unused[8]
  MDL_TEXTURE:    64,
  VVD_VERTEX:     48,
  VTX_FILE_HDR:   36,
  VTX_BP:          8,
  VTX_MODEL:       8,
  VTX_LOD:        12,
  VTX_MESH:        9,
  VTX_SG:         25,
  VTX_STRIP:      27,
  VTX_VERT:        9,
}

export async function parseSource(mdlBuffer, vvdBuffer, vtxBuffer, vtfFiles = {}) {
  const mdl  = new DataView(mdlBuffer)
  const mdlU8 = new Uint8Array(mdlBuffer)
  const version = mdl.getInt32(4, true)
  const name    = readStr(mdlU8, 12, 64)

  // ── MDL: texture names ───────────────────────────────────────────────────
  const numTextures    = mdl.getInt32(204, true)
  const textureIndex   = mdl.getInt32(208, true)
  const numskinref     = mdl.getInt32(220, true)
  const numskinfam     = mdl.getInt32(224, true)
  const skinindex      = mdl.getInt32(228, true)
  const numbodyparts   = mdl.getInt32(232, true)
  const bodypartindex  = mdl.getInt32(236, true)

  const textureNames = []
  for (let t = 0; t < numTextures; t++) {
    const base       = textureIndex + t * SZ.MDL_TEXTURE
    const sznameIdx  = mdl.getInt32(base, true)
    textureNames.push(readCStr(mdlU8, base + sznameIdx))
  }

  // ── Skin table ────────────────────────────────────────────────────────────
  const skins = []
  for (let i = 0; i < numskinref * numskinfam; i++)
    skins.push(mdl.getUint16(skinindex + i * 2, true))

  // ── Load VTF textures (async) ─────────────────────────────────────────────
  const textureStatus = new Array(numTextures).fill(false)
  const threeTextures = {}

  await Promise.all(textureNames.map(async (tname, i) => {
    const basename = tname.toLowerCase().replace(/\\/g, '/').split('/').pop().replace(/\.vtf$/i, '')
    const file = vtfFiles[basename]
    if (!file) return
    try {
      const buf  = await file.arrayBuffer()
      const tex  = parseVTF(buf)
      if (tex) { threeTextures[i] = tex; textureStatus[i] = true }
    } catch { /* texture missing or corrupt — render without */ }
  }))

  // ── VVD: read LOD-0 vertices ──────────────────────────────────────────────
  const vvd    = new DataView(vvdBuffer)
  if (vvd.getUint32(0, true) !== 0x56534449) throw new Error('Invalid VVD file (bad magic)')

  // vertexFileHeader_t layout (MSVC, 'long' = 32-bit):
  //   0  id, 4  version, 8  checksum(int32), 12 numLODs
  //  16  numLODVertices[8] (32 bytes)
  //  48  numFixups, 52 fixupTableStart, 56 vertexDataStart, 60 tangentDataStart
  const numLODVerts     = vvd.getInt32(16, true) // numLODVertices[0]
  const numFixups       = vvd.getInt32(48, true)
  const fixupTableStart = vvd.getInt32(52, true)
  const vertexDataStart = vvd.getInt32(56, true)

  const rawVerts = readVVDVerts(vvd, vertexDataStart, numLODVerts)
  const verts    = applyVVDFixups(rawVerts, vvd, numFixups, fixupTableStart)

  // ── VTX: parse mesh strips ────────────────────────────────────────────────
  const vtx = new DataView(vtxBuffer)
  if (vtx.getInt32(0, true) !== 7) throw new Error('Unsupported VTX version (expected 7)')
  const vtxBodyPartOffset = vtx.getInt32(32, true)

  const group       = new THREE.Group()
  group.rotation.x  = Z_UP_ROTATION
  const materialMap = new Map() // basenameLC → THREE.Material[]

  let totalVerts = 0
  let totalTris  = 0
  const usedMats = new Set()

  for (let bp = 0; bp < numbodyparts; bp++) {
    const mdlBPoff     = bodypartindex + bp * SZ.MDL_BODYPART
    const mdlNumModels = mdl.getInt32(mdlBPoff + 4,  true)
    const mdlModelIdx  = mdl.getInt32(mdlBPoff + 12, true)

    const vtxBPoff     = vtxBodyPartOffset + bp * SZ.VTX_BP
    const vtxNumModels = vtx.getInt32(vtxBPoff,     true)
    const vtxModOffset = vtx.getInt32(vtxBPoff + 4, true)

    const numMods = Math.min(mdlNumModels, vtxNumModels)

    for (let m = 0; m < numMods; m++) {
      // modelindex is relative to the bodypart struct (not absolute)
      const mdlMoff     = mdlBPoff + mdlModelIdx + m * SZ.MDL_MODEL
      const mdlNumMesh  = mdl.getInt32(mdlMoff + 72, true)
      const mdlMeshIdx  = mdl.getInt32(mdlMoff + 76, true)
      const mdlVertIdx  = mdl.getInt32(mdlMoff + 84, true)   // vertexindex: byte offset in VVD (offset 84, NOT 88 which is tangentsindex)
      const modelVertStart = mdlVertIdx / SZ.VVD_VERTEX | 0

      const vtxMoff     = vtxBPoff + vtxModOffset + m * SZ.VTX_MODEL
      const vtxNumLODs  = vtx.getInt32(vtxMoff,     true)
      const vtxLODOff   = vtx.getInt32(vtxMoff + 4, true)

      // Always use LOD 0
      const vtxLODabs   = vtxMoff + vtxLODOff
      const vtxNumMesh  = vtx.getInt32(vtxLODabs,     true)
      const vtxMeshOff  = vtx.getInt32(vtxLODabs + 4, true)

      const numMeshes = Math.min(mdlNumMesh, vtxNumMesh)

      for (let ms = 0; ms < numMeshes; ms++) {
        // meshindex is relative to the model struct (not absolute)
        const mdlMSoff    = mdlMoff + mdlMeshIdx + ms * SZ.MDL_MESH
        const material    = mdl.getInt32(mdlMSoff,      true)
        const meshVertOff = mdl.getInt32(mdlMSoff + 12, true)
        usedMats.add(material)

        const vtxMSabs  = vtxLODabs + vtxMeshOff + ms * SZ.VTX_MESH
        const vtxNumSG  = vtx.getInt32(vtxMSabs,     true)
        const vtxSGOff  = vtx.getInt32(vtxMSabs + 4, true)

        const positions = [], normals = [], uvs = []

        for (let sg = 0; sg < vtxNumSG; sg++) {
          const sgAbs      = vtxMSabs + vtxSGOff + sg * SZ.VTX_SG
          const sgNumV     = vtx.getInt32(sgAbs,      true)
          const sgVertOff  = vtx.getInt32(sgAbs + 4,  true)
          const sgNumIdx   = vtx.getInt32(sgAbs + 8,  true)
          const sgIdxOff   = vtx.getInt32(sgAbs + 12, true)
          const sgNumStrip = vtx.getInt32(sgAbs + 16, true)
          const sgStripOff = vtx.getInt32(sgAbs + 20, true)
          const vertBase = sgAbs + sgVertOff  // abs pos of vtx vertex array
          const idxBase  = sgAbs + sgIdxOff   // abs pos of index array

          // Map strip-group local vertex index → VVD global index
          const localToVVD = new Int32Array(sgNumV)
          for (let vi = 0; vi < sgNumV; vi++) {
            const vp      = vertBase + vi * SZ.VTX_VERT
            const origID  = vtx.getUint16(vp + 4, true)
            localToVVD[vi] = modelVertStart + meshVertOff + origID
          }
          const addVert = (li) => {
            const vd = verts[localToVVD[li]]
            if (!vd) return
            positions.push(vd.px, vd.py, vd.pz)
            normals.push(vd.nx, vd.ny, vd.nz)
            uvs.push(vd.u, 1 - vd.v)
          }

          for (let st = 0; st < sgNumStrip; st++) {
            const stAbs    = sgAbs + sgStripOff + st * SZ.VTX_STRIP
            const stNumIdx = vtx.getInt32(stAbs,     true)
            const stIdxOff = vtx.getInt32(stAbs + 4, true)
            // treat all strips as triangle lists regardless of flags byte

            // Indices are stored as uint16 in the strip group index buffer.
            // stIdxOff is in index units (not bytes).
            for (let i = 0; i <= stNumIdx - 3; i += 3) {
              const base = idxBase + (stIdxOff + i) * 2
              const i0   = vtx.getUint16(base,     true)
              const i1   = vtx.getUint16(base + 2, true)
              const i2   = vtx.getUint16(base + 4, true)
              addVert(i0); addVert(i1); addVert(i2)
              totalTris++
            }
          }
        }

        if (!positions.length) continue

        totalVerts += positions.length / 3

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3))
        geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,       2))

        const texIdx  = skins[material] ?? material
        const tex3    = threeTextures[texIdx] ?? null
        const mat = new THREE.MeshStandardMaterial({
          map:       tex3,
          color:     tex3 ? 0xffffff : 0xaaaaaa,
          roughness: 0.85,
          metalness: 0.05,
          side:      THREE.DoubleSide,
        })

        // Register in materialMap so textures can be hot-swapped later
        const rawName = textureNames[texIdx] ?? ''
        const texBase = rawName.toLowerCase().replace(/\\/g, '/').split('/').pop().replace(/\.vtf$/i, '')
        if (texBase) {
          if (!materialMap.has(texBase)) materialMap.set(texBase, [])
          materialMap.get(texBase).push(mat)
        }

        mat.userData.originalMap = mat.map  // saved for texture toggle

        const mesh = new THREE.Mesh(geo, mat)
        mesh.userData.solidMat = mat
        mesh.userData.texBase  = texBase || null
        group.add(mesh)
      }
    }
  }

  return {
    group,
    materialMap,
    info: {
      name,
      engine:        'Source',
      version,
      vertices:      totalVerts,
      triangles:     totalTris,
      materials:     usedMats.size,
      bodyparts:     numbodyparts,
      textures:      textureNames,
      textureStatus,
    },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readVVDVerts(vvd, dataStart, count) {
  const out = []
  for (let i = 0; i < count; i++) {
    const o = dataStart + i * 48
    out.push({
      // skip 16 bytes bone weights
      px: vvd.getFloat32(o+16, true), py: vvd.getFloat32(o+20, true), pz: vvd.getFloat32(o+24, true),
      nx: vvd.getFloat32(o+28, true), ny: vvd.getFloat32(o+32, true), nz: vvd.getFloat32(o+36, true),
      u:  vvd.getFloat32(o+40, true), v:  vvd.getFloat32(o+44, true),
    })
  }
  return out
}

function applyVVDFixups(verts, vvd, numFixups, fixupStart) {
  if (numFixups === 0) return verts
  const fixed = []
  for (let f = 0; f < numFixups; f++) {
    const foff     = fixupStart + f * 12
    const lod      = vvd.getInt32(foff,     true)
    const srcStart = vvd.getInt32(foff + 4, true)
    const count    = vvd.getInt32(foff + 8, true)
    if (lod === 0) {
      for (let i = 0; i < count; i++) fixed.push(verts[srcStart + i])
    }
  }
  return fixed.length ? fixed : verts
}
