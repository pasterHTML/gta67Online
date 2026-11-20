export function createVehicleAssetManager(THREE, GLTFLoader, notify = () => {}) {
  const loader = new GLTFLoader();
  const manifestUrl = new URL("../assets/cars/manifest.json", import.meta.url);
  const projectRoot = new URL("../", import.meta.url);
  const templates = new Map();
  let manifestPromise = null;
  let manifestCache = null;

  async function getManifest() {
    if (!manifestPromise) {
      manifestPromise = fetch(manifestUrl, { cache: "force-cache" }).then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить список автомобилей: HTTP " + response.status);
        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.vehicles)) throw new Error("Файл manifest.json имеет неверный формат");
        manifestCache = manifest;
        return manifest;
      });
    }
    return manifestPromise;
  }

  async function getTemplate(modelId) {
    if (templates.has(modelId)) return templates.get(modelId);
    const pending = (async () => {
      const manifest = await getManifest();
      const entry = manifest.vehicles.find((vehicle) => vehicle.id === modelId);
      if (!entry) throw new Error("Модель автомобиля отсутствует в manifest.json: " + modelId);
      const modelUrl = new URL(entry.model, projectRoot).href;
      const gltf = await loader.loadAsync(modelUrl);
      if (!gltf || !gltf.scene) throw new Error("GLTF не содержит 3D-сцену: " + modelId);
      return { entry, scene: gltf.scene };
    })();
    templates.set(modelId, pending);
    try {
      return await pending;
    } catch (error) {
      templates.delete(modelId);
      throw error;
    }
  }

  function fitModel(sourceScene, modelId) {
    const fitted = new THREE.Group();
    fitted.name = "vehicle-model-" + modelId;
    fitted.add(sourceScene.clone(true));
    fitted.updateMatrixWorld(true);

    let bounds = new THREE.Box3().setFromObject(fitted);
    let size = bounds.getSize(new THREE.Vector3());

    // A few Sketchfab exports use Z-up source coordinates. Rotate only when
    // the measured vertical extent is clearly longer than the car length.
    if (size.y > size.z * 1.3 && size.y > size.x * 1.5) {
      fitted.rotation.x = -Math.PI / 2;
      fitted.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(fitted);
      size = bounds.getSize(new THREE.Vector3());
    }

    if (!Number.isFinite(size.z) || size.z < 0.1 || size.x < 0.1 || size.y < 0.1) {
      throw new Error("Не удалось определить габариты модели " + modelId);
    }

    const targetLength = 4.5;
    const fitScale = targetLength / size.z;
    const center = bounds.getCenter(new THREE.Vector3());

    fitted.scale.setScalar(fitScale);
    fitted.position.set(
      -center.x * fitScale,
      -bounds.min.y * fitScale,
      -center.z * fitScale
    );

    fitted.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.frustumCulled = true;
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => {
          if (material && material.transparent && material.opacity >= 1) {
            material.transparent = false;
          }
        });
      }
    });

    return fitted;
  }

  function findWheelPivots(root) {
    const exactWheelName = /^(3dwheel\s+(front|rear)\s+[lr]|wheel1a_(lf|lr|rf|rr)(_|$)|wheel_(front|rear)\s+[lr](_|$)|wheel_(rf|lf|rr|lr)(_|$)|tire_(fl|fr|rl|rr)(_|$))/i;
    const candidates = [];
    root.traverse((object) => {
      const hasChildren = Array.isArray(object.children) && object.children.length > 0;
      if (!object.name || (!hasChildren && !object.isMesh)) return;
      if (!exactWheelName.test(object.name.trim())) return;
      candidates.push({
        object,
        front: /(front|_lf|_rf|_fl|_fr)/i.test(object.name),
        originalRotation: object.rotation.clone()
      });
    });
    return candidates;
  }

  async function mount(car) {
    if (!car || !car.spec || !car.spec.modelId || car.isPolice || car.isTank) return false;
    if (car.modelRoot) return true;

    try {
      const template = await getTemplate(car.spec.modelId);
      const fitted = fitModel(template.scene, car.spec.modelId);
      const wheelPivots = findWheelPivots(fitted);

      // Imported geometry is authored at real-world proportions. Reset the
      // old rarity-based scale so the physics body and visual shell stay aligned.
      car.group.scale.set(1, 1, 1);
      car.group.add(fitted);
      car.modelRoot = fitted;
      car.visualWheelPivots = wheelPivots;
      car.modelId = car.spec.modelId;
      car.modelReady = true;

      if (Array.isArray(car.baseVisualMeshes)) {
        car.baseVisualMeshes.forEach((mesh) => { if (mesh) mesh.visible = false; });
      }

      fitted.visible = true;
      return true;
    } catch (error) {
      console.warn("[LEONIDA] Не удалось загрузить модель", car.spec.modelId, error);
      if (!car._modelWarningShown) {
        car._modelWarningShown = true;
        notify("Не загрузилась модель " + car.spec.clsName + ". Используется резервная машина.", "rgba(239,68,68,.95)");
      }
      return false;
    }
  }

  function update(cars, referencePosition, activeCar = null) {
    if (!referencePosition || !Array.isArray(cars)) return;
    const highDetailDistanceSq = 72 * 72;

    for (const car of cars) {
      if (!car || !car.modelRoot) continue;
      const useDetailedModel = car === activeCar ||
        car.group.position.distanceToSquared(referencePosition) <= highDetailDistanceSq;

      if (car.modelRoot.visible !== useDetailedModel) {
        car.modelRoot.visible = useDetailedModel;
        if (Array.isArray(car.baseVisualMeshes)) {
          car.baseVisualMeshes.forEach((mesh) => { if (mesh) mesh.visible = !useDetailedModel; });
        }
      }
    }
  }

  function spinWheels(car, distanceTravelled, steerAngle = 0) {
    if (!car || !Array.isArray(car.visualWheelPivots) || !car.visualWheelPivots.length) return;
    const spin = distanceTravelled * 2.8;
    for (const wheel of car.visualWheelPivots) {
      if (!wheel.object || !wheel.object.parent) continue;
      wheel.object.rotation.x = wheel.originalRotation.x - spin;
      if (wheel.front) wheel.object.rotation.y = wheel.originalRotation.y + steerAngle;
    }
  }

  return {
    getManifest,
    mount,
    update,
    spinWheels,
    get manifest() { return manifestCache; }
  };
}
