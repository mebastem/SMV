import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

// ── Singleton scene state ─────────────────────────────────────────────────────
let renderer, scene, camera, controls
let modelGroup      = null
let gridHelper      = null
let wireOverlay     = null
let currentMode     = 'solid'
let texturesVisible = true

const BG_CYCLE = ['dark', 'mid', 'light']
let bgIndex = 0
const BG_COLORS = {
  dark:  0x0d0d10,
  mid:   0x1e1e28,
  light: 0x3a3a50,
}

// ── Init ─────────────────────────────────────────────────────────────────────
export function initScene(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.setClearColor(BG_COLORS.dark)
  renderer.shadowMap.enabled = false

  scene  = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.1, 20000)
  camera.position.set(80, 60, 120)

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping   = true
  controls.dampingFactor   = 0.08
  controls.minDistance     = 0.5
  controls.maxDistance     = 8000
  controls.zoomSpeed       = 1.2
  controls.panSpeed        = 0.8

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  sun.position.set(1, 2, 1.5)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0x8899cc, 0.4)
  fill.position.set(-1, 0.5, -1)
  scene.add(fill)
  const back = new THREE.DirectionalLight(0xffffff, 0.2)
  back.position.set(0, -1, -2)
  scene.add(back)

  // Grid
  gridHelper = new THREE.GridHelper(400, 60, 0x222230, 0x1e1e2a)
  scene.add(gridHelper)

  // Resize
  new ResizeObserver(() => onResize(canvas)).observe(canvas.parentElement)
  onResize(canvas)

  // Render loop
  ;(function loop() {
    requestAnimationFrame(loop)
    controls.update()
    renderer.render(scene, camera)
  })()
}

function onResize(canvas) {
  const w = canvas.parentElement.clientWidth
  const h = canvas.parentElement.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// ── Model management ──────────────────────────────────────────────────────────
export function getModelGroup() { return modelGroup }

export function clearModel() {
  if (modelGroup) { scene.remove(modelGroup); modelGroup = null }
  if (wireOverlay){ scene.remove(wireOverlay); wireOverlay = null }
}

export function addModel(group) {
  clearModel()
  modelGroup = group
  scene.add(group)
  fitCamera()

  // Re-apply current mode to new model
  applyMode(currentMode)
}

export function fitCamera() {
  if (!modelGroup) return
  const box    = new THREE.Box3().setFromObject(modelGroup)
  const center = box.getCenter(new THREE.Vector3())
  const size   = box.getSize(new THREE.Vector3()).length()

  controls.target.copy(center)
  camera.position.copy(center).addScaledVector(new THREE.Vector3(0.6, 0.4, 0.8).normalize(), size * 1.4)
  controls.update()

  // Snap grid to model floor
  if (gridHelper) gridHelper.position.y = box.min.y
}

// ── View modes ────────────────────────────────────────────────────────────────
export function setMode(mode) {
  currentMode = mode
  applyMode(mode)
}

function applyMode(mode) {
  if (!modelGroup) return

  // Remove wire overlay from previous mode
  if (wireOverlay) { scene.remove(wireOverlay); wireOverlay = null }

  modelGroup.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return

    if (mode === 'solid') {
      obj.material = obj.userData.solidMat ?? obj.material
    } else if (mode === 'wire') {
      if (!obj.userData.wireMat)
        obj.userData.wireMat = new THREE.MeshBasicMaterial({ color: 0x5b8dee, wireframe: true })
      obj.material = obj.userData.wireMat
    } else if (mode === 'normals') {
      if (!obj.userData.normalMat)
        obj.userData.normalMat = new THREE.MeshNormalMaterial()
      obj.material = obj.userData.normalMat
    }
  })
}

// ── Texture toggle ────────────────────────────────────────────────────────────
export function getTexturesVisible() { return texturesVisible }

export function setTexturesVisible(v) {
  texturesVisible = v
  if (!modelGroup) return
  modelGroup.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return
    const mat = obj.userData.solidMat ?? obj.material
    if (!mat) return
    mat.map   = v ? (mat.userData.originalMap ?? null) : null
    mat.color.set(v && mat.userData.originalMap ? 0xffffff : 0xaaaaaa)
    mat.needsUpdate = true
  })
}

export function toggleTextures() {
  setTexturesVisible(!texturesVisible)
  return texturesVisible
}

// ── Grid toggle ───────────────────────────────────────────────────────────────
export function toggleGrid() {
  if (gridHelper) gridHelper.visible = !gridHelper.visible
  return gridHelper?.visible ?? false
}

// ── Background cycle ──────────────────────────────────────────────────────────
export function cycleBackground() {
  bgIndex = (bgIndex + 1) % BG_CYCLE.length
  const key = BG_CYCLE[bgIndex]
  renderer.setClearColor(BG_COLORS[key])
  return key
}
