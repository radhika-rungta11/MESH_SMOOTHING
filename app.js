import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { transferUVsFromSourceMesh } from "./uvTransfer.js";

const viewer = document.getElementById("viewer");
const objFileInput = document.getElementById("objFileInput");
const textureFileInput = document.getElementById("textureFileInput");

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

let uploadedTexture = null;
let uploadedTextureURL = null;
let uploadedTextureName = "";

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

function disposeTexture(texture) {
  if (!texture) return;
  texture.dispose?.();
}

function disposeObject3D(object) {
  if (!object) return;

  object.traverse?.((child) => {
    if (child.geometry) {
      child.geometry.dispose?.();
    }

    if (Array.isArray(child.material)) {
      child.material.forEach((m) => {
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      });
    } else if (child.material) {
      if (child.material.map) child.material.map.dispose?.();
      child.material.dispose?.();
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

function geometryHasUVs(geometry) {
  return !!geometry?.attributes?.uv && geometry.attributes.uv.count > 0;
}

function geometryHasNormals(geometry) {
  return !!geometry?.attributes?.normal && geometry.attributes.normal.count > 0;
}

function convertToIndexedIfNeeded(geometry) {
  if (geometry.index) return geometry;

  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const normal = geometry.getAttribute("normal");

  const uniquePositions = [];
  const uniqueUVs = [];
  const uniqueNormals = [];
  const indices = [];
  const map = new Map();

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);

    const ux = uv ? uv.getX(i) : null;
    const uy = uv ? uv.getY(i) : null;

    const nx = normal ? normal.getX(i) : null;
    const ny = normal ? normal.getY(i) : null;
    const nz = normal ? normal.getZ(i) : null;

    const key = [
      px.toFixed(6),
      py.toFixed(6),
      pz.toFixed(6),
      ux !== null ? ux.toFixed(6) : "nou",
      uy !== null ? uy.toFixed(6) : "nov",
      nx !== null ? nx.toFixed(6) : "nonx",
      ny !== null ? ny.toFixed(6) : "nony",
      nz !== null ? nz.toFixed(6) : "nonz",
    ].join(",");

    if (!map.has(key)) {
      map.set(key, uniquePositions.length / 3);

      uniquePositions.push(px, py, pz);

      if (uv) {
        uniqueUVs.push(ux, uy);
      }

      if (normal) {
        uniqueNormals.push(nx, ny, nz);
      }
    }

    indices.push(map.get(key));
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(uniquePositions), 3)
  );

  if (uv && uniqueUVs.length > 0) {
    indexed.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(uniqueUVs), 2)
    );
  }

  if (normal && uniqueNormals.length > 0) {
    indexed.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(uniqueNormals), 3)
    );
  }

  indexed.setIndex(indices);

  if (!geometryHasNormals(indexed)) {
    indexed.computeVertexNormals();
  }

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

    const indexed = convertToIndexedIfNeeded(geometry);
    geometries.push(indexed);
  });

  if (geometries.length === 0) {
    throw new Error("No mesh geometry found in the OBJ file.");
  }

  const merged = mergeGeometriesSafe(geometries);

  if (!geometryHasNormals(merged)) {
    merged.computeVertexNormals();
  }

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

function generateCylindricalUVs(geometry) {
  const result = geometry.clone();
  result.computeBoundingBox();

  const box = result.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const minY = box.min.y;
  const maxY = box.max.y;
  const height = Math.max(maxY - minY, 1e-6);

  const pos = result.getAttribute("position");
  const uvArray = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - center.x;
    const y = pos.getY(i);
    const z = pos.getZ(i) - center.z;

    let u = Math.atan2(z, x) / (Math.PI * 2);
    if (u < 0) u += 1;

    const v = (y - minY) / height;

    uvArray[i * 2 + 0] = u;
    uvArray[i * 2 + 1] = THREE.MathUtils.clamp(v, 0, 1);
  }

  result.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));
  return result;
}

function ensureTextureReadyGeometry(geometry) {
  let output = convertToIndexedIfNeeded(geometry.clone());

  if (!geometryHasUVs(output)) {
    output = generateCylindricalUVs(output);
  }

  if (!geometryHasNormals(output)) {
    output.computeVertexNormals();
  }

  return output;
}

function getSourceTextureGeometry() {
  if (!originalGeometry) return null;

  let source = convertToIndexedIfNeeded(originalGeometry.clone());

  if (!geometryHasUVs(source)) {
    source = generateCylindricalUVs(source);
  }

  if (!geometryHasNormals(source)) {
    source.computeVertexNormals();
  }

  return source;
}

function transferTextureUVsToGeometry(targetGeometry) {
  if (!targetGeometry) return null;

  const target = convertToIndexedIfNeeded(targetGeometry.clone());
  const source = getSourceTextureGeometry();

  if (!source) {
    return ensureTextureReadyGeometry(target);
  }

  try {
    const sourceMaterial = new THREE.MeshBasicMaterial();
    const targetMaterial = new THREE.MeshBasicMaterial();

    const sourceMesh = new THREE.Mesh(source, sourceMaterial);
    const targetMesh = new THREE.Mesh(target, targetMaterial);

    const transferred = transferUVsFromSourceMesh({
      sourceMesh,
      targetMesh,
      debug: false,
    });

    sourceMaterial.dispose();
    targetMaterial.dispose();

    let output = transferred;

    if (!geometryHasNormals(output)) {
      output.computeVertexNormals();
    }

    return convertToIndexedIfNeeded(output);
  } catch (error) {
    console.warn("UV transfer failed. Falling back to generated UVs.", error);
    return ensureTextureReadyGeometry(target);
  }
}

