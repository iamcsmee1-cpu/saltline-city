// Saltline City — deterministic screenshot scenes for the entry's
// screenshots/ folder. Open the game with ?shot=cover|city|mission|night
// and it poses a real, running scene (simulation live, HUD on) that a
// headless browser can capture. Not used in normal play.

import { PLACES, MARINA_X } from './config.js';

export function shotName() {
  const q = new URLSearchParams(location.search).get('shot');
  return ['cover', 'city', 'mission', 'night'].includes(q) ? q : null;
}

// Point the "driver" (real input state) at a ground target.
function driveToward(G, tx, tz) {
  const car = G.player.car;
  if (!car) return;
  const want = Math.atan2(tx - car.mesh.position.x, tz - car.mesh.position.z);
  let diff = want - car.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  G.input.keys.delete('a');
  G.input.keys.delete('d');
  if (diff > 0.06) G.input.keys.add('a');
  else if (diff < -0.06) G.input.keys.add('d');
}

function putPlayerInCar(G, car) {
  G.player.mesh.position.set(car.mesh.position.x - 3, 0.3, car.mesh.position.z);
  G.player.tryEnter();
}

export function setupShot(G, name) {
  const p = G.player;
  G.shotMode = name;
  if (name === 'cover') {
    G.hour = 18.35;
    const car = G.carManager.spawn(0xd64541, 0, 6, 0, {});
    car.kind = 'parked';
    putPlayerInCar(G, car);
    G.police.setWanted(3);
    G.police.spawnCopAt(-6, -34);
    G.police.spawnCopAt(7, -48);
    G.objectiveLock = {
      title: 'Deliver the package to <b>Delgado</b>',
      sub: 'First Run — stage 2/2 • 148 m',
    };
    G.input.keys.add('w');
  } else if (name === 'city') {
    G.hour = 15.9;
    // Middle of the (0, 80) intersection, classic behind-player view
    // looking south-east across both streets toward the beach: traffic
    // crosses both ways and a stealable car waits at the kerb.
    p.mesh.position.set(2, 0.3, 86);
    p.angle = 0.6;
    p.camYaw = 0.6;
    p.camPitch = 0.4;
    const car = G.carManager.spawn(0x2e86de, 6.1, 99, Math.PI, {});
    car.kind = 'parked';
    G.objectiveLock = {
      title: 'Go to <b>Delgado\'s Diner</b>',
      sub: 'Mission 1 of 5: First Run — walk into the blue marker',
    };
  } else if (name === 'mission') {
    G.hour = 15.4;
    p.mesh.position.set(MARINA_X, 0.3, 238);
    p.angle = 0;
    p.camYaw = 0;
    p.aiming = true;
    G.combat.spawnRival(MARINA_X - 3.5, 256);
    G.combat.spawnRival(MARINA_X + 3, 266);
    G.combat.spawnRival(MARINA_X - 1, 276);
    G.objectiveLock = {
      title: 'Clear the <b>Tide Kings</b> off the pier',
      sub: 'Marina Muscle — stage 2/4',
    };
    G.missions.beam.visible = G.missions.ring.visible = true;
    G.missions.beam.position.x = MARINA_X;
    G.missions.beam.position.z = 262;
    G.missions.ring.position.x = MARINA_X;
    G.missions.ring.position.z = 262;
    G.shotWaypoint = { x: MARINA_X, z: 262 };
  } else if (name === 'night') {
    G.hour = 22.7;
    G.save.missionIndex = 5; // story done: free roam, no waypoint
    const car = G.carManager.spawn(0x8b5cf6, -60, 84.2, Math.PI / 2, {});
    car.kind = 'parked';
    putPlayerInCar(G, car);
    G.police.setWanted(2);
    G.police.spawnCopAt(-96, 88.2);
    G.input.keys.add('w');
    G.shotTarget = { x: 185, z: 84 };
    G.objectiveLock = {
      title: 'Free roam — the city is yours',
      sub: 'Story complete. Steal cars, chase stars, beat your best.',
    };
  }
  void PLACES;
  // Screenshots read the HUD exactly like a player would.
  G.hud.show();
}

// Runs every frame in shot mode, before the world updates.
export function updateShot(G, dt) {
  const name = G.shotMode;
  if (!name) return;
  G.shotTime = (G.shotTime || 0) + dt;
  if (name === 'cover') {
    driveToward(G, 4, 190);
    // Cap the pace so the pursuit stays in frame behind the player.
    const car = G.player.car;
    if (car && car.speed > 23) G.input.keys.delete('w');
    else G.input.keys.add('w');
  } else if (name === 'night') {
    const car = G.player.car;
    if (car && G.shotTarget) {
      const d = Math.hypot(G.shotTarget.x - car.mesh.position.x, G.shotTarget.z - car.mesh.position.z);
      if (d < 14) G.shotTarget = G.shotTarget.x > 0 ? { x: -185, z: 76 } : { x: 185, z: 84 };
      driveToward(G, G.shotTarget.x, G.shotTarget.z);
      if (car.speed > 30) G.input.keys.delete('w');
      else G.input.keys.add('w');
    }
  } else if (name === 'mission') {
    G.player.aiming = true;
    G.player.angle = 0;
    G.player.camYaw = 0;
  }
  if (G.objectiveLock) G.objective = { ...G.objectiveLock };
  if (G.shotTime > 1.2 && !window.__shotReady) window.__shotReady = true;
}
