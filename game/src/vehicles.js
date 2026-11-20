// Saltline City — cars: the shared car factory, arcade driving physics,
// traffic that loops the block grid, and the parked cars waiting to be
// stolen. Police cars are built here too; police.js drives them.

import * as THREE from 'three';
import { CAR, PALETTE, STREETS, clamp, lerpAngle, rng } from './config.js';
import { resolveCircle } from './city.js';

const rand = rng(777);
const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x15181c });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x18222e });
const chromeMat = new THREE.MeshLambertMaterial({ color: 0xb9c2cc });

let carSeq = 0;

// Build one car. Returns the car record used by every other system.
export function buildCar(scene, colorHex, { police = false, taxi = false } = {}) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: police ? 0xf2f4f6 : colorHex });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 4.4), paint);
  body.position.y = 0.62;
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.4, 0.9), paint);
  nose.position.set(0, 0.5, 2.4);
  group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.58, 2.1), glassMat);
  cabin.position.set(0, 1.18, -0.25);
  cabin.castShadow = true;
  group.add(cabin);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.16, 4.44),
    new THREE.MeshLambertMaterial({ color: police ? 0x1c2733 : 0x22262c }));
  trim.position.y = 0.38;
  group.add(trim);
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffd23e }));
    sign.position.set(0, 1.58, -0.25);
    group.add(sign);
  }
  // Lights: headlights (front, +z) and tail lights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff6cf });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1610 });
  for (const dx of [-0.68, 0.68]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.08), headMat);
    h.position.set(dx, 0.66, 2.86);
    group.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.08), tailMat);
    t.position.set(dx, 0.7, -2.22);
    group.add(t);
  }
  const wheels = [];
  const wheelPos = [[-1.02, 1.5], [1.02, 1.5], [-1.02, -1.5], [1.02, -1.5]];
  for (const [wx, wz] of wheelPos) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.42, wz);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    pivot.add(wheel);
    group.add(pivot);
    wheels.push({ pivot, wheel, front: wz > 0 });
  }
  let lightBar = null;
  if (police) {
    const bar = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.44), chromeMat);
    bar.add(base);
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff2a20 });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x2266ff });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.4), redMat);
    red.position.x = -0.38; red.position.y = 0.14;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.4), blueMat);
    blue.position.x = 0.38; blue.position.y = 0.14;
    bar.add(red, blue);
    bar.position.set(0, 1.56, -0.25);
    group.add(bar);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.34, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x1c4d8f }));
    badge.position.set(0, 0.66, 0.3);
    group.add(badge);
    lightBar = { redMat, blueMat };
  }
  scene.add(group);
  const car = {
    id: carSeq++,
    mesh: group,
    kind: 'traffic',
    color: colorHex,
    angle: 0,
    speed: 0,
    steerVis: 0,
    health: 100,
    wheels,
    lightBar,
    tailMat,
    headMat,
    driver: null,        // 'player' while Mara is behind the wheel
    stolen: false,
    missionTarget: false,
    dead: false,
    // traffic routing
    route: null,
    routeIndex: 0,
    cruiseSpeed: CAR.trafficSpeed * (0.8 + rand() * 0.45),
    blockedTime: 0,
  };
  group.userData.car = car;
  return car;
}

export function setCarPosition(car, x, z, angle) {
  car.mesh.position.set(x, 0, z);
  car.angle = angle;
  car.mesh.rotation.y = angle;
}

// A rectangular patrol loop around one city block, offset to the
// right-hand lane of each street.
function blockRoute(cx, cz) {
  const x0 = cx - 40, x1 = cx + 40, z0 = cz - 40, z1 = cz + 40;
  const L = 4.2; // lane offset from street centre
  // Clockwise seen from above (x east, z south): keeps cars on the right.
  return [
    { x: x0 + L, z: z0 + L }, { x: x0 + L, z: z1 - L },
    { x: x1 - L, z: z1 - L }, { x: x1 - L, z: z0 + L },
  ];
}

