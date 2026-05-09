import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SkinnedMesh,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CCDIKSolver, type IK } from 'three/examples/jsm/animation/CCDIKSolver.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls, type TransformControlsMode } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  CANONICAL_POSE_STATES,
  DEFAULT_POSE_STATE,
  RIDER_ASSET_URL,
  type PoseLibrary,
  type SavedPose,
  getPoseStateOptions,
  loadPoseLibrary,
  normalizePoseStateName,
  savePoseLibrary,
} from './poseState';

const BOARD_DECK_Y = 0.07;
const BOARD_HULL_BOTTOM_PERCENTILE = 0.15;
const BOARD_HULL_CLEARANCE = 0.02;
const BOARD_FIN_PROTRUSION_SCALE = 0.32;
const FOOT_DECK_SINK = 0.018;
const BOARD_ASSET_URL = '/assets/models/surfboard-jeremy.glb';
const HISTORY_LIMIT = 80;

const EDITABLE_BONES = [
  'Body',
  'Hips',
  'Abdomen',
  'Torso',
  'Neck',
  'Head',
  'ShoulderL',
  'UpperArmL',
  'LowerArmL',
  'PalmL',
  'ShoulderR',
  'UpperArmR',
  'LowerArmR',
  'PalmR',
  'UpperLegL',
  'LowerLegL',
  'FootL',
  'UpperLegR',
  'LowerLegR',
  'FootR',
] as const;

type PoseMarker = {
  bone: Object3D;
  mesh: Mesh;
};

type IkHandle = {
  label: string;
  target: Mesh;
  effector: Object3D;
  links: Object3D[];
};

type Selection =
  | { type: 'joint'; marker: PoseMarker }
  | { type: 'ik'; handle: IkHandle };

