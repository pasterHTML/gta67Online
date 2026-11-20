export function createVehicleAssetManager(THREE, GLTFLoader, notify = () => {}, onProgress = () => {}) {
  const manager = new THREE.LoadingManager();
  const loader = new GLTFLoader(manager);
  const manifestUrl = new URL("../assets/cars/manifest.json", import.meta.url);
  const projectRoot = new URL("../", import.meta.url);
  const farTemplates = new Map();
  const nearTemplates = new Map();
  const farStates = new Map();
  const nearStates = new Map();
  let manifestPromise = null;
  let manifestCache = null;
  let expectedModels = 6; // five far models + first nearby high-detail model
  let loadedFiles = 0;
  let totalFiles = 0;
  let lastProgress = null;

  function publishProgress(extra = {}) {
    const allStates = [...farStates.values(), ...nearStates.values()];
    const loadedModels = allStates.filter((state) => state === "loaded").length;
    const failedModels = allStates.filter((state) => state === "failed").length;
    const completedModels = loadedModels + failedModels;
    const currentModel =
      [...farStates.entries()].find(([, state]) => state === "loading")?.[0] ||
      [...nearStates.entries()].find(([, state]) => state === "loading")?.[0] ||
      null;
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
        expectedModels = manifest.vehicles.length + 1;
        publishProgress({ detail: "Найдено моделей: " + manifest.vehicles.length });
        return manifest;
      });
    }
    return manifestPromise;
  }

  async function getVehicleEntry(modelId) {
    const manifest = await getManifest();
    const entry = manifest.vehicles.find((vehicle) => vehicle.id === modelId);
    if (!entry) throw new Error("Модель автомобиля отсутствует в manifest.json: " + modelId);
    return entry;
  }

  async function getFarTemplate(modelId) {
    if (farTemplates.has(modelId)) return farTemplates.get(modelId);
    farStates.set(modelId, "loading");
    publishProgress({ detail: "Загрузка дальнего LOD: " + modelId });

    const pending = (async () => {
      const entry = await getVehicleEntry(modelId);
      const selectedPath = entry.farOptimizedModel || entry.optimizedModel || entry.model;
      const modelUrl = new URL(selectedPath, projectRoot).href;
      const gltf = await loader.loadAsync(modelUrl);
      if (!gltf || !gltf.scene) throw new Error("GLB не содержит 3D-сцену: " + modelId);
      return { entry, scene: gltf.scene };
    })();

    farTemplates.set(modelId, pending);
    try {
      const result = await pending;
      farStates.set(modelId, "loaded");
      publishProgress({ detail: "Готово: дальняя модель " + result.entry.name });
      return result;
    } catch (error) {
      farTemplates.delete(modelId);
      farStates.set(modelId, "failed");
      publishProgress({ detail: "Ошибка дальнего LOD: " + modelId, warning: error?.message || String(error) });
      throw error;
    }
  }

  async function getNearTemplate(modelId) {
    if (nearTemplates.has(modelId)) return nearTemplates.get(modelId);
    nearStates.set(modelId, "loading");
    publishProgress({ detail: "Загрузка детальной модели: " + modelId });

    const pending = (async () => {
      const entry = await getVehicleEntry(modelId);
      const selectedPath = entry.optimizedModel || entry.model;
      const modelUrl = new URL(selectedPath, projectRoot).href;
      const gltf = await loader.loadAsync(modelUrl);
      if (!gltf || !gltf.scene) throw new Error("GLB не содержит 3D-сцену: " + modelId);
      return { entry, scene: gltf.scene };
    })();

    nearTemplates.set(modelId, pending);
    try {
      const result = await pending;
      nearStates.set(modelId, "loaded");
      publishProgress({ detail: "Готово: детальная модель " + result.entry.name });
      return result;
    } catch (error) {
      nearTemplates.delete(modelId);
      nearStates.set(modelId, "failed");
      publishProgress({ detail: "Ошибка детальной модели: " + modelId, warning: error?.message || String(error) });
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

    // Some exports have their long car axis on Y instead of Z.
    if (size.y > size.z * 1.25 && size.y > size.x * 1.25) {
      fitted.rotation.x = -Math.PI / 2;
      fitted.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(fitted);
      size = bounds.getSize(new THREE.Vector3());
    }

    if (!Number.isFinite(size.z) || size.z < 0.1 || size.x < 0.1 || size.y < 0.1) {
      throw new Error("Не удалось определить габариты модели " + modelId);
    }

    // The game drives toward -Z; the source vehicle exports face +Z.
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
    });

    return fitted;
  }

  function findWheelPivots(root) {
    const wheelName = /^(3dwheel\s+(front|rear)\s+[lr]|wheel1a_(lf|lr|rf|rr)(_|$)|wheel_(front|rear)\s+[lr](_|$)|wheel_(rf|lf|rr|lr)(_|$)|wheel_(fl|fr|rl|rr)(_|$)|wheels?_(front|rear)|wheel_(front|rear))/i;
    const pivots = [];
    root.traverse((object) => {
      const hasChildren = Array.isArray(object.children) && object.children.length > 0;
      if (!object.name || (!hasChildren && !object.isMesh) || !wheelName.test(object.name.trim())) return;
      pivots.push({
        object,
        front: /(front|_lf|_rf|_fl|_fr)/i.test(object.name),
        originalRotation: object.rotation.clone()
      });
    });
    return pivots;
  }

  function loadNear(car) {
    if (!car || car.modelRoot || car._nearLoading || !car.spec?.modelId ||
        nearStates.get(car.spec.modelId) === "failed") return;
    car._nearLoading = true;

    getNearTemplate(car.spec.modelId).then((template) => {
      if (car.modelRoot) return;
      const fitted = fitModel(template.scene, car.spec.modelId + "-near");
      const pivots = findWheelPivots(fitted);
      car.group.add(fitted);
      car.modelRoot = fitted;
      car.visualWheelPivots = pivots;
      fitted.visible = true;
      if (car.farModelRoot) car.farModelRoot.visible = false;
    }).catch((error) => {
      console.warn("[LEONIDA] Не удалось загрузить детальную модель", car.spec.modelId, error);
      if (!car._nearWarningShown) {
        car._nearWarningShown = true;
        notify("Не загрузилась детальная модель " + car.spec.clsName + ". Оставлена облегчённая версия.", "rgba(249,115,22,.95)");
      }
    }).finally(() => {
      car._nearLoading = false;
    });
  }

  async function mount(car) {
    if (!car || !car.spec || !car.spec.modelId || car.isTank) return false;
    if (car.farModelRoot || car.modelRoot) return true;

    try {
      const template = await getFarTemplate(car.spec.modelId);
      const farFitted = fitModel(template.scene, car.spec.modelId + "-far");
      const farPivots = findWheelPivots(farFitted);

      car.group.scale.set(1, 1, 1);
      car.group.add(farFitted);
      car.farModelRoot = farFitted;
      car.farVisualWheelPivots = farPivots;
      car.modelId = car.spec.modelId;
      car.modelReady = true;
      farFitted.visible = true;

      if (Array.isArray(car.baseVisualMeshes)) {
        car.baseVisualMeshes.forEach((mesh) => { if (mesh) mesh.visible = false; });
      }
      return true;
    } catch (error) {
      console.warn("[LEONIDA] Не удалось загрузить дальнюю модель", car.spec.modelId, error);
      if (!car._modelWarningShown) {
        car._modelWarningShown = true;
        notify("Не загрузилась модель " + car.spec.clsName + ". Используется резервная машина.", "rgba(239,68,68,.95)");
      }
      return false;
    }
  }

  function update(cars, referencePosition = null, activeCar = null) {
    if (!Array.isArray(cars)) return;
    const nearDistanceSq = 58 * 58;

    for (const car of cars) {
      if (!car || !car.farModelRoot) continue;
      const distanceSq = referencePosition
        ? car.group.position.distanceToSquared(referencePosition)
        : 0;
      const needsNear = car === activeCar || !referencePosition || distanceSq <= nearDistanceSq;

      if (needsNear && !car.modelRoot) loadNear(car);

      if (car.modelRoot) car.modelRoot.visible = needsNear;
      car.farModelRoot.visible = !needsNear || !car.modelRoot;

      if (Array.isArray(car.baseVisualMeshes)) {
        car.baseVisualMeshes.forEach((mesh) => { if (mesh) mesh.visible = false; });
      }
    }
  }

  function spinWheelSet(wheels, distanceTravelled, steerAngle) {
    if (!Array.isArray(wheels) || !wheels.length) return;
    const spin = distanceTravelled * 2.8;
    for (const wheel of wheels) {
      if (!wheel.object || !wheel.object.parent) continue;
      wheel.object.rotation.x = wheel.originalRotation.x - spin;
      if (wheel.front) wheel.object.rotation.y = wheel.originalRotation.y + steerAngle;
    }
  }

  function spinWheels(car, distanceTravelled, steerAngle = 0) {
    if (!car) return;
    spinWheelSet(car.visualWheelPivots, distanceTravelled, steerAngle);
    spinWheelSet(car.farVisualWheelPivots, distanceTravelled, steerAngle);
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
