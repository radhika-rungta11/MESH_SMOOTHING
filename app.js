import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

const viewer = document.getElementById("viewer");
const objFileInput = document.getElementById("objFileInput");

const methodSelect = document.getElementById("methodSelect");

const strengthSlider = document.getElementById("strengthSlider");
const iterationSlider = document.getElementById("iterationSlider");
const featureAngleSlider = document.getElementById("featureAngleSlider");

const radialSlider = document.getElementById("radialSlider");
const verticalSlider = document.getElementById("verticalSlider");

const wireframeToggle = document.getElementById("wireframeToggle");

const strengthValue = document.getElementById("strengthValue");
const iterationValue = document.getElementById("iterationValue");
const featureAngleValue = document.getElementById("featureAngleValue");
const radialValue = document.getElementById("radialValue");
const verticalValue = document.getElementById("verticalValue");

const applyBtn = document.getElementById("applyBtn");
const optimizeBtn = document.getElementById("optimizeBtn");
const resetBtn = document.getElementById("resetBtn");
const exportObjBtn = document.getElementById("exportObjBtn");
const exportGlbBtn = document.getElementById("exportGlbBtn");

const statusEl = document.getElementById("status");

const featureControls = document.getElementById("featureControls");
const optimizationControls = document.getElementById("optimizationControls");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

const camera = new THREE.PerspectiveCamera(
  50,
  viewer.clientWidth / viewer.clientHeight,
  0.01,
  1000
);
camera.position.set(0, 0.5, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.2);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 4);
scene.add(dirLight);

const grid = new THREE.GridHelper(8, 40, 0x334155, 0x1e293b);
grid.position.y = -1.0;
scene.add(grid);

let originalGeometry = null;
let processedGeometry = null;
let previewMesh = null;
let previewWireframe = null;

const previewGroup = new THREE.Group();
scene.add(previewGroup);

function setStatus(message) {
  statusEl.textContent = `Status: ${String(message).replace(/\n/g, " ")}`;
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);

  if (previewMesh) {
    framePreviewMesh(previewMesh);
  }
});

function normalizeMethod(value) {
  const method = String(value || "").trim().toLowerCase();

  if (method === "laplacian" || method === "laplace") {
    return "laplacian";
  }

  if (method === "taubin") {
    return "taubin";
  }

  if (
    method === "feature" ||
    method === "feature-preserving" ||
    method === "feature preserving" ||
    method === "feature_preserving"
  ) {
    return "feature";
  }

  return "";
}

function updateRangeLabels() {
  if (strengthValue && strengthSlider) {
    strengthValue.textContent = Number(strengthSlider.value).toFixed(2);
  }

  if (iterationValue && iterationSlider) {
    iterationValue.textContent = iterationSlider.value;
  }

  if (featureAngleValue && featureAngleSlider) {
    featureAngleValue.textContent = featureAngleSlider.value;
  }

  if (radialValue && radialSlider) {
    radialValue.textContent = radialSlider.value;
  }

  if (verticalValue && verticalSlider) {
    verticalValue.textContent = verticalSlider.value;
  }
}

function updateParameterVisibility() {
  const method = normalizeMethod(methodSelect?.value);

  if (featureControls) {
    featureControls.style.display = method === "feature" ? "block" : "none";
  }

  if (optimizationControls) {
    optimizationControls.style.display = "block";
  }
}

strengthSlider?.addEventListener("input", updateRangeLabels);
iterationSlider?.addEventListener("input", updateRangeLabels);
featureAngleSlider?.addEventListener("input", updateRangeLabels);
radialSlider?.addEventListener("input", updateRangeLabels);
verticalSlider?.addEventListener("input", updateRangeLabels);

methodSelect?.addEventListener("change", updateParameterVisibility);

wireframeToggle?.addEventListener("change", () => {
  if (previewWireframe) {
    previewWireframe.visible = !!wireframeToggle.checked;
  }
});

updateRangeLabels();
updateParameterVisibility();

function disposeObject3D(object) {
  if (!object) return;

  object.traverse?.((child) => {
    if (child.geometry) {
      child.geometry.dispose?.();
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((m) => m.dispose?.());
    } else {
      child.material?.dispose?.();
    }
  });
}

function clearPreviewMeshes() {
  if (previewMesh) {
    previewGroup.remove(previewMesh);
    disposeObject3D(previewMesh);
    previewMesh = null;
  }

  if (previewWireframe) {
    previewGroup.remove(previewWireframe);
    disposeObject3D(previewWireframe);
    previewWireframe = null;
  }
}

