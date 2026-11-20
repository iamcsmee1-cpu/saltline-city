// Saltline City — combat: Mara's pistol and fists, hit sparks and tracers,
// and the rival crews who shoot back during missions. Hits are raycasts
// from the camera centre, so the crosshair is always honest.

import * as THREE from 'three';
import { COMBAT, PLAYER, clamp, dist2d } from './config.js';
import { makeHumanoid, animateHumanoid } from './pedestrians.js';
import { sightBlocked } from './city.js';

export class Combat {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.rivals = G.rivals;
    this.cooldown = 0;
    this.raycaster = new THREE.Raycaster();
    this.flash = null;
    this.flashTime = 0;
    this.tracers = [];
    this.#buildParticles();
  }

  // ---------- rivals ----------
  spawnRival(x, z, { shirt = 0x8b1e3f } = {}) {
    const parts = makeHumanoid({ shirt, pants: 0x1f2430, skin: 0x8d5524, cap: 0x14181f });
    parts.group.position.set(x, 0.3, z);
    this.scene.add(parts.group);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x14181c }));
    gun.position.set(0, -0.72, 0.3);
    parts.armR.add(gun);
    const rival = {
      parts, mesh: parts.group, kind: 'rival',
      health: COMBAT.rivalHealth, dead: false,
      angle: 0, phase: Math.random() * 6, shootCd: 1 + Math.random(),
      strafeDir: Math.random() > 0.5 ? 1 : -1, strafeTime: 2 + Math.random() * 2,
    };
    parts.group.userData.hitRef = { type: 'rival', ref: rival };
    this.rivals.push(rival);
    return rival;
  }

  damageRival(rival, amount) {
    if (rival.dead) return;
    rival.health -= amount;
    this.G.audio.hurt();
    if (rival.health <= 0) {
      rival.dead = true;
      rival.mesh.rotation.x = -Math.PI / 2;
      rival.mesh.position.y = 0.25;
      this.G.onCrime('fightRival', rival.mesh.position.x, rival.mesh.position.z);
      this.G.hud.toast('Rival down.', 'Combat');
    }
  }

  clearRivals() {
    for (const r of this.rivals) this.scene.remove(r.mesh);
    this.rivals.length = 0;
  }

  // ---------- particles (one pooled Points cloud for hit sparks) ----------
  #buildParticles() {
    const N = 240;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffcf6e, size: 0.32, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -50;
    this.scene.add(this.points);
    this.pCursor = 0;
  }

  burst(x, y, z, n = 8, color = null) {
    if (color !== null) this.points.material.color.setHex(color);
    for (let k = 0; k < n; k++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.pN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = (Math.random() - 0.5) * 5;
      this.pVel[i * 3 + 1] = Math.random() * 4.5;
      this.pVel[i * 3 + 2] = (Math.random() - 0.5) * 5;
      this.pLife[i] = 0.4 + Math.random() * 0.3;
    }
  }

  #updateParticles(dt) {
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 9 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = -50;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  // ---------- tracers ----------
  #tracer(from, to, color = 0xffe9a8) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  // ---------- player attacks ----------
  tryShoot() {
    const G = this.G;
    if (this.cooldown > 0 || G.player.driving) return;
    this.cooldown = COMBAT.pistolCooldown;
    G.audio.shot();
    G.onCrime('gunshot', G.player.x, G.player.z);
    G.pedsModule.scare(G.player.x, G.player.z, 30);
    // Muzzle flash: a brief bright sprite at the gun hand.
    if (!this.flash) {
      this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffd76e }));
      this.scene.add(this.flash);
    }
    const p = G.player;
    this.flash.position.set(
      p.mesh.position.x + Math.sin(p.angle) * 0.7,
      1.45,
      p.mesh.position.z + Math.cos(p.angle) * 0.7,
    );
    this.flash.visible = true;
    this.flashTime = 0.05;

    // Raycast from the camera through the crosshair.
    this.raycaster.setFromCamera({ x: 0, y: 0 }, G.camera);
    this.raycaster.far = COMBAT.pistolRange;
    const targets = [];
    for (const r of this.rivals) if (!r.dead) targets.push(r.mesh);
    for (const ped of G.peds) if (!ped.dead) targets.push(ped.mesh);
    for (const car of G.cars) if (!car.dead) targets.push(car.mesh);
    const hits = this.raycaster.intersectObjects(targets, true);
    const from = this.flash.position.clone();
    if (hits.length) {
      const hit = hits[0];
      this.#tracer(from, hit.point.clone());
      this.burst(hit.point.x, hit.point.y, hit.point.z, 7);
      let obj = hit.object;
      while (obj && !obj.userData.hitRef && !obj.userData.car) obj = obj.parent;
      if (obj && obj.userData.car) {
        const car = obj.userData.car;
        car.health -= COMBAT.pistolDamage;
        this.burst(hit.point.x, hit.point.y, hit.point.z, 10, 0xffa502);
        if (car.health <= 0 && !car.dead) {
          car.dead = true;
          car.speed = 0;
          this.burst(car.mesh.position.x, 1, car.mesh.position.z, 30, 0xff6b35);
          G.audio.crash(1);
        }
      } else if (obj && obj.userData.hitRef) {
        const { type, ref } = obj.userData.hitRef;
        if (type === 'rival') this.damageRival(ref, COMBAT.pistolDamage);
        else if (type === 'ped') {
          const result = G.pedsModule.damage(ref, COMBAT.pistolDamage);
          G.onCrime(result === 'killed' ? 'killPedestrian' : 'hitPedestrian', ref.mesh.position.x, ref.mesh.position.z);
        }
        G.hud.hitmarker();
      }
    } else {
      const end = this.raycaster.ray.at(COMBAT.pistolRange, new THREE.Vector3());
      this.#tracer(from, end);
    }
  }

  tryMelee() {
    const G = this.G;
    const p = G.player;
    if (p.driving) return;
    G.audio.melee();
    const fx = Math.sin(p.angle), fz = Math.cos(p.angle);
    const inFront = (x, z) => {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      return d < PLAYER.meleeRange + 0.6 && (dx * fx + dz * fz) / (d || 1) > 0.3;
    };
    for (const r of this.rivals) {
      if (!r.dead && inFront(r.mesh.position.x, r.mesh.position.z)) {
        this.damageRival(r, PLAYER.meleeDamage);
        this.burst(r.mesh.position.x, 1.3, r.mesh.position.z, 6, 0xffffff);
        return;
      }
    }
    for (const ped of G.peds) {
      if (!ped.dead && inFront(ped.mesh.position.x, ped.mesh.position.z)) {
        const result = G.pedsModule.damage(ped, PLAYER.meleeDamage);
        G.onCrime(result === 'killed' ? 'killPedestrian' : 'hitPedestrian', ped.mesh.position.x, ped.mesh.position.z);
        G.hud.hitmarker();
        return;
      }
    }
  }

  // ---------- rival AI ----------
  update(dt) {
    const G = this.G;
    this.cooldown -= dt;
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0 && this.flash) this.flash.visible = false;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].life -= dt;
      if (this.tracers[i].life <= 0) {
        this.scene.remove(this.tracers[i].line);
        this.tracers.splice(i, 1);
      }
    }
    this.#updateParticles(dt);

    const p = G.player;
    for (const r of this.rivals) {
      if (r.dead) continue;
      const pos = r.mesh.position;
      const d = dist2d(p.x, p.z, pos.x, pos.z);
      const want = Math.atan2(p.x - pos.x, p.z - pos.z);
      r.angle = want;
      r.mesh.rotation.y = want;
      // Keep a fighting distance: close in if far, back off if crowded.
      let moveSpeed = 0;
      if (d > 22) moveSpeed = 4.6;
      else if (d < 8) moveSpeed = -2.4;
      r.strafeTime -= dt;
      if (r.strafeTime <= 0) { r.strafeDir *= -1; r.strafeTime = 1.6 + Math.random() * 2; }
      const strafeX = Math.cos(want) * r.strafeDir * 1.6;
      const strafeZ = -Math.sin(want) * r.strafeDir * 1.6;
      pos.x += (Math.sin(want) * moveSpeed + strafeX) * dt;
      pos.z += (Math.cos(want) * moveSpeed + strafeZ) * dt;
      r.phase += dt * 6;
      animateHumanoid(r.parts, r.phase, moveSpeed !== 0 ? 0.9 : 0.25, true);
      // Shoot back when in range with a clear line.
      r.shootCd -= dt;
      if (r.shootCd <= 0 && d < COMBAT.rivalRange && !sightBlocked(pos.x, pos.z, p.x, p.z, G.city.colliders)) {
        r.shootCd = COMBAT.rivalCooldown * (0.75 + Math.random() * 0.6);
        G.audio.rivalShot();
        const from = new THREE.Vector3(pos.x, 1.45, pos.z);
        const to = new THREE.Vector3(p.x, 1.2, p.z);
        this.#tracer(from, to, 0xff9a7a);
        if (Math.random() < 0.55) {
          p.damage(COMBAT.rivalDamage, G.elapsed);
          this.burst(p.x, 1.3, p.z, 5, 0xff5252);
        }
      }
    }
  }
}
