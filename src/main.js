import './style.css'
import { initScene, addModel, fitCamera, setMode, toggleGrid, cycleBackground, getModelGroup, toggleTextures, getTexturesVisible, setTexturesVisible } from './scene.js'
import * as THREE from 'three'
import {
  toast, setLoading, setEngineBadge, setModelTitle, setStatus,
  updateInfo, updateTextureList, updateFileChips,
  showCanvas, showDropzone, setModeButton, setGridButton,
  setTexButton, showHUD, setHUDStats,
} from './ui.js'
import { detectEngine, ENGINE } from './parsers/detect.js'
import { parseGoldSrc } from './parsers/goldsrc.js'
import { parseSource   } from './parsers/source.js'
import { parseVTF      } from './parsers/vtf.js'

// ── Persistent state ──────────────────────────────────────────────────────────
const files = { mdl: null, vvd: null, vtx: null, vtf: {} }

// Kept alive after load so textures can be hot-swapped without re-parsing
let materialMap   = new Map() // basenameLC → THREE.Material[]
let neededTextures = []       // [{base, name, loaded}] — what the model declared
let currentEngine = null
let currentMode   = 'solid'
let gridVisible   = true

// ── Boot ──────────────────────────────────────────────────────────────────────
initScene(document.getElementById('canvas'))

// ── File ingestion ────────────────────────────────────────────────────────────
function ingestFiles(list) {
  let needFullLoad = false

  for (const f of list) {
    const low = f.name.toLowerCase()
    if      (low.endsWith('.mdl'))  { files.mdl = f; needFullLoad = true }
    else if (low.endsWith('.vvd'))  { files.vvd = f; needFullLoad = true }
    else if (low.endsWith('.vtx'))  { files.vtx = f; needFullLoad = true }
    else if (low.endsWith('.vtf')) {
      const base = low.replace(/\.vtf$/, '').split(/[/\\]/).pop()
      files.vtf[base] = f
    }
  }

  if (needFullLoad) {
    loadModel()
  } else if (Object.keys(files.vtf).length && materialMap.size) {
    // Only VTF files were added — hot-swap without re-parsing
    applyVTFs()
  }
}

// ── Full model load ───────────────────────────────────────────────────────────
async function loadModel() {
  if (!files.mdl) { toast('Drop a .mdl file to start.', 'info'); return }

  setLoading(true)
  setStatus('parsing…')

  try {
    const mdlBuf = await files.mdl.arrayBuffer()
    const { engine, version } = detectEngine(mdlBuf)
    currentEngine = engine

    updateFileChips({
      mdl: files.mdl, vvd: files.vvd, vtx: files.vtx,
      vtfCount: Object.keys(files.vtf).length, engine
    })

    let result

    if (engine === ENGINE.GOLDSRC) {
      result = parseGoldSrc(mdlBuf)

    } else if (engine === ENGINE.SOURCE) {
      if (!files.vvd || !files.vtx) {
        setEngineBadge(engine)
        setStatus('source model — also drop .vvd and .vtx')
        toast('Source models need .mdl + .vvd + .vtx — drop all 3 at once.', 'info')
        setLoading(false)
        return
      }
      const [vvdBuf, vtxBuf] = await Promise.all([
        files.vvd.arrayBuffer(),
        files.vtx.arrayBuffer(),
      ])
      result = await parseSource(mdlBuf, vvdBuf, vtxBuf, files.vtf)

    } else {
      throw new Error('Source 2 (.vmdl_c) is not yet supported.')
    }

    const { group, info } = result

    // Add to scene first so rebuildMaterialMap can traverse it
    addModel(group)
    applyMode(currentMode)
    setTexturesVisible(true)          // reset toggle on new model load
    setTexButton(true)

    // Store material map; if parser map is empty, rebuild from mesh userData in scene
    materialMap = result.materialMap ?? new Map()
    if (!materialMap.size) rebuildMaterialMap()

    neededTextures = buildNeededList(info.textures ?? [], info.textureStatus ?? [])

    setEngineBadge(engine)
    setModelTitle(info.name)
    updateInfo(info)
    renderTextureList()
    setHUDStats(info.vertices, info.triangles)
    showCanvas()
    showHUD(true)

    updateFileChips({
      mdl: files.mdl, vvd: files.vvd, vtx: files.vtx,
      vtfCount: Object.keys(files.vtf).length, engine
    })

    const loaded  = neededTextures.filter(t => t.loaded).length
    const total   = neededTextures.length
    setStatus(`${info.name}  ·  ${info.engine} v${info.version}`, total ? `${loaded}/${total} tex` : '')

    if (total > 0 && loaded === 0 && engine === ENGINE.SOURCE) {
      toast(`Needs ${total} texture file${total > 1 ? 's' : ''} — see sidebar to load them.`, 'info')
    }

  } catch (err) {
    toast(err.message)
    console.error(err)
    setStatus('error loading model')
  }

  setLoading(false)
}