export function createPoseEditorView(shell: HTMLElement, renderer: WebGLRenderer): void {
  shell.classList.add('game--pose-editor');

  const scene = new Scene();
  scene.background = new Color('#b7eef4');
  scene.add(new AmbientLight('#ffffff', 2.1));

  const keyLight = new DirectionalLight('#ffffff', 3.3);
  keyLight.position.set(3.5, 6, 4.5);
  scene.add(keyLight);

  const fillLight = new DirectionalLight('#c8f7ff', 1.4);
  fillLight.position.set(-4, 3.5, -5);
  scene.add(fillLight);

  const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 60);
  camera.position.set(3.8, 2.2, 5);

  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.set(0, 0.7, 0);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('rotate');
  transformControls.setSpace('local');
  transformControls.setSize(0.62);
  scene.add(transformControls.getHelper());
  transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
  });
  transformControls.addEventListener('objectChange', () => {
    if (selected?.type === 'ik') {
      solveIk();
    }
    updateOutput();
  });

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const markerRoot = new Group();
  const ikRoot = new Group();
  scene.add(markerRoot);
  scene.add(ikRoot);

  const ui = createPoseEditorUi(shell);
  const panelResizeObserver = new ResizeObserver(() => resize());
  panelResizeObserver.observe(ui.panel);
  let markers: PoseMarker[] = [];
  let ikHandles: IkHandle[] = [];
  let selected: Selection | null = null;
  let skinnedMesh: SkinnedMesh | null = null;
  let poseLibrary = loadPoseLibrary();
  let activeState = poseLibrary.activeState;
  let pendingHistorySnapshot: SavedPose | null = null;
  const undoStack: SavedPose[] = [];
  const redoStack: SavedPose[] = [];
  let basePose = new Map<Object3D, {
    position: Vector3;
    rotation: [number, number, number];
    scale: Vector3;
  }>();
  populateStateSelect(ui.stateSelect, poseLibrary, activeState);
  ui.stateName.value = activeState;
  updateHistoryButtons();

  void loadEditorAssets().then(({ root, rider }) => {
    scene.add(root);
    basePose = captureBasePose(rider);
    skinnedMesh = findFirstSkinnedMesh(rider);
    markers = createBoneMarkers(rider, markerRoot);
    ikHandles = skinnedMesh ? createIkHandles(rider, ikRoot) : [];
    selectJoint(markers.find((marker) => marker.bone.name === 'Hips') ?? markers[0] ?? null);
    loadState(activeState, false);
    updateOutput();
  }).catch((error: unknown) => {
    ui.status.textContent = 'Could not load pose editor assets.';
    console.error('Pose editor assets failed to load.', error);
  });

  scene.add(createEditorDeck());
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  ui.rotateButton.addEventListener('click', () => setMode('rotate'));
  ui.translateButton.addEventListener('click', () => setMode('translate'));
  ui.undoButton.addEventListener('click', undoPoseEdit);
  ui.redoButton.addEventListener('click', redoPoseEdit);
  ui.solveIkButton.addEventListener('click', () => {
    const before = captureCurrentPose();
    solveIk();
    commitHistorySnapshot(before);
  });
  ui.syncIkButton.addEventListener('click', () => {
    const before = captureCurrentPose();
    syncIkTargets();
    commitHistorySnapshot(before);
  });
  ui.stateSelect.addEventListener('change', () => {
    activeState = ui.stateSelect.value || DEFAULT_POSE_STATE;
    ui.stateName.value = activeState;
    loadState(activeState);
  });
  ui.stateName.addEventListener('change', () => {
    activeState = normalizePoseStateName(ui.stateName.value);
    ui.stateName.value = activeState;
    populateStateSelect(ui.stateSelect, poseLibrary, activeState);
    updateOutput();
  });
  ui.saveStateButton.addEventListener('click', saveState);
  ui.loadStateButton.addEventListener('click', () => loadState(currentStateName()));
  ui.resetSelectedButton.addEventListener('click', resetSelected);
  ui.resetAllButton.addEventListener('click', resetAll);
  ui.saveButton.addEventListener('click', savePose);
  ui.copyButton.addEventListener('click', copyPose);
  for (const button of ui.statePresetButtons) {
    button.addEventListener('click', () => {
      const stateName = button.dataset.statePreset;
      if (!stateName) {
        return;
      }
      activeState = normalizePoseStateName(stateName);
      ui.stateName.value = activeState;
      loadState(activeState);
    });
  }
  transformControls.addEventListener('mouseDown', () => {
    pendingHistorySnapshot = captureCurrentPose();
  });
  transformControls.addEventListener('mouseUp', () => {
    commitHistorySnapshot(pendingHistorySnapshot);
    pendingHistorySnapshot = null;
  });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', dispose);

  resize();
  renderer.setAnimationLoop(render);

  function render(): void {
    orbitControls.update();
    updateMarkers(markers);
    renderer.render(scene, camera);
  }

  function resize(): void {
    const panelRect = ui.panel.getBoundingClientRect();
    const isMobileLayout = window.matchMedia('(max-width: 720px)').matches;
    const width = isMobileLayout
      ? window.innerWidth
      : Math.max(320, Math.floor(window.innerWidth - panelRect.width - 28));
    const height = isMobileLayout
      ? Math.max(180, Math.floor(window.innerHeight - panelRect.height - 20))
      : window.innerHeight;

    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function dispose(): void {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', resize);
    panelResizeObserver.disconnect();
    orbitControls.dispose();
    transformControls.dispose();
    renderer.dispose();
  }

  function onPointerDown(event: PointerEvent): void {
    if (transformControls.dragging) {
      return;
    }

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(markers.map((marker) => marker.mesh), false);
    if (hits[0]?.object instanceof Mesh) {
      const marker = markers.find((item) => item.mesh === hits[0].object);
      selectJoint(marker ?? null);
      return;
    }

    const ikHits = raycaster.intersectObjects(ikHandles.map((handle) => handle.target), false);
    if (ikHits[0]?.object instanceof Mesh) {
      const handle = ikHandles.find((item) => item.target === ikHits[0].object);
      selectIk(handle ?? null);
    }
  }

  function selectJoint(marker: PoseMarker | null): void {
    selected = marker ? { type: 'joint', marker } : null;
    for (const item of markers) {
      const material = item.mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.set(item === marker ? '#ffef5c' : '#114653');
        material.opacity = item === marker ? 0.95 : 0.62;
      }
    }
    setIkHandleSelection(null);

    if (!marker) {
      transformControls.detach();
      ui.selected.textContent = 'No joint';
      return;
    }

    transformControls.attach(marker.bone);
    ui.selected.textContent = marker.bone.name;
    ui.status.textContent = 'Drag the widget to pose the selected joint.';
  }

  function selectIk(handle: IkHandle | null): void {
    selected = handle ? { type: 'ik', handle } : null;
    for (const marker of markers) {
      const material = marker.mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.set('#114653');
        material.opacity = 0.62;
      }
    }
    setIkHandleSelection(handle);

    if (!handle) {
      transformControls.detach();
      ui.selected.textContent = 'No joint';
      return;
    }

    transformControls.setMode('translate');
    updateModeButtons('translate');
    transformControls.attach(handle.target);
    ui.selected.textContent = `IK ${handle.label}`;
    ui.status.textContent = 'Move the IK handle, then fine-tune with joint rotation if needed.';
  }

  function setIkHandleSelection(handle: IkHandle | null): void {
    for (const item of ikHandles) {
      const material = item.target.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.set(item === handle ? '#ffef5c' : '#d946ef');
        material.opacity = item === handle ? 0.96 : 0.72;
      }
    }
  }

  function setMode(mode: TransformControlsMode): void {
    transformControls.setMode(mode);
    updateModeButtons(mode);
  }

  function updateModeButtons(mode: TransformControlsMode): void {
    ui.rotateButton.classList.toggle('pose-editor__button--active', mode === 'rotate');
    ui.translateButton.classList.toggle('pose-editor__button--active', mode === 'translate');
  }

  function resetSelected(): void {
    if (!selected) {
      return;
    }

    const before = captureCurrentPose();
    if (selected.type === 'joint') {
      restoreBone(selected.marker.bone);
    } else {
      syncIkTarget(selected.handle);
      solveIk();
    }
    commitHistorySnapshot(before);
    updateOutput();
  }

  function resetAll(): void {
    const before = captureCurrentPose();
    for (const bone of basePose.keys()) {
      restoreBone(bone);
    }
    syncIkTargets();
    commitHistorySnapshot(before);
    updateOutput();
  }

  function restoreBone(bone: Object3D): void {
    const base = basePose.get(bone);
    if (!base) {
      return;
    }

    bone.position.copy(base.position);
    bone.rotation.set(base.rotation[0], base.rotation[1], base.rotation[2]);
    bone.scale.copy(base.scale);
    bone.updateMatrixWorld(true);
  }

  function updateOutput(): void {
    ui.output.value = JSON.stringify(createPoseLibrarySnapshot(
      poseLibrary,
      currentStateName(),
      markers,
      ikHandles,
    ), null, 2);
    updatePresetButtons();
  }

  function solveIk(): void {
    if (!skinnedMesh || ikHandles.length === 0) {
      return;
    }

    const iks = ikHandles.map((handle): IK => ({
      target: ensureSkeletonIndex(skinnedMesh as SkinnedMesh, handle.target),
      effector: ensureSkeletonIndex(skinnedMesh as SkinnedMesh, handle.effector),
      links: handle.links.map((link) => ({
        index: ensureSkeletonIndex(skinnedMesh as SkinnedMesh, link),
      })),
      iteration: 10,
      maxAngle: 0.18,
      blendFactor: 1,
    }));

    new CCDIKSolver(skinnedMesh, iks).update();
    updateMarkers(markers);
    ui.status.textContent = 'IK solved. Save or copy the JSON when it looks right.';
    updateOutput();
  }

  function syncIkTargets(): void {
    for (const handle of ikHandles) {
      syncIkTarget(handle);
    }
    ui.status.textContent = 'IK handles synced to the current pose.';
  }

  function syncIkTarget(handle: IkHandle): void {
    handle.effector.updateMatrixWorld(true);
    handle.effector.getWorldPosition(handle.target.position);
  }

  function savePose(): void {
    updateOutput();
    const blob = new Blob([ui.output.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'floripa-surfer-poses.json';
    link.click();
    URL.revokeObjectURL(url);
    ui.status.textContent = 'Pose states exported as JSON.';
  }

  function copyPose(): void {
    updateOutput();
    void navigator.clipboard.writeText(ui.output.value).then(() => {
      ui.status.textContent = 'Pose JSON copied.';
    }).catch(() => {
      ui.output.select();
      ui.status.textContent = 'Select and copy the JSON.';
    });
  }

  function saveState(): void {
    activeState = currentStateName();
    poseLibrary = createPoseLibrarySnapshot(poseLibrary, activeState, markers, ikHandles);
    savePoseLibrary(poseLibrary);
    populateStateSelect(ui.stateSelect, poseLibrary, activeState);
    ui.stateName.value = activeState;
    ui.status.textContent = `Saved current pose to "${activeState}".`;
    updatePresetButtons();
    updateOutput();
  }

  function loadState(stateName: string, recordHistory = true): void {
    const normalized = normalizePoseStateName(stateName);
    const pose = poseLibrary.states[normalized];
    activeState = normalized;
    ui.stateName.value = normalized;
    populateStateSelect(ui.stateSelect, poseLibrary, normalized);
    updatePresetButtons();

    if (!pose) {
      ui.status.textContent = `No saved "${normalized}" pose yet. Current edit will save there.`;
      updateOutput();
      return;
    }

    const before = recordHistory ? captureCurrentPose() : null;
    applySavedPose(pose, markers, ikHandles);
    commitHistorySnapshot(before);
    ui.status.textContent = `Loaded "${normalized}".`;
    updateOutput();
  }

  function currentStateName(): string {
    return normalizePoseStateName(ui.stateName.value || ui.stateSelect.value || activeState);
  }

  function captureCurrentPose(): SavedPose | null {
    if (markers.length === 0) {
      return null;
    }

    return serializePose(markers.map((marker) => marker.bone), ikHandles);
  }

  function commitHistorySnapshot(before: SavedPose | null): void {
    const after = captureCurrentPose();
    if (!before || !after || poseSignature(before) === poseSignature(after)) {
      updateHistoryButtons();
      return;
    }

    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) {
      undoStack.shift();
    }
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function undoPoseEdit(): void {
    const previous = undoStack.pop();
    const current = captureCurrentPose();
    if (!previous || !current) {
      updateHistoryButtons();
      return;
    }

    redoStack.push(current);
    applyPoseSnapshot(previous);
    ui.status.textContent = 'Undid pose edit.';
    updateHistoryButtons();
  }

  function redoPoseEdit(): void {
    const next = redoStack.pop();
    const current = captureCurrentPose();
    if (!next || !current) {
      updateHistoryButtons();
      return;
    }

    undoStack.push(current);
    applyPoseSnapshot(next);
    ui.status.textContent = 'Redid pose edit.';
    updateHistoryButtons();
  }

  function applyPoseSnapshot(pose: SavedPose): void {
    applySavedPose(pose, markers, ikHandles);
    updateMarkers(markers);
    updateOutput();
  }

  function updateHistoryButtons(): void {
    ui.undoButton.disabled = undoStack.length === 0;
    ui.redoButton.disabled = redoStack.length === 0;
  }

  function updatePresetButtons(): void {
    for (const button of ui.statePresetButtons) {
      button.classList.toggle('pose-editor__button--active', button.dataset.statePreset === activeState);
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }

    const isUndoKey = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z';
    const isRedoKey = ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z')
      || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y');
    if (isRedoKey) {
      event.preventDefault();
      redoPoseEdit();
    } else if (isUndoKey) {
      event.preventDefault();
      undoPoseEdit();
    }
  }
}

async function loadEditorAssets(): Promise<{ root: Group; rider: Object3D }> {
  const loader = new GLTFLoader();
  const [boardGltf, riderGltf] = await Promise.all([
    loader.loadAsync(BOARD_ASSET_URL),
    loader.loadAsync(RIDER_ASSET_URL),
  ]);

  const root = new Group();
  root.add(prepareBoard(boardGltf.scene));
  const rider = prepareRider(riderGltf.scene);
  root.add(rider);
  return { root, rider };
}

function prepareBoard(model: Object3D): Group {
  const wrapper = new Group();
  normalizeAsset(model, 3.4, 'longest');
  model.rotation.set(-Math.PI / 2, -Math.PI / 2, 0);
  shortenBoardFins(model);
  placeBoardOnHull(model);
  model.position.y += BOARD_HULL_CLEARANCE;
  wrapper.add(model);
  wrapper.rotation.x = -0.05;
  return wrapper;
}

function prepareRider(model: Object3D): Object3D {
  normalizeAsset(model, 1.48, 'height');
  model.position.x = -0.03;
  model.position.z = -0.02;
  model.rotation.y = Math.PI;
  model.scale.x *= 1.02;
  model.scale.z *= 1.02;
  tintRiderForSurf(model);
  snapFeetToDeck(model, BOARD_DECK_Y);
  return model;
}

function normalizeAsset(model: Object3D, targetSize: number, axis: 'height' | 'longest'): void {
  setRuntimeFlags(model);
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const sourceSize = axis === 'height' ? size.y : Math.max(size.x, size.y, size.z);

  if (sourceSize <= 0) {
    return;
  }

  model.position.sub(center);
  model.scale.multiplyScalar(targetSize / sourceSize);

  const fittedBox = new Box3().setFromObject(model);
  const fittedCenter = fittedBox.getCenter(new Vector3());
  model.position.x -= fittedCenter.x;
  model.position.z -= fittedCenter.z;
  model.position.y -= fittedBox.min.y;
}

function setRuntimeFlags(model: Object3D): void {
  model.traverse((child) => {
    if (child instanceof Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

function placeBoardOnHull(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  const hullBottomY = estimateBoardHullBottom(model, box.min.y);
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= hullBottomY;
}

function shortenBoardFins(model: Object3D): void {
  const box = new Box3().setFromObject(model);
  const hullBottomY = estimateBoardHullBottom(model, box.min.y);
  const vertex = new Vector3();
  const worldVertex = new Vector3();

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const positions = child.geometry.getAttribute('position');
    if (!positions) {
      return;
    }

    let changed = false;
    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index);
      worldVertex.copy(vertex);
      child.localToWorld(worldVertex);

      if (worldVertex.y >= hullBottomY) {
        continue;
      }

      worldVertex.y = hullBottomY + (worldVertex.y - hullBottomY) * BOARD_FIN_PROTRUSION_SCALE;
      child.worldToLocal(worldVertex);
      positions.setXYZ(index, worldVertex.x, worldVertex.y, worldVertex.z);
      changed = true;
    }

    if (changed) {
      positions.needsUpdate = true;
      child.geometry.computeVertexNormals();
      child.geometry.computeBoundingBox();
      child.geometry.computeBoundingSphere();
    }
  });
}

function estimateBoardHullBottom(model: Object3D, fallbackY: number): number {
  const vertex = new Vector3();
  const yValues: number[] = [];

  model.updateMatrixWorld(true);
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const positions = child.geometry.getAttribute('position');
    if (!positions) {
      return;
    }

    for (let index = 0; index < positions.count; index += 1) {
      vertex.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
      yValues.push(vertex.y);
    }
  });

  if (yValues.length === 0) {
    return fallbackY;
  }

  yValues.sort((a, b) => a - b);
  const hullIndex = Math.min(
    yValues.length - 1,
    Math.floor((yValues.length - 1) * BOARD_HULL_BOTTOM_PERCENTILE),
  );
  return yValues[hullIndex];
}

