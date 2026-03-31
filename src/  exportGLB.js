import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function downloadGLB(object3D, fileName = 'optimized-textured.glb') {
  const exporter = new GLTFExporter();

  exporter.parse(
    object3D,
    (result) => {
      const blob = new Blob([result], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();

      URL.revokeObjectURL(url);
    },
    (error) => {
      console.error('GLB export failed:', error);
    },
    { binary: true }
  );
}