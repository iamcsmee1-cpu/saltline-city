// Saltline City — boot and the one game loop. Builds the world, wires the
// systems together (crime → police, crashes → damage, missions → HUD),
// owns the day/night cycle, menus, pause, and busted/wasted flow.

import * as THREE from 'three';
import {
  PALETTE, CRIME, WORLD, clamp, lerp, dist2d,
} from './config.js';
import { City } from './city.js';
import { CarManager } from './vehicles.js';
import { Pedestrians } from './pedestrians.js';
import { Player } from './player.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions } from './missions.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { loadSave, storeSave, wipeSave, scoreOf } from './save.js';
import { shotName, setupShot, updateShot } from './shots.js';

const $ = (id) => document.getElementById(id);

// ---------- renderer / scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.skyDay);
scene.fog = new THREE.Fog(PALETTE.skyDay, 180, 620);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
camera.position.set(88, 6, -66);

const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3a4a3a, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -210;
sun.shadow.camera.right = 210;
sun.shadow.camera.top = 210;
sun.shadow.camera.bottom = -210;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0015;
sun.shadow.normalBias = 2.2;
scene.add(sun);
scene.add(sun.target);
const moonGlow = new THREE.DirectionalLight(0x8fb4ff, 0);
moonGlow.position.set(-120, 200, -80);
scene.add(moonGlow);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- game state ----------
const G = {
  scene, camera, renderer,
  elapsed: 0,
  hour: WORLD.startHour,
  playing: false,
  paused: false,
  over: false,
  shotMode: null,
  shotTime: 0,
  shake: 0,
  minWanted: 0,
  heatDecayBoost: false,
  objective: null,
  objectiveLock: null,
  mouseOrbit: 0,
  cars: [],
  peds: [],
  rivals: [],
  save: loadSave(),
  saveModule: { storeSave },
  input: {
    keys: new Set(),
    pressed: new Set(),
    mouseDown: false,
    get moving() { return this.keys.has('w') || this.keys.has('a') || this.keys.has('s') || this.keys.has('d'); },
  },
};
window.__G = G; // debugging handle

G.audio = new GameAudio();
G.city = new City(scene);
G.carManager = new CarManager(scene, G);
G.pedsModule = new Pedestrians(scene, G);
G.player = new Player(scene, G);
G.police = new Police(scene, G);
G.combat = new Combat(scene, G);
G.missions = new Missions(scene, G);
G.hud = new Hud(G);

G.carManager.spawnInitial();
G.pedsModule.spawnInitial();

// Building facade materials, for the night window glow.
const facadeMats = [];
scene.traverse((obj) => {
  if (obj.material && obj.material.emissiveMap) facadeMats.push(obj.material);
});

// ---------- crime & consequence wiring ----------
G.onCrime = (type, x, z) => {
  const points = CRIME[type] || 0;
  if (points > 0) {
    // Crimes in plain sight of the law — or of a crowd who will call it
    // in — raise the heat. Quiet ones in empty streets may pass.
    const copNear = G.police.nearestCopDistance() < 70;
    let crowdNear = false;
    for (const ped of G.peds) {
      if (!ped.dead && dist2d(x, z, ped.mesh.position.x, ped.mesh.position.z) < 26) { crowdNear = true; break; }
    }
    if (copNear || crowdNear || type === 'gunshot') G.police.addWanted(points);
    else if (type === 'stealCar') G.police.addWanted(points * 0.5);
  }
  if (type === 'gunshot' || type === 'killPedestrian' || type === 'hitPedestrian') {
    G.pedsModule.scare(x, z, 30);
  }
};

const SPAWN = { x: 86.5, z: -66 };
function endRun(kind) {
  G.over = true;
  G.playing = false;
  document.exitPointerLock?.();
  const fine = kind === 'busted'
    ? Math.min(G.save.money, 120 + G.police.stars * 70)
    : Math.min(G.save.money, 150);
  G.save.money -= fine;
  if (kind === 'busted') G.save.timesBusted += 1;
  else G.save.timesWasted += 1;
  storeSave(G.save);
  G.audio.fail();
  $('endTitle').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  $('endText').textContent = kind === 'busted'
    ? `The Saltline PD finally boxed Mara in. Bail and "fees" cost $${fine}. Delgado is not impressed.`
    : `Mara wakes up in Saltline General with a $${fine} hospital bill and a new scar. The city keeps turning.`;
  $('endScreen').classList.add('on');
  G.hud.hide();
}

