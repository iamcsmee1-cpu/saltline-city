// Saltline City — Mara Voss: on-foot movement, third-person camera,
// entering/stealing cars, and the arcade driving seat. Owns the player's
// health and the camera rig for both modes.

import * as THREE from 'three';
import { PLAYER, CAR, clamp, lerp, lerpAngle, dist2d } from './config.js';
import { resolveCircle } from './city.js';
import { makeHumanoid, animateHumanoid } from './pedestrians.js';

export class Player {
  constructor(scene, G) {
    this.G = G;
    this.parts = makeHumanoid({ shirt: 0x0e7c86, pants: 0x23272e, skin: 0xc68642, cap: 0xff2e88 });
    this.mesh = this.parts.group;
    this.mesh.position.set(86.5, 0.3, -66);
    scene.add(this.mesh);
    this.angle = Math.PI / 2;       // facing east, toward the diner
    this.health = PLAYER.maxHealth;
    this.driving = false;
    this.car = null;
    this.phase = 0;
    this.jumpY = 0;
    this.jumpV = 0;
    this.grounded = true;
    this.aiming = false;
    this.lastHurt = -99;
    // Camera rig state.
    this.camYaw = Math.PI / 2;
    this.camPitch = 0.32;
    this.carCamAngle = Math.PI / 2;
    this.camPos = new THREE.Vector3(78, 5.5, -66);
    this.camTarget = new THREE.Vector3();
  }

  get x() { return this.driving && this.car ? this.car.mesh.position.x : this.mesh.position.x; }
  get z() { return this.driving && this.car ? this.car.mesh.position.z : this.mesh.position.z; }
  get speed() { return this.driving && this.car ? this.car.speed : 0; }

  reset(spawn) {
    this.exitCar(true);
    this.mesh.position.set(spawn.x, 0.3, spawn.z);
    this.health = PLAYER.maxHealth;
    this.angle = Math.PI;
    this.camYaw = Math.PI;
  }

