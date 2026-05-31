import * as THREE from 'three'
import { readStr } from './binary.js'

/*
  GoldSrc MDL v10 parser.

  All offsets in the file are absolute (from byte 0).

  Key structures (sizes in bytes):
    studiohdr_t      — 244
    mstudiotexture_t —  80   (name[64] + flags + width + height + dataOffset)
    mstudiobodyparts_t — 76  (name[64] + nummodels + base + modelindex)
    mstudiomodel_t   — 112   (name[64] + type + radius + nummesh + meshindex +
                               numverts + vertinfoindex + vertindex +
                               numnorms + norminfoindex + normindex +
                               numgroups + groupindex)
    mstudiomesh_t    —  20   (numtris + triindex + skinref + numnorms + normindex)
*/

// GoldSrc uses Z-up; Three.js is Y-up.  We rotate the root group by -90° on X.
const Z_UP_ROTATION = -Math.PI / 2

export function parseGoldSrc(buffer) {
  const view = new DataView(buffer)
  const u8   = new Uint8Array(buffer)

  const version      = view.getInt32(4, true)
  const name         = readStr(u8, 8, 64)

  const numtextures  = view.getInt32(180, true)
  const textureindex = view.getInt32(184, true)
  const numskinref   = view.getInt32(192, true)
  const numskinfam   = view.getInt32(196, true)
  const skinindex    = view.getInt32(200, true)
  const numbodyparts = view.getInt32(204, true)
  const bodypartidx  = view.getInt32(208, true)

  // ── Skin table ────────────────────────────────────────────────────────────
  const skins = []
  for (let i = 0; i < numskinref * numskinfam; i++)
    skins.push(view.getUint16(skinindex + i * 2, true))

  // ── Textures (embedded: raw 8-bit indexed pixels + 256-colour palette) ───
  const textures = []
  for (let t = 0; t < numtextures; t++) {
    const base   = textureindex + t * 80
    const tname  = readStr(u8, base, 64)
    const tw     = view.getInt32(base + 68, true)
    const th     = view.getInt32(base + 72, true)
    const tdata  = view.getInt32(base + 76, true)

    const pixels  = new Uint8Array(buffer, tdata, tw * th)
    const palette = new Uint8Array(buffer, tdata + tw * th, 768)
    const rgba    = new Uint8Array(tw * th * 4)

    for (let i = 0; i < tw * th; i++) {
      const ci     = pixels[i] * 3
      rgba[i*4]    = palette[ci]
      rgba[i*4+1]  = palette[ci+1]
      rgba[i*4+2]  = palette[ci+2]
      rgba[i*4+3]  = 255
    }

    const tex = new THREE.DataTexture(rgba, tw, th, THREE.RGBAFormat)
    tex.colorSpace  = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.flipY       = true
    tex.needsUpdate = true
    textures.push({ name: tname, tex, width: tw, height: th })
  }

  // ── Build geometry ────────────────────────────────────────────────────────
  const group   = new THREE.Group()
  group.rotation.x = Z_UP_ROTATION

  let totalVerts = 0
  let totalTris  = 0
  const usedTextures = new Set()
  const materialMap  = new Map() // basenameLC → THREE.Material[]

  for (let bp = 0; bp < numbodyparts; bp++) {
    const bpBase     = bodypartidx + bp * 76
    const nummodels  = view.getInt32(bpBase + 64, true)
    const modelindex = view.getInt32(bpBase + 72, true)

    for (let m = 0; m < nummodels; m++) {
      const mBase     = modelindex + m * 112
      const nummesh   = view.getInt32(mBase + 72, true)
      const meshindex = view.getInt32(mBase + 76, true)
      const numverts  = view.getInt32(mBase + 80, true)
      const vertindex = view.getInt32(mBase + 88, true)
      const numnorms  = view.getInt32(mBase + 92, true)
      const normindex = view.getInt32(mBase + 100, true)

      // Vertex and normal arrays
      const verts = []
      for (let i = 0; i < numverts; i++)
        verts.push([
          view.getFloat32(vertindex + i*12,   true),
          view.getFloat32(vertindex + i*12+4, true),
          view.getFloat32(vertindex + i*12+8, true),
        ])

      const norms = []
      for (let i = 0; i < numnorms; i++)
        norms.push([
          view.getFloat32(normindex + i*12,   true),
          view.getFloat32(normindex + i*12+4, true),
          view.getFloat32(normindex + i*12+8, true),
        ])

      // Accumulate triangle data per texture
      const byTex = {}

      for (let ms = 0; ms < nummesh; ms++) {
        const msBase  = meshindex + ms * 20
        const triidx  = view.getInt32(msBase + 4, true)
        const skinref = view.getInt32(msBase + 8, true)
        const texIdx  = skins[skinref] ?? 0
        const texInfo = textures[texIdx]
        const tw      = texInfo?.width  || 1
        const th      = texInfo?.height || 1
        usedTextures.add(texIdx)

        if (!byTex[texIdx]) byTex[texIdx] = { positions: [], normals: [], uvs: [], texIdx }
        const bucket = byTex[texIdx]

        const push = (tv) => {
          const v = verts[tv.vi] || [0,0,0]
          const n = norms[tv.ni] || [0,0,1]
          bucket.positions.push(v[0], v[1], v[2])
          bucket.normals.push(n[0], n[1], n[2])
          // GoldSrc UVs are raw pixel coordinates — normalise and flip V
          bucket.uvs.push(tv.s / tw, 1 - tv.t / th)
        }

        let off = triidx
        while (true) {
          const type = view.getInt16(off, true); off += 2
          if (!type) break

          const isStrip = type > 0
          const count   = Math.abs(type)
          const tv = []
          for (let i = 0; i < count; i++) {
            tv.push({
              vi: view.getInt16(off,   true),
              ni: view.getInt16(off+2, true),
              s:  view.getInt16(off+4, true),
              t:  view.getInt16(off+6, true),
            })
            off += 8
          }

          if (isStrip) {
            for (let i = 0; i < count - 2; i++) {
              if (i % 2 === 0) { push(tv[i]); push(tv[i+1]); push(tv[i+2]) }
              else             { push(tv[i+1]); push(tv[i]); push(tv[i+2]) }
              totalTris++
            }
          } else {
            for (let i = 1; i < count - 1; i++) {
              push(tv[0]); push(tv[i]); push(tv[i+1])
              totalTris++
            }
          }
        }
      }

      // Create one Three.js Mesh per texture
      for (const data of Object.values(byTex)) {
        if (!data.positions.length) continue
        totalVerts += data.positions.length / 3

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3))
        geo.setAttribute('normal',   new THREE.Float32BufferAttribute(data.normals,   3))
        geo.setAttribute('uv',       new THREE.Float32BufferAttribute(data.uvs,       2))

        const texInfo = textures[data.texIdx]
        const mat = new THREE.MeshStandardMaterial({
          map:       texInfo?.tex ?? null,
          color:     texInfo?.tex ? 0xffffff : 0xaaaaaa,
          roughness: 0.85,
          metalness: 0.05,
          side:      THREE.DoubleSide,
        })

        // Register in materialMap + store on mesh for scene-traversal fallback
        const texBase = texInfo?.name
          ? texInfo.name.toLowerCase().replace(/\\/g,'/').split('/').pop().replace(/\.vtf$/i,'')
          : ''
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

  const textureNames = textures.map(t => t.name)

  return {
    group,
    materialMap, // Map<basenameLC, THREE.Material[]>
    info: {
      name,
      engine:    'GoldSrc',
      version,
      vertices:  totalVerts,
      triangles: totalTris,
      materials: usedTextures.size,
      bodyparts: numbodyparts,
      textures:  textureNames,
      textureStatus: textureNames.map(() => true), // always loaded (embedded)
    },
  }
}
