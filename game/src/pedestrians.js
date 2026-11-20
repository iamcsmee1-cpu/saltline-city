// Saltline City — pedestrians: low-poly people who stroll the sidewalks,
// flee from danger and (sometimes) don't survive traffic. Also exports the
// humanoid builder the player and rival crews are made from.

import * as THREE from 'three';
import { PALETTE, WORLD, clamp, lerpAngle, rng } from './config.js';
import { resolveCircle } from './city.js';

const rand = rng(4242);
const skinTones = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

// A ~1.8 m person built from boxes: legs and arms pivot at hip/shoulder so
// the walk cycle is just two sine swings.
export function makeHumanoid({ shirt = 0x4ecdc4, pants = 0x2d3436, skin = 0xe0ac69, cap = null } = {}) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });

  const mkLimb = (mat, w, len, x, y, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    mesh.position.y = -len / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  };
  const legL = mkLimb(pantsMat, 0.24, 0.92, -0.14, 0.92, 0);
  const legR = mkLimb(pantsMat, 0.24, 0.92, 0.14, 0.92, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.66, 0.3), shirtMat);
  torso.position.y = 1.26;
  torso.castShadow = true;
  group.add(torso);
  const armL = mkLimb(shirtMat, 0.18, 0.78, -0.39, 1.52, 0);
  const armR = mkLimb(shirtMat, 0.18, 0.78, 0.39, 1.52, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), skinMat);
  head.position.y = 1.8;
  head.castShadow = true;
  group.add(head);
  if (cap !== null) {
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.4),
      new THREE.MeshLambertMaterial({ color: cap }));
    hat.position.y = 2.02;
    group.add(hat);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.3),
      new THREE.MeshLambertMaterial({ color: cap }));
    brim.position.set(0, 1.97, 0.3);
    group.add(brim);
  }
  return { group, legL, legR, armL, armR, head, torso };
}

export function animateHumanoid(parts, phase, speedRatio, aimPose = false) {
  const swing = Math.sin(phase) * 0.62 * speedRatio;
  parts.legL.rotation.x = swing;
  parts.legR.rotation.x = -swing;
  if (aimPose) {
    parts.armR.rotation.x = -Math.PI / 2 + 0.12;
    parts.armL.rotation.x = -Math.PI / 2 + 0.3;
  } else {
    parts.armL.rotation.x = -swing * 0.8;
    parts.armR.rotation.x = swing * 0.8;
  }
}

const BLOCK_CENTRES = [-120, -40, 40, 120];

