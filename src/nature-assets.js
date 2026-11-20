// Streamed vegetation. Source packs are stored as ordinary glTF assets.
export function loadNatureAssets(THREE, GLTFLoader, scene, roadXList, roadZList, oldTrees) {
  const loader = new GLTFLoader();
  const batches = [];
  const random = (seed) => {
    let x = seed | 0;
    return () => { x = (Math.imul(1664525, x) + 1013904223) | 0; return (x >>> 0) / 4294967296; };
  };
  const rand = random(20261120);
  function safeSpot(x, z) {
    return !roadXList.some(v => Math.abs(x-v)<13) &&
      !roadZList.some(v => Math.abs(z-v)<13);
  }
  function variants(root, matcher) {
    root.updateMatrixWorld(true);
    const result = [];
    root.traverse(o => {
      if (!matcher(o.name)) return;
      const box = new THREE.Box3().setFromObject(o);
      const size = box.getSize(new THREE.Vector3());
      if (size.y < 0.01) return;
      const clone = o.clone(true);
      // Preserve transforms of the Sketchfab parent hierarchy.
      const wrapper = new THREE.Group();
      o.parent.matrixWorld.decompose(wrapper.position, wrapper.quaternion, wrapper.scale);
      wrapper.add(clone);
      const normalized = new THREE.Group();
      normalized.add(wrapper);
      normalized.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(normalized);
      const sz = b.getSize(new THREE.Vector3());
      if (sz.y < 0.01) return;
      const offset = b.getCenter(new THREE.Vector3());
      normalized.position.sub(offset);
      normalized.position.y += sz.y / 2;
      result.push({model: normalized, height: sz.y});
    });
    return result;
  }
  function plant(url, matcher, locations, onReady) {
    loader.load(new URL(url, document.baseURI).href, gltf => {
      const choices = variants(gltf.scene, matcher);
      if (!choices.length) { console.warn('[Nature] No matching trees:', url); return; }
      const placed = new THREE.Group();
      locations.forEach(([x,z],i) => {
        const choice = choices[i % choices.length];
        const tree = choice.model.clone(true);
        const target = 8 + rand()*5;
        const scale = target / choice.height;
        tree.scale.setScalar(scale);
        tree.rotation.y = rand()*Math.PI*2;
        tree.position.set(x, 0.14, z);
        tree.traverse(obj => { if (obj.isMesh) {obj.castShadow = false; obj.receiveShadow = false;} });
        placed.add(tree);
      });
      scene.add(placed);
      batches.push(placed);
      onReady?.();
      console.info('[Nature] Loaded', choices.length, 'variants from', url);
    }, undefined, err => console.warn('[Nature] Model unavailable:',url,err));
  }
  const oakSpots = [];
  for (let x=-195;x<=115;x+=24) {
    for (let z=-225;z<=225;z+=25) {
      const xx=x+(rand()-.5)*13, zz=z+(rand()-.5)*13;
      if (safeSpot(xx,zz) && rand()<0.25) oakSpots.push([xx,zz]);
    }
  }
  plant('./assets/nature/oaks/scene.gltf',
    name => /^(Big|Large|Medium)_oak_tree/i.test(name) && /_LOD1$/i.test(name),
    oakSpots, () => { if (oldTrees) oldTrees.forEach(mesh => mesh.visible=false); });
  // Palm pack is optional until its zip has been uploaded and unpacked.
  const palmSpots = [];
  for(let z=-215;z<=215;z+=22) {
    if(!roadZList.some(r=>Math.abs(z-r)<13)) palmSpots.push([160,z],[189,z+5]);
  }
  // The four palm variants each consist of a bark trunk and matching leaf group.
  loader.load(new URL('./assets/nature/palms/scene.gltf', document.baseURI).href, gltf => {
    const palms = [];
    gltf.scene.updateMatrixWorld(true);
    for (let i=1;i<=4;i++) {
      const bark = gltf.scene.getObjectByName('Bark_'+i);
      const leaf = gltf.scene.getObjectByName('Leaf_'+i);
      if (!bark || !leaf) continue;
      const combined = new THREE.Group();
      for (const node of [bark,leaf]) {
        const part = node.clone(true);
        const parent = new THREE.Group();
        node.parent.matrixWorld.decompose(parent.position,parent.quaternion,parent.scale);
        parent.add(part);
        combined.add(parent);
      }
      const bounds = new THREE.Box3().setFromObject(combined);
      const height = bounds.getSize(new THREE.Vector3()).y;
      if (height < 0.01) continue;
      const center = bounds.getCenter(new THREE.Vector3());
      combined.position.sub(center);
      combined.position.y += height/2;
      palms.push({model:combined,height});
    }
    const placed = new THREE.Group();
    palmSpots.forEach(([x,z],index) => {
      if (!palms.length) return;
      const p=palms[index%palms.length];
      const tree=p.model.clone(true);
      tree.scale.setScalar((7.5+rand()*3)/p.height);
      tree.position.set(x,0.14,z);
      tree.rotation.y=rand()*Math.PI*2;
      tree.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;}});
      placed.add(tree);
    });
    scene.add(placed);
    console.info('[Nature] Loaded',palms.length,'palm variants');
  },undefined,err=>console.info('[Nature] Palm assets not uploaded yet:',err));
  return batches;
}