function convertToIndexedIfNeeded(geometry) {
  if (geometry.index) return geometry;

  const pos = geometry.attributes.position;
  const map = new Map();
  const unique = [];
  const indices = [];

  for (let i = 0; i < pos.count; i++) {
    const key = [
      pos.getX(i).toFixed(6),
      pos.getY(i).toFixed(6),
      pos.getZ(i).toFixed(6),
    ].join(",");

    if (!map.has(key)) {
      map.set(key, unique.length);
      unique.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    }

    indices.push(map.get(key));
  }

  const indexed = new THREE.BufferGeometry();
  const vertices = new Float32Array(unique.flat());

  indexed.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  indexed.setIndex(indices);
  indexed.computeVertexNormals();

  return indexed;
}

function mergeGeometriesSafe(geometries) {
  if (geometries.length === 1) {
    return geometries[0];
  }

  const mergeFn =
    BufferGeometryUtils.mergeGeometries ||
    BufferGeometryUtils.mergeBufferGeometries;

  if (!mergeFn) {
    throw new Error("Geometry merge function not found in BufferGeometryUtils.");
  }

  return mergeFn(geometries, false);
}

function extractMergedGeometryFromOBJ(objText) {
  const loader = new OBJLoader();
  const object = loader.parse(objText);

  object.updateMatrixWorld(true);

  const geometries = [];

  object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;

    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    geometries.push(convertToIndexedIfNeeded(geometry));
  });

  if (geometries.length === 0) {
    throw new Error("No mesh geometry found in the OBJ file.");
  }

  const merged = mergeGeometriesSafe(geometries);
  merged.computeVertexNormals();

  return convertToIndexedIfNeeded(merged);
}

function buildVertexAdjacency(indexArray, vertexCount) {
  const neighbors = Array.from({ length: vertexCount }, () => new Set());

  for (let i = 0; i < indexArray.length; i += 3) {
    const a = indexArray[i];
    const b = indexArray[i + 1];
    const c = indexArray[i + 2];

    neighbors[a].add(b);
    neighbors[a].add(c);

    neighbors[b].add(a);
    neighbors[b].add(c);

    neighbors[c].add(a);
    neighbors[c].add(b);
  }

  return neighbors;
}

function computeFaceNormals(positions, indexArray) {
  const faceNormals = [];

  for (let i = 0; i < indexArray.length; i += 3) {
    const ia = indexArray[i];
    const ib = indexArray[i + 1];
    const ic = indexArray[i + 2];

    const ax = positions[ia * 3 + 0];
    const ay = positions[ia * 3 + 1];
    const az = positions[ia * 3 + 2];

    const bx = positions[ib * 3 + 0];
    const by = positions[ib * 3 + 1];
    const bz = positions[ib * 3 + 2];

    const cx = positions[ic * 3 + 0];
    const cy = positions[ic * 3 + 1];
    const cz = positions[ic * 3 + 2];

    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;

    const acx = cx - ax;
    const acy = cy - ay;
    const acz = cz - az;

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;

    const len = Math.hypot(nx, ny, nz) || 1.0;
    nx /= len;
    ny /= len;
    nz /= len;

    faceNormals.push([nx, ny, nz]);
  }

  return faceNormals;
}

function buildEdgeFaceMap(indexArray) {
  const edgeToFaces = new Map();

  function addEdge(a, b, faceIndex) {
    const minV = Math.min(a, b);
    const maxV = Math.max(a, b);
    const key = `${minV}_${maxV}`;

    if (!edgeToFaces.has(key)) {
      edgeToFaces.set(key, {
        verts: [minV, maxV],
        faces: [],
      });
    }

    edgeToFaces.get(key).faces.push(faceIndex);
  }

  for (let i = 0; i < indexArray.length; i += 3) {
    const faceIndex = i / 3;
    const a = indexArray[i];
    const b = indexArray[i + 1];
    const c = indexArray[i + 2];

    addEdge(a, b, faceIndex);
    addEdge(b, c, faceIndex);
    addEdge(c, a, faceIndex);
  }

  return edgeToFaces;
}

