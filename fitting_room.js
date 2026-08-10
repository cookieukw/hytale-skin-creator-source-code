const equippedState = {};
const equippedRamp = {};
CATALOG_TABS.forEach(({ id }) => {
  equippedState[id] = null;
  equippedRamp[id] = null;
});
let skinTone = DEFAULT_SKIN_TONE;

let locale = localStorage.getItem("locale") || "en-US";
if (!I18N[locale]) locale = "en-US";

function t(key) {
  const b = I18N[locale] || {};
  const val = key.split(".").reduce((o, k) => (o == null ? o : o[k]), b);
  return val == null ? key : val;
}

function setLocale(code) {
  if (!I18N[code]) return;
  locale = code;
  localStorage.setItem("locale", code);
  applyStaticText();
  renderGroupRail();
  renderTabs();
  renderItemGrid();
  renderColorBar();
}
let currentCategory = CATALOG_TABS[0].id;
let currentGroup = CATALOG_TABS[0].group;
let searchQuery = "";

const TINTS = [
  0xffffff, 0xe6c875, 0xc98a3e, 0x8a5a2b, 0x5a3825, 0x2e2118, 0x333333,
  0xb5382b, 0xd4622f, 0xd8a33a, 0x7fa63c, 0x3f8f5c, 0x3aa8a0, 0x4a90e2,
  0x3b5ec2, 0x7a5cc4, 0xb45cc4, 0xd664be, 0xd45f83, 0xbcc2cb,
];

const loadedImagesCache = new Map();

const container = document.getElementById("viewport-container");
const canvas = document.getElementById("canvas3d");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  28,
  container.clientWidth / container.clientHeight,
  0.1,
  100,
);

camera.position.set(0, 4.5, 12);

const renderer = new THREE.WebGLRenderer({
  canvas: canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.target.set(0, 4.5, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambientLight);

const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.15);
dirLight1.position.set(5, 10, 7);
scene.add(dirLight1);

const playerRootGroup = new THREE.Group();
scene.add(playerRootGroup);

const playerBoneMap = new Map();
let playerModelJson = null;
let playerBaseTexture = null;

function normalizeBoneOffsets(nodes) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node) continue;
    if (node.shape && node.shape.type === "none") {
      node.shape.offset = { x: 0, y: 0, z: 0 };
    }
    if (node.children && Array.isArray(node.children)) {
      normalizeBoneOffsets(node.children);
    }
  }
}

function applyGradientLUT(baseImg, lutImg) {
  const out = document.createElement("canvas");
  out.width = baseImg.width;
  out.height = baseImg.height;
  const ctx = out.getContext("2d");
  ctx.drawImage(baseImg, 0, 0);

  if (lutImg) {
    const lc = document.createElement("canvas");
    lc.width = lutImg.width;
    lc.height = 1;
    lc.getContext("2d").drawImage(lutImg, 0, 0);
    const ramp = lc.getContext("2d").getImageData(0, 0, lutImg.width, 1).data;
    const last = lutImg.width - 1;

    const image = ctx.getImageData(0, 0, out.width, out.height);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const r = px[i];

      if (r !== px[i + 1] || r !== px[i + 2]) continue;
      const j = Math.min(last, r) * 4;
      px[i] = ramp[j];
      px[i + 1] = ramp[j + 1];
      px[i + 2] = ramp[j + 2];
    }
    ctx.putImageData(image, 0, 0);
  }

  const tex = new THREE.Texture(out);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (loadedImagesCache.has(url)) {
    return Promise.resolve(loadedImagesCache.get(url));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      loadedImagesCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error("falhou: " + url));
    img.src = url;
  });
}

const LAYER_ORDER = {
  faces: 1,
  ears: 1,
  eyebrows: 2,
  eyes: 2,
  mouths: 2,
  hair: 3,
  faceAccessory: 5,
  earAccessory: 5,
  head: 6,

  underwear: 1,
  undertops: 2,
  overtops: 3,
  gloves: 3,

  pants: 2,
  overpants: 3,
  shoes: 4,

  capes: 6,
};

function rampsFor(item) {
  return (item && GRADIENT_SETS[item.gradientSet]) || [];
}

