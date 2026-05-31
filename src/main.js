import './style.css'
import {
  initScene, addModel, fitCamera, setMode, toggleGrid, cycleBackground,
  getModelGroup, toggleTextures, getTexturesVisible, setTexturesVisible,
  mountGroup, unmountGroup, disposeGroup,
} from './scene.js'
import * as THREE from 'three'
import {
  toast, setLoading, setEngineBadge, setModelTitle, setStatus,
  updateInfo, updateTextureList, updateFileChips,
  showCanvas, showDropzone, setModeButton, setGridButton,
  setTexButton, showHUD, setHUDStats, renderTabs,
} from './ui.js'
import { detectEngine, ENGINE } from './parsers/detect.js'
import { parseGoldSrc } from './parsers/goldsrc.js'
import { parseSource   } from './parsers/source.js'
import { parseVTF      } from './parsers/vtf.js'

// ── Tab model ───────────────────────────────────────────────────────────────
// Each tab is a fully self-contained, cached session:
//   { id, group, info, engine, materialMap, neededTextures, files, texturesVisible }
let tabs        = []
let activeTabId = null
let tabSeq      = 0

// Files being assembled before a model is committed to a tab
let staging = freshFiles()

// Global view preferences (shared across tabs)
let currentMode = 'solid'
let gridVisible = true

function freshFiles() { return { mdl: null, vvd: null, vtx: null, vtf: {} } }
function activeTab()  { return tabs.find(t => t.id === activeTabId) ?? null }

// ── Boot ──────────────────────────────────────────────────────────────────────
initScene(document.getElementById('canvas'))

// ── File ingestion ────────────────────────────────────────────────────────────
function ingestFiles(list) {
  const incoming = { mdl: null, vvd: null, vtx: null, vtf: [] }

  for (const f of list) {
    const low = f.name.toLowerCase()
    if      (low.endsWith('.mdl')) incoming.mdl = f
    else if (low.endsWith('.vvd')) incoming.vvd = f
    else if (low.endsWith('.vtx')) incoming.vtx = f
    else if (low.endsWith('.vtf')) incoming.vtf.push(f)
  }

  if (incoming.mdl) {
    // A new .mdl always begins a brand-new model → fresh staging
    staging = freshFiles()
    staging.mdl = incoming.mdl
    if (incoming.vvd) staging.vvd = incoming.vvd
    if (incoming.vtx) staging.vtx = incoming.vtx
    addVtfFiles(staging.vtf, incoming.vtf)
    loadStagedModel()

  } else if (incoming.vvd || incoming.vtx) {
    // Completing a staged Source model (files dropped one at a time)
    if (incoming.vvd) staging.vvd = incoming.vvd
    if (incoming.vtx) staging.vtx = incoming.vtx
    addVtfFiles(staging.vtf, incoming.vtf)
    loadStagedModel()

  } else if (incoming.vtf.length) {
    // Only textures dropped → hot-swap onto the active tab
    const tab = activeTab()
    if (tab) {
      addVtfFiles(tab.files.vtf, incoming.vtf)
      applyVTFs()
    } else {
      addVtfFiles(staging.vtf, incoming.vtf)
      toast('Textures staged — load a model to apply them.', 'info')
    }
  }
}

function addVtfFiles(target, fileArray) {
  for (const f of fileArray) {
    const base = f.name.toLowerCase().replace(/\.vtf$/, '').split(/[/\\]/).pop()
    target[base] = f
  }
}

