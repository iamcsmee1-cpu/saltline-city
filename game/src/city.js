// Saltline City — the procedural city: street grid, tower blocks with lit
// windows, neon signs, a park, the beachfront, the marina pier and boats.
// Everything is generated from a fixed seed, so the city is identical on
// every load and in every screenshot. Also owns collision + sight helpers.

import * as THREE from 'three';
import {
  STREETS, ROAD_HALF, WORLD_EDGE, BEACH_Z, WATER_Z, MARINA_X, MARINA_END_Z,
  PALETTE, rng, clamp,
} from './config.js';

const rand = rng(1337);

// ---------- shared canvas textures ----------

function facadeTextures() {
  // Colour map: pale facade with a grid of window recesses.
  const c = document.createElement('canvas'); c.width = 96; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#cfd4d8'; g.fillRect(0, 0, 96, 192);
  // Emissive map: black except the windows that are lit tonight.
  const e = document.createElement('canvas'); e.width = 96; e.height = 192;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 96, 192);
  const r = rng(42);
  for (let y = 8; y < 184; y += 14) {
    for (let x = 8; x < 88; x += 16) {
      const lit = r();
      g.fillStyle = lit > 0.45 ? '#778792' : '#39434c';
      g.fillRect(x, y, 10, 8);
      if (lit > 0.45) {
        ge.fillStyle = lit > 0.8 ? '#ffd9a0' : '#bfe3ff';
        ge.fillRect(x, y, 10, 8);
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  const emissiveMap = new THREE.CanvasTexture(e);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return { map, emissiveMap };
}

function signTexture(text, fg, bg = 'rgba(8,8,16,0.92)') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.font = '900 54px "Segoe UI", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = fg; g.shadowBlur = 22;
  g.fillStyle = fg;
  g.fillText(text, 256, 52);
  g.shadowBlur = 6;
  g.fillText(text, 256, 52);
  return new THREE.CanvasTexture(c);
}

function dashTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 16, 64);
  g.fillStyle = '#e8e4c8';
  g.fillRect(6, 6, 4, 30);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function foamTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 16);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let x = 0; x < 128; x += 16) g.fillRect(x, 5, 9, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 1);
  return t;
}

// ---------- collision / sight helpers (shared by every mover) ----------

// Push a circle (pos = {x,z} object with a THREE.Object3D or plain) out of
// every building AABB. Mutates the x/z passed in via the holder object.
export function resolveCircle(holder, radius, colliders) {
  for (const b of colliders) {
    const nx = clamp(holder.x, b.minX, b.maxX);
    const nz = clamp(holder.z, b.minZ, b.maxZ);
    const dx = holder.x - nx;
    const dz = holder.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      holder.x = nx + (dx / d) * radius;
      holder.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = holder.x - b.minX, right = b.maxX - holder.x;
      const top = holder.z - b.minZ, bottom = b.maxZ - holder.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) holder.x = b.minX - radius;
      else if (m === right) holder.x = b.maxX + radius;
      else if (m === top) holder.z = b.minZ - radius;
      else holder.z = b.maxZ + radius;
    }
  }
}

// Is the straight line between two ground points blocked by a tall building?
export function sightBlocked(ax, az, bx, bz, colliders) {
  const dist = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.floor(dist / 3));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const b of colliders) {
      if (b.h > 4 && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
  }
  return false;
}

export function isOnRoad(x, z) {
  for (const s of STREETS) if (Math.abs(x - s) < ROAD_HALF + 1) return true;
  for (const s of STREETS) if (Math.abs(z - s) < ROAD_HALF + 1) return true;
  return false;
}

// ---------- the city ----------

export class City {
  constructor(scene) {
    this.colliders = [];
    this.boats = [];
    this.neonSigns = [];
    this.lampHeads = [];
    const { map, emissiveMap } = facadeTextures();
    this.facade = { map, emissiveMap };

    this.#ground(scene);
    this.#blocks(scene);
    this.#landmarks(scene);
    this.#beachAndMarina(scene);
    this.#streetFurniture(scene);
  }