function buildPlayerRigNode(nodeData, parentShapeOffset = null) {
  const group = new THREE.Group();
  group.name = nodeData.name || "node";

  playerBoneMap.set(nodeData.name, group);

  const pos = nodeData.position || { x: 0, y: 0, z: 0 };
  let posX = pos.x;
  let posY = pos.y;
  let posZ = pos.z;

  if (parentShapeOffset) {
    posX += parentShapeOffset.x;
    posY += parentShapeOffset.y;
    posZ += parentShapeOffset.z;
  }

  group.position.set(posX / 16, posY / 16, posZ / 16);

  const q = nodeData.orientation || { x: 0, y: 0, z: 0, w: 1 };
  group.quaternion.set(q.x, q.y, q.z, q.w);

  let currentShapeOffset = null;
  if (nodeData.shape && nodeData.shape.type !== "none") {
    const size = nodeData.shape.settings.size || { x: 1, y: 1, z: 1 };
    const stretch = nodeData.shape.stretch || { x: 1, y: 1, z: 1 };
    const offset = nodeData.shape.offset || { x: 0, y: 0, z: 0 };

    currentShapeOffset = offset;
    group.currentShapeOffset = offset;

    const width = Math.abs(size.x) / 16;
    const height = Math.abs(size.y) / 16;
    const depth = (size.z != null ? Math.abs(size.z) : 0) / 16;
    if (isNaN(width) || isNaN(height) || isNaN(depth)) {
      console.warn("[BASE] Geometria NaN em:", nodeData.name, {
        width,
        height,
        depth,
        size,
      });
    }
    const boxGeo = new THREE.BoxGeometry(width, height, depth);

    applyCustomUVs(
      boxGeo,
      nodeData.shape.textureLayout,
      size,
      playerBaseTexture.image ? playerBaseTexture.image.width : 128,
      playerBaseTexture.image ? playerBaseTexture.image.height : 128,
    );

    const boxMat = new THREE.MeshStandardMaterial({
      map: playerBaseTexture,
      roughness: 0.8,
      metalness: 0.1,
      alphaTest: 0.5,
      side: nodeData.shape.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(boxGeo, boxMat);
    mesh.position.set(offset.x / 16, offset.y / 16, offset.z / 16);
    mesh.scale.set(stretch.x, stretch.y, stretch.z);
    group.add(mesh);
  }

  if (nodeData.children && Array.isArray(nodeData.children)) {
    nodeData.children.forEach((childData) => {
      group.add(buildPlayerRigNode(childData, currentShapeOffset));
    });
  }

  return group;
}

function removeCategoryCosmetic(category) {
  if (equippedState[category] && equippedState[category].nodeGroups) {
    equippedState[category].nodeGroups.forEach((nodeGroup) => {
      if (nodeGroup.parent) {
        nodeGroup.parent.remove(nodeGroup);
      }
    });
  }
  equippedState[category] = null;
}

function attachCosmeticModel(category, layers, itemModel, itemTex, baseImg) {
  removeCategoryCosmetic(category);

  layers = layers.filter((l) => l && l.modelJson && l.modelJson.nodes);
  if (!layers.length) return;

  const nodeGroups = [];
  let texture = null;
  let depthBias = 0;

  function buildCosmeticNode(
    nodeData,
    rootOffset = null,
    isRoot = false,
    parentShapeOffset = null,
  ) {
    const group = new THREE.Group();
    group.name = nodeData.name || "node";

    const pos = nodeData.position || { x: 0, y: 0, z: 0 };
    let posX = isRoot ? (rootOffset ? rootOffset.x : 0) : pos.x;
    let posY = isRoot ? (rootOffset ? rootOffset.y : 0) : pos.y;
    let posZ = isRoot ? (rootOffset ? rootOffset.z : 0) : pos.z;

    if (!isRoot && parentShapeOffset) {
      posX += parentShapeOffset.x;
      posY += parentShapeOffset.y;
      posZ += parentShapeOffset.z;
    }

    group.position.set(posX / 16, posY / 16, posZ / 16);

    if (!isRoot) {
      const q = nodeData.orientation || { x: 0, y: 0, z: 0, w: 1 };
      group.quaternion.set(q.x, q.y, q.z, q.w);
    }

    let currentShapeOffset = null;

    if (nodeData.shape && nodeData.shape.type !== "none") {
      const size = nodeData.shape.settings.size || { x: 1, y: 1, z: 1 };
      const stretch = nodeData.shape.stretch || { x: 1, y: 1, z: 1 };
      const offset = nodeData.shape.offset || { x: 0, y: 0, z: 0 };
      currentShapeOffset = offset;

      const width = Math.abs(size.x) / 16;
      const height = Math.abs(size.y) / 16;
      const depth = (size.z ? Math.abs(size.z) : 0.1) / 16;

      if (isNaN(width) || isNaN(height) || isNaN(depth)) {
        console.warn(
          "[COSMETIC]",
          category,
          "Geometria NaN em:",
          nodeData.name,
          { width, height, depth, size },
        );
      }

      let geo;
      const isQuad = nodeData.shape.type === "quad";
      if (isQuad) {
        geo = new THREE.PlaneGeometry(width, height);

        const normal =
          (nodeData.shape.settings && nodeData.shape.settings.normal) || "+Z";
        switch (normal) {
          case "-Z":
            geo.rotateY(Math.PI);
            break;
          case "+X":
            geo.rotateY(Math.PI / 2);
            break;
          case "-X":
            geo.rotateY(-Math.PI / 2);
            break;
          case "+Y":
            geo.rotateX(-Math.PI / 2);
            break;
          case "-Y":
            geo.rotateX(Math.PI / 2);
            break;
        }
      } else {
        geo = new THREE.BoxGeometry(width, height, depth);
      }

      applyCustomUVs(
        geo,
        nodeData.shape.textureLayout,
        size,
        texture.image ? texture.image.width : 128,
        texture.image ? texture.image.height : 128,
      );

      const boxMat = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
        alphaTest: 0.5,
        side: nodeData.shape.doubleSided ? THREE.DoubleSide : THREE.FrontSide,

        polygonOffset: depthBias !== 0,
        polygonOffsetFactor: 0,
        polygonOffsetUnits: -depthBias * 4,
      });

      const mesh = new THREE.Mesh(geo, boxMat);
      mesh.position.set(offset.x / 16, offset.y / 16, offset.z / 16);
      mesh.scale.set(stretch.x, stretch.y, stretch.z);
      group.add(mesh);
    }

    if (nodeData.children && Array.isArray(nodeData.children)) {
      nodeData.children.forEach((childData) => {
        if (attachAsPiece(childData)) return;
        group.add(
          buildCosmeticNode(childData, null, false, currentShapeOffset),
        );
      });
    }

    return group;
  }

  function attachAsPiece(nodeData) {
    const isPiece =
      nodeData.shape &&
      nodeData.shape.settings &&
      nodeData.shape.settings.isPiece === true;
    const bone = isPiece && playerBoneMap.get(nodeData.name);
    if (!bone) return false;

    const g = buildCosmeticNode(
      nodeData,
      bone.currentShapeOffset || null,
      true,
    );
    bone.add(g);
    nodeGroups.push(g);
    return true;
  }

  layers.forEach(({ modelJson, texture: layerTexture }, i) => {
    texture = layerTexture;

    depthBias = (LAYER_ORDER[category] || 1) + i;
    normalizeBoneOffsets(modelJson.nodes);

    modelJson.nodes.forEach((cosmeticNode) => {
      if (attachAsPiece(cosmeticNode)) return;

      const targetBone =
        playerBoneMap.get(cosmeticNode.name) ||
        playerBoneMap.get("Head") ||
        playerRootGroup;

      const nodeGroup = buildCosmeticNode(
        cosmeticNode,
        targetBone.currentShapeOffset || null,
        true,
      );
      targetBone.add(nodeGroup);
      nodeGroups.push(nodeGroup);
    });
  });

  equippedState[category] = {
    nodeGroups: nodeGroups,
    itemModel: itemModel,
    itemTex: itemTex,
    baseImg: baseImg,
  };
}