function snapFeetToDeck(model: Object3D, deckY: number): void {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  model.position.y += deckY - FOOT_DECK_SINK - box.min.y;
}

function tintRiderForSurf(model: Object3D): void {
  model.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) {
        continue;
      }

      const name = material.name.toLowerCase();
      material.roughness = 0.62;
      material.metalness = 0.04;

      if (name.includes('shirt')) {
        material.color.set('#ee7651');
      } else if (name.includes('pants')) {
        material.color.set('#123f4d');
      } else if (name.includes('skin')) {
        material.color.set('#a46a49');
      } else if (name.includes('hair')) {
        material.color.set('#23150f');
      } else if (name.includes('shoes')) {
        material.color.set('#5b3728');
      }
    }
  });
}

function createBoneMarkers(rider: Object3D, markerRoot: Group): PoseMarker[] {
  const markerGeometry = new SphereGeometry(0.035, 12, 8);
  const markers: PoseMarker[] = [];
  rider.traverse((child) => {
    if (!EDITABLE_BONES.includes(child.name as (typeof EDITABLE_BONES)[number])) {
      return;
    }

    const marker = new Mesh(markerGeometry, new MeshBasicMaterial({
      color: '#114653',
      transparent: true,
      opacity: 0.62,
      depthTest: false,
    }));
    marker.renderOrder = 10;
    marker.userData.boneName = child.name;
    markerRoot.add(marker);
    markers.push({ bone: child, mesh: marker });
  });
  return markers;
}