export class CarManager {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.cars = G.cars;
  }

  spawnInitial() {
    const centres = [-120, -40, 40, 120];
    // Moving traffic, one or two cars per block loop.
    for (let i = 0; i < CAR.trafficCount; i++) {
      const cx = centres[Math.floor(rand() * 4)];
      const cz = centres[Math.floor(rand() * 4)];
      const car = buildCar(this.scene, PALETTE.carColors[Math.floor(rand() * PALETTE.carColors.length)], { taxi: rand() > 0.82 });
      car.kind = 'traffic';
      car.route = blockRoute(cx, cz);
      if (rand() > 0.5) car.route.reverse();
      car.routeIndex = Math.floor(rand() * 4);
      const start = car.route[car.routeIndex];
      const next = car.route[(car.routeIndex + 1) % 4];
      setCarPosition(car, start.x, start.z, Math.atan2(next.x - start.x, next.z - start.z));
      this.cars.push(car);
    }
    // Parked cars along street edges — the stealable fleet.
    for (let i = 0; i < CAR.parkedCount; i++) {
      const vertical = rand() > 0.5;
      const street = STREETS[Math.floor(rand() * STREETS.length)];
      const along = -176 + rand() * 352;
      const side = rand() > 0.5 ? 1 : -1;
      const car = buildCar(this.scene, PALETTE.carColors[Math.floor(rand() * PALETTE.carColors.length)], { taxi: rand() > 0.9 });
      car.kind = 'parked';
      if (vertical) setCarPosition(car, street + side * 6.1, along, side > 0 ? 0 : Math.PI);
      else setCarPosition(car, along, street + side * 6.1, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      this.cars.push(car);
    }
  }

  // Spawn one extra car of any kind (missions use this for the target car).
  spawn(colorHex, x, z, angle, opts = {}) {
    const car = buildCar(this.scene, colorHex, opts);
    setCarPosition(car, x, z, angle);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    this.scene.remove(car.mesh);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  // ---- traffic driving ----
  updateTraffic(dt) {
    const G = this.G;
    for (const car of this.cars) {
      if (car.kind !== 'traffic' || car.dead) continue;
      const target = car.route[(car.routeIndex + 1) % 4];
      const dx = target.x - car.mesh.position.x;
      const dz = target.z - car.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 5.5) {
        car.routeIndex = (car.routeIndex + 1) % 4;
        continue;
      }
      const wantAngle = Math.atan2(dx, dz);
      car.angle = lerpAngle(car.angle, wantAngle, clamp(dt * 3.2, 0, 1));
      // Slow for corners and for anything close ahead.
      let speed = car.cruiseSpeed;
      if (dist < 16) speed = Math.min(speed, 5.5);
      const ahead = this.#aheadBlocked(car);
      if (ahead < 8) speed = 0;
      else if (ahead < 15) speed = Math.min(speed, 4);
      car.speed += clamp(speed - car.speed, -dt * 18, dt * 9);
      const nx = car.mesh.position.x + Math.sin(car.angle) * car.speed * dt;
      const nz = car.mesh.position.z + Math.cos(car.angle) * car.speed * dt;
      car.mesh.position.x = nx;
      car.mesh.position.z = nz;
      car.mesh.rotation.y = car.angle;
      this.#spinWheels(car, dt);
      void G;
    }
  }

  #aheadBlocked(car) {
    const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
    let best = Infinity;
    const test = (ox, oz, r) => {
      const dx = ox - car.mesh.position.x;
      const dz = oz - car.mesh.position.z;
      const along = dx * fx + dz * fz;
      if (along < 0 || along > 18) return;
      const side = Math.abs(dx * fz - dz * fx);
      if (side < r + 1.6) best = Math.min(best, along);
    };
    for (const other of this.cars) {
      if (other === car || other.dead) continue;
      test(other.mesh.position.x, other.mesh.position.z, CAR.radius);
    }
    const p = this.G.player;
    if (p && !p.driving) test(p.mesh.position.x, p.mesh.position.z, 0.8);
    if (p && p.driving && p.car) test(p.car.mesh.position.x, p.car.mesh.position.z, CAR.radius);
    return best;
  }

  #spinWheels(car, dt) {
    for (const w of car.wheels) {
      w.wheel.rotation.x += (car.speed * dt) / 0.42;
      if (w.front) w.pivot.rotation.y = car.steerVis || 0;
    }
  }

  // Shared arcade physics for the player car and police cars.
  // input: { throttle -1..1, steer -1..1, handbrake bool }
  // Returns impact speed if the car slammed a building this step, else 0.
  stepDrive(car, dt, input, colliders) {
    const accel = input.throttle > 0 ? CAR.accel : CAR.brake * 0.8;
    if (input.throttle !== 0) {
      car.speed += input.throttle * accel * dt;
    } else {
      // Rolling drag.
      car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), dt * 6);
    }
    if (input.brake) {
      car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), dt * CAR.brake);
    }
    car.speed = clamp(car.speed, -CAR.maxReverse, car.topSpeed || CAR.maxSpeed);
    const speedRatio = clamp(Math.abs(car.speed) / 14, 0, 1);
    const dirSign = car.speed < 0 ? -1 : 1;
    const grip = input.handbrake ? 1.5 : 1;
    car.angle += input.steer * CAR.turnRate * speedRatio * dirSign * grip * dt * (input.handbrake ? 1 : clamp(Math.abs(car.speed) / 20, 0.25, 1));
    car.steerVis = lerpAngle(car.steerVis || 0, input.steer * 0.45, clamp(dt * 10, 0, 1));

    const holder = { x: car.mesh.position.x, z: car.mesh.position.z };
    holder.x += Math.sin(car.angle) * car.speed * dt;
    holder.z += Math.cos(car.angle) * car.speed * dt;
    const before = Math.abs(car.speed);
    resolveCircle(holder, CAR.radius, colliders);
    const moved = Math.hypot(holder.x - car.mesh.position.x, holder.z - car.mesh.position.z);
    let impact = 0;
    if (moved < Math.abs(car.speed) * dt * 0.45 && before > 7) {
      impact = before;
      car.speed *= 0.25;
    } else if (moved < Math.abs(car.speed) * dt * 0.7 && before > 3) {
      car.speed *= 0.6;
    }
    car.mesh.position.x = holder.x;
    car.mesh.position.z = holder.z;
    car.mesh.rotation.y = car.angle;
    // Body roll/pitch for feel.
    car.mesh.rotation.z = -input.steer * clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1) * 0.05;
    car.mesh.rotation.x = clamp(-(input.throttle) * 0.02, -0.03, 0.03);
    this.#spinWheels(car, dt);
    // Brake lights.
    car.tailMat.color.setHex(input.brake || input.throttle < 0 ? 0xff2a1a : 0x7a1610);
    return impact;
  }

  // Car-vs-car soft collisions for every pair; calls onCrash(carA, carB,
  // strength) when the player is involved in a hard hit.
  resolveCarPairs(onCrash) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      if (a.dead) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        if (b.dead) continue;
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const d2 = dx * dx + dz * dz;
        const min = CAR.radius * 2 - 0.4;
        if (d2 > min * min || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const ux = dx / d, uz = dz / d;
        const relSpeed = Math.abs(a.speed - b.speed);
        for (const [car, s] of [[a, -1], [b, 1]]) {
          if (car.driver === 'player' || car.kind === 'police' || car.kind === 'traffic') {
            car.mesh.position.x += ux * push * s;
            car.mesh.position.z += uz * push * s;
          }
        }
        if (a.kind === 'traffic') a.speed *= 0.5;
        if (b.kind === 'traffic') b.speed *= 0.5;
        if (relSpeed > 8) {
          a.health -= relSpeed * 0.7;
          b.health -= relSpeed * 0.7;
          if (onCrash) onCrash(a, b, relSpeed);
        }
      }
    }
  }
}