G.onBusted = () => { if (!G.over) endRun('busted'); };
G.onWasted = () => { if (!G.over) endRun('wasted'); };

function respawn() {
  $('endScreen').classList.remove('on');
  $('pauseScreen').classList.remove('on');
  G.over = false;
  G.police.clearWanted();
  G.minWanted = 0;
  G.combat.clearRivals();
  if (G.missions.active) {
    // A failed run keeps the mission, but its fight starts fresh.
    const stage = G.missions.active.stages[G.missions.stageIndex];
    if (stage && stage.start && G.missions.fightRivals.length) {
      G.missions.fightRivals = [];
      stage.start(G, G.missions);
    }
  }
  G.player.reset(SPAWN);
  G.player.angle = Math.PI / 2;
  G.player.camYaw = Math.PI / 2;
  G.hud.show();
  G.playing = true;
}

// Cars vs pedestrians: the city's least popular interaction.
const pedHitCd = new WeakMap();
function carPedCollisions() {
  for (const car of G.cars) {
    if (car.dead || Math.abs(car.speed) < 3.2) continue;
    for (const ped of G.peds) {
      if (ped.dead || ped.state === 'down') continue;
      const d = dist2d(car.mesh.position.x, car.mesh.position.z, ped.mesh.position.x, ped.mesh.position.z);
      if (d > 3.1) continue;
      if (pedHitCd.get(ped) && G.elapsed - pedHitCd.get(ped) < 2) continue;
      pedHitCd.set(ped, G.elapsed);
      const wasAlive = ped.health > 0;
      const result = G.pedsModule.damage(ped, Math.abs(car.speed) * 4.5);
      if (car.driver === 'player') {
        G.onCrime(result === 'killed' && wasAlive ? 'killPedestrian' : 'hitPedestrian',
          ped.mesh.position.x, ped.mesh.position.z);
        G.audio.crash(0.5);
        G.shake = Math.max(G.shake, 0.22);
        car.speed *= 0.55;
      }
    }
  }
}

// ---------- input ----------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
  if (!G.input.keys.has(k)) G.input.pressed.add(k);
  G.input.keys.add(k);
  if (!G.shotMode && G.playing && !G.paused && !G.over) {
    if (k === 'e') G.player.tryEnter();
    if (k === 'f') G.combat.tryMelee();
  }
  if ((k === 'p' || k === 'escape') && G.playing) togglePause();
});
window.addEventListener('keyup', (e) => G.input.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => G.input.keys.clear());
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) {
    G.input.mouseDown = true;
    if (G.playing && !G.paused && !G.over && !G.shotMode) G.combat.tryShoot();
  }
  if (e.button === 2) G.player.aiming = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) G.input.mouseDown = false;
  if (e.button === 2) G.player.aiming = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('click', () => {
  if (G.playing && !G.paused && !G.shotMode && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || !G.playing) return;
  const p = G.player;
  if (p.driving) {
    G.mouseOrbit = clamp(G.mouseOrbit + e.movementX * 0.0022, -1.4, 1.4);
  } else {
    p.camYaw -= e.movementX * 0.0028;
    p.camPitch = clamp(p.camPitch + e.movementY * 0.0028, -0.12, 1.15);
  }
});

// Hold-to-fire: repeat shots while the mouse is held.
let fireHeld = 0;

// ---------- menus ----------
function refreshStartStats() {
  const s = G.save;
  $('startStats').textContent = s.missionIndex > 0 || s.totalEarned > 0
    ? `Saved game — $${s.money} • ${s.missionIndex}/5 missions • score ${scoreOf(s)}`
    : 'New game — no save yet. Progress autosaves.';
  $('pauseStats').textContent =
    `Money $${s.money} • Missions ${s.missionIndex}/5 • Cars stolen ${s.carsStolen} • Busted ${s.timesBusted} • Wasted ${s.timesWasted} • Best heat ${s.bestStars}★ • Score ${scoreOf(s)}`;
}
function togglePause() {
  if (G.over) return;
  G.paused = !G.paused;
  $('pauseScreen').classList.toggle('on', G.paused);
  if (G.paused) { refreshStartStats(); document.exitPointerLock?.(); }
}
$('startBtn').addEventListener('click', () => {
  G.audio.init();
  $('startScreen').classList.remove('on');
  G.hud.show();
  G.playing = true;
  G.hud.toast('Welcome to Saltline City. Delgado is waiting at his diner — follow the blue marker.');
});
$('wipeBtn').addEventListener('click', () => {
  wipeSave();
  G.save = loadSave();
  refreshStartStats();
});
$('resumeBtn').addEventListener('click', togglePause);
$('restartBtn').addEventListener('click', () => { G.paused = false; respawn(); });
$('respawnBtn').addEventListener('click', respawn);
refreshStartStats();