function buildTexturedGeometryForDisplay(targetGeometry) {
  if (!targetGeometry) return null;

  const base = convertToIndexedIfNeeded(targetGeometry.clone());

  if (!uploadedTexture) {
    if (!geometryHasNormals(base)) {
      base.computeVertexNormals();
    }
    return base;
  }

  // If the geometry already has UVs (e.g. optimized cylinder or unwrapped mesh),
  // keep those UVs instead of trying to re‑project from the original mesh.
  if (geometryHasUVs(base)) {
    if (!geometryHasNormals(base)) {
      base.computeVertexNormals();
    }
    return base;
  }

  // Only fall back to UV transfer / cylindrical generation when UVs are missing.
  return transferTextureUVsToGeometry(base);
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

  // Build a clean, cylindrical UV layout directly on the optimized can mesh
  // so that textures wrap evenly around the surface.
  const indexedOptimized = convertToIndexedIfNeeded(optimized);
  const uvOptimized = generateCylindricalUVs(indexedOptimized);

  if (!geometryHasNormals(uvOptimized)) {
    uvOptimized.computeVertexNormals();
  }

  return uvOptimized;
}

function createDisplayMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: uploadedTexture ? 0xffffff : 0x60a5fa,
    metalness: 0.1,
    roughness: 0.65,
    map: uploadedTexture || null,
  });

  if (uploadedTexture) {
    material.needsUpdate = true;
  }

  return material;
}

function createDisplayMesh(geometry) {
  return new THREE.Mesh(geometry, createDisplayMaterial());
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
  let previewGeometry = buildTexturedGeometryForDisplay(sourceGeometry);

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
  previewMesh = createDisplayMesh(previewGeometry);
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

  if (geometryHasUVs(originalGeometry)) {
    setStatus("OBJ loaded. Source UVs detected. Texture transfer is ready.");
  } else {
    setStatus("OBJ loaded. No source UVs found. Fallback cylindrical UVs will be used.");
  }
}

async function loadTextureFromFile(file) {
  if (!file) return;

  if (uploadedTextureURL) {
    URL.revokeObjectURL(uploadedTextureURL);
    uploadedTextureURL = null;
  }

  disposeTexture(uploadedTexture);
  uploadedTexture = null;

  const objectURL = URL.createObjectURL(file);
  uploadedTextureURL = objectURL;
  uploadedTextureName = file.name;

  const loader = new THREE.TextureLoader();
  const texture = await loader.loadAsync(objectURL);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  uploadedTexture = texture;

  rebuildPreview();

  if (originalGeometry && geometryHasUVs(originalGeometry)) {
    setStatus(`Texture loaded: ${uploadedTextureName}. Preview updated with UV transfer.`);
  } else {
    setStatus(`Texture loaded: ${uploadedTextureName}. Preview updated with fallback UVs.`);
  }
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

  const exportGeometry = uploadedTexture
    ? buildTexturedGeometryForDisplay(geometryToExport)
    : geometryToExport.clone();

  const tempMesh = new THREE.Mesh(
    exportGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );

  const exporter = new OBJExporter();
  const objText = exporter.parse(tempMesh);
  const blob = new Blob([objText], { type: "text/plain" });

  downloadBlob(blob, "processed_mesh.obj");

  tempMesh.geometry.dispose();
  tempMesh.material.dispose();

  if (uploadedTexture) {
    setStatus("OBJ exported. Geometry includes transferred UVs, but texture image is not packed into OBJ.");
  } else {
    setStatus("Exported current mesh as OBJ.");
  }
}

function exportCurrentGLB() {
  const geometryToExport = processedGeometry || originalGeometry;

  if (!geometryToExport) {
    setStatus("Load and process a mesh first.");
    return;
  }

  const exportGeometry = uploadedTexture
    ? buildTexturedGeometryForDisplay(geometryToExport)
    : geometryToExport.clone();

  const tempScene = new THREE.Scene();
  const tempMesh = new THREE.Mesh(exportGeometry, createDisplayMaterial());

  tempScene.add(tempMesh);

  const exporter = new GLTFExporter();

  exporter.parse(
    tempScene,
    (result) => {
      const blob = new Blob([result], { type: "model/gltf-binary" });
      downloadBlob(blob, "processed_textured_mesh.glb");

      tempMesh.geometry.dispose();
      tempMesh.material.dispose();

      setStatus("Exported current mesh as textured GLB with transferred UVs.");
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

textureFileInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    setStatus("Loading texture image...");
    await loadTextureFromFile(file);
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load texture. ${error.message}`);
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

    if (uploadedTexture && geometryHasUVs(originalGeometry)) {
      setStatus(
        `Optimization complete with transferred source UVs. Radial segments: ${radialSegments}. Vertical slices: ${verticalSlices}.`
      );
    } else if (uploadedTexture) {
      setStatus(
        `Optimization complete with fallback UVs. Radial segments: ${radialSegments}. Vertical slices: ${verticalSlices}.`
      );
    } else {
      setStatus(
        `Optimization complete. Radial segments: ${radialSegments}. Vertical slices: ${verticalSlices}.`
      );
    }
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

window.addEventListener("beforeunload", () => {
  if (uploadedTextureURL) {
    URL.revokeObjectURL(uploadedTextureURL);
    uploadedTextureURL = null;
  }
  disposeTexture(uploadedTexture);
});