function updateMarkers(markers: PoseMarker[]): void {
  for (const marker of markers) {
    marker.bone.updateMatrixWorld(true);
    marker.bone.getWorldPosition(marker.mesh.position);
    const scale = marker.bone.name.includes('Finger') || marker.bone.name.includes('Palm') ? 0.75 : 1;
    marker.mesh.scale.setScalar(scale);
  }
}

function createIkHandles(rider: Object3D, ikRoot: Group): IkHandle[] {
  const bones = new Map<string, Object3D>();
  rider.traverse((child) => bones.set(child.name, child));

  const specs = [
    { label: 'Left Hand', effector: 'PalmL', links: ['LowerArmL', 'UpperArmL'] },
    { label: 'Right Hand', effector: 'PalmR', links: ['LowerArmR', 'UpperArmR'] },
    { label: 'Left Ankle', effector: 'LowerLegL_end', links: ['LowerLegL', 'UpperLegL'] },
    { label: 'Right Ankle', effector: 'LowerLegR_end', links: ['LowerLegR', 'UpperLegR'] },
  ];

  const targetGeometry = new SphereGeometry(0.055, 16, 10);
  const handles: IkHandle[] = [];
  for (const spec of specs) {
    const effector = bones.get(spec.effector);
    const links = spec.links.map((name) => bones.get(name));
    if (!effector || links.some((link) => !link)) {
      continue;
    }

    const target = new Mesh(targetGeometry, new MeshBasicMaterial({
      color: '#d946ef',
      transparent: true,
      opacity: 0.72,
      depthTest: false,
    }));
    target.name = `IK_${spec.label.replace(/\s+/g, '')}`;
    target.renderOrder = 12;
    target.userData.ikLabel = spec.label;
    effector.updateMatrixWorld(true);
    effector.getWorldPosition(target.position);
    ikRoot.add(target);
    handles.push({
      label: spec.label,
      target,
      effector,
      links: links as Object3D[],
    });
  }

  return handles;
}

