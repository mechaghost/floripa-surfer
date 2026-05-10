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
  OrthographicCamera,
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
  DEFAULT_POSE_STATE,
  RIDER_ASSET_URL,
  type PoseLibrary,
  type SavedPose,
  getPoseStateOptions,
  loadPoseLibrary,
  normalizePoseStateName,
  savePoseLibrary,
} from './poseState';

const BOARD_DECK_TOP_PERCENTILE = 0.92;
const BOARD_HULL_BOTTOM_PERCENTILE = 0.15;
const BOARD_HULL_CLEARANCE = 0.02;
const BOARD_FIN_PROTRUSION_SCALE = 0.32;
const FOOT_DECK_CLEARANCE = 0.018;
const BOARD_ASSET_URL = '/assets/models/surfboard-jeremy.glb';
const HISTORY_LIMIT = 80;
const KEYBOARD_ROTATION_STEP = 0.035;
const KEYBOARD_MOVE_STEP = 0.025;
const IK_REACH_MARGIN = 1.06;
const IK_REACH_PADDING = 0.04;
const BODY_HEIGHT_MIN_FOOT_CLEARANCE = 0.42;
const REFERENCE_POSE_DEPTH_SCALE = 0.28;
const REFERENCE_POSE_MIN_VISIBILITY = 0.28;
const MEDIAPIPE_TASKS_VERSION = '0.10.35';
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;
const MEDIAPIPE_POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const POSE_CAMERA_ORTHO_HEIGHT = 3.8;
const POSE_CAMERA_TARGET = new Vector3(0, 0.72, 0);
const POSE_CAMERA_PRESET_OFFSETS: Record<PoseCameraPreset, Vector3> = {
  iso: new Vector3(3.8, 2.2, 5),
  left: new Vector3(-5.4, 0, 0),
  right: new Vector3(5.4, 0, 0),
  top: new Vector3(0, 5.4, 0.01),
  down: new Vector3(0, -5.4, 0.01),
};
const DEFAULT_JOINT_LIMIT = new Vector3(1.05, 1.05, 1.05);
const IK_JOINT_LIMITS: Record<string, Vector3> = {
  Body: new Vector3(0.55, 0.75, 0.55),
  Hips: new Vector3(0.65, 0.85, 0.65),
  Abdomen: new Vector3(0.75, 0.8, 0.75),
  Torso: new Vector3(0.8, 0.9, 0.8),
  Neck: new Vector3(0.85, 0.95, 0.75),
  UpperArmL: new Vector3(1.55, 1.25, 1.35),
  UpperArmR: new Vector3(1.55, 1.25, 1.35),
  LowerArmL: new Vector3(1.45, 0.42, 0.42),
  LowerArmR: new Vector3(1.45, 0.42, 0.42),
  UpperLegL: new Vector3(1.25, 0.85, 0.95),
  UpperLegR: new Vector3(1.25, 0.85, 0.95),
  LowerLegL: new Vector3(1.65, 0.34, 0.34),
  LowerLegR: new Vector3(1.65, 0.34, 0.34),
};

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
  drivenBone?: Object3D;
  reachRoot?: Object3D;
  maxReach?: number;
  solveMode?: 'chain' | 'body-height';
};

type Selection =
  | { type: 'joint'; marker: PoseMarker }
  | { type: 'ik'; handle: IkHandle };

type TransformAxis = 'x' | 'y' | 'z';
type SelectionMode = 'joint' | 'ik';
type PoseCameraPreset = 'iso' | 'left' | 'right' | 'top' | 'down';
type PoseCameraProjection = 'perspective' | 'orthographic';
type ReferenceImageView = 'side' | 'front';

type ReferenceLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
};

type ReferencePoint = {
  x: number;
  y: number;
  z: number;
};

type ReferencePoseDetector = {
  detect: (image: HTMLImageElement) => {
    landmarks?: ReferenceLandmark[][];
  };
};

