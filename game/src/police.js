// Saltline City — the Saltline PD: wanted level, pursuit cars, officers on
// foot, and the busted meter. Crimes raise the heat; breaking sight for
// long enough lets it cool — unless a mission says otherwise.

import * as THREE from 'three';
import { POLICE, clamp, lerpAngle, dist2d } from './config.js';
import { buildCar, setCarPosition } from './vehicles.js';
import { makeHumanoid, animateHumanoid } from './pedestrians.js';
import { sightBlocked, resolveCircle } from './city.js';

export class Police {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.wanted = 0;             // float; stars = floor
    this.cars = [];              // police car records (also in G.cars)
    this.unseenTime = 0;
    this.bustedProgress = 0;
    this.flashPhase = 0;
    this.spawnCd = 0;
  }

  get stars() { return Math.floor(this.wanted); }

  addWanted(points) {
    this.wanted = clamp(this.wanted + points, 0, POLICE.maxStars + 0.6);
    const s = this.stars;
    if (s > (this.G.save.bestStars || 0)) {
      this.G.save.bestStars = s;
    }
    if (points > 0) this.unseenTime = 0;
  }

  setWanted(level) {
    this.wanted = Math.max(this.wanted, level);
  }

  clearWanted() {
    this.wanted = 0;
    this.bustedProgress = 0;
  }

  nearestCopDistance() {
    const p = this.G.player;
    let best = Infinity;
    for (const cop of this.cars) {
      best = Math.min(best, dist2d(p.x, p.z, cop.mesh.position.x, cop.mesh.position.z));
      if (cop.officerOut) {
        best = Math.min(best, dist2d(p.x, p.z, cop.officer.mesh.position.x, cop.officer.mesh.position.z));
      }
    }
    return best;
  }

  playerSeen() {
    const p = this.G.player;
    for (const cop of this.cars) {
      const d = dist2d(p.x, p.z, cop.mesh.position.x, cop.mesh.position.z);
      if (d < 16) return true;
      if (d < 62 && !sightBlocked(p.x, p.z, cop.mesh.position.x, cop.mesh.position.z, this.G.city.colliders)) return true;
    }
    return false;
  }

  // Public: place a fresh police car at an exact spot (screenshot scenes).
  spawnCopAt(x, z) {
    this.#spawnCop({ x, z });
  }

  #spawnCop(fixed = null) {
    const G = this.G;
    const p = G.player;
    // Pick a street intersection roughly spawnDistance away.
    const streets = [-160, -80, 0, 80, 160];
    let x = p.x, z = p.z;
    if (fixed) { x = fixed.x; z = fixed.z; }
    for (let tries = 0; tries < (fixed ? 0 : 12); tries++) {
      const a = Math.random() * Math.PI * 2;
      const tx = p.x + Math.sin(a) * POLICE.spawnDistance;
      const tz = p.z + Math.cos(a) * POLICE.spawnDistance;
      x = streets.reduce((best, s) => (Math.abs(s - tx) < Math.abs(best - tx) ? s : best), streets[0]);
      z = streets.reduce((best, s) => (Math.abs(s - tz) < Math.abs(best - tz) ? s : best), streets[0]);
      if (dist2d(p.x, p.z, x, z) > 55) break;
    }
    const car = buildCar(this.scene, 0xf2f4f6, { police: true });
    car.kind = 'police';
    car.topSpeed = POLICE.carSpeed;
    setCarPosition(car, x, z, Math.atan2(p.x - x, p.z - z));
    // The officer who can get out and chase on foot.
    const parts = makeHumanoid({ shirt: 0x1c4d8f, pants: 0x1a2432, skin: 0xe0ac69, cap: 0x12283f });
    parts.group.visible = false;
    this.scene.add(parts.group);
    car.officer = { parts, mesh: parts.group, phase: 0 };
    car.officerOut = false;
    this.cars.push(car);
    G.cars.push(car);
  }

  #despawnCop(car) {
    const G = this.G;
    this.scene.remove(car.mesh);
    this.scene.remove(car.officer.mesh);
    this.cars.splice(this.cars.indexOf(car), 1);
    const gi = G.cars.indexOf(car);
    if (gi >= 0) G.cars.splice(gi, 1);
  }

  update(dt) {
    const G = this.G;
    const p = G.player;
    const stars = this.stars;

    // --- heat decay ---
    const seen = stars > 0 && this.playerSeen();
    if (seen) this.unseenTime = 0;
    else this.unseenTime += dt;
    const minWanted = G.minWanted || 0;
    if (stars > 0 && this.unseenTime > POLICE.loseSightTime) {
      const rate = G.heatDecayBoost ? 0.16 : 0.055;
      this.wanted = Math.max(minWanted, this.wanted - dt * rate * 10 * 0.1);
    }
    if (this.wanted < minWanted) this.wanted = minWanted;

    // --- fleet size follows the stars ---
    this.spawnCd -= dt;
    const wantCars = stars * POLICE.carsPerStar;
    if (this.cars.length < wantCars && this.spawnCd <= 0) {
      this.#spawnCop();
      this.spawnCd = 1.2;
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const cop = this.cars[i];
      const d = dist2d(p.x, p.z, cop.mesh.position.x, cop.mesh.position.z);
      if ((stars === 0 && d > 40 && !cop.officerOut) || d > POLICE.despawnDistance) {
        this.#despawnCop(cop);
      }
    }

    // --- pursuit ---
    this.flashPhase += dt * 7;
    const flash = Math.sin(this.flashPhase) > 0;
    for (const cop of this.cars) {
      if (cop.lightBar) {
        cop.lightBar.redMat.color.setHex(flash ? 0xff2a20 : 0x57120d);
        cop.lightBar.blueMat.color.setHex(flash ? 0x0d1e57 : 0x2266ff);
      }
      this.#driveCop(cop, dt);
      this.#updateOfficer(cop, dt);
    }

    // --- busted meter ---
    const near = this.nearestCopDistance();
    const playerSlow = p.driving ? Math.abs(p.speed) < 2.4 : true;
    const playerStill = !p.driving && !G.input.moving;
    if (stars > 0 && near < POLICE.bustedRadius && (p.driving ? playerSlow : playerStill)) {
      this.bustedProgress += dt / POLICE.bustedTime;
    } else {
      this.bustedProgress = Math.max(0, this.bustedProgress - dt * 0.8);
    }
    G.hud.setBusted(this.bustedProgress);
    if (this.bustedProgress >= 1) {
      this.bustedProgress = 0;
      G.onBusted();
    }
  }

  #driveCop(cop, dt) {
    const G = this.G;
    const p = G.player;
    if (cop.officerOut) {
      // Parked while the officer is out: handbrake on.
      cop.speed = 0;
      return;
    }
    const tx = p.x + (p.driving ? Math.sin(p.car.angle) * p.speed * 0.4 : 0);
    const tz = p.z + (p.driving ? Math.cos(p.car.angle) * p.speed * 0.4 : 0);
    const dx = tx - cop.mesh.position.x;
    const dz = tz - cop.mesh.position.z;
    const dist = Math.hypot(dx, dz);
    const wantAngle = Math.atan2(dx, dz);
    let diff = wantAngle - cop.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 1.7, -1, 1);
    let throttle = 1;
    if (Math.abs(diff) > 2.5 && dist < 12 && Math.abs(cop.speed) < 3) throttle = -1;
    if (!p.driving && dist < 9) throttle = 0; // don't run Mara down; get out instead
    if (p.driving && dist < 4.5) throttle = 0.4;
    const impact = G.carManager.stepDrive(cop, dt, { throttle, steer, brake: false, handbrake: false }, G.city.colliders);
    if (impact > 14 && p.driving) {
      // Ramming hurts both cars a little.
      cop.health -= 4;
    }
    // Should the officer bail out and chase on foot?
    if (!p.driving && dist < 26 && Math.abs(cop.speed) < 2 && this.stars > 0) {
      cop.officerOut = true;
      cop.officer.mesh.visible = true;
      cop.officer.mesh.position.set(cop.mesh.position.x + 2.4, 0.3, cop.mesh.position.z);
    }
  }

  #updateOfficer(cop, dt) {
    const G = this.G;
    const p = G.player;
    if (!cop.officerOut) return;
    const o = cop.officer;
    const distToPlayer = dist2d(p.x, p.z, o.mesh.position.x, o.mesh.position.z);
    const distToCar = dist2d(cop.mesh.position.x, cop.mesh.position.z, o.mesh.position.x, o.mesh.position.z);
    // Get back in if the chase has clearly moved on.
    if (p.driving || distToPlayer > 46 || this.stars === 0) {
      if (distToCar < 3) {
        cop.officerOut = false;
        o.mesh.visible = false;
        return;
      }
      this.#moveOfficer(o, cop.mesh.position.x, cop.mesh.position.z, 7.5, dt);
      return;
    }
    this.#moveOfficer(o, p.x, p.z, 6.8, dt);
  }

  #moveOfficer(o, tx, tz, speed, dt) {
    const pos = o.mesh.position;
    const want = Math.atan2(tx - pos.x, tz - pos.z);
    o.mesh.rotation.y = lerpAngle(o.mesh.rotation.y, want, clamp(dt * 8, 0, 1));
    const holder = { x: pos.x + Math.sin(o.mesh.rotation.y) * speed * dt, z: pos.z + Math.cos(o.mesh.rotation.y) * speed * dt };
    resolveCircle(holder, 0.55, this.G.city.colliders);
    pos.x = holder.x;
    pos.z = holder.z;
    o.phase += dt * speed * 1.9;
    animateHumanoid(o.parts, o.phase, 1.2);
  }
}