function detectFeatureVertices(geometry, angleThresholdDeg = 35) {
  const indexedGeometry = convertToIndexedIfNeeded(geometry.clone());
  const positions = indexedGeometry.attributes.position.array;
  const indexArray = indexedGeometry.index.array;
  const vertexCount = indexedGeometry.attributes.position.count;

  const faceNormals = computeFaceNormals(positions, indexArray);
  const edgeToFaces = buildEdgeFaceMap(indexArray);

  const locked = new Array(vertexCount).fill(false);
  const cosThreshold = Math.cos((angleThresholdDeg * Math.PI) / 180);

  for (const edgeData of edgeToFaces.values()) {
    const [v0, v1] = edgeData.verts;
    const attachedFaces = edgeData.faces;

    if (attachedFaces.length !== 2) {
      locked[v0] = true;
      locked[v1] = true;
      continue;
    }

    const n0 = faceNormals[attachedFaces[0]];
    const n1 = faceNormals[attachedFaces[1]];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];

    if (dot < cosThreshold) {
      locked[v0] = true;
      locked[v1] = true;
    }
  }

  return locked;
}

function smoothStep(current, neighbors, factor, lockedMask = null) {
  const vertexCount = current.length / 3;
  const next = new Float32Array(current);

  for (let i = 0; i < vertexCount; i++) {
    if (lockedMask && lockedMask[i]) continue;

    const nbs = [...neighbors[i]];
    if (nbs.length === 0) continue;

    let avgX = 0;
    let avgY = 0;
    let avgZ = 0;

    for (const j of nbs) {
      avgX += current[j * 3 + 0];
      avgY += current[j * 3 + 1];
      avgZ += current[j * 3 + 2];
    }

    avgX /= nbs.length;
    avgY /= nbs.length;
    avgZ /= nbs.length;

    const px = current[i * 3 + 0];
    const py = current[i * 3 + 1];
    const pz = current[i * 3 + 2];

    next[i * 3 + 0] = px + factor * (avgX - px);
    next[i * 3 + 1] = py + factor * (avgY - py);
    next[i * 3 + 2] = pz + factor * (avgZ - pz);
  }

  return next;
}

function laplacianSmooth(geometry, lambda = 0.2, iterations = 5) {
  const indexedGeometry = convertToIndexedIfNeeded(geometry.clone());
  const posAttr = indexedGeometry.getAttribute("position");
  const indexArray = indexedGeometry.index.array;
  const vertexCount = posAttr.count;

  const neighbors = buildVertexAdjacency(indexArray, vertexCount);
  let current = new Float32Array(posAttr.array);

  for (let iter = 0; iter < iterations; iter++) {
    current = smoothStep(current, neighbors, lambda);
  }

  posAttr.array.set(current);
  posAttr.needsUpdate = true;
  indexedGeometry.computeVertexNormals();

  return indexedGeometry;
}

function taubinSmooth(geometry, lambda = 0.2, iterations = 5) {
  const indexedGeometry = convertToIndexedIfNeeded(geometry.clone());
  const posAttr = indexedGeometry.getAttribute("position");
  const indexArray = indexedGeometry.index.array;
  const vertexCount = posAttr.count;

  const neighbors = buildVertexAdjacency(indexArray, vertexCount);
  let current = new Float32Array(posAttr.array);

  const mu = -0.53 * lambda;

  for (let iter = 0; iter < iterations; iter++) {
    current = smoothStep(current, neighbors, lambda);
    current = smoothStep(current, neighbors, mu);
  }

  posAttr.array.set(current);
  posAttr.needsUpdate = true;
  indexedGeometry.computeVertexNormals();

  return indexedGeometry;
}

function featurePreservingSmooth(
  geometry,
  lambda = 0.2,
  iterations = 5,
  angleThresholdDeg = 35
) {
  const indexedGeometry = convertToIndexedIfNeeded(geometry.clone());
  const posAttr = indexedGeometry.getAttribute("position");
  const indexArray = indexedGeometry.index.array;
  const vertexCount = posAttr.count;

  const neighbors = buildVertexAdjacency(indexArray, vertexCount);
  const lockedMask = detectFeatureVertices(indexedGeometry, angleThresholdDeg);

  let current = new Float32Array(posAttr.array);
  const mu = -0.53 * lambda;

  for (let iter = 0; iter < iterations; iter++) {
    current = smoothStep(current, neighbors, lambda, lockedMask);
    current = smoothStep(current, neighbors, mu, lockedMask);
  }

  posAttr.array.set(current);
  posAttr.needsUpdate = true;
  indexedGeometry.computeVertexNormals();

  return indexedGeometry;
}