function faceUVCorners(lay, w, h, texW, texH, flipDiagonal) {
  const ox = lay.offset.x;
  const oy = lay.offset.y;
  const mx = lay.mirror && lay.mirror.x ? -1 : 1;
  const my = lay.mirror && lay.mirror.y ? -1 : 1;

  let u1, v1, u2, v2;
  switch (lay.angle) {
    case 90:
      u1 = ox;
      v1 = oy + w * mx;
      u2 = ox + h * -my;
      v2 = oy;
      break;
    case 270:
      u1 = ox + h * my;
      v1 = oy;
      u2 = ox;
      v2 = oy + w * -mx;
      break;
    case 180:
      u1 = ox + w * -mx;
      v1 = oy + h * -my;
      u2 = ox;
      v2 = oy;
      break;
    default:
      u1 = ox;
      v1 = oy;
      u2 = ox + w * mx;
      v2 = oy + h * my;
      break;
  }

  if (flipDiagonal) {
    let t = u1;
    u1 = u2;
    u2 = t;
    t = v1;
    v1 = v2;
    v2 = t;
  }

  let U1 = u1 / texW;
  let V1 = 1.0 - v1 / texH;
  let U2 = u2 / texW;
  let V2 = 1.0 - v2 / texH;

  const eU = 0.02 / texW;
  const eV = 0.02 / texH;
  const dU = U1 < U2 ? eU : -eU;
  const dV = V1 < V2 ? eV : -eV;
  U1 += dU;
  U2 -= dU;
  V1 += dV;
  V2 -= dV;

  const c = [
    { u: U1, v: V1 },
    { u: U2, v: V1 },
    { u: U1, v: V2 },
    { u: U2, v: V2 },
  ];

  switch (lay.angle) {
    case 90:
      return [c[2], c[0], c[3], c[1]];
    case 180:
      return [c[3], c[2], c[1], c[0]];
    case 270:
      return [c[1], c[3], c[0], c[2]];
    default:
      return c;
  }
}