const TRANSFORM_AXES: TransformAxis[] = ['x', 'y', 'z'];
const POSE_CAMERA_PRESETS: PoseCameraPreset[] = ['iso', 'left', 'right', 'top', 'down'];
const REFERENCE_TARGET_LANDMARKS: Record<string, number[]> = {
  Head: [0],
  'Body Height': [23, 24],
  'Left Hand': [15],
  'Right Hand': [16],
  'Left Knee': [25],
  'Right Knee': [26],
  'Left Foot': [27, 29, 31],
  'Right Foot': [28, 30, 32],
};
let referencePoseDetectorPromise: Promise<ReferencePoseDetector> | null = null;

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

  const perspectiveCamera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 60);
  const orthographicCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  let camera: PerspectiveCamera | OrthographicCamera = perspectiveCamera;
  let cameraProjection: PoseCameraProjection = 'perspective';
  let cameraPreset: PoseCameraPreset = 'iso';
  camera.position.copy(POSE_CAMERA_TARGET).add(POSE_CAMERA_PRESET_OFFSETS.iso);
  camera.lookAt(POSE_CAMERA_TARGET);

  const orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.copy(POSE_CAMERA_TARGET);
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
      solveSelectedIk(selected.handle);
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
  let editorMode: TransformControlsMode = 'rotate';
  let selectionMode: SelectionMode = 'joint';
  let activeAxis: TransformAxis = 'x';
  let skinnedMesh: SkinnedMesh | null = null;
  let poseLibrary = loadPoseLibrary();
  let activeState = poseLibrary.activeState;
  let poseJson = '';
  let pendingHistorySnapshot: SavedPose | null = null;
  let referenceImageFile: File | null = null;
  let referenceImageUrl: string | null = null;
  const undoStack: SavedPose[] = [];
  const redoStack: SavedPose[] = [];
  let basePose = new Map<Object3D, {
    position: Vector3;
    rotation: [number, number, number];
    scale: Vector3;
  }>();
  populateStateSelect(ui.stateSelect, poseLibrary, activeState);
  updateHistoryButtons();

  void loadEditorAssets().then(({ root, rider }) => {
    scene.add(root);
    basePose = captureBasePose(rider);
    skinnedMesh = findFirstSkinnedMesh(rider);
    markers = createBoneMarkers(rider, markerRoot);
    ikHandles = skinnedMesh ? createIkHandles(rider, ikRoot) : [];
    populateIkTargetSelect(ui.ikTargetSelect, ikHandles);
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
  for (const preset of POSE_CAMERA_PRESETS) {
    ui.viewButtons[preset].addEventListener('click', () => setCameraPreset(preset));
  }
  ui.projectionButton.addEventListener('click', toggleCameraProjection);
  for (const axis of TRANSFORM_AXES) {
    ui.axisButtons[axis].addEventListener('click', () => setActiveAxis(axis));
  }
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
  ui.ikTargetSelect.addEventListener('change', () => {
    const handle = ikHandles.find((item) => item.label === ui.ikTargetSelect.value) ?? null;
    selectIk(handle);
  });
  ui.stateSelect.addEventListener('change', () => {
    activeState = ui.stateSelect.value || DEFAULT_POSE_STATE;
    loadState(activeState);
  });
  ui.loadBaseButton.addEventListener('click', openLoadBaseModal);
  ui.loadBaseCancelButton.addEventListener('click', closeLoadBaseModal);
  ui.loadBaseCloseButton.addEventListener('click', closeLoadBaseModal);
  ui.loadBaseConfirmButton.addEventListener('click', applyLoadBasePose);
  ui.loadBaseModal.addEventListener('pointerdown', (event) => {
    if (event.target === ui.loadBaseModal) {
      closeLoadBaseModal();
    }
  });
  ui.referenceButton.addEventListener('click', openReferenceModal);
  ui.referenceCancelButton.addEventListener('click', closeReferenceModal);
  ui.referenceCloseButton.addEventListener('click', closeReferenceModal);
  ui.referenceApplyButton.addEventListener('click', () => {
    void applyReferenceImagePose();
  });
  ui.referenceInput.addEventListener('change', updateReferenceImageFile);
  ui.referenceModal.addEventListener('pointerdown', (event) => {
    if (event.target === ui.referenceModal) {
      closeReferenceModal();
    }
  });
  ui.saveStateButton.addEventListener('click', saveState);
  ui.resetSelectedButton.addEventListener('click', resetSelected);
  ui.resetAllButton.addEventListener('click', resetAll);
  ui.saveButton.addEventListener('click', savePose);
  ui.copyButton.addEventListener('click', copyPose);
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

  updateAxisButtons();
  updateCameraViewButtons();
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
    updateCameraProjection(width, height);
  }

  function updateCameraProjection(width: number, height: number): void {
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();

    const aspect = width / Math.max(height, 1);
    orthographicCamera.left = -POSE_CAMERA_ORTHO_HEIGHT * aspect * 0.5;
    orthographicCamera.right = POSE_CAMERA_ORTHO_HEIGHT * aspect * 0.5;
    orthographicCamera.top = POSE_CAMERA_ORTHO_HEIGHT * 0.5;
    orthographicCamera.bottom = -POSE_CAMERA_ORTHO_HEIGHT * 0.5;
    orthographicCamera.updateProjectionMatrix();
  }

  function dispose(): void {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', resize);
    panelResizeObserver.disconnect();
    clearReferenceImageUrl();
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

    if (selectionMode === 'joint') {
      const hits = raycaster.intersectObjects(markers.map((marker) => marker.mesh), false);
      if (hits[0]?.object instanceof Mesh) {
        const marker = markers.find((item) => item.mesh === hits[0].object);
        selectJoint(marker ?? null);
        return;
      }

      clearSelection();
      ui.status.textContent = 'Joint mode: no joint selected.';
      return;
    }

    const ikHits = raycaster.intersectObjects(ikHandles.map((handle) => handle.target), false);
    if (ikHits[0]?.object instanceof Mesh) {
      const handle = ikHandles.find((item) => item.target === ikHits[0].object);
      selectIk(handle ?? null);
      return;
    }

    clearSelection();
    ui.status.textContent = 'IK mode: no IK target selected.';
  }

  function selectJoint(marker: PoseMarker | null): void {
    selected = marker ? { type: 'joint', marker } : null;
    selectionMode = 'joint';
    updateModeVisibility();
    for (const item of markers) {
      const material = item.mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.set(item === marker ? '#ffef5c' : '#114653');
        material.opacity = item === marker ? 0.95 : 0.62;
      }
    }
    setIkHandleSelection(null);
    transformControls.setMode('rotate');
    editorMode = 'rotate';
    updateModeButtons('rotate');

    if (!marker) {
      transformControls.detach();
      ui.selected.textContent = 'No selection';
      return;
    }

    transformControls.attach(marker.bone);
    ui.selected.textContent = marker.bone.name;
    ui.status.textContent = 'Joint mode: rotate the selected joint.';
  }

  function selectIk(handle: IkHandle | null): void {
    selected = handle ? { type: 'ik', handle } : null;
    selectionMode = 'ik';
    updateModeVisibility();
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
      ui.selected.textContent = 'No selection';
      ui.ikTargetSelect.value = '';
      return;
    }

    transformControls.setMode('translate');
    editorMode = 'translate';
    updateModeButtons('translate');
    transformControls.attach(handle.target);
    ui.selected.textContent = `IK ${handle.label}`;
    ui.ikTargetSelect.value = handle.label;
    ui.status.textContent = 'IK mode: move the selected target, then solve IK.';
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

  function clearSelection(): void {
    selected = null;
    for (const marker of markers) {
      const material = marker.mesh.material;
      if (material instanceof MeshBasicMaterial) {
        material.color.set('#114653');
        material.opacity = 0.62;
      }
    }
    setIkHandleSelection(null);
    transformControls.detach();
    ui.selected.textContent = 'No selection';
    ui.ikTargetSelect.value = '';
  }

  function updateModeVisibility(): void {
    markerRoot.visible = selectionMode === 'joint';
    ikRoot.visible = selectionMode === 'ik';
  }

  function setMode(mode: TransformControlsMode): void {
    if (mode === 'translate') {
      transformControls.setMode('translate');
      editorMode = 'translate';
      selectionMode = 'ik';
      updateModeVisibility();
      updateModeButtons('translate');
      if (selected?.type === 'ik') {
        transformControls.attach(selected.handle.target);
        ui.status.textContent = 'IK mode: move the selected IK target.';
      } else {
        clearSelection();
        ui.status.textContent = 'IK mode: click a purple target to move it.';
      }
      return;
    }

    transformControls.setMode('rotate');
    editorMode = 'rotate';
    selectionMode = 'joint';
    updateModeVisibility();
    updateModeButtons('rotate');
    if (selected?.type === 'joint') {
      transformControls.attach(selected.marker.bone);
      ui.status.textContent = 'Joint mode: rotate the selected joint.';
    } else {
      clearSelection();
      ui.status.textContent = 'Joint mode: click a joint marker to rotate it.';
    }
  }

  function updateModeButtons(mode: TransformControlsMode): void {
    ui.rotateButton.classList.toggle('pose-editor__button--active', mode === 'rotate');
    ui.translateButton.classList.toggle('pose-editor__button--active', mode === 'translate');
    ui.rotateButton.setAttribute('aria-pressed', String(mode === 'rotate'));
    ui.translateButton.setAttribute('aria-pressed', String(mode === 'translate'));
  }

  function setCameraPreset(preset: PoseCameraPreset): void {
    cameraPreset = preset;
    const nextPosition = POSE_CAMERA_TARGET.clone().add(POSE_CAMERA_PRESET_OFFSETS[preset]);
    camera.position.copy(nextPosition);
    camera.lookAt(POSE_CAMERA_TARGET);
    camera.updateMatrixWorld(true);
    orbitControls.target.copy(POSE_CAMERA_TARGET);
    orbitControls.update();
    ui.status.textContent = `${getCameraPresetLabel(preset)} view selected.`;
    updateCameraViewButtons();
  }

  function toggleCameraProjection(): void {
    cameraProjection = cameraProjection === 'perspective' ? 'orthographic' : 'perspective';
    const previousPosition = camera.position.clone();
    const previousQuaternion = camera.quaternion.clone();
    camera = cameraProjection === 'orthographic' ? orthographicCamera : perspectiveCamera;
    camera.position.copy(previousPosition);
    camera.quaternion.copy(previousQuaternion);
    camera.updateMatrixWorld(true);
    orbitControls.object = camera;
    transformControls.camera = camera;
    resize();
    orbitControls.update();
    ui.status.textContent = cameraProjection === 'orthographic'
      ? 'Orthographic camera enabled.'
      : 'Perspective camera enabled.';
    updateCameraViewButtons();
  }

  function updateCameraViewButtons(): void {
    for (const preset of POSE_CAMERA_PRESETS) {
      ui.viewButtons[preset].classList.toggle('pose-editor__button--active', preset === cameraPreset);
      ui.viewButtons[preset].setAttribute('aria-pressed', String(preset === cameraPreset));
    }
    ui.projectionButton.classList.toggle('pose-editor__button--active', cameraProjection === 'orthographic');
    ui.projectionButton.setAttribute('aria-pressed', String(cameraProjection === 'orthographic'));
  }

  function setActiveAxis(axis: TransformAxis): void {
    activeAxis = axis;
    updateAxisButtons();
    ui.status.textContent = `Axis ${axis.toUpperCase()} selected. Use arrow keys to nudge.`;
  }

  function updateAxisButtons(): void {
    for (const axis of TRANSFORM_AXES) {
      ui.axisButtons[axis].classList.toggle('pose-editor__button--active', axis === activeAxis);
    }
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
    poseJson = JSON.stringify(createPoseLibrarySnapshot(
      poseLibrary,
      currentStateName(),
      markers,
      ikHandles,
    ), null, 2);
  }

  function solveIk(handles = ikHandles): boolean {
    const chainHandles = handles.filter((handle) => handle.solveMode !== 'body-height');
    if (!skinnedMesh || ikHandles.length === 0) {
      return false;
    }
    if (chainHandles.length === 0) {
      return false;
    }

    const clamped = clampIkTargetsToReach(chainHandles);
    const iks = chainHandles.map((handle): IK => {
      const mesh = skinnedMesh as SkinnedMesh;
      return {
        target: ensureSkeletonIndex(mesh, handle.target),
        effector: ensureSkeletonIndex(mesh, handle.effector),
        links: handle.links.map((link) => createLimitedIkLink(mesh, link)),
        iteration: 18,
        blendFactor: 1,
      };
    });

    new CCDIKSolver(skinnedMesh, iks).update();
    updateDrivenBonesFromTargets(chainHandles);
    updateMarkers(markers);
    ui.status.textContent = clamped
      ? 'IK solved with unreachable target clamped to limb reach.'
      : 'IK solved. Save or export the pose when it looks right.';
    updateOutput();
    return clamped;
  }

  function solveSelectedIk(handle: IkHandle): boolean {
    if (handle.solveMode === 'body-height') {
      return solveBodyHeightIk(handle);
    }

    const clamped = solveIk([handle]);
    syncDependentIkTargets(handle);
    updateMarkers(markers);
    updateOutput();
    return clamped;
  }

  function solveBodyHeightIk(handle: IkHandle): boolean {
    const footHandles = ikHandles.filter((item) => item.label === 'Left Foot' || item.label === 'Right Foot');
    const targetWorld = getObjectWorldPosition(handle.target);
    const requestedY = targetWorld.y;
    const maxFootY = footHandles.reduce((highest, footHandle) => {
      const footWorld = getObjectWorldPosition(footHandle.target);
      return Math.max(highest, footWorld.y);
    }, -Infinity);

    if (Number.isFinite(maxFootY)) {
      targetWorld.y = Math.max(targetWorld.y, maxFootY + BODY_HEIGHT_MIN_FOOT_CLEARANCE);
    }

    setObjectWorldPosition(handle.effector, targetWorld);
    syncIkTarget(handle);
    const clamped = solveIkWithoutTargetClamp(footHandles);
    syncDependentIkTargets(handle, new Set(footHandles));
    updateMarkers(markers);
    updateOutput();
    ui.status.textContent = clamped
      ? 'Body height moved with planted feet; leg reach is at its limit.'
      : 'Body height moved with planted feet.';
    return clamped || Math.abs(targetWorld.y - requestedY) > 0.0001;
  }

  function solveIkWithoutTargetClamp(handles: IkHandle[]): boolean {
    if (!skinnedMesh || handles.length === 0) {
      return false;
    }

    const chainHandles = handles.filter((handle) => handle.solveMode !== 'body-height');
    if (chainHandles.length === 0) {
      return false;
    }

    const iks = chainHandles.map((handle): IK => {
      const mesh = skinnedMesh as SkinnedMesh;
      return {
        target: ensureSkeletonIndex(mesh, handle.target),
        effector: ensureSkeletonIndex(mesh, handle.effector),
        links: handle.links.map((link) => createLimitedIkLink(mesh, link)),
        iteration: 18,
        blendFactor: 1,
      };
    });

    new CCDIKSolver(skinnedMesh, iks).update();
    updateDrivenBonesFromTargets(chainHandles);
    return false;
  }

  function createLimitedIkLink(mesh: SkinnedMesh, link: Object3D): IK['links'][number] {
    const base = basePose.get(link);
    const limit = IK_JOINT_LIMITS[link.name] ?? DEFAULT_JOINT_LIMIT;
    const center = base?.rotation ?? [link.rotation.x, link.rotation.y, link.rotation.z];

    return {
      index: ensureSkeletonIndex(mesh, link),
      rotationMin: new Vector3(
        center[0] - limit.x,
        center[1] - limit.y,
        center[2] - limit.z,
      ),
      rotationMax: new Vector3(
        center[0] + limit.x,
        center[1] + limit.y,
        center[2] + limit.z,
      ),
    };
  }

  function updateDrivenBonesFromTargets(handles: IkHandle[]): void {
    const worldTarget = new Vector3();
    for (const handle of handles) {
      if (!handle.drivenBone) {
        continue;
      }

      handle.target.updateMatrixWorld(true);
      handle.target.getWorldPosition(worldTarget);
      setObjectWorldPosition(handle.drivenBone, worldTarget);
    }
  }

  function clampIkTargetsToReach(handles: IkHandle[]): boolean {
    let didClamp = false;
    for (const handle of handles) {
      didClamp = clampIkTargetToReach(handle) || didClamp;
    }
    return didClamp;
  }

  function clampIkTargetToReach(handle: IkHandle): boolean {
    if (!handle.reachRoot || !handle.maxReach) {
      return false;
    }

    const rootWorld = new Vector3();
    const targetWorld = new Vector3();
    handle.reachRoot.updateMatrixWorld(true);
    handle.target.updateMatrixWorld(true);
    handle.reachRoot.getWorldPosition(rootWorld);
    handle.target.getWorldPosition(targetWorld);

    const offset = targetWorld.sub(rootWorld);
    const distance = offset.length();
    if (distance <= handle.maxReach || distance < 0.0001) {
      return false;
    }

    offset.multiplyScalar(handle.maxReach / distance);
    setObjectWorldPosition(handle.target, rootWorld.add(offset));
    return true;
  }

  function syncIkTargets(): void {
    for (const handle of ikHandles) {
      syncIkTarget(handle);
    }
    ui.status.textContent = 'IK handles synced to the current pose.';
  }

  function syncDependentIkTargets(parentHandle: IkHandle, excludedHandles = new Set<IkHandle>()): void {
    for (const handle of ikHandles) {
      if (
        handle === parentHandle ||
        excludedHandles.has(handle) ||
        !isPoseIkTargetDependent(parentHandle.effector, handle.drivenBone ?? handle.effector)
      ) {
        continue;
      }

      syncIkTarget(handle);
    }
  }

  function syncIkTarget(handle: IkHandle): void {
    const syncSource = handle.drivenBone ?? handle.effector;
    syncSource.updateMatrixWorld(true);
    syncSource.getWorldPosition(handle.target.position);
  }

  function savePose(): void {
    updateOutput();
    const blob = new Blob([poseJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'defaultPoseLibrary.json';
    link.click();
    URL.revokeObjectURL(url);
    ui.status.textContent = 'Production pose file downloaded. Replace src/data/defaultPoseLibrary.json and commit.';
  }

  function copyPose(): void {
    updateOutput();
    void navigator.clipboard.writeText(poseJson).then(() => {
      ui.status.textContent = 'Production pose JSON copied. Save it to src/data/defaultPoseLibrary.json and commit.';
    }).catch(() => {
      ui.status.textContent = 'Clipboard blocked. Use Download Pose File instead.';
    });
  }

  function saveState(): void {
    activeState = currentStateName();
    poseLibrary = createPoseLibrarySnapshot(poseLibrary, activeState, markers, ikHandles);
    savePoseLibrary(poseLibrary);
    populateStateSelect(ui.stateSelect, poseLibrary, activeState);
    ui.status.textContent = `Saved "${activeState}" in this browser. Export poses to update the bundled git file.`;
    updateOutput();
  }

  function loadState(stateName: string, recordHistory = true): void {
    const normalized = normalizePoseStateName(stateName);
    const pose = poseLibrary.states[normalized];
    activeState = normalized;
    populateStateSelect(ui.stateSelect, poseLibrary, normalized);

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

  function openLoadBaseModal(): void {
    populateLoadBaseSelect();
    ui.loadBaseModal.hidden = false;
    ui.loadBaseSelect.focus();
  }

  function closeLoadBaseModal(): void {
    ui.loadBaseModal.hidden = true;
  }

  function populateLoadBaseSelect(): void {
    const savedStateNames = getPoseStateOptions(poseLibrary, currentStateName())
      .filter((name) => Boolean(poseLibrary.states[name]));
    ui.loadBaseSelect.replaceChildren(...savedStateNames.map((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === currentStateName();
      return option;
    }));

    if (savedStateNames.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No saved poses';
      ui.loadBaseSelect.append(option);
    }

    ui.loadBaseSelect.disabled = savedStateNames.length === 0;
    ui.loadBaseConfirmButton.disabled = savedStateNames.length === 0;
  }

  function applyLoadBasePose(): void {
    const sourceState = normalizePoseStateName(ui.loadBaseSelect.value);
    const targetState = currentStateName();
    const pose = poseLibrary.states[sourceState];
    if (!pose) {
      ui.status.textContent = `No saved "${sourceState}" pose to load.`;
      closeLoadBaseModal();
      return;
    }

    const before = captureCurrentPose();
    applySavedPose(pose, markers, ikHandles);
    activeState = targetState;
    ui.stateSelect.value = targetState;
    commitHistorySnapshot(before);
    ui.status.textContent = `Loaded "${sourceState}" as base for "${targetState}".`;
    updateOutput();
    closeLoadBaseModal();
  }

  function openReferenceModal(): void {
    setReferenceStatus(
      referenceImageFile
        ? `Ready to apply "${referenceImageFile.name}".`
        : 'Choose a clear full-body image, then apply IK.',
    );
    ui.referenceModal.hidden = false;
    ui.referenceInput.focus();
  }

  function closeReferenceModal(): void {
    ui.referenceModal.hidden = true;
  }

  function updateReferenceImageFile(): void {
    referenceImageFile = ui.referenceInput.files?.[0] ?? null;
    clearReferenceImageUrl();

    if (!referenceImageFile) {
      ui.referencePreview.hidden = true;
      ui.referenceApplyButton.disabled = true;
      setReferenceStatus('Choose a clear full-body image, then apply IK.');
      return;
    }

    referenceImageUrl = URL.createObjectURL(referenceImageFile);
    ui.referencePreview.src = referenceImageUrl;
    ui.referencePreview.hidden = false;
    ui.referenceApplyButton.disabled = false;
    setReferenceStatus(`Ready to apply "${referenceImageFile.name}".`);
    ui.status.textContent = `Loaded reference image "${referenceImageFile.name}".`;
  }

  function clearReferenceImageUrl(): void {
    if (!referenceImageUrl) {
      return;
    }

    URL.revokeObjectURL(referenceImageUrl);
    referenceImageUrl = null;
  }

  async function applyReferenceImagePose(): Promise<void> {
    if (!referenceImageFile) {
      ui.status.textContent = 'Choose a reference image first.';
      setReferenceStatus('Choose a reference image first.');
      return;
    }

    if (ikHandles.length === 0) {
      ui.status.textContent = 'IK handles are still loading.';
      setReferenceStatus('IK handles are still loading.');
      return;
    }

    const before = captureCurrentPose();
    ui.referenceApplyButton.disabled = true;
    setReferenceBusy(true);
    setReferenceStatus('Detecting body landmarks from reference image...', true);
    ui.status.textContent = 'Detecting body landmarks from reference image...';

    try {
      const image = await loadReferenceImage(referenceImageFile);
      setReferenceStatus('Loading pose detector...', true);
      const detector = await getReferencePoseDetector();
      setReferenceStatus('Solving IK targets...', true);
      const result = detector.detect(image);
      const landmarks = result.landmarks?.[0];
      if (!landmarks) {
        ui.status.textContent = 'No full-body pose found in that image.';
        setReferenceStatus('No full-body pose found in that image.');
        return;
      }

      const appliedCount = applyReferenceLandmarksToIkTargets(
        landmarks,
        ui.referenceViewSelect.value as ReferenceImageView,
        ui.referenceFlipInput.checked,
      );
      if (appliedCount === 0) {
        ui.status.textContent = 'Pose found, but no confident IK landmarks were usable.';
        setReferenceStatus('Pose found, but no confident IK landmarks were usable.');
        return;
      }

      const clamped = solveIk();
      commitHistorySnapshot(before);
      setMode('translate');
      ui.status.textContent = clamped
        ? `Applied ${appliedCount} IK targets from reference image; some targets were clamped.`
        : `Applied ${appliedCount} IK targets from reference image.`;
      setReferenceStatus(`Applied ${appliedCount} IK targets.`);
      updateOutput();
      closeReferenceModal();
    } catch (error: unknown) {
      console.error('Reference image pose failed.', error);
      ui.status.textContent = 'Could not apply that reference image.';
      setReferenceStatus('Could not apply that reference image.');
    } finally {
      setReferenceBusy(false);
      ui.referenceApplyButton.disabled = !referenceImageFile;
    }
  }

  function setReferenceBusy(isBusy: boolean): void {
    ui.referenceApplyButton.textContent = isBusy ? 'Working...' : 'Apply IK';
    ui.referenceStatus.classList.toggle('pose-editor-modal__status--busy', isBusy);
    ui.referenceStatus.setAttribute('aria-busy', String(isBusy));
  }

  function setReferenceStatus(message: string, isBusy = false): void {
    ui.referenceStatus.textContent = message;
    ui.referenceStatus.classList.toggle('pose-editor-modal__status--busy', isBusy);
    ui.referenceStatus.setAttribute('aria-busy', String(isBusy));
  }

  function applyReferenceLandmarksToIkTargets(
    landmarks: ReferenceLandmark[],
    imageView: ReferenceImageView,
    flipHorizontal: boolean,
  ): number {
    const points = createReferencePointMap(landmarks);
    const targetEntries = Array.from(points.entries())
      .map(([label, point]) => ({ handle: ikHandles.find((item) => item.label === label), point }))
      .filter((entry): entry is { handle: IkHandle; point: ReferencePoint } => Boolean(entry.handle));

    if (targetEntries.length < 3) {
      return 0;
    }

    const referenceBounds = getReferencePointBounds(targetEntries.map((entry) => entry.point));
    const worldBounds = getIkWorldBounds(targetEntries.map((entry) => entry.handle));
    if (!referenceBounds || !worldBounds) {
      return 0;
    }

    const referenceCenter = points.get('Body Height') ?? referenceBounds.center;
    const bodyHeightHandle = ikHandles.find((handle) => handle.label === 'Body Height');
    const worldCenter = bodyHeightHandle
      ? getObjectWorldPosition(bodyHeightHandle.target)
      : worldBounds.center;
    const scale = worldBounds.height / Math.max(referenceBounds.height, 0.001);
    const horizontalAxis = imageView === 'side'
      ? new Vector3(0, 0, 1)
      : new Vector3(1, 0, 0);
    const depthAxis = imageView === 'side'
      ? new Vector3(1, 0, 0)
      : new Vector3(0, 0, 1);
    const upAxis = new Vector3(0, 1, 0);
    let appliedCount = 0;

    for (const { handle, point } of targetEntries) {
      const horizontal = (point.x - referenceCenter.x) * (flipHorizontal ? -1 : 1);
      const vertical = referenceCenter.y - point.y;
      const depth = referenceCenter.z - point.z;
      const worldPosition = worldCenter.clone()
        .addScaledVector(horizontalAxis, horizontal * scale)
        .addScaledVector(upAxis, vertical * scale)
        .addScaledVector(depthAxis, depth * scale * REFERENCE_POSE_DEPTH_SCALE);

      setObjectWorldPosition(handle.target, worldPosition);
      appliedCount += 1;
    }

    return appliedCount;
  }

  function currentStateName(): string {
    return normalizePoseStateName(ui.stateSelect.value || activeState);
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

  function nudgeSelected(event: KeyboardEvent): void {
    const sign = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
    const multiplier = event.shiftKey ? 4 : event.altKey ? 0.25 : 1;
    const before = captureCurrentPose();

    if (editorMode === 'rotate') {
      if (selected?.type !== 'joint') {
        ui.status.textContent = 'Rotate nudges need a selected joint.';
        return;
      }

      const amount = sign * KEYBOARD_ROTATION_STEP * multiplier;
      selected.marker.bone.rotation[activeAxis] += amount;
      selected.marker.bone.updateMatrixWorld(true);
      updateMarkers(markers);
      commitHistorySnapshot(before);
      updateOutput();
      ui.status.textContent = `Rotated ${selected.marker.bone.name} on ${activeAxis.toUpperCase()}.`;
      return;
    }

    if (selected?.type !== 'ik') {
      ui.status.textContent = 'Move nudges need a selected purple IK target.';
      return;
    }

    const amount = sign * KEYBOARD_MOVE_STEP * multiplier;
    const handle = selected.handle;
    handle.target.position[activeAxis] += amount;
    const clamped = solveSelectedIk(handle);
    commitHistorySnapshot(before);
    updateOutput();
    if (handle.solveMode === 'body-height') {
      ui.status.textContent = clamped
        ? `Moved IK ${handle.label} on ${activeAxis.toUpperCase()} and kept above foot clearance.`
        : `Moved IK ${handle.label} on ${activeAxis.toUpperCase()}.`;
      return;
    }

    ui.status.textContent = clamped
      ? `Moved IK ${handle.label} on ${activeAxis.toUpperCase()} and clamped to limb reach.`
      : `Moved IK ${handle.label} on ${activeAxis.toUpperCase()}.`;
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !ui.loadBaseModal.hidden) {
      event.preventDefault();
      closeLoadBaseModal();
      return;
    }
    if (event.key === 'Escape' && !ui.referenceModal.hidden) {
      event.preventDefault();
      closeReferenceModal();
      return;
    }

    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return;
    }
    if (!ui.loadBaseModal.hidden || !ui.referenceModal.hidden) {
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
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      setMode('rotate');
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      setMode('translate');
    } else if (!event.metaKey && !event.ctrlKey && !event.altKey && ['1', '2', '3'].includes(event.key)) {
      event.preventDefault();
      setActiveAxis(TRANSFORM_AXES[Number(event.key) - 1]);
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      nudgeSelected(event);
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
  const board = prepareBoard(boardGltf.scene);
  const deckY = estimateBoardDeckTop(board);
  root.add(board);
  const rider = prepareRider(riderGltf.scene, deckY);
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

function prepareRider(model: Object3D, deckY: number): Object3D {
  normalizeAsset(model, 1.48, 'height');
  model.position.x = -0.03;
  model.position.z = -0.02;
  model.rotation.y = Math.PI;
  model.scale.x *= 1.02;
  model.scale.z *= 1.02;
  tintRiderForSurf(model);
  snapFeetToDeck(model, deckY);
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

function estimateBoardDeckTop(model: Object3D): number {
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
    return 0;
  }

  yValues.sort((a, b) => a - b);
  const deckIndex = Math.min(
    yValues.length - 1,
    Math.floor((yValues.length - 1) * BOARD_DECK_TOP_PERCENTILE),
  );
  return yValues[deckIndex];
}

function snapFeetToDeck(model: Object3D, deckY: number): void {
  model.updateMatrixWorld(true);
  const box = new Box3();
  let hasFootBounds = false;

  model.traverse((child) => {
    if (child instanceof SkinnedMesh && child.name.includes('Feet')) {
      box.expandByObject(child);
      hasFootBounds = true;
    }
  });

  if (!hasFootBounds) {
    box.setFromObject(model);
  }

  model.position.y += deckY + FOOT_DECK_CLEARANCE - box.min.y;
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
    { label: 'Head', effector: 'Head', links: ['Neck', 'Torso'], reachRoot: 'Torso' },
    { label: 'Body Height', effector: 'Hips', links: [], reachRoot: 'Hips', solveMode: 'body-height' as const },
    { label: 'Left Hand', effector: 'PalmL', links: ['LowerArmL', 'UpperArmL'], reachRoot: 'UpperArmL' },
    { label: 'Right Hand', effector: 'PalmR', links: ['LowerArmR', 'UpperArmR'], reachRoot: 'UpperArmR' },
    { label: 'Left Knee', effector: 'LowerLegL', links: ['UpperLegL'], reachRoot: 'UpperLegL' },
    { label: 'Right Knee', effector: 'LowerLegR', links: ['UpperLegR'], reachRoot: 'UpperLegR' },
    { label: 'Left Foot', effector: 'LowerLegL_end', links: ['LowerLegL', 'UpperLegL'], drivenBone: 'FootL', reachRoot: 'UpperLegL' },
    { label: 'Right Foot', effector: 'LowerLegR_end', links: ['LowerLegR', 'UpperLegR'], drivenBone: 'FootR', reachRoot: 'UpperLegR' },
  ];

  const targetGeometry = new SphereGeometry(0.055, 16, 10);
  const handles: IkHandle[] = [];
  for (const spec of specs) {
    const effector = bones.get(spec.effector);
    const links = spec.links.map((name) => bones.get(name));
    const drivenBone = spec.drivenBone ? bones.get(spec.drivenBone) : undefined;
    const reachRoot = bones.get(spec.reachRoot);
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
    ikRoot.add(target);
    const handle: IkHandle = {
      label: spec.label,
      target,
      effector,
      links: links as Object3D[],
      drivenBone,
      reachRoot,
      solveMode: spec.solveMode ?? 'chain',
    };
    syncIkTargetToSource(handle);
    handle.maxReach = estimateIkReach(handle);
    handles.push(handle);
  }

  return handles;
}

function syncIkTargetToSource(handle: IkHandle): void {
  const source = handle.drivenBone ?? handle.effector;
  source.updateMatrixWorld(true);
  source.getWorldPosition(handle.target.position);
}

function estimateIkReach(handle: IkHandle): number | undefined {
  if (!handle.reachRoot) {
    return undefined;
  }

  const source = handle.drivenBone ?? handle.effector;
  const chain = [
    handle.reachRoot,
    ...handle.links.slice().reverse().filter((link) => link !== handle.reachRoot),
    source,
  ];
  let length = 0;
  for (let index = 0; index < chain.length - 1; index += 1) {
    const start = new Vector3();
    const end = new Vector3();
    chain[index].updateMatrixWorld(true);
    chain[index + 1].updateMatrixWorld(true);
    chain[index].getWorldPosition(start);
    chain[index + 1].getWorldPosition(end);
    length += start.distanceTo(end);
  }

  return length > 0 ? length * IK_REACH_MARGIN + IK_REACH_PADDING : undefined;
}

function setObjectWorldPosition(object: Object3D, worldPosition: Vector3): void {
  const localPosition = worldPosition.clone();
  object.parent?.worldToLocal(localPosition);
  object.position.copy(localPosition);
  object.updateMatrixWorld(true);
}

export function isPoseIkTargetDependent(parentEffector: Object3D, childSource: Object3D): boolean {
  let cursor: Object3D | null = childSource.parent;
  while (cursor) {
    if (cursor === parentEffector) {
      return true;
    }

    cursor = cursor.parent;
  }

  return false;
}

function getObjectWorldPosition(object: Object3D): Vector3 {
  const position = new Vector3();
  object.updateMatrixWorld(true);
  object.getWorldPosition(position);
  return position;
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

async function getReferencePoseDetector(): Promise<ReferencePoseDetector> {
  if (!referencePoseDetectorPromise) {
    referencePoseDetectorPromise = createReferencePoseDetector();
  }
  return referencePoseDetectorPromise;
}

async function createReferencePoseDetector(): Promise<ReferencePoseDetector> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

  try {
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MEDIAPIPE_POSE_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
    }) as ReferencePoseDetector;
  } catch {
    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MEDIAPIPE_POSE_MODEL_URL,
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
    }) as ReferencePoseDetector;
  }
}

function loadReferenceImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Reference image could not load.'));
    };
    image.src = url;
  });
}

function createReferencePointMap(landmarks: ReferenceLandmark[]): Map<string, ReferencePoint> {
  const points = new Map<string, ReferencePoint>();
  for (const [label, indexes] of Object.entries(REFERENCE_TARGET_LANDMARKS)) {
    const point = averageReferenceLandmarks(landmarks, indexes);
    if (point) {
      points.set(label, point);
    }
  }
  return points;
}

function averageReferenceLandmarks(
  landmarks: ReferenceLandmark[],
  indexes: number[],
): ReferencePoint | null {
  const visible = indexes
    .map((index) => landmarks[index])
    .filter((landmark): landmark is ReferenceLandmark => {
      if (!landmark) {
        return false;
      }
      const confidence = Math.max(landmark.visibility ?? 1, landmark.presence ?? 1);
      return confidence >= REFERENCE_POSE_MIN_VISIBILITY;
    });

  if (visible.length === 0) {
    return null;
  }

  const total = visible.reduce((sum, landmark) => {
    sum.x += landmark.x;
    sum.y += landmark.y;
    sum.z += landmark.z;
    return sum;
  }, { x: 0, y: 0, z: 0 });

  return {
    x: total.x / visible.length,
    y: total.y / visible.length,
    z: total.z / visible.length,
  };
}

