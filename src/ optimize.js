export function optimizeGeometry(geometry) {
  const g = geometry.clone();

  // -----------------------------------------
  // Put your current smoothing logic here.
  // Example:
  // applyLaplacianSmoothing(g, iterations, strength);
  // applyTaubinSmoothing(g, iterations, lambda, mu);
  // -----------------------------------------

  g.computeVertexNormals();
  return g;
}