function applyCustomUVs(geometry, layout, size, texW, texH) {
  const uvAttr = geometry.attributes.uv;

  if (geometry.type === "PlaneGeometry" || uvAttr.count === 4) {
    const lay = layout
      ? layout.front ||
        layout.back ||
        layout.top ||
        layout.bottom ||
        Object.values(layout)[0]
      : null;
    if (!lay) return;

    const p = faceUVCorners(lay, size.x, size.y, texW, texH, false);
    geometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(
        new Float32Array([
          p[0].u,
          p[0].v,
          p[1].u,
          p[1].v,
          p[2].u,
          p[2].v,
          p[3].u,
          p[3].v,
        ]),
        2,
      ),
    );
    geometry.uvsNeedUpdate = true;
    return;
  }

  const faceKeys = ["right", "left", "top", "bottom", "front", "back"];
  const uvCoords = new Float32Array(uvAttr.count * 2);

  for (let f = 0; f < 6; f++) {
    const face = faceKeys[f];
    const lay = layout ? layout[face] : null;
    const startIdx = f * 4;
    if (!lay) continue;

    let w = size.x;
    let h = size.y;
    if (face === "left" || face === "right") w = size.z;
    else if (face === "top" || face === "bottom") h = size.z;

    const p = faceUVCorners(lay, w, h, texW, texH, face === "bottom");
    for (let k = 0; k < 4; k++) {
      uvCoords[(startIdx + k) * 2] = p[k].u;
      uvCoords[(startIdx + k) * 2 + 1] = p[k].v;
    }
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvCoords, 2));
  geometry.uvsNeedUpdate = true;
}

function loadPlayerBase() {
  return Promise.all([
    fetch("Assets/Common/Characters/Player_With_Face.blockymodel").then((r) =>
      r.json(),
    ),
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.src = "Assets/Common/Characters/Player_Textures/Player_Greyscale.png";
    }),
  ])
    .then(([modelJson, img]) => {
      const tone = (GRADIENT_SETS.Skin || []).find((r) => r.name === skinTone);
      return loadImage(tone && tone.tex).then((lut) => {
        playerBaseTexture = applyGradientLUT(img, lut);
        playerModelJson = modelJson;
        return modelJson;
      });
    })
    .then((modelJson) => {
      while (playerRootGroup.children.length > 0) {
        playerRootGroup.remove(playerRootGroup.children[0]);
      }
      playerBoneMap.clear();

      normalizeBoneOffsets(modelJson.nodes);

      modelJson.nodes.forEach((rootNode) => {
        playerRootGroup.add(buildPlayerRigNode(rootNode));
      });

      focusCamera("body");

      const vestido = Object.entries(equippedState)
        .filter(([, v]) => v && v.item)
        .map(([cat, v]) => [cat, v.item]);
      vestido.forEach(([cat]) => (equippedState[cat] = null));
      return Promise.all(vestido.map(([cat, item]) => equipItem(cat, item)));
    })
    .catch((err) => {
      console.error("Falha ao carregar o modelo base:", err);
    });
}