// ── VTF hot-swap (no re-parse) ────────────────────────────────────────────────
async function applyVTFs(specificBase = null) {
  // If materialMap is empty, try to rebuild it from the live scene
  if (!materialMap.size) rebuildMaterialMap()

  if (!materialMap.size) {
    console.warn('[SMV] applyVTFs: materialMap still empty — is a model loaded?')
    toast('Load a model first, then add textures.', 'info')
    return
  }


  const toProcess = specificBase
    ? (files.vtf[specificBase] ? { [specificBase]: files.vtf[specificBase] } : {})
    : files.vtf

  let updated = 0
  const noMatch = []

  await Promise.all(Object.entries(toProcess).map(async ([dropBase, file]) => {
    // 1. Exact match
    let mats = materialMap.get(dropBase)

    // 2. Fuzzy fallback: find any materialMap key that contains the dropped name
    //    or vice versa (handles suffix/prefix differences)
    if (!mats?.length) {
      for (const [mapKey, mapMats] of materialMap) {
        if (mapKey.includes(dropBase) || dropBase.includes(mapKey)) {
          mats = mapMats
          console.log(`[SMV] Fuzzy matched "${dropBase}" → "${mapKey}"`)
          break
        }
      }
    }

    if (!mats?.length) {
      noMatch.push(dropBase)
      return
    }

    try {
      const buf = await file.arrayBuffer()
      const tex = parseVTF(buf)
      if (!tex) { console.warn('[SMV] parseVTF returned null for', dropBase); return }

      for (const mat of mats) {
        mat.userData.originalMap = tex           // store for toggle
        if (getTexturesVisible()) {
          mat.map   = tex
          mat.color.set(0xffffff)
          mat.needsUpdate = true
        }
      }
      updated++

      // Mark as loaded — check both exact and fuzzy key
      for (const entry of neededTextures) {
        if (entry.base === dropBase || mats === materialMap.get(entry.base)) {
          entry.loaded = true
        }
      }
    } catch (e) {
      console.error('[SMV] VTF parse error for', dropBase, e)
      toast(`Failed to parse ${dropBase}.vtf — ${e.message}`, 'error')
    }
  }))

  if (noMatch.length) {
    const needed = [...materialMap.keys()].join(', ')
    console.warn(`[SMV] No match for: ${noMatch.join(', ')} — model needs: ${needed}`)
    toast(`${noMatch.length} texture(s) didn't match any material. Check console for needed names.`, 'info')
  }

  if (updated) {
    renderTextureList()
    const loaded = neededTextures.filter(t => t.loaded).length
    const total  = neededTextures.length
    setStatus(document.getElementById('st-left').textContent, total ? `${loaded}/${total} tex` : '')
    updateFileChips({
      mdl: files.mdl, vvd: files.vvd, vtx: files.vtx,
      vtfCount: Object.keys(files.vtf).length, engine: currentEngine,
    })
    toast(`${updated} texture${updated > 1 ? 's' : ''} applied.`, 'success')
  }
}

// ── Rebuild materialMap from live scene (fallback if parser map is empty) ─────
function rebuildMaterialMap() {
  const group = getModelGroup()
  if (!group) return

  const rebuilt = new Map()
  group.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return
    const base = obj.userData.texBase
    const mat  = obj.material
    if (!base || !mat) return
    if (!rebuilt.has(base)) rebuilt.set(base, [])
    if (!rebuilt.get(base).includes(mat)) rebuilt.get(base).push(mat)
  })

  if (rebuilt.size > 0) materialMap = rebuilt
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildNeededList(textures, textureStatus) {
  return textures.map((name, i) => ({
    name,
    base: name.toLowerCase().replace(/\\/g, '/').split('/').pop().replace(/\.vtf$/i, ''),
    loaded: textureStatus[i] ?? false,
  }))
}

// ── Texture list rendering with per-texture browse ────────────────────────────
function renderTextureList() {
  updateTextureList(neededTextures, (base) => pickTextureFor(base))
}

// Per-texture file picker
function pickTextureFor(base) {
  const input = document.createElement('input')
  input.type   = 'accept'
  input.type   = 'file'
  input.accept = '.vtf'
  input.onchange = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    const fileBase = f.name.toLowerCase().replace(/\.vtf$/, '')
    files.vtf[base]     = f   // store under the model's expected name
    files.vtf[fileBase] = f   // also store under the actual filename
    await applyVTFs(base)
  }
  input.click()
}

// ── Drag & drop ───────────────────────────────────────────────────────────────
const dropzone  = document.getElementById('dropzone')
const viewport  = document.getElementById('viewport')
const dragFlash = document.getElementById('drag-flash')

dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('dz-active') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dz-active'))
dropzone.addEventListener('drop', e => {
  e.preventDefault()
  dropzone.classList.remove('dz-active')
  ingestFiles([...e.dataTransfer.files])
})

viewport.addEventListener('dragover', e => { e.preventDefault(); dragFlash.classList.add('show') })
viewport.addEventListener('dragleave', e => {
  if (!viewport.contains(e.relatedTarget)) dragFlash.classList.remove('show')
})
viewport.addEventListener('drop', e => {
  e.preventDefault()
  dragFlash.classList.remove('show')
  ingestFiles([...e.dataTransfer.files])
})

// ── File input (open button) ──────────────────────────────────────────────────
const fileInput = document.getElementById('file-input')
document.getElementById('btn-open').addEventListener('click', () => fileInput.click())
document.getElementById('btn-browse').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', e => { ingestFiles([...e.target.files]); e.target.value = '' })

// ── "Add textures" button in sidebar ─────────────────────────────────────────
document.getElementById('btn-add-tex').addEventListener('click', () => {
  const input = document.createElement('input')
  input.type     = 'file'
  input.accept   = '.vtf'
  input.multiple = true
  input.onchange = e => {
    for (const f of e.target.files) {
      const base = f.name.toLowerCase().replace(/\.vtf$/, '')
      files.vtf[base] = f
    }
    applyVTFs()
  }
  input.click()
})

// ── View mode ─────────────────────────────────────────────────────────────────
function applyMode(mode) {
  currentMode = mode
  setMode(mode)
  setModeButton(mode)
}
document.getElementById('btn-solid').addEventListener('click',   () => applyMode('solid'))
document.getElementById('btn-wire').addEventListener('click',    () => applyMode('wire'))
document.getElementById('btn-normals').addEventListener('click', () => applyMode('normals'))

// ── Utility ───────────────────────────────────────────────────────────────────
document.getElementById('btn-reset').addEventListener('click', fitCamera)
document.getElementById('btn-grid').addEventListener('click', () => {
  gridVisible = toggleGrid()
  setGridButton(gridVisible)
})
document.getElementById('btn-tex').addEventListener('click', () => {
  const v = toggleTextures()
  setTexButton(v)
})
document.getElementById('btn-bg').addEventListener('click', cycleBackground)

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return
  switch (e.key.toLowerCase()) {
    case 'f': fitCamera(); break
    case 'g': gridVisible = toggleGrid(); setGridButton(gridVisible); break
    case 't': { const v = toggleTextures(); setTexButton(v); break }
    case 'b': cycleBackground(); break
    case '1': applyMode('solid');   break
    case '2': applyMode('wire');    break
    case '3': applyMode('normals'); break
  }
})

// ── Sidebar resize ────────────────────────────────────────────────────────────
const sidebar       = document.getElementById('sidebar')
const sidebarHandle = document.getElementById('sidebar-handle')
let resizing = false, resizeStartX = 0, resizeStartW = 0

sidebarHandle.addEventListener('mousedown', e => {
  resizing     = true
  resizeStartX = e.clientX
  resizeStartW = sidebar.offsetWidth
  sidebarHandle.classList.add('dragging')
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
})
document.addEventListener('mousemove', e => {
  if (!resizing) return
  const w = Math.min(420, Math.max(160, resizeStartW + e.clientX - resizeStartX))
  document.documentElement.style.setProperty('--sidebar-w', w + 'px')
})
document.addEventListener('mouseup', () => {
  if (!resizing) return
  resizing = false
  sidebarHandle.classList.remove('dragging')
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

// ── Collapsible sidebar sections ──────────────────────────────────────────────
document.querySelectorAll('.block-label.collapsible').forEach(label => {
  const targetId = label.dataset.target
  const body     = document.getElementById(targetId)
  if (!body) return

  // Set initial max-height so transition works
  body.style.maxHeight = body.scrollHeight + 'px'

  label.addEventListener('click', () => {
    const isCollapsed = body.classList.contains('collapsed')
    if (isCollapsed) {
      body.style.maxHeight = body.scrollHeight + 'px'
      body.classList.remove('collapsed')
      label.querySelector('.collapse-arrow').style.transform = ''
    } else {
      body.style.maxHeight = body.scrollHeight + 'px' // force reflow
      requestAnimationFrame(() => {
        body.style.maxHeight = '0px'
        body.classList.add('collapsed')
        label.querySelector('.collapse-arrow').style.transform = 'rotate(-90deg)'
      })
    }
  })
})

// ── Init ──────────────────────────────────────────────────────────────────────
setStatus('drop a .mdl file to begin')
setGridButton(true)
showHUD(false)