  damage(amount, elapsed) {
    if (elapsed - this.lastHurt < 0.05) return;
    this.lastHurt = elapsed;
    this.health -= amount;
    this.G.hud.flashDamage();
    this.G.audio.hurt();
    if (this.health <= 0) {
      this.health = 0;
      this.G.onWasted();
    }
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, PLAYER.maxHealth);
  }

  nearestCar(maxDist = PLAYER.enterRange) {
    let best = null, bestD = maxDist;
    for (const car of this.G.cars) {
      if (car.dead || car.driver === 'player') continue;
      const d = dist2d(this.mesh.position.x, this.mesh.position.z, car.mesh.position.x, car.mesh.position.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  tryEnter() {
    const G = this.G;
    if (this.driving) { this.exitCar(); return; }
    const car = this.nearestCar();
    if (!car) return;
    this.driving = true;
    this.car = car;
    car.driver = 'player';
    car.wasTraffic = car.kind === 'traffic';
    car.kind = 'player';
    this.mesh.visible = false;
    this.carCamAngle = car.angle;
    G.audio.door();
    if (!car.stolen) {
      car.stolen = true;
      G.save.carsStolen += 1;
      G.onCrime('stealCar', car.mesh.position.x, car.mesh.position.z);
      G.hud.toast('You lifted a ride. The owner might have opinions — and a phone.', 'Wheels');
    }
  }

  exitCar(silent = false) {
    const G = this.G;
    if (!this.driving || !this.car) { this.driving = false; this.car = null; return; }
    const car = this.car;
    car.driver = null;
    car.kind = 'parked';
    car.speed = 0;
    // Step out at the driver's door (left side).
    const sideX = Math.cos(car.angle), sideZ = -Math.sin(car.angle);
    const holder = {
      x: car.mesh.position.x - sideX * 2.6,
      z: car.mesh.position.z - sideZ * 2.6,
    };
    resolveCircle(holder, PLAYER.radius, G.city.colliders);
    this.mesh.position.set(holder.x, 0.3, holder.z);
    this.mesh.visible = true;
    this.driving = false;
    this.car = null;
    this.camYaw = car.angle + Math.PI;
    if (!silent) G.audio.door();
  }

  update(dt) {
    const G = this.G;
    const input = G.input;
    if (this.driving && this.car) this.#updateDriving(dt, input);
    else this.#updateOnFoot(dt, input);
    this.#updateCamera(dt);
  }

  #updateOnFoot(dt, input) {
    const G = this.G;
    const running = input.keys.has('shift');
    const speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    let mx = 0, mz = 0;
    if (input.keys.has('w')) mz += 1;
    if (input.keys.has('s')) mz -= 1;
    if (input.keys.has('a')) mx -= 1;
    if (input.keys.has('d')) mx += 1;
    const moving = (mx !== 0 || mz !== 0);
    // Movement is relative to the camera yaw.
    const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
    // Forward = (sin, cos); right = (-cos, sin). Move = F*mz + R*mx.
    const wx = mz * sin - mx * cos;
    const wz = mz * cos + mx * sin;
    if (moving) {
      const len = Math.hypot(wx, wz) || 1;
      const holder = {
        x: this.mesh.position.x + (wx / len) * speed * dt,
        z: this.mesh.position.z + (wz / len) * speed * dt,
      };
      resolveCircle(holder, PLAYER.radius, G.city.colliders);
      this.mesh.position.x = clamp(holder.x, -190, 190);
      this.mesh.position.z = clamp(holder.z, -190, 300);
      const moveAngle = Math.atan2(wx, wz);
      // While aiming, Mara strafes and keeps facing the crosshair.
      this.angle = lerpAngle(this.angle, this.aiming ? this.camYaw : moveAngle, clamp(dt * 12, 0, 1));
      this.phase += dt * speed * 1.9;
    }
    // Hop.
    if (input.pressed.has(' ') && this.grounded) {
      this.jumpV = 5.6;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.jumpV -= 15 * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= 0) { this.jumpY = 0; this.grounded = true; }
    }
    this.mesh.position.y = 0.3 + this.jumpY;
    this.mesh.rotation.y = this.angle;
    animateHumanoid(this.parts, this.phase, moving ? (running ? 1.25 : 0.85) : 0, this.aiming);
    // Prompt for the nearest stealable car.
    const near = this.nearestCar();
    G.hud.setPrompt(near ? '<kbd>E</kbd> Enter / steal car' : null);
  }

  #updateDriving(dt, input) {
    const G = this.G;
    const car = this.car;
    const drive = {
      throttle: (input.keys.has('w') ? 1 : 0) + (input.keys.has('s') ? -1 : 0),
      steer: (input.keys.has('a') ? 1 : 0) + (input.keys.has('d') ? -1 : 0),
      brake: false,
      handbrake: input.keys.has(' '),
    };
    // S while moving forward is the brake; S at rest reverses.
    if (input.keys.has('s') && car.speed > 1) { drive.throttle = 0; drive.brake = true; }
    const impact = G.carManager.stepDrive(car, dt, drive, G.city.colliders);
    if (impact > 12) {
      G.audio.crash(clamp(impact / 30, 0.3, 1));
      this.damage(impact * 0.22, G.elapsed);
      G.shake = Math.min(0.5, impact * 0.012);
    } else if (impact > 0) {
      G.audio.crash(0.3);
    }
    if (input.pressed.has('h')) G.audio.horn();
    G.hud.setPrompt('<kbd>E</kbd> Get out');
  }

  #updateCamera(dt) {
    const G = this.G;
    const cam = G.camera;
    let wantPos, wantTarget;
    if (this.driving && this.car) {
      const car = this.car;
      // Chase angle eases toward the car's heading; mouse can offset it.
      this.carCamAngle = lerpAngle(this.carCamAngle, car.angle, clamp(dt * (Math.abs(car.speed) < 3 ? 9 : 4.2), 0, 1));
      const yaw = this.carCamAngle + G.mouseOrbit;
      const back = 11.5, up = 4.6;
      wantPos = new THREE.Vector3(
        car.mesh.position.x - Math.sin(yaw) * back,
        up,
        car.mesh.position.z - Math.cos(yaw) * back,
      );
      wantTarget = new THREE.Vector3(
        car.mesh.position.x + Math.sin(car.angle) * 7,
        1.6,
        car.mesh.position.z + Math.cos(car.angle) * 7,
      );
    } else {
      const dist = 8;
      const cy = this.camYaw, cp = this.camPitch;
      wantPos = new THREE.Vector3(
        this.mesh.position.x - Math.sin(cy) * Math.cos(cp) * dist,
        this.mesh.position.y + 1.6 + Math.sin(cp) * dist,
        this.mesh.position.z - Math.cos(cy) * Math.cos(cp) * dist,
      );
      wantPos.y = Math.max(wantPos.y, 0.7);
      wantTarget = new THREE.Vector3(
        this.mesh.position.x + Math.sin(cy) * 4,
        this.mesh.position.y + 1.7,
        this.mesh.position.z + Math.cos(cy) * 4,
      );
    }
    const k = clamp(dt * 7, 0, 1);
    this.camPos.lerp(wantPos, this.driving ? clamp(dt * 4.5, 0, 1) : k);
    this.camTarget.lerp(wantTarget, clamp(dt * 10, 0, 1));
    cam.position.copy(this.camPos);
    if (G.shake > 0.003) {
      cam.position.x += (Math.random() - 0.5) * G.shake;
      cam.position.y += (Math.random() - 0.5) * G.shake;
      G.shake *= Math.pow(0.02, dt);
    } else G.shake = 0;
    cam.lookAt(this.camTarget);
    void lerp;
  }
}