function equipItem(category, item) {
  if (!item || !item.model || !item.tex) {
    removeCategoryCosmetic(category);
    equippedRamp[category] = null;

    if (category === "head" && equippedState.hair && equippedState.hair.item) {
      equipItem("hair", equippedState.hair.item);
    } else if (
      category === "faceAccessory" &&
      equippedState.eyebrows &&
      equippedState.eyebrows.item
    ) {
      equipItem("eyebrows", equippedState.eyebrows.item);
    } else {
      renderItemGrid();
      renderColorBar();
    }
    return Promise.resolve();
  }

  const headItem = equippedState.head && equippedState.head.item;
  const isFullyCovered =
    headItem &&
    (headItem.headType === "FullyCovering" ||
      headItem.disablePart === "Haircut");
  const isHalfCovered = headItem && headItem.headType === "HalfCovering";

  if (category === "hair" && isFullyCovered) {
    removeCategoryCosmetic("hair");
    equippedState.hair = {
      nodeGroups: [],
      itemModel: item.model,
      itemTex: item.tex,
      baseImg: null,
      itemId: item.id,
      item: item,
    };
    renderItemGrid();
    renderColorBar();
    return Promise.resolve();
  }

  const faceAcc =
    equippedState.faceAccessory && equippedState.faceAccessory.item;
  if (
    category === "eyebrows" &&
    faceAcc &&
    faceAcc.disablePart === "Eyebrows"
  ) {
    removeCategoryCosmetic("eyebrows");
    equippedState.eyebrows = {
      nodeGroups: [],
      itemModel: item.model,
      itemTex: item.tex,
      baseImg: null,
      itemId: item.id,
      item: item,
    };
    renderItemGrid();
    renderColorBar();
    return Promise.resolve();
  }

  const ramps = rampsFor(item);
  const chosen =
    ramps.find((r) => r.name === equippedRamp[category]) ||
    (item.gradientSet === "Skin"
      ? ramps.find((r) => r.name === skinTone)
      : null) ||
    ramps[0] ||
    null;

  let modelItem = item;
  let baseItem =
    item.baseHair && HAIRCUT_FALLBACKS[item.baseHair]
      ? (CATALOG[category] || []).find(
          (i) => i.id === HAIRCUT_FALLBACKS[item.baseHair],
        )
      : null;

  if (category === "hair" && isHalfCovered) {
    const genericFallbackId =
      HAIRCUT_FALLBACKS[item.hairType || item.baseHair] ||
      (item.hairType ? "Generic" + item.hairType : "GenericShort");
    const fallbackItem = (CATALOG.hair || []).find(
      (i) => i.id === genericFallbackId,
    );
    if (fallbackItem) {
      modelItem = fallbackItem;
      baseItem = null;
    }
  }

  return Promise.all([
    fetch(modelItem.model).then((r) => r.json()),
    loadImage(modelItem.tex),
    loadImage(chosen && chosen.tex),
    baseItem ? fetch(baseItem.model).then((r) => r.json()) : null,
    baseItem ? loadImage(baseItem.tex) : null,
  ])
    .then(([modelJson, img, lut, baseJson, baseImg2]) => {
      const tex = applyGradientLUT(img, lut);
      const layers = [];
      if (baseJson) {
        layers.push({
          modelJson: baseJson,
          texture: applyGradientLUT(baseImg2, lut),
        });
      }
      layers.push({ modelJson, texture: tex });

      attachCosmeticModel(category, layers, item.model, item.tex, img);
      if (equippedState[category]) {
        equippedState[category].itemId = item.id;
        equippedState[category].item = item;
      }
      equippedRamp[category] = chosen ? chosen.name : null;

      if (
        category === "head" &&
        equippedState.hair &&
        equippedState.hair.item
      ) {
        equipItem("hair", equippedState.hair.item);
      } else if (
        category === "faceAccessory" &&
        equippedState.eyebrows &&
        equippedState.eyebrows.item
      ) {
        equipItem("eyebrows", equippedState.eyebrows.item);
      } else {
        renderItemGrid();
        renderColorBar();
      }
    })
    .catch((err) => {
      console.error("Falha ao carregar cosmético:", item.name, err);
    });
}

const iconFor = (entry, selected) =>
  `ui/icons/${entry.icon}${selected ? "Selected" : ""}@2x.png`;

const labelOf = (entry) => {
  const traduzido = (I18N[locale] || {}).tabs || {};
  return traduzido[entry.langKey] || entry.label;
};