// ── Parse a staged model and commit it to a new tab ───────────────────────────
async function loadStagedModel() {
  if (!staging.mdl) return

  setLoading(true)
  setStatus('parsing…')

  try {
    const mdlBuf = await staging.mdl.arrayBuffer()
    const { engine, version } = detectEngine(mdlBuf)

    let result
    if (engine === ENGINE.GOLDSRC) {
      result = parseGoldSrc(mdlBuf)

    } else if (engine === ENGINE.SOURCE) {
      if (!staging.vvd || !staging.vtx) {
        setEngineBadge(engine)
        setStatus('source model — also drop .vvd and .vtx')
        toast('Source models need .mdl + .vvd + .vtx — drop all 3 at once.', 'info')
        setLoading(false)
        return
      }
      const [vvdBuf, vtxBuf] = await Promise.all([
        staging.vvd.arrayBuffer(),
        staging.vtx.arrayBuffer(),
      ])
      result = await parseSource(mdlBuf, vvdBuf, vtxBuf, staging.vtf)

    } else {
      throw new Error('Source 2 (.vmdl_c) is not yet supported.')
    }

    const { group, info } = result

    // Build material map (rebuild from scene if parser couldn't extract names)
    let materialMap = result.materialMap ?? new Map()
    if (!materialMap.size) materialMap = rebuildMaterialMapFor(group)

    const tab = {
      id:    ++tabSeq,
      group,
      info,
      engine,
      materialMap,
      neededTextures: buildNeededList(info.textures ?? [], info.textureStatus ?? []),
      files: { mdl: staging.mdl, vvd: staging.vvd, vtx: staging.vtx, vtf: { ...staging.vtf } },
      texturesVisible: true,
    }

    tabs.push(tab)
    staging = freshFiles()
    activateTab(tab.id)

    const loaded = tab.neededTextures.filter(t => t.loaded).length
    const total  = tab.neededTextures.length
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

// ── Tab activation ────────────────────────────────────────────────────────────
function activateTab(id) {
  const tab = tabs.find(t => t.id === id)
  if (!tab) return

  // Unmount whatever is currently shown, mount this tab's cached group
  const prev = activeTab()
  if (prev && prev.group !== tab.group) unmountGroup(prev.group)

  activeTabId = id
  mountGroup(tab.group)
  fitCamera()

  // Restore view state for this tab
  setMode(currentMode)                  // global shading mode, re-applied to new meshes
  setTexturesVisible(tab.texturesVisible)
  setTexButton(tab.texturesVisible)

  // Restore all sidebar / HUD info from the tab
  setEngineBadge(tab.engine)
  setModelTitle(tab.info.name)
  updateInfo(tab.info)
  setHUDStats(tab.info.vertices, tab.info.triangles)
  renderTextureList()
  updateFileChips({
    mdl: tab.files.mdl, vvd: tab.files.vvd, vtx: tab.files.vtx,
    vtfCount: Object.keys(tab.files.vtf).length, engine: tab.engine,
  })

  const loaded = tab.neededTextures.filter(t => t.loaded).length
  const total  = tab.neededTextures.length
  setStatus(`${tab.info.name}  ·  ${tab.info.engine} v${tab.info.version}`, total ? `${loaded}/${total} tex` : '')

  showCanvas()
  showHUD(true)
  renderTabBar()
}

// ── Tab closing ───────────────────────────────────────────────────────────────
function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id)
  if (idx === -1) return

  const tab = tabs[idx]
  disposeGroup(tab.group)          // free GPU memory
  tabs.splice(idx, 1)

  if (activeTabId === id) {
    if (tabs.length) {
      // Activate the neighbour (prefer the one to the left)
      const next = tabs[Math.max(0, idx - 1)]
      activeTabId = null
      activateTab(next.id)
    } else {
      // No tabs left — back to empty state
      activeTabId = null
      showDropzone()
      showHUD(false)
      setModelTitle('')
      setStatus('drop a .mdl file to begin')
      renderTabBar()
    }
  } else {
    renderTabBar()
  }
}

function renderTabBar() {
  renderTabs(tabs, activeTabId, {
    onSelect: (id) => { if (id !== activeTabId) activateTab(id) },
    onClose:  (id) => closeTab(id),
    onNew:    () => fileInput.click(),
  })
}

