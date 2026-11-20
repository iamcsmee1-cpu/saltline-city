// Saltline City — tuning, palette and city layout in one place.
// Every other module reads its numbers from here so the game can be
// rebalanced (or re-skinned) without hunting through the code.

// ---------- city layout ----------
// Streets run along x and z at these coordinates; blocks sit between them.
export const STREETS = [-160, -80, 0, 80, 160];
export const ROAD_HALF = 8;              // half the width of a street
export const BLOCK = 64;                  // block face between two streets
export const WORLD_EDGE = 192;            // playable ground ends here
export const BEACH_Z = 196;               // sand starts (south edge)
export const WATER_Z = 226;               // water starts
export const MARINA_X = 118;              // pier centreline, runs into the sea
export const MARINA_END_Z = 292;

// Key places (x, z on the ground plane).
export const PLACES = {
  delgado: { x: 104, z: -74, name: "Delgado's Diner" },
  garage: { x: 172, z: -16, name: 'Saltline Customs' },
  hideout: { x: -168, z: -168, name: 'Northwest Hideout' },
  marina: { x: MARINA_X, z: 252, name: 'Saltline Marina' },
  warehouse: { x: 60, z: 176, name: 'Marina Warehouse' },
  beachLot: { x: -12, z: 168, name: 'Beachfront Lot' },
  alley: { x: -96, z: 92, name: 'Canal Alley' },
};

// ---------- palette ----------
export const PALETTE = {
  skyDay: 0x9fd8ef,
  skySunset: 0xff9a5c,
  skyNight: 0x0b1026,
  sunDay: 0xfff2d8,
  sunSunset: 0xffb37a,
  asphalt: 0x2e3138,
  sidewalk: 0x8d9299,
  sand: 0xe8cf9e,
  water: 0x1a6f8e,
  waterNight: 0x0d3550,
  grass: 0x4d7c4f,
  neonPink: 0xff2e88,
  neonCyan: 0x22d3ee,
  neonAmber: 0xffb020,
  neonViolet: 0x8b5cf6,
  buildingTints: [0xd9c9b8, 0xb8c4cc, 0xcbb7a6, 0xaebfd0, 0xd6d3ce, 0xc2b280, 0x9fb4a8, 0xd0a8a0],
  carColors: [0xd64541, 0x2e86de, 0xf5f6fa, 0x222f3e, 0xffa502, 0x2ed573, 0xeccc68, 0x747d8c, 0xa55eea, 0xfd9644, 0x4b6584, 0xc0392b],
  pedShirts: [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da, 0xfcbad3, 0xa8e6cf, 0xffd3b6, 0x6c5ce7],
  pedPants: [0x2d3436, 0x636e72, 0x3b3b98, 0x574b90, 0x30336b],
};

// ---------- player ----------
export const PLAYER = {
  walkSpeed: 7.5,
  runSpeed: 12,
  radius: 0.75,
  maxHealth: 100,
  meleeRange: 2.4,
  meleeDamage: 40,
  enterRange: 4.6,
};

// ---------- cars ----------
export const CAR = {
  accel: 26,
  brake: 42,
  maxSpeed: 46,          // m/s, ~165 km/h
  maxReverse: 12,
  turnRate: 1.9,         // rad/s at full lock, scaled by speed
  radius: 2.3,
  trafficSpeed: 11,
  parkedCount: 16,
  trafficCount: 15,
};

// ---------- police & wanted ----------
export const POLICE = {
  maxStars: 5,
  carSpeed: 49,          // slightly faster than the player car: pressure
  spawnDistance: 105,
  despawnDistance: 190,
  bustedRadius: 7.5,
  bustedTime: 2.6,       // seconds of being pinned before BUSTED
  loseSightTime: 9,      // unseen seconds before stars start to fall
  carsPerStar: 1,
};

// Crime → wanted points (wanted is a float, stars are its floor).
export const CRIME = {
  stealCar: 1,
  hitPedestrian: 2,
  hitCar: 0.34,
  gunshot: 0.5,
  killPedestrian: 2,
  fightRival: 0.25,
};

export const COMBAT = {
  pistolDamage: 34,
  pistolRange: 90,
  pistolCooldown: 0.22,
  rivalDamage: 6,        // per rival hit on the player
  rivalCooldown: 1.25,
  rivalRange: 38,
  rivalHealth: 70,
};

export const WORLD = {
  dayLength: 600,        // seconds for a full day-night cycle
  startHour: 16.8,       // late golden afternoon
  pedCount: 42,
};

// Small deterministic RNG (mulberry32) so the city is the same every load.
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// Shortest-path angle lerp.
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