const tabsOfGroup = (group) =>
  CATALOG_TABS.filter(
    (t) => t.group === group && (CATALOG[t.id] || []).length > 1,
  );

function renderGroupRail() {
  const rail = document.getElementById("group-rail");
  rail.innerHTML = "";
  CATALOG_GROUPS.forEach((group) => {
    if (!tabsOfGroup(group.id).length) return;

    const active = group.id === currentGroup;
    const btn = document.createElement("button");
    btn.className = "rail-btn" + (active ? " active" : "");
    btn.dataset.group = group.id;
    btn.title = labelOf(group);
    btn.innerHTML = `<img src="${iconFor(group, active)}" alt="${labelOf(group)}" />`;
    btn.onclick = () => switchGroup(group.id);
    rail.appendChild(btn);
  });
}

function renderTabs() {
  const bar = document.getElementById("tab-bar");
  bar.innerHTML = "";
  tabsOfGroup(currentGroup).forEach((tab) => {
    const count = (CATALOG[tab.id] || []).length - 1;
    const active = tab.id === currentCategory;
    const btn = document.createElement("button");
    btn.className = "rail-btn" + (active ? " active" : "");
    btn.dataset.category = tab.id;
    btn.title = `${labelOf(tab)} (${count})`;
    btn.innerHTML = `
      <img src="${iconFor(tab, active)}" alt="${labelOf(tab)}" />
      <span class="tab-count">${count}</span>
    `;
    btn.onclick = () => switchCategory(tab.id);
    bar.appendChild(btn);
  });
}

function switchGroup(group) {
  currentGroup = group;
  const tabs = tabsOfGroup(group);
  if (tabs.length) currentCategory = tabs[0].id;
  renderGroupRail();
  renderTabs();
  renderItemGrid();
  renderColorBar();
}

function switchCategory(cat) {
  currentCategory = cat;
  renderTabs();
  renderItemGrid();
  renderColorBar();
}

function renderBreadcrumb() {
  const tab = CATALOG_TABS.find((t) => t.id === currentCategory);
  const group = CATALOG_GROUPS.find((g) => g.id === currentGroup);
  document.getElementById("breadcrumb").innerHTML =
    `${group ? labelOf(group) : ""}<span class="sep">▸</span>` +
    `${tab ? labelOf(tab) : currentCategory}`;
}

function renderItemGrid() {
  renderBreadcrumb();

  const grid = document.getElementById("item-grid");
  grid.innerHTML = "";

  const q = searchQuery.trim().toLowerCase();
  const equipped = equippedState[currentCategory];

  (CATALOG[currentCategory] || []).forEach((item) => {
    if (q && item.model && !item.name.toLowerCase().includes(q)) return;

    const isEquipped =
      item.model &&
      equipped &&
      equipped.itemModel === item.model &&
      equipped.itemTex === item.tex;

    const card = document.createElement("div");
    card.className =
      "item-card" +
      (isEquipped ? " equipped" : "") +
      (item.model ? "" : " none-card");
    card.title = item.model ? item.name : t("none");
    card.innerHTML = `<div class="item-name">${item.model ? item.name : "✕"}</div>`;
    card.onclick = () => equipItem(currentCategory, item);
    grid.appendChild(card);
  });
}

function renderColorBar() {
  const bar = document.getElementById("color-bar");
  bar.innerHTML = "";

  const eq = equippedState[currentCategory];
  const ramps = rampsFor(eq && eq.item);
  const label = document.querySelector(".color-section .section-label");

  if (!ramps.length) {
    if (label) label.style.opacity = 0.35;
    return;
  }
  if (label) label.style.opacity = 1;

  const current = equippedRamp[currentCategory];
  ramps.forEach((ramp) => {
    const sw = document.createElement("div");
    sw.className = "swatch" + (ramp.name === current ? " active" : "");
    sw.style.background = ramp.baseColor || "#888";
    sw.title = ramp.name;
    sw.onclick = () => setEquippedRamp(ramp.name);
    bar.appendChild(sw);
  });
}

function setEquippedRamp(name) {
  equippedRamp[currentCategory] = name;
  const eq = equippedState[currentCategory];
  if (!eq || !eq.baseImg) return renderColorBar();

  const ramp = rampsFor(eq.item).find((r) => r.name === name);
  loadImage(ramp && ramp.tex).then((lut) => {
    const tex = applyGradientLUT(eq.baseImg, lut);
    (eq.nodeGroups || []).forEach((g) =>
      g.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.map = tex;
          child.material.needsUpdate = true;
        }
      }),
    );
    renderColorBar();
  });
}

