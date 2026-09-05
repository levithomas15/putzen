import * as THREE from 'three';

/**
 * Vorläufiger Aufbau — dient nur der Überprüfung der Renderpipeline.
 * Wird in Schritt 3 durch die echte Terrasse ersetzt.
 */
export async function buildLevel(stage) {
  const scene = stage.scene;
  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x6b6257, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(10, 3, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x8a5a48, roughness: 0.8 }),
  );
  wall.position.set(0, 1.5, -5);
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);

  for (let i = 0; i < 5; i++) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xaab2b8, roughness: 0.4, metalness: 0.3 }),
    );
    box.position.set(-3 + i * 1.5, 0.4, -1.5);
    box.rotation.y = i * 0.4;
    box.castShadow = box.receiveShadow = true;
    group.add(box);
  }

  scene.add(group);

  return {
    group,
    center: new THREE.Vector3(0, 0, -2),
    shadowRadius: 12,
    cleanables: [],
  };
}