function optimizeProfiledCylinder(
  geometry,
  radialSegments = 32,
  verticalSlices = 24
) {
  const indexedGeometry = convertToIndexedIfNeeded(geometry.clone());
  indexedGeometry.computeBoundingBox();

  const box = indexedGeometry.boundingBox.clone();
  const center = box.getCenter(new THREE.Vector3());

  const minY = box.min.y;
  const maxY = box.max.y;
  const height = Math.max(maxY - minY, 1e-6);
  const sliceThickness = height / Math.max(1, verticalSlices);

  const positions = indexedGeometry.attributes.position.array;
  const slicePoints = [];

  slicePoints.push(new THREE.Vector2(0, minY - center.y));

  for (let s = 0; s <= verticalSlices; s++) {
    const currentY = minY + s * sliceThickness;
    const layerRadii = [];

    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i + 0];
      const py = positions[i + 1];
      const pz = positions[i + 2];

      if (Math.abs(py - currentY) <= sliceThickness * 0.75) {
        const dx = px - center.x;
        const dz = pz - center.z;
        layerRadii.push(Math.hypot(dx, dz));
      }
    }

    let sliceRadius = 0;

    if (layerRadii.length > 0) {
      layerRadii.sort((a, b) => a - b);
      const percentileIndex = Math.floor((layerRadii.length - 1) * 0.75);
      sliceRadius = layerRadii[Math.max(0, percentileIndex)];
    } else if (slicePoints.length > 0) {
      sliceRadius = slicePoints[slicePoints.length - 1].x;
    }

    slicePoints.push(new THREE.Vector2(sliceRadius, currentY - center.y));
  }

  slicePoints.push(new THREE.Vector2(0, maxY - center.y));

  const optimized = new THREE.LatheGeometry(
    slicePoints,
    Math.max(8, radialSegments)
  );

  optimized.translate(center.x, center.y, center.z);
  optimized.computeVertexNormals();

  return convertToIndexedIfNeeded(optimized);
}

function createDisplayMesh(geometry, color = 0x60a5fa) {
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.1,
    roughness: 0.65,
  });

  return new THREE.Mesh(geometry, material);
}

function createWireframeOverlay(geometry) {
  const wireGeometry = new THREE.WireframeGeometry(geometry);
  const wireMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
  });

  return new THREE.LineSegments(wireGeometry, wireMaterial);
}

function createPreviewGeometry(sourceGeometry) {
  const previewGeometry = sourceGeometry.clone();
  previewGeometry.computeBoundingBox();
  previewGeometry.center();
  previewGeometry.computeVertexNormals();
  return previewGeometry;
}