function setSkinTone(name) {
  skinTone = name;
  loadPlayerBase();
}

function equipDefaults() {
  return Promise.all(
    Object.entries(DEFAULT_ITEMS).map(([category, id]) => {
      const item = (CATALOG[category] || []).find((i) => i.id === id);
      return item ? equipItem(category, item) : null;
    }),
  );
}

function clearAllCosmetics() {
  Object.keys(equippedState).forEach((cat) => {
    removeCategoryCosmetic(cat);
    equippedRamp[cat] = null;
  });
  loadPlayerBase()
    .then(equipDefaults)
    .then(() => {
      renderItemGrid();
      renderColorBar();
    });
}

const FEMALE_HAIRCUT_IDS = new Set([
  "BobCut",
  "PonyTail",
  "Bun",
  "Braid",
  "BraidDouble",
  "Rustic",
  "RoseBun",
  "SideBuns",
  "SmallPigtails",
  "Pigtails",
  "SingleSidePigtail",
  "WavyPonytail",
  "ChopsticksPonyTail",
  "Curly",
  "MessyBobcut",
  "Simple",
  "WidePonytail",
  "AfroPuffs",
  "PuffyPonytail",
  "FighterBuns",
  "SidePonytail",
  "PonyBuns",
  "ElfBackBun",
  "BraidedPonytail",
  "ThickBraid",
  "WavyBraids",
  "Witch",
  "FrizzyLong",
  "WavyLong",
  "Cat",
  "LongTied",
  "LongBangs",
  "CuteEmoBangs",
  "CutePart",
  "LongPigtails",
  "FeatheredHair",
  "LongHairPigtail",
  "StraightHairBun",
  "EmoWavy",
  "BowHair",
  "Long",
  "GenericLong",
  "GenericMedium",
  "LongCurly",
  "MorningLong",
  "MediumCurly",
  "MagicalPonytail",
  "MagicalPigtails",
  "PuffyBubbleBraids",
  "PonytailBraidedDouble",
  "PonytailBraidedLong",
  "PuffyTwinDreads",
  "FrizzyBuns",
  "StarPuffs",
  "BantuKnot",
  "Cornrows",
]);

function randomizeOutfit() {
  const isFemale = Math.random() < 0.5;

  const skinRamps = GRADIENT_SETS.Skin || [];
  if (skinRamps.length) {
    skinTone = skinRamps[Math.floor(Math.random() * skinRamps.length)].name;
  }

  const selection = {};

  CATALOG_TABS.forEach(({ id }) => {
    const items = (CATALOG[id] || []).filter((i) => i.model);
    if (!items.length) {
      selection[id] = null;
      return;
    }

    if (id === "facialHair") {
      if (isFemale || Math.random() > 0.25) {
        selection[id] = null;
        return;
      }
    } else if (id === "head" && Math.random() > 0.25) {
      selection[id] = null;
      return;
    } else if (id === "faceAccessory" && Math.random() > 0.15) {
      selection[id] = null;
      return;
    } else if (id === "earAccessory" && Math.random() > 0.2) {
      selection[id] = null;
      return;
    } else if (id === "capes" && Math.random() > 0.1) {
      selection[id] = null;
      return;
    } else if (id === "gloves" && Math.random() > 0.2) {
      selection[id] = null;
      return;
    } else if (id === "overpants" && Math.random() > 0.2) {
      selection[id] = null;
      return;
    }

    let itemPool = items;
    if (id === "hair" && isFemale) {
      const femalePool = items.filter((i) => FEMALE_HAIRCUT_IDS.has(i.id));
      if (femalePool.length) itemPool = femalePool;
    }

    const chosenItem = itemPool[Math.floor(Math.random() * itemPool.length)];
    selection[id] = chosenItem;

    const ramps = rampsFor(chosenItem);
    if (ramps.length) {
      equippedRamp[id] = ramps[Math.floor(Math.random() * ramps.length)].name;
    }
  });

  loadPlayerBase()
    .then(() =>
      Promise.all(
        Object.entries(selection).map(([cat, item]) => equipItem(cat, item)),
      ),
    )
    .then(() => {
      renderItemGrid();
      renderColorBar();
    });
}