function findFirstSkinnedMesh(model: Object3D): SkinnedMesh | null {
  let skinnedMesh: SkinnedMesh | null = null;
  model.traverse((child) => {
    if (!skinnedMesh && child instanceof SkinnedMesh) {
      skinnedMesh = child;
    }
  });
  return skinnedMesh;
}

function ensureSkeletonIndex(skinnedMesh: SkinnedMesh, object: Object3D): number {
  const bones = skinnedMesh.skeleton.bones as Object3D[];
  const existing = bones.indexOf(object);
  if (existing >= 0) {
    return existing;
  }

  bones.push(object);
  skinnedMesh.skeleton.boneInverses.push(new Matrix4());
  return bones.length - 1;
}

function createEditorDeck(): Group {
  const root = new Group();
  const material = new MeshBasicMaterial({
    color: new Color('#ffffff'),
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const center = new Mesh(new PlaneGeometry(0.08, 4.2), material);
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.022;
  root.add(center);

  const cross = new Mesh(new PlaneGeometry(1.7, 0.05), material.clone());
  cross.rotation.x = -Math.PI / 2;
  cross.position.y = 0.024;
  root.add(cross);
  return root;
}

function captureBasePose(rider: Object3D): Map<Object3D, {
  position: Vector3;
  rotation: [number, number, number];
  scale: Vector3;
}> {
  const pose = new Map<Object3D, {
    position: Vector3;
    rotation: [number, number, number];
    scale: Vector3;
  }>();
  rider.traverse((child) => {
    if (!EDITABLE_BONES.includes(child.name as (typeof EDITABLE_BONES)[number])) {
      return;
    }

    pose.set(child, {
      position: child.position.clone(),
      rotation: [child.rotation.x, child.rotation.y, child.rotation.z],
      scale: child.scale.clone(),
    });
  });
  return pose;
}

function serializePose(bones: Object3D[], ikHandles: IkHandle[]): SavedPose {
  const data: SavedPose = {
    asset: RIDER_ASSET_URL,
    savedAt: new Date().toISOString(),
    bones: {},
    ikTargets: {},
  };

  for (const bone of bones) {
    data.bones[bone.name] = {
      position: [round(bone.position.x), round(bone.position.y), round(bone.position.z)],
      rotation: [round(bone.rotation.x), round(bone.rotation.y), round(bone.rotation.z)],
      scale: [round(bone.scale.x), round(bone.scale.y), round(bone.scale.z)],
    };
  }

  for (const handle of ikHandles) {
    data.ikTargets[handle.label] = [
      round(handle.target.position.x),
      round(handle.target.position.y),
      round(handle.target.position.z),
    ];
  }

  return data;
}

function createPoseLibrarySnapshot(
  library: PoseLibrary,
  activeState: string,
  markers: PoseMarker[],
  ikHandles: IkHandle[],
): PoseLibrary {
  return {
    ...library,
    asset: RIDER_ASSET_URL,
    activeState,
    updatedAt: new Date().toISOString(),
    states: {
      ...library.states,
      [activeState]: serializePose(markers.map((marker) => marker.bone), ikHandles),
    },
  };
}

function populateStateSelect(select: HTMLSelectElement, library: PoseLibrary, activeState: string): void {
  select.replaceChildren(...getPoseStateOptions(library, activeState).map((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    option.selected = name === activeState;
    return option;
  }));
}

function applySavedPose(pose: SavedPose, markers: PoseMarker[], ikHandles: IkHandle[]): void {
  for (const marker of markers) {
    const saved = pose.bones[marker.bone.name];
    if (!saved) {
      continue;
    }

    marker.bone.position.set(saved.position[0], saved.position[1], saved.position[2]);
    marker.bone.rotation.set(saved.rotation[0], saved.rotation[1], saved.rotation[2]);
    marker.bone.scale.set(saved.scale[0], saved.scale[1], saved.scale[2]);
    marker.bone.updateMatrixWorld(true);
  }

  for (const handle of ikHandles) {
    const saved = pose.ikTargets?.[handle.label];
    if (!saved) {
      continue;
    }

    handle.target.position.set(saved[0], saved[1], saved[2]);
  }
}

function poseSignature(pose: SavedPose): string {
  return JSON.stringify({
    bones: pose.bones,
    ikTargets: pose.ikTargets,
  });
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function createPoseEditorUi(shell: HTMLElement): {
  panel: HTMLElement;
  selected: HTMLElement;
  status: HTMLElement;
  output: HTMLTextAreaElement;
  stateSelect: HTMLSelectElement;
  stateName: HTMLInputElement;
  rotateButton: HTMLButtonElement;
  translateButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  solveIkButton: HTMLButtonElement;
  syncIkButton: HTMLButtonElement;
  saveStateButton: HTMLButtonElement;
  loadStateButton: HTMLButtonElement;
  resetSelectedButton: HTMLButtonElement;
  resetAllButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  statePresetButtons: HTMLButtonElement[];
} {
  const panel = document.createElement('section');
  panel.className = 'pose-editor';
  panel.innerHTML = `
    <div class="pose-editor__header">
      <div>
        <div class="pose-editor__eyebrow">Pose Editor</div>
        <div class="pose-editor__selected">No joint</div>
      </div>
      <div class="pose-editor__mode">
        <button class="pose-editor__button pose-editor__button--active" data-action="rotate" type="button">Rotate</button>
        <button class="pose-editor__button" data-action="translate" type="button">Move</button>
        <button class="pose-editor__button" data-action="undo" type="button" disabled>Undo</button>
        <button class="pose-editor__button" data-action="redo" type="button" disabled>Redo</button>
      </div>
    </div>
    <div class="pose-editor__state">
      <select class="pose-editor__select" data-role="state-select" aria-label="Pose state"></select>
      <input class="pose-editor__input" data-role="state-name" aria-label="Pose state name" value="default" />
      <button class="pose-editor__button pose-editor__button--active" data-action="save-state" type="button">Save State</button>
      <button class="pose-editor__button" data-action="load-state" type="button">Load State</button>
    </div>
    <div class="pose-editor__presets" aria-label="Pose presets">
      ${CANONICAL_POSE_STATES.map((name) => (
        `<button class="pose-editor__button" data-state-preset="${name}" type="button">${name}</button>`
      )).join('')}
    </div>
    <div class="pose-editor__actions">
      <button class="pose-editor__button" data-action="solve-ik" type="button">Solve IK</button>
      <button class="pose-editor__button" data-action="sync-ik" type="button">Sync IK</button>
      <button class="pose-editor__button" data-action="reset-selected" type="button">Reset Joint</button>
      <button class="pose-editor__button" data-action="reset-all" type="button">Reset All</button>
      <button class="pose-editor__button" data-action="copy" type="button">Copy JSON</button>
      <button class="pose-editor__button pose-editor__button--primary" data-action="save" type="button">Export JSON</button>
    </div>
    <div class="pose-editor__status">Click a joint marker, then drag the widget.</div>
    <textarea class="pose-editor__output" spellcheck="false"></textarea>
  `;
  shell.append(panel);

  return {
    panel,
    selected: panel.querySelector('.pose-editor__selected') as HTMLElement,
    status: panel.querySelector('.pose-editor__status') as HTMLElement,
    output: panel.querySelector('.pose-editor__output') as HTMLTextAreaElement,
    stateSelect: panel.querySelector('[data-role="state-select"]') as HTMLSelectElement,
    stateName: panel.querySelector('[data-role="state-name"]') as HTMLInputElement,
    rotateButton: panel.querySelector('[data-action="rotate"]') as HTMLButtonElement,
    translateButton: panel.querySelector('[data-action="translate"]') as HTMLButtonElement,
    undoButton: panel.querySelector('[data-action="undo"]') as HTMLButtonElement,
    redoButton: panel.querySelector('[data-action="redo"]') as HTMLButtonElement,
    solveIkButton: panel.querySelector('[data-action="solve-ik"]') as HTMLButtonElement,
    syncIkButton: panel.querySelector('[data-action="sync-ik"]') as HTMLButtonElement,
    saveStateButton: panel.querySelector('[data-action="save-state"]') as HTMLButtonElement,
    loadStateButton: panel.querySelector('[data-action="load-state"]') as HTMLButtonElement,
    resetSelectedButton: panel.querySelector('[data-action="reset-selected"]') as HTMLButtonElement,
    resetAllButton: panel.querySelector('[data-action="reset-all"]') as HTMLButtonElement,
    saveButton: panel.querySelector('[data-action="save"]') as HTMLButtonElement,
    copyButton: panel.querySelector('[data-action="copy"]') as HTMLButtonElement,
    statePresetButtons: Array.from(panel.querySelectorAll('[data-state-preset]')) as HTMLButtonElement[],
  };
}