function framePreviewMesh(mesh) {
  if (!mesh) return;

  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fov = THREE.MathUtils.degToRad(camera.fov);

  let distance = (maxDim * 0.5) / Math.tan(fov / 2);
  distance *= 1.8;

  controls.target.copy(center);

  camera.position.set(
    center.x,
    center.y + maxDim * 0.25,
    center.z + distance
  );

  camera.near = Math.max(0.001, maxDim / 100);
  camera.far = Math.max(1000, maxDim * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

function rebuildPreview() {
  clearPreviewMeshes();

  const geometryToShow = processedGeometry || originalGeometry;
  if (!geometryToShow) return;

  previewGroup.position.set(0, 0, 0);

  const previewGeometry = createPreviewGeometry(geometryToShow);
  previewMesh = createDisplayMesh(previewGeometry, 0x60a5fa);
  previewMesh.name = "previewMesh";

  previewGroup.add(previewMesh);

  previewWireframe = createWireframeOverlay(previewGeometry);
  previewWireframe.visible = !!wireframeToggle?.checked;
  previewGroup.add(previewWireframe);

  framePreviewMesh(previewMesh);
}

function getWorkingGeometry() {
  if (processedGeometry) return processedGeometry.clone();
  if (originalGeometry) return originalGeometry.clone();
  return null;
}

async function loadOBJFromText(objText) {
  const mergedGeometry = extractMergedGeometryFromOBJ(objText);

  originalGeometry = convertToIndexedIfNeeded(mergedGeometry.clone());
  processedGeometry = originalGeometry.clone();

  rebuildPreview();
  setStatus("OBJ loaded. Showing current mesh only.");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = fileName;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function exportCurrentOBJ() {
  const geometryToExport = processedGeometry || originalGeometry;

  if (!geometryToExport) {
    setStatus("Load and process a mesh first.");
    return;
  }

  const tempMesh = new THREE.Mesh(
    geometryToExport.clone(),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );

  const exporter = new OBJExporter();
  const objText = exporter.parse(tempMesh);
  const blob = new Blob([objText], { type: "text/plain" });

  downloadBlob(blob, "processed_mesh.obj");

  tempMesh.geometry.dispose();
  tempMesh.material.dispose();

  setStatus("Exported current mesh as OBJ.");
}

function exportCurrentGLB() {
  const geometryToExport = processedGeometry || originalGeometry;

  if (!geometryToExport) {
    setStatus("Load and process a mesh first.");
    return;
  }

  const tempScene = new THREE.Scene();
  const tempMesh = new THREE.Mesh(
    geometryToExport.clone(),
    new THREE.MeshStandardMaterial({
      color: 0x60a5fa,
      metalness: 0.1,
      roughness: 0.65,
    })
  );

  tempScene.add(tempMesh);

  const exporter = new GLTFExporter();

  exporter.parse(
    tempScene,
    (result) => {
      const blob = new Blob([result], { type: "model/gltf-binary" });
      downloadBlob(blob, "processed_mesh.glb");

      tempMesh.geometry.dispose();
      tempMesh.material.dispose();

      setStatus("Exported current mesh as GLB.");
    },
    (error) => {
      console.error(error);
      setStatus(`GLB export failed. ${error.message || error}`);
    },
    { binary: true }
  );
}

objFileInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    setStatus("Reading OBJ file...");
    const text = await file.text();
    await loadOBJFromText(text);
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load OBJ. ${error.message}`);
  }
});

applyBtn?.addEventListener("click", () => {
  if (!originalGeometry) {
    setStatus("Please load an OBJ mesh first.");
    return;
  }

  try {
    const rawMethod = methodSelect?.value;
    const method = normalizeMethod(rawMethod);

    if (!method) {
      setStatus(`Unknown smoothing method selected: ${rawMethod}`);
      return;
    }

    const sourceGeometry = getWorkingGeometry();
    if (!sourceGeometry) {
      setStatus("No geometry available.");
      return;
    }

    const strength = Number(strengthSlider?.value ?? 0.2);
    const iterations = Number(iterationSlider?.value ?? 5);
    const featureAngle = Number(featureAngleSlider?.value ?? 35);

    setStatus(`Applying ${method} smoothing...`);

    if (method === "laplacian") {
      processedGeometry = laplacianSmooth(
        sourceGeometry,
        strength,
        iterations
      );
    } else if (method === "taubin") {
      processedGeometry = taubinSmooth(
        sourceGeometry,
        strength,
        iterations
      );
    } else if (method === "feature") {
      processedGeometry = featurePreservingSmooth(
        sourceGeometry,
        strength,
        iterations,
        featureAngle
      );
    }

    rebuildPreview();

    setStatus(
      `Smoothing complete. Method: ${method}. Strength: ${strength.toFixed(
        2
      )}. Iterations: ${iterations}. Feature angle: ${featureAngle}°.`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Smoothing failed. ${error.message}`);
  }
});

optimizeBtn?.addEventListener("click", () => {
  if (!originalGeometry) {
    setStatus("Please load an OBJ mesh first.");
    return;
  }

  try {
    const sourceGeometry = getWorkingGeometry();
    if (!sourceGeometry) {
      setStatus("No geometry available.");
      return;
    }

    const radialSegments = Number(radialSlider?.value ?? 32);
    const verticalSlices = Number(verticalSlider?.value ?? 24);

    setStatus("Applying mesh optimization...");

    processedGeometry = optimizeProfiledCylinder(
      sourceGeometry,
      radialSegments,
      verticalSlices
    );

    rebuildPreview();

    setStatus(
      `Optimization complete. Radial segments: ${radialSegments}. Vertical slices: ${verticalSlices}.`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Optimization failed. ${error.message}`);
  }
});

resetBtn?.addEventListener("click", () => {
  if (!originalGeometry) {
    setStatus("Nothing to reset yet.");
    return;
  }

  processedGeometry = originalGeometry.clone();
  rebuildPreview();
  setStatus("Processed mesh reset to original.");
});

exportObjBtn?.addEventListener("click", () => {
  try {
    exportCurrentOBJ();
  } catch (error) {
    console.error(error);
    setStatus(`OBJ export failed. ${error.message}`);
  }
});

exportGlbBtn?.addEventListener("click", () => {
  try {
    exportCurrentGLB();
  } catch (error) {
    console.error(error);
    setStatus(`GLB export failed. ${error.message}`);
  }
});