function buildSkinJSON() {
  const out = { bodyCharacteristic: "Default." + skinTone };
  CATALOG_TABS.forEach(({ id, gameKey }) => {
    const eq = equippedState[id];
    if (!eq || !eq.itemId) {
      out[gameKey] = null;
      return;
    }
    const ramp = equippedRamp[id];
    out[gameKey] = ramp ? `${eq.itemId}.${ramp}` : eq.itemId;
  });
  return out;
}

function copySkinJSON() {
  const json = JSON.stringify(buildSkinJSON(), null, 2);
  navigator.clipboard
    .writeText(json)
    .then(() => console.log("JSON da skin copiado:\n" + json))
    .catch(() => console.log(json));
}

function loadSkinJSON(data) {
  if (typeof data === "string") data = JSON.parse(data);

  const missing = [];
  const escolhidos = [];

  CATALOG_TABS.forEach(({ id, gameKey }) => {
    const raw = data[gameKey];
    if (!raw) {
      equippedRamp[id] = null;
      return;
    }
    const [wantedId, variant] = String(raw).split(".");
    const item = (CATALOG[id] || []).find((i) => i.id === wantedId);
    if (!item) {
      missing.push(`${gameKey} = ${raw}`);
      return;
    }
    const ramp = rampsFor(item).find((r) => r.name === variant);
    if (variant && !ramp)
      missing.push(`${gameKey} = ${raw} (cor "${variant}")`);
    equippedRamp[id] = ramp ? ramp.name : null;
    escolhidos.push([id, item]);
  });

  const bc = String(data.bodyCharacteristic || "");
  if (bc.includes(".")) skinTone = bc.split(".")[1];

  Object.keys(equippedState).forEach(removeCategoryCosmetic);

  const pronto = loadPlayerBase()
    .then(() =>
      Promise.all(escolhidos.map(([cat, item]) => equipItem(cat, item))),
    )
    .then(() => {
      renderItemGrid();
      renderColorBar();
    });

  if (missing.length) console.warn("Não encontrados:", missing);
  return { missing, pronto };
}

function frameObject(object3d, padding = 1.18) {
  if (!object3d) return;

  const box = new THREE.Box3().setFromObject(object3d);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;
  const fitHeight = size.y / 2 / Math.tan(halfFov);
  const fitWidth = size.x / 2 / (Math.tan(halfFov) * camera.aspect);
  const distance = Math.max(fitHeight, fitWidth) * padding + size.z / 2;

  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, distance);

  camera.near = Math.max(0.01, distance / 200);
  camera.far = distance * 20;
  camera.updateProjectionMatrix();

  controls.minDistance = size.y * 0.12;
  controls.maxDistance = distance * 3;
  controls.update();
}

function focusCamera(target) {
  frameObject(
    target === "head" ? playerBoneMap.get("Head") : playerRootGroup,
    target === "head" ? 1.5 : 1.18,
  );
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

function applyStaticText() {
  const set = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  set("panel-title", t("title"));
  set("color-label", t("color"));
  set("reset-btn", t("reset"));
  set("import-btn", t("import"));
  set("copy-btn", t("copy"));
  set("disclaimer-text", t("disclaimer"));
  document.getElementById("search-input").placeholder = t("search");
  document.getElementById("cam-head-btn").title = t("cameraHead");
  document.getElementById("cam-body-btn").title = t("cameraBody");
  document.getElementById("random-btn").title = t("randomize");
  document.documentElement.lang = locale;
}

const seletorIdioma = document.getElementById("locale-select");
I18N_LOCALES.forEach(({ code, label }) => {
  const opt = document.createElement("option");
  opt.value = code;
  opt.textContent = label;
  opt.selected = code === locale;
  seletorIdioma.appendChild(opt);
});
seletorIdioma.addEventListener("change", (e) => setLocale(e.target.value));

document.getElementById("search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderItemGrid();
});

document.getElementById("import-btn").addEventListener("click", () => {
  const texto = prompt(t("importPrompt"));
  if (!texto) return;
  try {
    const { missing } = loadSkinJSON(texto);
    if (missing.length) {
      alert(t("importMissing") + missing.join("\n"));
    }
  } catch (err) {
    alert(t("importBad") + err.message);
  }
});

applyStaticText();
loadPlayerBase().then(equipDefaults);
renderGroupRail();
renderTabs();
renderItemGrid();
renderColorBar();
animate();