export class Pedestrians {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.peds = G.peds;
  }

  spawnInitial() {
    for (let i = 0; i < WORLD.pedCount; i++) {
      const cx = BLOCK_CENTRES[Math.floor(rand() * 4)];
      const cz = BLOCK_CENTRES[Math.floor(rand() * 4)];
      this.#spawn(cx, cz);
    }
    // A few beach strollers.
    for (let i = 0; i < 6; i++) this.#spawnBeach();
  }

  #spawn(cx, cz) {
    const parts = makeHumanoid({
      shirt: PALETTE.pedShirts[Math.floor(rand() * PALETTE.pedShirts.length)],
      pants: PALETTE.pedPants[Math.floor(rand() * PALETTE.pedPants.length)],
      skin: skinTones[Math.floor(rand() * skinTones.length)],
      cap: rand() > 0.7 ? PALETTE.carColors[Math.floor(rand() * PALETTE.carColors.length)] : null,
    });
    const ring = 33.5;
    const side = Math.floor(rand() * 4);
    const along = (rand() - 0.5) * 2 * ring;
    const pos = [
      { x: cx + along, z: cz - ring }, { x: cx + ring, z: cz + along },
      { x: cx - along, z: cz + ring }, { x: cx - ring, z: cz - along },
    ][side];
    parts.group.position.set(pos.x, 0.3, pos.z);
    this.scene.add(parts.group);
    const ped = {
      parts, mesh: parts.group, kind: 'ped',
      cx, cz, ring, wp: (side + 1) % 4,
      speed: 1.5 + rand() * 1.2, phase: rand() * 6,
      health: 100, state: 'walk', stateTime: 0, fleeFrom: null,
      angle: 0, dead: false,
    };
    parts.group.userData.hitRef = { type: 'ped', ref: ped };
    this.peds.push(ped);
    return ped;
  }

  #spawnBeach() {
    const parts = makeHumanoid({
      shirt: PALETTE.pedShirts[Math.floor(rand() * PALETTE.pedShirts.length)],
      pants: PALETTE.pedPants[Math.floor(rand() * PALETTE.pedPants.length)],
      skin: skinTones[Math.floor(rand() * skinTones.length)],
    });
    const x = -170 + rand() * 340;
    parts.group.position.set(x, 0.15, 205 + rand() * 14);
    this.scene.add(parts.group);
    const ped = {
      parts, mesh: parts.group, kind: 'ped', beach: true,
      cx: 0, cz: 0, ring: 0, wp: 0,
      speed: 1.2 + rand(), phase: rand() * 6,
      health: 100, state: 'walk', stateTime: 0, fleeFrom: null,
      angle: rand() > 0.5 ? Math.PI / 2 : -Math.PI / 2, dead: false,
      beachDir: rand() > 0.5 ? 1 : -1,
    };
    parts.group.userData.hitRef = { type: 'ped', ref: ped };
    this.peds.push(ped);
    return ped;
  }

  #waypoint(ped) {
    const { cx, cz, ring } = ped;
    return [
      { x: cx + ring, z: cz - ring }, { x: cx + ring, z: cz + ring },
      { x: cx - ring, z: cz + ring }, { x: cx - ring, z: cz - ring },
    ][ped.wp];
  }

  scare(x, z, radius = 26) {
    for (const ped of this.peds) {
      if (ped.dead || ped.state === 'down') continue;
      const d = Math.hypot(ped.mesh.position.x - x, ped.mesh.position.z - z);
      if (d < radius) {
        ped.state = 'flee';
        ped.stateTime = 2.5 + Math.random() * 2;
        ped.fleeFrom = { x, z };
      }
    }
  }

  damage(ped, amount) {
    if (ped.dead) return 'dead';
    ped.health -= amount;
    if (ped.health <= 0) {
      ped.dead = true;
      ped.state = 'down';
      ped.stateTime = Infinity;
      ped.mesh.rotation.x = -Math.PI / 2;
      ped.mesh.position.y = 0.25;
      return 'killed';
    }
    ped.state = 'down';
    ped.stateTime = 3.5;
    ped.mesh.rotation.x = -Math.PI / 2;
    ped.mesh.position.y = 0.25;
    return 'down';
  }

  update(dt) {
    const G = this.G;
    for (const ped of this.peds) {
      if (ped.dead) continue;
      const pos = ped.mesh.position;
      ped.stateTime -= dt;
      if (ped.state === 'down') {
        if (ped.stateTime <= 0) {
          ped.state = 'walk';
          ped.mesh.rotation.x = 0;
          ped.mesh.position.y = ped.beach ? 0.15 : 0.3;
          ped.health = Math.max(ped.health, 55);
        }
        continue;
      }
      let tx, tz, speed = ped.speed;
      if (ped.state === 'flee' && ped.fleeFrom) {
        const dx = pos.x - ped.fleeFrom.x;
        const dz = pos.z - ped.fleeFrom.z;
        const d = Math.hypot(dx, dz) || 1;
        tx = pos.x + (dx / d) * 12;
        tz = pos.z + (dz / d) * 12;
        speed = 6.4;
        if (ped.stateTime <= 0) ped.state = 'walk';
      } else if (ped.beach) {
        tx = pos.x + ped.beachDir * 10;
        tz = pos.z;
        if (pos.x > 178) ped.beachDir = -1;
        if (pos.x < -178) ped.beachDir = 1;
      } else {
        const wp = this.#waypoint(ped);
        tx = wp.x; tz = wp.z;
        if (Math.hypot(tx - pos.x, tz - pos.z) < 1.6) {
          ped.wp = (ped.wp + 1) % 4;
          continue;
        }
      }
      const want = Math.atan2(tx - pos.x, tz - pos.z);
      ped.angle = lerpAngle(ped.angle, want, clamp(dt * 6, 0, 1));
      const holder = { x: pos.x + Math.sin(ped.angle) * speed * dt, z: pos.z + Math.cos(ped.angle) * speed * dt };
      resolveCircle(holder, 0.55, G.city.colliders);
      pos.x = clamp(holder.x, -188, 188);
      pos.z = clamp(holder.z, -188, 300);
      ped.mesh.rotation.y = ped.angle;
      ped.phase += dt * speed * 2.6;
      animateHumanoid(ped.parts, ped.phase, clamp(speed / 3, 0.3, 1.6));
    }
  }
}