function getReferencePointBounds(points: ReferencePoint[]): {
  center: ReferencePoint;
  height: number;
} | null {
  if (points.length === 0) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  return {
    center: {
      x: (minX + maxX) * 0.5,
      y: (minY + maxY) * 0.5,
      z: (minZ + maxZ) * 0.5,
    },
    height: maxY - minY,
  };
}

function getIkWorldBounds(handles: IkHandle[]): {
  center: Vector3;
  height: number;
} | null {
  if (handles.length === 0) {
    return null;
  }

  const box = new Box3();
  for (const handle of handles) {
    box.expandByPoint(getObjectWorldPosition(handle.target));
  }

  const size = box.getSize(new Vector3());
  return {
    center: box.getCenter(new Vector3()),
    height: Math.max(size.y, 0.001),
  };
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

function populateIkTargetSelect(select: HTMLSelectElement, ikHandles: IkHandle[]): void {
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Choose IK Target';
  select.replaceChildren(
    placeholder,
    ...ikHandles.map((handle) => {
      const option = document.createElement('option');
      option.value = handle.label;
      option.textContent = handle.label;
      return option;
    }),
  );
  select.value = '';
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
      syncIkTargetToSource(handle);
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

function getCameraPresetLabel(preset: PoseCameraPreset): string {
  const labels: Record<PoseCameraPreset, string> = {
    iso: 'Isometric',
    left: 'Left',
    right: 'Right',
    top: 'Top',
    down: 'Down',
  };
  return labels[preset];
}

function createPoseEditorUi(shell: HTMLElement): {
  panel: HTMLElement;
  selected: HTMLElement;
  status: HTMLElement;
  stateSelect: HTMLSelectElement;
  loadBaseModal: HTMLElement;
  loadBaseSelect: HTMLSelectElement;
  referenceModal: HTMLElement;
  referenceInput: HTMLInputElement;
  referencePreview: HTMLImageElement;
  referenceStatus: HTMLElement;
  referenceViewSelect: HTMLSelectElement;
  referenceFlipInput: HTMLInputElement;
  viewButtons: Record<PoseCameraPreset, HTMLButtonElement>;
  projectionButton: HTMLButtonElement;
  axisButtons: Record<TransformAxis, HTMLButtonElement>;
  rotateButton: HTMLButtonElement;
  translateButton: HTMLButtonElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  loadBaseButton: HTMLButtonElement;
  loadBaseConfirmButton: HTMLButtonElement;
  loadBaseCancelButton: HTMLButtonElement;
  loadBaseCloseButton: HTMLButtonElement;
  referenceButton: HTMLButtonElement;
  referenceApplyButton: HTMLButtonElement;
  referenceCancelButton: HTMLButtonElement;
  referenceCloseButton: HTMLButtonElement;
  ikTargetSelect: HTMLSelectElement;
  solveIkButton: HTMLButtonElement;
  syncIkButton: HTMLButtonElement;
  saveStateButton: HTMLButtonElement;
  resetSelectedButton: HTMLButtonElement;
  resetAllButton: HTMLButtonElement;
  saveButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
} {
  const panel = document.createElement('section');
  panel.className = 'pose-editor';
  panel.innerHTML = `
    <div class="pose-editor__header">
      <div>
        <div class="pose-editor__eyebrow">Floripa Pose Studio</div>
        <div class="pose-editor__label">Selection</div>
        <div class="pose-editor__selected">No selection</div>
      </div>
      <a class="pose-editor__button pose-editor__link-button" href="./" aria-label="Exit pose editor">Exit</a>
    </div>
    <div class="pose-editor__status" aria-live="polite">Joint mode: click a joint to rotate it. Switch to IK mode for purple targets.</div>
    <section class="pose-editor__section">
      <div class="pose-editor__section-title">Pose State</div>
      <div class="pose-editor__state">
        <select class="pose-editor__select" data-role="state-select" aria-label="Pose state"></select>
        <button class="pose-editor__button" data-action="load-base" type="button">Load Base Pose</button>
        <button class="pose-editor__button pose-editor__button--active" data-action="save-state" type="button">Save Local State</button>
      </div>
    </section>
    <section class="pose-editor__section">
      <div class="pose-editor__section-title">Selection Mode</div>
      <div class="pose-editor__mode">
        <button class="pose-editor__button pose-editor__button--active" data-action="rotate" type="button" aria-pressed="true">Joint Rotation</button>
        <button class="pose-editor__button" data-action="translate" type="button" aria-pressed="false">IK Targets</button>
        <button class="pose-editor__button" data-action="undo" type="button" disabled>Undo</button>
        <button class="pose-editor__button" data-action="redo" type="button" disabled>Redo</button>
      </div>
      <div class="pose-editor__axis-group">
        <div class="pose-editor__inline-label">Nudge Axis</div>
        <div class="pose-editor__axis-buttons">
          <button class="pose-editor__button pose-editor__button--active pose-editor__axis-button" data-axis="x" type="button">X</button>
          <button class="pose-editor__button pose-editor__axis-button" data-axis="y" type="button">Y</button>
          <button class="pose-editor__button pose-editor__axis-button" data-axis="z" type="button">Z</button>
        </div>
      </div>
    </section>
    <section class="pose-editor__section">
      <div class="pose-editor__section-title">Camera View</div>
      <div class="pose-editor__views">
        <button class="pose-editor__button pose-editor__button--active" data-view="iso" type="button" aria-pressed="true">Isometric</button>
        <button class="pose-editor__button" data-view="left" type="button" aria-pressed="false">Left</button>
        <button class="pose-editor__button" data-view="right" type="button" aria-pressed="false">Right</button>
        <button class="pose-editor__button" data-view="top" type="button" aria-pressed="false">Top</button>
        <button class="pose-editor__button" data-view="down" type="button" aria-pressed="false">Bottom</button>
        <button class="pose-editor__button" data-action="projection" type="button" aria-pressed="false">Orthographic</button>
      </div>
    </section>
    <section class="pose-editor__section">
      <div class="pose-editor__section-title">IK Tools</div>
      <label class="pose-editor__field">
        <span>IK Target</span>
        <select class="pose-editor__select" data-role="ik-target-select" aria-label="IK target">
          <option value="">Choose IK Target</option>
        </select>
      </label>
      <div class="pose-editor__actions">
        <button class="pose-editor__button" data-action="solve-ik" type="button">Solve IK</button>
        <button class="pose-editor__button" data-action="sync-ik" type="button">Sync Targets</button>
        <button class="pose-editor__button" data-action="reset-selected" type="button">Reset Selected</button>
        <button class="pose-editor__button" data-action="reset-all" type="button">Reset Rig</button>
      </div>
    </section>
    <section class="pose-editor__section">
      <div class="pose-editor__section-title">Pose Sources</div>
      <div class="pose-editor__actions">
        <button class="pose-editor__button" data-action="reference-image" type="button">Use Reference Image</button>
      </div>
    </section>
    <section class="pose-editor__section">
      <div class="pose-editor__section-title">Production Pose File</div>
      <div class="pose-editor__actions">
        <button class="pose-editor__button" data-action="copy" type="button">Copy Pose File</button>
        <button class="pose-editor__button pose-editor__button--primary" data-action="save" type="button">Download Pose File</button>
      </div>
    </section>
  `;
  const loadBaseModal = document.createElement('div');
  loadBaseModal.className = 'pose-editor-modal';
  loadBaseModal.hidden = true;
  loadBaseModal.innerHTML = `
    <section class="pose-editor-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="pose-editor-load-base-title">
      <div class="pose-editor-modal__header">
        <div id="pose-editor-load-base-title" class="pose-editor-modal__title">Load Base Pose</div>
        <button class="pose-editor__button pose-editor-modal__close" data-action="load-base-close" type="button" aria-label="Close load base pose">X</button>
      </div>
      <label class="pose-editor-modal__field">
        <span>Source Pose</span>
        <select class="pose-editor__select" data-role="load-base-select" aria-label="Source pose"></select>
      </label>
      <div class="pose-editor-modal__actions">
        <button class="pose-editor__button" data-action="load-base-cancel" type="button">Cancel</button>
        <button class="pose-editor__button pose-editor__button--primary" data-action="load-base-confirm" type="button">Load Pose</button>
      </div>
    </section>
  `;
  const referenceModal = document.createElement('div');
  referenceModal.className = 'pose-editor-modal';
  referenceModal.hidden = true;
  referenceModal.innerHTML = `
    <section class="pose-editor-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="pose-editor-reference-title">
      <div class="pose-editor-modal__header">
        <div id="pose-editor-reference-title" class="pose-editor-modal__title">Reference Image</div>
        <button class="pose-editor__button pose-editor-modal__close" data-action="reference-close" type="button" aria-label="Close reference image">X</button>
      </div>
      <label class="pose-editor-modal__field">
        <span>Image</span>
        <input class="pose-editor-modal__file" data-role="reference-input" type="file" accept="image/*" aria-label="Reference image">
      </label>
      <label class="pose-editor-modal__field">
        <span>View</span>
        <select class="pose-editor__select" data-role="reference-view" aria-label="Reference view">
          <option value="side" selected>Side</option>
          <option value="front">Front</option>
        </select>
      </label>
      <label class="pose-editor-modal__check">
        <input data-role="reference-flip" type="checkbox">
        <span>Flip Horizontal</span>
      </label>
      <img class="pose-editor-modal__preview" data-role="reference-preview" alt="Reference pose preview" hidden>
      <div class="pose-editor-modal__status" data-role="reference-status" aria-live="polite">Choose a clear full-body image, then apply IK.</div>
      <div class="pose-editor-modal__actions">
        <button class="pose-editor__button" data-action="reference-cancel" type="button">Cancel</button>
        <button class="pose-editor__button pose-editor__button--primary" data-action="reference-apply" type="button" disabled>Apply IK</button>
      </div>
    </section>
  `;
  shell.append(panel);
  shell.append(loadBaseModal);
  shell.append(referenceModal);

  return {
    panel,
    selected: panel.querySelector('.pose-editor__selected') as HTMLElement,
    status: panel.querySelector('.pose-editor__status') as HTMLElement,
    stateSelect: panel.querySelector('[data-role="state-select"]') as HTMLSelectElement,
    loadBaseModal,
    loadBaseSelect: loadBaseModal.querySelector('[data-role="load-base-select"]') as HTMLSelectElement,
    referenceModal,
    referenceInput: referenceModal.querySelector('[data-role="reference-input"]') as HTMLInputElement,
    referencePreview: referenceModal.querySelector('[data-role="reference-preview"]') as HTMLImageElement,
    referenceStatus: referenceModal.querySelector('[data-role="reference-status"]') as HTMLElement,
    referenceViewSelect: referenceModal.querySelector('[data-role="reference-view"]') as HTMLSelectElement,
    referenceFlipInput: referenceModal.querySelector('[data-role="reference-flip"]') as HTMLInputElement,
    viewButtons: {
      iso: panel.querySelector('[data-view="iso"]') as HTMLButtonElement,
      left: panel.querySelector('[data-view="left"]') as HTMLButtonElement,
      right: panel.querySelector('[data-view="right"]') as HTMLButtonElement,
      top: panel.querySelector('[data-view="top"]') as HTMLButtonElement,
      down: panel.querySelector('[data-view="down"]') as HTMLButtonElement,
    },
    projectionButton: panel.querySelector('[data-action="projection"]') as HTMLButtonElement,
    axisButtons: {
      x: panel.querySelector('[data-axis="x"]') as HTMLButtonElement,
      y: panel.querySelector('[data-axis="y"]') as HTMLButtonElement,
      z: panel.querySelector('[data-axis="z"]') as HTMLButtonElement,
    },
    rotateButton: panel.querySelector('[data-action="rotate"]') as HTMLButtonElement,
    translateButton: panel.querySelector('[data-action="translate"]') as HTMLButtonElement,
    undoButton: panel.querySelector('[data-action="undo"]') as HTMLButtonElement,
    redoButton: panel.querySelector('[data-action="redo"]') as HTMLButtonElement,
    loadBaseButton: panel.querySelector('[data-action="load-base"]') as HTMLButtonElement,
    loadBaseConfirmButton: loadBaseModal.querySelector('[data-action="load-base-confirm"]') as HTMLButtonElement,
    loadBaseCancelButton: loadBaseModal.querySelector('[data-action="load-base-cancel"]') as HTMLButtonElement,
    loadBaseCloseButton: loadBaseModal.querySelector('[data-action="load-base-close"]') as HTMLButtonElement,
    referenceButton: panel.querySelector('[data-action="reference-image"]') as HTMLButtonElement,
    referenceApplyButton: referenceModal.querySelector('[data-action="reference-apply"]') as HTMLButtonElement,
    referenceCancelButton: referenceModal.querySelector('[data-action="reference-cancel"]') as HTMLButtonElement,
    referenceCloseButton: referenceModal.querySelector('[data-action="reference-close"]') as HTMLButtonElement,
    ikTargetSelect: panel.querySelector('[data-role="ik-target-select"]') as HTMLSelectElement,
    solveIkButton: panel.querySelector('[data-action="solve-ik"]') as HTMLButtonElement,
    syncIkButton: panel.querySelector('[data-action="sync-ik"]') as HTMLButtonElement,
    saveStateButton: panel.querySelector('[data-action="save-state"]') as HTMLButtonElement,
    resetSelectedButton: panel.querySelector('[data-action="reset-selected"]') as HTMLButtonElement,
    resetAllButton: panel.querySelector('[data-action="reset-all"]') as HTMLButtonElement,
    saveButton: panel.querySelector('[data-action="save"]') as HTMLButtonElement,
    copyButton: panel.querySelector('[data-action="copy"]') as HTMLButtonElement,
  };
}
