// ── Toasts ────────────────────────────────────────────────────────────────────
const toastBox = document.getElementById('toasts')

export function toast(message, type = 'error') {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message
  toastBox.appendChild(el)
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 3000)
}

// ── Loading veil ──────────────────────────────────────────────────────────────
const loadVeil = document.getElementById('load-veil')
export function setLoading(v) { loadVeil.classList.toggle('show', v) }

// ── Engine badge (topbar) — repurposed as HUD tag ─────────────────────────────
const hudEngineTag = document.getElementById('hud-engine-tag')
const hudName      = document.getElementById('hud-name')
const hud          = document.getElementById('hud')

export function setEngineBadge(engine) {
  hudEngineTag.textContent = ({ goldsrc: 'GOLDSRC', source: 'SOURCE', source2: 'SOURCE 2' })[engine] ?? engine.toUpperCase()
}

// ── Model title (HUD top-left) ────────────────────────────────────────────────
export function setModelTitle(name) {
  hudName.textContent = name || ''
  document.title = name ? `SMV — ${name}` : 'SMV'
}

// ── Show HUD ──────────────────────────────────────────────────────────────────
export function showHUD(v) { hud.classList.toggle('hidden', !v) }

// ── HUD stats (bottom-right) ──────────────────────────────────────────────────
export function setHUDStats(verts, tris) {
  document.getElementById('hud-verts').textContent = `${verts.toLocaleString()} verts`
  document.getElementById('hud-tris').textContent  = `${tris.toLocaleString()} tris`
}

// ── Status bar ────────────────────────────────────────────────────────────────
export function setStatus(left, right = '') {
  document.getElementById('st-left').textContent  = left
  document.getElementById('st-right').textContent = right
}

// ── Info panel ────────────────────────────────────────────────────────────────
export function updateInfo({ name, engine, version, vertices, triangles, materials, bodyparts }) {
  set('i-name',    name      || '—')
  set('i-engine',  engine    || '—')
  set('i-version', version   ? `v${version}` : '—')
  set('i-verts',   vertices  != null ? vertices.toLocaleString()  : '—')
  set('i-tris',    triangles != null ? triangles.toLocaleString() : '—')
  set('i-mats',    materials != null ? String(materials)           : '—')
  set('i-parts',   bodyparts != null ? String(bodyparts)           : '—')
}

function set(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

// ── Texture list ──────────────────────────────────────────────────────────────
// `entries` = [{name, base, loaded}], `onPick(base)` = callback for per-row browse
const blockTex  = document.getElementById('block-tex')
const texList   = document.getElementById('texture-list')
const texCount  = document.getElementById('tex-count')

export function updateTextureList(entries, onPick) {
  texList.innerHTML = ''
  if (!entries.length) { blockTex.classList.add('hidden'); return }
  blockTex.classList.remove('hidden')

  const loaded = entries.filter(e => e.loaded).length
  texCount.textContent = `${loaded}/${entries.length}`
  texCount.className   = loaded === entries.length ? 'tex-count-ok' : 'tex-count-missing'

  for (const entry of entries) {
    const row = document.createElement('div')
    row.className = `tex-row${entry.loaded ? ' t-ok' : ' t-missing'}`
    row.title = entry.name

    const dot = document.createElement('span')
    dot.className = 'tdot'
    dot.textContent = entry.loaded ? '●' : '○'

    const nm = document.createElement('span')
    nm.className   = 'tname'
    nm.textContent = entry.base + '.vtf'

    row.appendChild(dot)
    row.appendChild(nm)

    if (!entry.loaded) {
      const btn = document.createElement('button')
      btn.className   = 'tex-pick-btn'
      btn.textContent = 'pick'
      btn.title       = `Browse for ${entry.base}.vtf`
      btn.addEventListener('click', (e) => { e.stopPropagation(); onPick(entry.base) })
      row.appendChild(btn)
    }

    texList.appendChild(row)
  }
}

// ── File rows ─────────────────────────────────────────────────────────────────
export function updateFileChips({ mdl, vvd, vtx, vtfCount, engine }) {
  fileRow('row-mdl', mdl?.name ?? null, !!mdl, false, false)

  const src = engine === 'source'
  fileRow('row-vvd', vvd?.name ?? '.vvd', !!vvd, src && !vvd, !src)
  fileRow('row-vtx', vtx?.name ?? '.vtx', !!vtx, src && !vtx, !src)
  fileRow('row-vtf',
    vtfCount ? `${vtfCount} vtf file${vtfCount > 1 ? 's' : ''}` : 'textures',
    vtfCount > 0, false, !(src && vtfCount > 0))

  document.getElementById('source-hint').classList.toggle('hidden', !(src && (!vvd || !vtx)))
}

function fileRow(id, label, ok, err, hidden) {
  const row = document.getElementById(id)
  if (!row) return
  if (hidden) { row.classList.add('hidden'); return }
  row.classList.remove('hidden', 'frow-none', 'f-ok', 'f-err')
  if (ok)  row.classList.add('f-ok')
  if (err) row.classList.add('f-err')
  row.querySelector('.fname').textContent = label || '—'
  row.querySelector('.fdot').textContent  = ok ? '●' : '○'
}

// ── Drop zone / canvas ────────────────────────────────────────────────────────
const dropzone = document.getElementById('dropzone')
const canvas   = document.getElementById('canvas')

export function showCanvas() {
  dropzone.style.display = 'none'
  canvas.style.display = 'block'
}

export function showDropzone() {
  dropzone.style.display = 'flex'
  canvas.style.display = 'none'
}

// ── Mode buttons ──────────────────────────────────────────────────────────────
export function setModeButton(mode) {
  ;['solid','wire','normals'].forEach(m =>
    document.getElementById(`btn-${m}`).classList.toggle('active', m === mode))
}

// ── Grid / BG buttons ─────────────────────────────────────────────────────────
export function setGridButton(v) {
  document.getElementById('btn-grid').classList.toggle('active', v)
}

// ── Texture toggle button ─────────────────────────────────────────────────────
export function setTexButton(v) {
  document.getElementById('btn-tex').classList.toggle('active', v)
}
