import * as THREE from 'three';
import { UVUnwrapper } from 'xatlas-three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const unwrapper = new UVUnwrapper({
  BufferAttribute: THREE.BufferAttribute,
});

let libraryReady = null;

export async function initUnwrapper() {
  if (!libraryReady) {
    unwrapper.chartOptions = {
      fixWinding: false,
      maxBoundaryLength: 0,
      maxChartArea: 0,
      maxCost: 2,
      maxIterations: 1,
      normalDeviationWeight: 2,
      normalSeamWeight: 4,
      roundnessWeight: 0.01,
      straightnessWeight: 6,
      textureSeamWeight: 0.5,
      useInputMeshUvs: false,
    };

    unwrapper.packOptions = {
      bilinear: true,
      blockAlign: false,
      bruteForce: false,
      createImage: false,
      maxChartSize: 0,
      padding: 4,
      resolution: 1024,
      rotateCharts: true,
      rotateChartsToAxis: true,
      texelsPerUnit: 0,
    };

    libraryReady = unwrapper.loadLibrary(
      (mode, progress) => {
        console.log('xatlas:', mode, progress);
      },
      'https://cdn.jsdelivr.net/npm/xatlasjs@0.2.0/dist/xatlas.wasm',
      'https://cdn.jsdelivr.net/npm/xatlasjs@0.2.0/dist/xatlas.js'
    );
  }

  await libraryReady;
}

export async function unwrapGeometryForBake(geometry) {
  await initUnwrapper();

  const indexed = geometry.index ? geometry.clone() : mergeVertices(geometry);
  await unwrapper.unwrap(indexed);

  indexed.computeVertexNormals();
  return indexed;
}