import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

const viewer = document.getElementById("viewer");
const objFileInput = document.getElementById("objFileInput");
const methodSelect = document.getElementById("methodSelect");
const strengthSlider = document.getElementById("strengthSlider");
const iterationSlider = document.getElementById("iterationSlider");
const featureAngleSlider = document.getElementById("featureAngleSlider");

const strengthValue = document.getElementById("strengthValue");
const iterationValue = document.getElementById("iterationValue");
const featureAngleValue = document.getElementById("featureAngleValue");

const applyBtn = document.getElementById("applyBtn");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");

strengthSlider.addEventListener("input", () => {
  strengthValue.textContent = Number(strengthSlider.value).toFixed(2);
});

iterationSlider.addEventListener("input", () => {
  iterationValue.textContent = iterationSlider.value;
});

featureAngleSlider.addEventListener("input", () => {
  featureAngleValue.textContent = featureAngleSlider.value;
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);

const camera = new THREE.PerspectiveCamera(
  50,
  viewer.clientWidth / viewer.clientHeight,
  0.01,
  1000
);
camera.position.set(0, 0.5, 2.5);

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

const grid = new THREE.GridHelper(4, 20, 0x334155, 0x1e293b);
grid.position.y = -0.75;
scene.add(grid);

let currentMesh = null;
let originalGeometry = null;

function setStatus(message) {
  statusEl.textContent = `Status: ${message}`;
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
});

function centerAndFrameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  object.position.sub(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 2.2 || 2;
  camera.position.set(0, maxDim * 0.4, distance);
  controls.target.set(0, 0, 0);
  controls.update();
}

function disposeCurrentMesh() {
  if (!currentMesh) return;

  scene.remove(currentMesh);

  currentMesh.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();

      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose?.());
      } else {
        child.material?.dispose?.();
      }
    }
  });

  currentMesh = null;
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
      // Boundary edge
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

function createDisplayMesh(geometry) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x60a5fa,
    metalness: 0.1,
    roughness: 0.65,
  });

  return new THREE.Mesh(geometry, material);
}

async function loadOBJFromText(objText) {
  const loader = new OBJLoader();
  const object = loader.parse(objText);

  let firstMeshGeometry = null;

  object.traverse((child) => {
    if (child.isMesh && !firstMeshGeometry) {
      firstMeshGeometry = child.geometry.clone();
    }
  });

  if (!firstMeshGeometry) {
    throw new Error("No mesh geometry found in the OBJ file.");
  }

  disposeCurrentMesh();

  originalGeometry = convertToIndexedIfNeeded(firstMeshGeometry.clone());
  currentMesh = createDisplayMesh(originalGeometry.clone());
  scene.add(currentMesh);
  centerAndFrameObject(currentMesh);

  setStatus("OBJ loaded successfully. Ready for smoothing.");
}

objFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    setStatus("Reading OBJ file...");
    const text = await file.text();
    await loadOBJFromText(text);
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load OBJ.\n${error.message}`);
  }
});

applyBtn.addEventListener("click", () => {
  if (!currentMesh || !originalGeometry) {
    setStatus("Please load an OBJ mesh first.");
    return;
  }

  try {
    const method = methodSelect.value;
    const strength = Number(strengthSlider.value);
    const iterations = Number(iterationSlider.value);
    const featureAngle = Number(featureAngleSlider.value);

    setStatus(`Applying ${method} smoothing...`);

    let newGeometry;

    if (method === "laplacian") {
      newGeometry = laplacianSmooth(originalGeometry, strength, iterations);
    } else if (method === "taubin") {
      newGeometry = taubinSmooth(originalGeometry, strength, iterations);
    } else if (method === "feature") {
      newGeometry = featurePreservingSmooth(
        originalGeometry,
        strength,
        iterations,
        featureAngle
      );
    } else {
      setStatus(`${method} is not enabled yet.`);
      return;
    }

    currentMesh.geometry.dispose();
    currentMesh.geometry = newGeometry;

    setStatus(
      `Smoothing complete.\nMethod: ${method}\nStrength: ${strength.toFixed(2)}\nIterations: ${iterations}\nFeature angle: ${featureAngle}°`
    );
  } catch (error) {
    console.error(error);
    setStatus(`Smoothing failed.\n${error.message}`);
  }
});

resetBtn.addEventListener("click", () => {
  if (!currentMesh || !originalGeometry) {
    setStatus("Nothing to reset yet.");
    return;
  }

  currentMesh.geometry.dispose();
  currentMesh.geometry = originalGeometry.clone();
  currentMesh.geometry.computeVertexNormals();

  setStatus("Mesh reset to original geometry.");
});