  #addCollider(x, z, w, d, h) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h });
  }

  #ground(scene) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 760),
      new THREE.MeshLambertMaterial({ color: PALETTE.asphalt }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 40);
    ground.receiveShadow = true;
    scene.add(ground);

    // Centre dashes on every street.
    const dash = dashTexture();
    const dashMat = new THREE.MeshBasicMaterial({ map: dash, transparent: true, depthWrite: false });
    for (const s of STREETS) {
      const mk = (rot) => {
        const tex = dash.clone();
        tex.needsUpdate = true;
        tex.repeat.set(1, 26);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 384), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = rot;
        m.position.y = 0.06;
        return m;
      };
      const v = mk(0); v.position.x = s; v.position.z = 0; scene.add(v);
      const h = mk(Math.PI / 2); h.position.z = s; h.position.x = 0; scene.add(h);
      void dashMat;
    }
  }

  #building(scene, x, z, w, d, h, tint) {
    const tex = this.facade.map.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, Math.round(w / 14)), Math.max(1, Math.round(h / 16)));
    const emi = this.facade.emissiveMap.clone();
    emi.needsUpdate = true;
    emi.repeat.copy(tex.repeat);
    const mat = new THREE.MeshLambertMaterial({
      color: tint, map: tex, emissiveMap: emi, emissive: 0xffc98a, emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2 + 0.3, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Rooftop slab + the occasional water tank / AC box for silhouette.
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.96, 0.7, d * 0.96),
      new THREE.MeshLambertMaterial({ color: 0x555b63 }),
    );
    roof.position.set(x, h + 0.6, z);
    scene.add(roof);
    if (rand() > 0.55) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.3, 1.8 + rand() * 2, d * 0.3),
        new THREE.MeshLambertMaterial({ color: 0x6a7076 }),
      );
      box.position.set(x + (rand() - 0.5) * w * 0.4, h + 1.6, z + (rand() - 0.5) * d * 0.4);
      scene.add(box);
    }
    this.#addCollider(x, z, w, d, h);
    return mat;
  }

  #sign(scene, text, color, x, y, z, ry, w = 15) {
    const tex = signTexture(text, color);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.1875), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    scene.add(mesh);
    this.neonSigns.push(mat);
    return mesh;
  }

  #blocks(scene) {
    const slabMat = new THREE.MeshLambertMaterial({ color: PALETTE.sidewalk });
    const parkMat = new THREE.MeshLambertMaterial({ color: PALETTE.grass });
    const centres = [-120, -40, 40, 120];
    for (const cx of centres) {
      for (const cz of centres) {
        const isPark = cx === -40 && cz === -120;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(72, 0.3, 72), isPark ? parkMat : slabMat);
        slab.position.set(cx, 0.15, cz);
        slab.receiveShadow = true;
        scene.add(slab);
        if (isPark) { this.#park(scene, cx, cz); continue; }

        // Taller towers toward the city centre, low-rises at the edges.
        const centrality = 1 - Math.min(1, (Math.abs(cx) + Math.abs(cz)) / 260);
        const four = rand() > 0.45;
        const lots = four
          ? [[-17, -17], [17, -17], [-17, 17], [17, 17]]
          : [[0, 0]];
        for (const [ox, oz] of lots) {
          const w = four ? 24 + rand() * 7 : 44 + rand() * 10;
          const d = four ? 24 + rand() * 7 : 44 + rand() * 10;
          const h = (10 + rand() * 22) * (0.55 + centrality * 1.15);
          const tint = PALETTE.buildingTints[Math.floor(rand() * PALETTE.buildingTints.length)];
          this.#building(scene, cx + ox, cz + oz, w, d, h, tint);
        }
        // Some blocks get a glowing sign on a random face.
        if (rand() > 0.45) {
          const words = [
            ['HOTEL AZUL', '#22d3ee'], ['CLUB TIDE', '#ff2e88'], ['NOODLE BAR', '#ffb020'],
            ['PALM HOTEL', '#7dff9a'], ['BAR LUNA', '#c084fc'], ['TIDE GYM', '#7dd3fc'],
            ['SALSA CLUB', '#ff7a59'], ['HOTEL SOL', '#ffd23e'],
          ];
          const [word, col] = words[Math.floor(rand() * words.length)];
          const face = Math.floor(rand() * 4);
          const off = 36.4;
          const px = cx + (face === 0 ? 0 : face === 1 ? off : face === 2 ? 0 : -off);
          const pz = cz + (face === 0 ? -off : face === 1 ? 0 : face === 2 ? off : 0);
          this.#sign(scene, word, col, px, 9 + rand() * 8, pz, face === 0 ? Math.PI : face === 1 ? Math.PI / 2 : face === 2 ? 0 : -Math.PI / 2, 17);
        }
      }
    }
  }

  #park(scene, cx, cz) {
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3e7d44 });
    for (let i = 0; i < 9; i++) {
      const x = cx + (rand() - 0.5) * 56;
      const z = cz + (rand() - 0.5) * 56;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 6), trunkMat);
      trunk.position.set(x, 1.7, z);
      trunk.castShadow = true;
      scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(2.6 + rand() * 1.4, 8, 6), leafMat);
      crown.position.set(x, 4.6 + rand(), z);
      crown.castShadow = true;
      scene.add(crown);
      this.#addCollider(x, z, 1, 1, 3);
    }
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(7, 20),
      new THREE.MeshLambertMaterial({ color: PALETTE.water }),
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(cx + 12, 0.34, cz - 10);
    scene.add(pond);
  }

  #landmarks(scene) {
    // Delgado's Diner — low pink block on the block NE of (80,-80).
    const dinerMat = new THREE.MeshLambertMaterial({ color: 0xf2b8c6 });
    const diner = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 18), dinerMat);
    diner.position.set(104, 3.3, -62);
    diner.castShadow = true;
    scene.add(diner);
    this.#addCollider(104, -62, 26, 18, 6);
    this.#sign(scene, "DELGADO'S", '#ff2e88', 104, 7.6, -71.2, Math.PI, 20);
    this.#sign(scene, 'DINER • OPEN LATE', '#22d3ee', 90.8, 5, -62, -Math.PI / 2, 13);

    // Saltline Customs garage, east side.
    const garage = new THREE.Mesh(
      new THREE.BoxGeometry(20, 7, 26),
      new THREE.MeshLambertMaterial({ color: 0x9fb4a8 }),
    );
    garage.position.set(178, 3.8, -30);
    garage.castShadow = true;
    scene.add(garage);
    this.#addCollider(178, -30, 20, 26, 7);
    this.#sign(scene, 'SALTLINE CUSTOMS', '#ffb020', 167.8, 6, -30, -Math.PI / 2, 16);

    // Marina warehouse, on the beachfront strip.
    const wh = new THREE.Mesh(
      new THREE.BoxGeometry(34, 10, 20),
      new THREE.MeshLambertMaterial({ color: 0x7d8a99 }),
    );
    wh.position.set(60, 5.3, 178);
    wh.castShadow = true;
    scene.add(wh);
    this.#addCollider(60, 178, 34, 20, 10);
    this.#sign(scene, 'MARINA STORAGE', '#7dd3fc', 60, 8.6, 167.8, Math.PI, 18);
  }

  #beachAndMarina(scene) {
    const sand = new THREE.Mesh(
      new THREE.PlaneGeometry(760, WATER_Z - BEACH_Z + 30),
      new THREE.MeshLambertMaterial({ color: PALETTE.sand }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, 0.12, (BEACH_Z + WATER_Z) / 2 + 6);
    sand.receiveShadow = true;
    scene.add(sand);

    const waterMat = new THREE.MeshLambertMaterial({
      color: PALETTE.water, transparent: true, opacity: 0.92,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(760, 190), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.22, WATER_Z + 92);
    scene.add(water);
    this.waterMat = waterMat;

    const foamTex = foamTexture();
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 3),
      new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false }),
    );
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.3, WATER_Z + 1);
    scene.add(foam);
    this.foamTex = foamTex;

    // The pier: deck, posts, lamp posts and moored boats.
    const deckMat = new THREE.MeshLambertMaterial({ color: 0x8a6b4a });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.8, MARINA_END_Z - 196), deckMat);
    deck.position.set(MARINA_X, 0.9, (196 + MARINA_END_Z) / 2);
    deck.receiveShadow = true;
    deck.castShadow = true;
    scene.add(deck);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5f4630 });
    for (let z = 202; z < MARINA_END_Z; z += 14) {
      for (const dx of [-5, 5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), postMat);
        post.position.set(MARINA_X + dx, 0, z);
        scene.add(post);
      }
    }
    const hullColors = [0xf5f6fa, 0xd64541, 0x2e86de, 0xffa502, 0xeccc68];
    for (let i = 0; i < 5; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const boat = this.#boat(hullColors[i % hullColors.length]);
      boat.position.set(MARINA_X + side * 11, 0.35, 214 + i * 17);
      boat.rotation.y = side > 0 ? 0.06 : -0.06 + Math.PI;
      scene.add(boat);
      this.boats.push(boat);
    }
    this.#sign(scene, 'SALTLINE MARINA', '#22d3ee', MARINA_X, 6.4, 197, Math.PI, 15);

    // A little lighthouse island + arched bridge silhouette to the east.
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 16, 2.4, 18),
      new THREE.MeshLambertMaterial({ color: 0x9a8f7a }),
    );
    island.position.set(228, 0.6, 300);
    scene.add(island);
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3, 15, 10),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }),
    );
    tower.position.set(228, 9, 300);
    scene.add(tower);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), lampMat);
    lamp.position.set(228, 17.4, 300);
    scene.add(lamp);
    this.lighthouseMat = lampMat;
    const bridgeMat = new THREE.MeshLambertMaterial({ color: 0x707880 });
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const bx = MARINA_X + 6 + (228 - MARINA_X - 6) * t;
      const bz = MARINA_END_Z - 2 + (300 - MARINA_END_Z + 2) * t;
      const by = 1.4 + Math.sin(t * Math.PI) * 4.4;
      const seg = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.7, 4.4), bridgeMat);
      seg.position.set(bx, by, bz);
      seg.rotation.y = -Math.atan2(300 - MARINA_END_Z + 2, 228 - MARINA_X - 6);
      scene.add(seg);
      if (i % 3 === 1) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, by + 1, 7), bridgeMat);
        pillar.position.set(bx, (by - 1) / 2, bz);
        scene.add(pillar);
      }
    }
  }

  #boat(color) {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.3, 9),
      new THREE.MeshLambertMaterial({ color }),
    );
    hull.position.y = 0.4;
    group.add(hull);
    const bow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 1.7, 1.3, 4),
      new THREE.MeshLambertMaterial({ color }),
    );
    bow.rotation.y = Math.PI / 4;
    bow.scale.set(1, 1, 1.6);
    bow.position.set(0, 0.4, 5.2);
    group.add(bow);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 1.2, 3),
      new THREE.MeshLambertMaterial({ color: 0xf5f6fa }),
    );
    cabin.position.set(0, 1.5, -0.6);
    group.add(cabin);
    return group;
  }

  #streetFurniture(scene) {
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3c4249 });
    const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
    for (const sx of STREETS) {
      for (const sz of STREETS) {
        for (const [ox, oz] of [[-10.5, -10.5], [10.5, 10.5]]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.4, 6), poleMat);
          pole.position.set(sx + ox, 3.2, sz + oz);
          scene.add(pole);
          const headMat = new THREE.MeshBasicMaterial({ color: 0x8a8f96 });
          const head = new THREE.Mesh(headGeo, headMat);
          head.position.set(sx + ox, 6.5, sz + oz);
          scene.add(head);
          this.lampHeads.push(headMat);
        }
      }
    }
    // Palms along the beachfront and in the park blocks.
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b4a });
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d, side: THREE.DoubleSide });
    const frondGeo = new THREE.ConeGeometry(3.1, 1.5, 7);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 6.4, 6);
    const palm = (x, z) => {
      const lean = (rand() - 0.5) * 0.16;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, 3.2, z);
      trunk.rotation.z = lean;
      trunk.castShadow = true;
      scene.add(trunk);
      const fronds = new THREE.Mesh(frondGeo, frondMat);
      fronds.position.set(x + lean * -6, 6.9, z);
      fronds.rotation.x = Math.PI;
      scene.add(fronds);
      this.#addCollider(x, z, 0.8, 0.8, 4);
    };
    for (let x = -184; x <= 184; x += 16) {
      if (Math.abs(x - MARINA_X) < 12) continue;
      palm(x + (rand() - 0.5) * 4, 189 + (rand() - 0.5) * 3);
    }
    for (let i = 0; i < 14; i++) {
      const cx = [-120, -40, 40, 120][Math.floor(rand() * 4)];
      const cz = [-120, -40, 40, 120][Math.floor(rand() * 4)];
      palm(cx + (rand() - 0.5) * 62, cz + (rand() - 0.5) * 62);
    }
  }

  // Animate the living bits: water foam crawl, boat bobbing, lamp glow.
  update(dt, elapsed, nightFactor) {
    this.foamTex.offset.x = (elapsed * 0.03) % 1;
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      b.position.y = 0.35 + Math.sin(elapsed * 0.9 + i * 1.7) * 0.14;
      b.rotation.z = Math.sin(elapsed * 0.7 + i) * 0.03;
    }
    const lampColor = nightFactor > 0.4 ? 0xffd9a0 : 0x8a8f96;
    for (const m of this.lampHeads) m.color.setHex(lampColor);
    if (this.lighthouseMat) {
      const pulse = 0.65 + 0.35 * Math.sin(elapsed * 2.2);
      this.lighthouseMat.color.setRGB(pulse, pulse * 0.9, pulse * 0.6);
    }
    // Window glow rises as the sky darkens.
    // (Materials are per-building clones of the facade maps; the emissive
    // intensity is driven through the scene traversal in main.js instead —
    // here we only expose the factor.)
    this.nightFactor = nightFactor;
    void dt;
  }
}
