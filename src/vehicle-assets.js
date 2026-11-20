export function createVehicleAssetManager(THREE, GLTFLoader, notify = () => {}, onProgress = () => {}) {
  const manager = new THREE.LoadingManager();
  const loader = new GLTFLoader(manager);
  const manifestUrl = new URL("../assets/cars/manifest.json", import.meta.url);
  const projectRoot = new URL("../", import.meta.url);
  const templates = new Map();
  const modelStates = new Map();
  let manifestPromise = null;
  let manifestCache = null;
  let expectedModels = 5;
  let loadedFiles = 0;
  let totalFiles = 0;
  let lastProgress = null;

  function publishProgress(extra = {}) {
    const loadedModels = [...modelStates.values()].filter((s) => s === "loaded").length;
    const failedModels = [...modelStates.values()].filter((s) => s === "failed").length;
    const completedModels = loadedModels + failedModels;
    const currentModel = [...modelStates.entries()].find(([, state]) => state === "loading")?.[0] || null;
    const fileFraction = totalFiles > 0 ? Math.min(0.85, loadedFiles / totalFiles) : 0;
    const rawPercent = ((completedModels + fileFraction) / Math.max(1, expectedModels)) * 100;
    const percent = completedModels >= expectedModels ? 100 : Math.min(98, Math.round(rawPercent));

    lastProgress = {
      percent,
      loadedModels,
      failedModels,
      completedModels,
      totalModels: expectedModels,
      loadedFiles,
      totalFiles,
      currentModel,
      detail: currentModel ? "Загрузка: " + currentModel : "Подготовка моделей автомобилей",
      done: completedModels >= expectedModels,
      ...extra
    };
    onProgress(lastProgress);
  }

  manager.onStart = (url, itemsLoaded, itemsTotal) => {
    loadedFiles = itemsLoaded;
    totalFiles = itemsTotal;
    publishProgress({ detail: "Загружаются модели и текстуры" });
  };
  manager.onProgress = (url, itemsLoaded, itemsTotal) => {
    loadedFiles = itemsLoaded;
    totalFiles = itemsTotal;
    publishProgress({ detail: "Загружаются модели и текстуры" });
  };
  manager.onError = (url) => {
    console.warn("[LEONIDA] Не удалось загрузить ресурс модели:", url);
    publishProgress({ warning: "Один из файлов модели не загрузился" });
  };
  manager.onLoad = () => {
    loadedFiles = totalFiles;
    publishProgress({ detail: "Файлы загружены, завершаем подготовку" });
  };

  async function getManifest() {
    if (!manifestPromise) {
      publishProgress({ detail: "Получаем список автомобилей" });
      manifestPromise = fetch(manifestUrl, { cache: "no-cache" }).then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить список автомобилей: HTTP " + response.status);
        const manifest = await response.json();
        if (!manifest || !Array.isArray(manifest.vehicles)) throw new Error("Файл manifest.json имеет неверный формат");
        manifestCache = manifest;
        expectedModels = manifest.vehicles.length || 5;
        publishProgress({ detail: "Найдено моделей: " + expectedModels });
        return manifest;
      });
    }
    return manifestPromise;
  }

  async function getTemplate(modelId) {
    if (templates.has(modelId)) return templates.get(modelId);

    modelStates.set(modelId, "loading");
    publishProgress({ detail: "Загрузка: " + modelId });

    const pending = (async () => {
      const manifest = await getManifest();
      const entry = manifest.vehicles.find((vehicle) => vehicle.id === modelId);
      if (!entry) throw new Error("Модель автомобиля отсутствует в manifest.json: " + modelId);

      const selectedPath = entry.optimizedModel || entry.model;
      const modelUrl = new URL(selectedPath, projectRoot).href;
      const gltf = await loader.loadAsync(modelUrl);
      if (!gltf || !gltf.scene) throw new Error("GLTF не содержит 3D-сцену: " + modelId);
      return { entry, scene: gltf.scene };
    })();

    templates.set(modelId, pending);
    try {
      const result = await pending;
      modelStates.set(modelId, "loaded");
      publishProgress({ detail: "Готово: " + result.entry.name });
      return result;
    } catch (error) {
      templates.delete(modelId);
      modelStates.set(modelId, "failed");
      publishProgress({ detail: "Ошибка загрузки: " + modelId, warning: error?.message || String(error) });
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

    // Some Sketchfab exports have their long car axis on Y instead of Z.
    // Rotate those scenes into the game's Y-up / Z-forward coordinate system.
    if (size.y > size.z * 1.25 && size.y > size.x * 1.25) {
      fitted.rotation.x = -Math.PI / 2;
      fitted.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(fitted);
      size = bounds.getSize(new THREE.Vector3());
    }

    if (!Number.isFinite(size.z) || size.z < 0.1 || size.x < 0.1 || size.y < 0.1) {
      throw new Error("Не удалось определить габариты модели " + modelId);
    }

    // The game's forward vector is -Z. The supplied vehicle exports face +Z.
    fitted.rotation.y += Math.PI;
    fitted.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(fitted);
    size = bounds.getSize(new THREE.Vector3());

    const targetLength = 5.05;
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
      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = true;
      object.matrixAutoUpdate = true;
    });

    return fitted;
  }

  function findWheelPivots(root) {
    const exactWheelName = /^(3dwheel\s+(front|rear)\s+[lr]|wheel1a_(lf|lr|rf|rr)(_|$)|wheel_(front|rear)\s+[lr](_|$)|wheel_(rf|lf|rr|lr)(_|$)|wheel_(fl|fr|rl|rr)(_|$)|wheels?_(front|rear)|wheel_(front|rear))/i;
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
    if (!car || !car.spec || !car.spec.modelId || car.isTank) return false;
    if (car.modelRoot) return true;

    try {
      const template = await getTemplate(car.spec.modelId);
      const fitted = fitModel(template.scene, car.spec.modelId);
      const wheelPivots = findWheelPivots(fitted);

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

  function update(cars) {
    if (!Array.isArray(cars)) return;
    for (const car of cars) {
      if (!car || !car.modelRoot) continue;
      if (!car.modelRoot.visible) car.modelRoot.visible = true;
      if (Array.isArray(car.baseVisualMeshes)) {
        car.baseVisualMeshes.forEach((mesh) => { if (mesh) mesh.visible = false; });
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
    get manifest() { return manifestCache; },
    get progress() { return lastProgress; }
  };
}