// ── VTF hot-swap (no re-parse) — operates on the active tab ───────────────────
async function applyVTFs(specificBase = null) {
  const tab = activeTab()
  if (!tab) { toast('Load a model first, then add textures.', 'info'); return }

  if (!tab.materialMap.size) tab.materialMap = rebuildMaterialMapFor(tab.group)
  if (!tab.materialMap.size) {
    toast('This model has no texture slots.', 'info')
    return
  }

  const vtf = tab.files.vtf
  const toProcess = specificBase
    ? (vtf[specificBase] ? { [specificBase]: vtf[specificBase] } : {})
    : vtf

  let updated = 0
  const noMatch = []

  await Promise.all(Object.entries(toProcess).map(async ([dropBase, file]) => {
    let mats = tab.materialMap.get(dropBase)

    // Fuzzy fallback for prefix/suffix differences
    if (!mats?.length) {
      for (const [mapKey, mapMats] of tab.materialMap) {
        if (mapKey.includes(dropBase) || dropBase.includes(mapKey)) { mats = mapMats; break }
      }
    }
    if (!mats?.length) { noMatch.push(dropBase); return }

    try {
      const buf = await file.arrayBuffer()
      const tex = parseVTF(buf)
      if (!tex) return

      for (const mat of mats) {
        mat.userData.originalMap = tex
        if (getTexturesVisible()) {
          mat.map = tex
          mat.color.set(0xffffff)
          mat.needsUpdate = true
        }
      }
      updated++

      for (const entry of tab.neededTextures) {
        if (entry.base === dropBase || mats === tab.materialMap.get(entry.base)) entry.loaded = true
      }
    } catch (e) {
      console.error('[SMV] VTF parse error for', dropBase, e)
      toast(`Failed to parse ${dropBase}.vtf — ${e.message}`, 'error')
    }
  }))

  if (noMatch.length) {
    toast(`${noMatch.length} texture(s) didn't match this model's materials.`, 'info')
  }

  if (updated) {
    renderTextureList()
    const loaded = tab.neededTextures.filter(t => t.loaded).length
    const total  = tab.neededTextures.length
    setStatus(document.getElementById('st-left').textContent, total ? `${loaded}/${total} tex` : '')
    updateFileChips({
      mdl: tab.files.mdl, vvd: tab.files.vvd, vtx: tab.files.vtx,
      vtfCount: Object.keys(tab.files.vtf).length, engine: tab.engine,
    })
    toast(`${updated} texture${updated > 1 ? 's' : ''} applied.`, 'success')
  }
}

// ── Build a materialMap from a group's mesh userData ──────────────────────────
function rebuildMaterialMapFor(group) {
  const map = new Map()
  group.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return
    const base = obj.userData.texBase
    const mat  = obj.material
    if (!base || !mat) return
    if (!map.has(base)) map.set(base, [])
    if (!map.get(base).includes(mat)) map.get(base).push(mat)
  })
  return map
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildNeededList(textures, textureStatus) {
  return textures.map((name, i) => ({
    name,
    base: name.toLowerCase().replace(/\\/g, '/').split('/').pop().replace(/\.vtf$/i, ''),
    loaded: textureStatus[i] ?? false,
  }))
}

function renderTextureList() {
  const tab = activeTab()
  updateTextureList(tab ? tab.neededTextures : [], (base) => pickTextureFor(base))
}

function pickTextureFor(base) {
  const tab = activeTab()
  if (!tab) return
  const input = document.createElement('input')
  input.type   = 'file'
  input.accept = '.vtf'
  input.onchange = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    const fileBase = f.name.toLowerCase().replace(/\.vtf$/, '')
    tab.files.vtf[base]     = f
    tab.files.vtf[fileBase] = f
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
  const tab = activeTab()
  if (!tab) return
  const input = document.createElement('input')
  input.type     = 'file'
  input.accept   = '.vtf'
  input.multiple = true
  input.onchange = e => {
    addVtfFiles(tab.files.vtf, [...e.target.files])
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
  const tab = activeTab()
  if (!tab) return
  tab.texturesVisible = toggleTextures()
  setTexButton(tab.texturesVisible)
})
document.getElementById('btn-bg').addEventListener('click', cycleBackground)

// ── Keyboard ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return

  // Ctrl+Tab / Ctrl+Shift+Tab → cycle tabs ; Ctrl+W → close active tab
  if (e.ctrlKey && e.key.toLowerCase() === 'tab' && tabs.length > 1) {
    e.preventDefault()
    const idx  = tabs.findIndex(t => t.id === activeTabId)
    const next = (idx + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length
    activateTab(tabs[next].id)
    return
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'w' && activeTab()) {
    e.preventDefault()
    closeTab(activeTabId)
    return
  }

  switch (e.key.toLowerCase()) {
    case 'f': fitCamera(); break
    case 'g': gridVisible = toggleGrid(); setGridButton(gridVisible); break
    case 't': { const tab = activeTab(); if (tab) { tab.texturesVisible = toggleTextures(); setTexButton(tab.texturesVisible) } break }
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

  body.style.maxHeight = body.scrollHeight + 'px'

  label.addEventListener('click', () => {
    const isCollapsed = body.classList.contains('collapsed')
    if (isCollapsed) {
      body.style.maxHeight = body.scrollHeight + 'px'
      body.classList.remove('collapsed')
      label.querySelector('.collapse-arrow').style.transform = ''
    } else {
      body.style.maxHeight = body.scrollHeight + 'px'
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