// ---------- day / night ----------
const skyDay = new THREE.Color(PALETTE.skyDay);
const skySunset = new THREE.Color(PALETTE.skySunset);
const skyNight = new THREE.Color(PALETTE.skyNight);
const sunDay = new THREE.Color(PALETTE.sunDay);
const sunSet = new THREE.Color(PALETTE.sunSunset);
const tmpColor = new THREE.Color();

function updateSky() {
  const ang = ((G.hour - 6) / 12) * Math.PI;      // sunrise 6h, sunset 18h
  const elev = Math.sin(ang);
  const dayF = clamp(elev * 2.4, 0, 1);
  const duskF = clamp(1 - Math.abs(elev) * 3.2, 0, 1) * (G.hour > 4 && G.hour < 21 ? 1 : 0);
  tmpColor.copy(skyNight).lerp(skyDay, dayF).lerp(skySunset, duskF * 0.65);
  scene.background.copy(tmpColor);
  scene.fog.color.copy(tmpColor);
  sun.position.set(Math.cos(ang) * 320, Math.max(14, elev * 300), 140);
  sun.target.position.set(G.player.x, 0, G.player.z);
  sun.position.x += G.player.x;
  sun.position.z += G.player.z;
  sun.intensity = 0.25 + dayF * 1.5;
  sun.color.copy(sunDay).lerp(sunSet, duskF);
  moonGlow.intensity = (1 - dayF) * 0.35;
  hemi.intensity = 0.34 + dayF * 0.6;
  const nightF = 1 - dayF;
  for (const m of facadeMats) m.emissiveIntensity = nightF * 1.15;
  G.city.update(0, G.elapsed, nightF);
  return nightF;
}

// ---------- shot mode ----------
const shot = shotName();
if (shot) {
  $('startScreen').classList.remove('on');
  G.playing = true;
  setupShot(G, shot);
}

// ---------- the loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.paused) dt = 0;
  G.elapsed += dt;

  if (dt > 0) {
    G.hour = (G.hour + (dt * 24) / WORLD.dayLength) % 24;
    if (G.shotMode) updateShot(G, dt);
    if (G.playing && !G.over) {
      G.player.update(dt);
      G.carManager.updateTraffic(dt);
      G.carManager.resolveCarPairs((a, b, strength) => {
        if (a.driver === 'player' || b.driver === 'player') {
          G.onCrime('hitCar', G.player.x, G.player.z);
          G.audio.crash(clamp(strength / 26, 0.3, 1));
          G.shake = Math.max(G.shake, 0.18);
        } else if (dist2d(G.player.x, G.player.z, a.mesh.position.x, a.mesh.position.z) < 30) {
          G.audio.crash(0.25);
        }
      });
      carPedCollisions();
      G.police.update(dt);
      G.pedsModule.update(dt);
      G.combat.update(dt);
      if (!G.shotMode) G.missions.update(dt);
      else if (G.objectiveLock) G.objective = { ...G.objectiveLock };
      // Hold-to-fire.
      if (G.input.mouseDown && !G.player.driving) {
        fireHeld += dt;
        if (fireHeld > 0.12) G.combat.tryShoot();
      } else fireHeld = 0;
      if (!G.shotMode) {
        G.player.aiming = G.input.mouseDown
          || (G.player.aiming && document.pointerLockElement === canvas);
      }
    }
    updateSky();
    // Audio follows the action.
    let sirenDist = Infinity;
    if (G.police.cars.length) sirenDist = G.police.nearestCopDistance();
    G.audio.update(dt, {
      driving: G.player.driving,
      speedRatio: G.player.driving ? G.player.speed / 46 : 0,
      sirenDistance: sirenDist,
    });
    G.mouseOrbit = lerp(G.mouseOrbit, 0, clamp(dt * 1.6, 0, 1));
  }
  G.hud.update();
  G.input.pressed.clear();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
