// Saltline City — the story: five jobs for fixer Delgado, run in order,
// with free-roam between them. Each mission is a list of stages; a stage
// is a place to reach, a car to steal, a crew to clear, or heat to lose.
// Owns the glowing world marker and the objective text on the HUD.

import * as THREE from 'three';
import { PLACES, MARINA_X, dist2d } from './config.js';

const at = (place, radius) => ({
  target: () => place,
  check: (G) => dist2d(G.player.x, G.player.z, place.x, place.z) < radius,
});

export class Missions {
  constructor(scene, G) {
    this.scene = scene;
    this.G = G;
    this.active = null;      // mission definition being run
    this.activeIndex = -1;
    this.stageIndex = 0;
    this.targetCar = null;
    this.fightRivals = [];
    this.stageTime = 0;

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb020, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 42, 18, 1, true), beamMat);
    this.beam.position.y = 21;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb020, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.9, 28), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.25;
    this.beam.visible = false;
    this.ring.visible = false;
    scene.add(this.beam, this.ring);

    this.defs = this.#definitions();
  }

  #definitions() {
    const D = PLACES.delgado, GAR = PLACES.garage, HID = PLACES.hideout;
    const WH = PLACES.warehouse, LOT = PLACES.beachLot, ALLEY = PLACES.alley;
    return [
      {
        title: 'First Run', pay: 350,
        intro: [
          ['Delgado', 'Mara. A package is sitting in Canal Alley and the tide — and my patience — wait for no one.'],
          ['Delgado', 'Pick it up, bring it here. Drive like you mean it.'],
        ],
        stages: [
          { text: 'Pick up the package in <b>Canal Alley</b>', ...at(ALLEY, 6.5),
            done: [['Mara', 'Got it. Smells like trouble and cheap cologne.']] },
          { text: 'Deliver the package to <b>Delgado</b>', ...at(D, 8),
            done: [['Delgado', 'Clean work. You might survive this city yet.']] },
        ],
      },
      {
        title: 'Borrowed Wheels', pay: 600,
        intro: [
          ['Delgado', 'A gold coupe is sunning itself at the Beachfront Lot. Its owner owes me.'],
          ['Delgado', 'Take it. Bring it to Saltline Customs. If the police object — lose them.'],
        ],
        stages: [
          { text: 'Steal the <b>gold coupe</b> at the Beachfront Lot',
            target: () => LOT,
            check: (G, M) => G.player.driving && G.player.car === M.targetCar,
            done: [['Mara', 'Sorry, friend. Delgado sends his regards.']] },
          { text: 'Deliver the coupe to <b>Saltline Customs</b>',
            target: () => GAR,
            check: (G, M) => G.player.driving && G.player.car === M.targetCar
              && dist2d(G.player.x, G.player.z, GAR.x, GAR.z) < 10,
            done: [['Delgado', 'Beautiful. The boys will strip it by sunrise.']] },
        ],
      },
      {
        title: 'Marina Muscle', pay: 900,
        intro: [
          ['Delgado', 'The Tide Kings crew are squatting on my pier, guarding a briefcase of mine.'],
          ['Delgado', 'Clear them out. Bring me the case. Try not to bleed on it.'],
        ],
        stages: [
          { text: 'Go to the <b>Saltline Marina</b> pier', ...at({ x: MARINA_X, z: 246 }, 9) },
          { text: 'Clear the <b>Tide Kings</b> off the pier',
            target: () => ({ x: MARINA_X, z: 262 }),
            start: (G, M) => {
              M.fightRivals = [
                G.combat.spawnRival(MARINA_X - 3, 258),
                G.combat.spawnRival(MARINA_X + 3.5, 268),
                G.combat.spawnRival(MARINA_X - 1, 278),
              ];
            },
            check: (G, M) => M.fightRivals.length > 0 && M.fightRivals.every((r) => r.dead),
            done: [['Mara', 'Pier is clear. The gulls can have what is left.']] },
          { text: 'Grab the <b>briefcase</b> at the end of the pier', ...at({ x: MARINA_X, z: 286 }, 5),
            done: [['Mara', 'Heavy. Whatever is in here, it is not sandwiches.']] },
          { text: 'Bring the briefcase to <b>Delgado</b>', ...at(D, 8),
            done: [['Delgado', 'You are becoming my favourite mistake, Mara.']] },
        ],
      },
      {
        title: 'Heat Check', pay: 1100,
        intro: [
          ['Delgado', 'The PD is rolling a new task force and you are their poster girl.'],
          ['Delgado', 'I need to know you can shake them. Three stars of heat — get to the hideout and go dark.'],
        ],
        stages: [
          { text: 'Get to the <b>Northwest Hideout</b> with the heat on',
            target: () => HID,
            start: (G) => { G.police.setWanted(3.2); G.minWanted = 3; },
            check: (G) => dist2d(G.player.x, G.player.z, HID.x, HID.z) < 13,
          },
          { text: '<b>Lose the heat</b> — stay low at the hideout',
            target: () => HID,
            start: (G) => { G.minWanted = 0; },
            check: (G) => {
              const near = dist2d(G.player.x, G.player.z, HID.x, HID.z) < 17;
              G.heatDecayBoost = near;
              return G.police.wanted < 0.4;
            },
            done: [['Delgado', 'Ghost. Exactly what I needed to see.']] },
        ],
      },
      {
        title: 'The Saltline Score', pay: 2000,
        intro: [
          ['Delgado', 'Last job. The marina warehouse holds a fortune in bonded cargo.'],
          ['Delgado', 'The Tide Kings guard it, the whole PD will chase it. Take it, and run it to the hideout.'],
        ],
        stages: [
          { text: 'Go to the <b>Marina Warehouse</b>', ...at(WH, 11) },
          { text: 'Clear the <b>Tide Kings</b> guarding the warehouse',
            target: () => WH,
            start: (G, M) => {
              M.fightRivals = [
                G.combat.spawnRival(44, 162, { shirt: 0x8b1e3f }),
                G.combat.spawnRival(76, 162, { shirt: 0x8b1e3f }),
                G.combat.spawnRival(48, 190, { shirt: 0x5b21b6 }),
                G.combat.spawnRival(72, 190, { shirt: 0x5b21b6 }),
              ];
            },
            check: (G, M) => M.fightRivals.length > 0 && M.fightRivals.every((r) => r.dead),
            done: [['Mara', 'Warehouse is mine. Now the loud part.']] },
          { text: 'Grab the <b>loot</b> at the warehouse door', ...at({ x: 60, z: 164 }, 5.5),
            start: (G) => { G.police.setWanted(2); },
          },
          { text: 'Escape to the <b>Northwest Hideout</b>',
            target: () => HID,
            start: (G) => { G.police.setWanted(4); G.minWanted = 2; },
            check: (G) => dist2d(G.player.x, G.player.z, HID.x, HID.z) < 13,
            done: [['Delgado', 'The Saltline Score. Done. You are a legend, Mara Voss.']] },
        ],
      },
    ];
  }

  get finished() { return this.G.save.missionIndex >= this.defs.length; }

  #startMission(index) {
    const G = this.G;
    const def = this.defs[index];
    this.active = def;
    this.activeIndex = index;
    this.stageIndex = 0;
    this.stageTime = 0;
    if (index === 1) {
      // "Borrowed Wheels": the gold coupe waits at the beachfront lot.
      this.targetCar = G.carManager.spawn(0xe8b923, PLACES.beachLot.x, PLACES.beachLot.z, Math.PI / 2, {});
      this.targetCar.kind = 'parked';
      this.targetCar.missionTarget = true;
    }
    G.hud.dialog(def.intro);
    G.hud.banner(`MISSION ${index + 1}`, def.title);
    G.audio.phone();
    const stage = def.stages[0];
    if (stage.start) stage.start(G, this);
  }

  #completeMission() {
    const G = this.G;
    const def = this.active;
    G.save.money += def.pay;
    G.save.totalEarned += def.pay;
    G.save.missionIndex = this.activeIndex + 1;
    if (this.activeIndex === this.defs.length - 1) {
      G.save.finishedStory = true;
      G.minWanted = 0;
    }
    if (this.targetCar) { this.targetCar.missionTarget = false; this.targetCar = null; }
    G.heatDecayBoost = false;
    const { storeSave } = G.saveModule;
    storeSave(G.save);
    G.hud.banner('MISSION COMPLETE', `${def.title}  •  +$${def.pay}`);
    G.hud.dialog([[ 'Delgado', `Paid in full: $${def.pay}. ${this.finished ? 'That was the last job — the city is yours now.' : 'Come see me for the next one.'}` ]]);
    G.audio.success();
    G.audio.cash();
    this.active = null;
    this.activeIndex = -1;
  }

  #advanceStage() {
    const G = this.G;
    const stage = this.active.stages[this.stageIndex];
    if (stage.done) G.hud.dialog(stage.done);
    this.stageIndex += 1;
    this.stageTime = 0;
    if (this.stageIndex >= this.active.stages.length) {
      this.#completeMission();
      return;
    }
    const next = this.active.stages[this.stageIndex];
    if (next.start) next.start(G, this);
    G.audio.objective();
  }

  // Where the minimap waypoint and the world marker should point.
  currentTarget() {
    if (this.active) {
      const stage = this.active.stages[this.stageIndex];
      return stage.target ? stage.target() : null;
    }
    if (!this.finished) return PLACES.delgado;
    return null;
  }

  update(dt) {
    const G = this.G;
    const target = this.currentTarget();
    // Marker visuals.
    if (target) {
      this.beam.visible = this.ring.visible = true;
      this.beam.position.x = target.x;
      this.beam.position.z = target.z;
      this.ring.position.x = target.x;
      this.ring.position.z = target.z;
      const active = !!this.active;
      const color = active ? 0xffb020 : 0x22d3ee;
      this.beam.material.color.setHex(color);
      this.ring.material.color.setHex(color);
      this.ring.scale.setScalar(1 + Math.sin(G.elapsed * 3.4) * 0.12);
      this.beam.material.opacity = 0.3 + Math.sin(G.elapsed * 2.2) * 0.07;
    } else {
      this.beam.visible = this.ring.visible = false;
    }

    if (!this.active) {
      if (!this.finished) {
        G.objective = {
          title: `Go to <b>Delgado's Diner</b>`,
          sub: `Mission ${G.save.missionIndex + 1} of ${this.defs.length}: ${this.defs[G.save.missionIndex].title} — walk into the blue marker`,
        };
        if (dist2d(G.player.x, G.player.z, PLACES.delgado.x, PLACES.delgado.z) < 5.5) {
          this.#startMission(G.save.missionIndex);
        }
      } else {
        G.objective = { title: 'Free roam — the city is yours', sub: 'Story complete. Steal cars, chase stars, beat your best.' };
      }
      return;
    }

    this.stageTime += dt;
    const stage = this.active.stages[this.stageIndex];
    const dest = stage.target ? stage.target() : null;
    const dist = dest ? Math.round(dist2d(G.player.x, G.player.z, dest.x, dest.z)) : 0;
    G.objective = {
      title: stage.text,
      sub: `${this.active.title} — stage ${this.stageIndex + 1}/${this.active.stages.length}${dest ? ` • ${dist} m` : ''}`,
    };
    if (stage.check && stage.check(G, this)) this.#advanceStage();
  }
}
