// Saltline City — HUD: vitals, money, wanted stars, objective card,
// prompts, dialogue toasts, banners, the busted meter, and the live
// canvas minimap (roads, traffic, police, pedestrians, waypoint).

import { STREETS, WORLD_EDGE, clamp } from './config.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(G) {
    this.G = G;
    this.root = $('hud');
    this.healthBar = $('healthBar');
    this.moneyEl = $('money');
    this.wantedEl = $('wanted');
    this.objectiveEl = $('objective');
    this.promptEl = $('prompt');
    this.toastEl = $('toast');
    this.bannerEl = $('banner');
    this.speedoEl = $('speedo');
    this.speedNum = this.speedoEl.querySelector('.num');
    this.crosshairEl = $('crosshair');
    this.hitEl = $('hitmarker');
    this.bustedEl = $('bustedMeter');
    this.bustedBar = $('bustedBar');
    this.damageVin = $('damageVin');
    this.map = $('minimap').getContext('2d');
    this.promptText = undefined;
    this.toastUntil = 0;
    this.bannerUntil = 0;
    this.hitUntil = 0;
    this.damageUntil = 0;
    this.dialogQueue = [];
    this.dialogUntil = 0;
    this.lastObjectiveHtml = '';
    this.frame = 0;
  }

  show() { this.root.classList.add('on'); }
  hide() { this.root.classList.remove('on'); }

  setPrompt(html) {
    if (html === this.promptText) return;
    this.promptText = html;
    if (html) {
      this.promptEl.innerHTML = html;
      this.promptEl.style.display = 'block';
      this.promptEl.className = 'panel';
    } else {
      this.promptEl.style.display = 'none';
    }
  }

  toast(text, who = null) {
    this.dialogQueue.push([who, text]);
  }

  dialog(lines) {
    for (const [who, text] of lines) this.dialogQueue.push([who, text]);
  }

  banner(big, small = '') {
    this.bannerEl.querySelector('.big').textContent = big;
    this.bannerEl.querySelector('.small').textContent = small;
    this.bannerEl.style.display = 'block';
    this.bannerUntil = this.G.elapsed + 2.8;
  }

  hitmarker() { this.hitUntil = this.G.elapsed + 0.12; }
  flashDamage() { this.damageUntil = this.G.elapsed + 0.35; }

  setBusted(progress) {
    if (progress > 0.02) {
      this.bustedEl.style.display = 'block';
      this.bustedBar.style.width = `${Math.round(progress * 100)}%`;
    } else {
      this.bustedEl.style.display = 'none';
    }
  }

  #updateDialog() {
    const now = this.G.elapsed;
    if (now < this.dialogUntil) return;
    const next = this.dialogQueue.shift();
    if (!next) {
      this.toastEl.style.display = 'none';
      return;
    }
    const [who, text] = next;
    this.toastEl.innerHTML = who ? `<span class="who">${who}:</span> ${text}` : text;
    this.toastEl.style.display = 'block';
    this.toastEl.className = 'panel';
    this.dialogUntil = now + Math.min(6, 2.2 + text.length * 0.045);
  }

  update() {
    const G = this.G;
    const p = G.player;
    this.frame += 1;
    this.healthBar.style.width = `${clamp(p.health, 0, 100)}%`;
    this.healthBar.style.background = p.health < 30
      ? 'linear-gradient(90deg,#ff2222,#ff5147)'
      : 'linear-gradient(90deg,#ff2e88,#ff7a59)';
    this.moneyEl.textContent = `$${G.save.money.toLocaleString('en-US')}`;

    const stars = G.police ? G.police.stars : 0;
    if (stars > 0) {
      this.wantedEl.classList.remove('hidden');
      let html = '';
      for (let i = 0; i < 5; i++) html += `<span class="${i < stars ? 'lit' : ''}">★</span>`;
      if (this.wantedEl.innerHTML !== html) this.wantedEl.innerHTML = html;
    } else {
      this.wantedEl.classList.add('hidden');
    }

    if (G.objective) {
      const html = `${G.objective.title}<span class="sub">${G.objective.sub || ''}</span>`;
      if (html !== this.lastObjectiveHtml) {
        this.objectiveEl.innerHTML = html;
        this.lastObjectiveHtml = html;
      }
      this.objectiveEl.style.display = 'block';
    } else {
      this.objectiveEl.style.display = 'none';
    }

    if (p.driving) {
      this.speedoEl.style.display = 'block';
      this.speedNum.textContent = String(Math.round(Math.abs(p.speed) * 3.6));
    } else {
      this.speedoEl.style.display = 'none';
    }
    this.crosshairEl.style.display = !p.driving && G.playing ? 'block' : 'none';
    this.hitEl.style.display = G.elapsed < this.hitUntil ? 'block' : 'none';
    this.bannerEl.style.display = G.elapsed < this.bannerUntil ? 'block' : 'none';
    this.damageVin.style.opacity = G.elapsed < this.damageUntil ? '1' : '0';
    this.#updateDialog();
    if (this.frame % 2 === 0) this.#drawMinimap();
  }

  #drawMinimap() {
    const G = this.G;
    const ctx = this.map;
    const S = 372;                       // canvas pixels
    const world = WORLD_EDGE + 130;      // half-extent mapped (covers marina)
    const toPx = (v) => (v / world) * (S / 2) + S / 2;
    ctx.fillStyle = '#101725';
    ctx.fillRect(0, 0, S, S);
    // Water + beach to the south.
    ctx.fillStyle = '#14425e';
    ctx.fillRect(0, toPx(226), S, S - toPx(226));
    ctx.fillStyle = '#8a7648';
    ctx.fillRect(0, toPx(194), S, toPx(226) - toPx(194));
    // Blocks.
    ctx.fillStyle = '#232c3d';
    for (const cx of [-120, -40, 40, 120]) {
      for (const cz of [-120, -40, 40, 120]) {
        ctx.fillRect(toPx(cx - 36), toPx(cz - 36), toPx(cx + 36) - toPx(cx - 36), toPx(cz + 36) - toPx(cz - 36));
      }
    }
    // Roads.
    ctx.strokeStyle = '#3d4a63';
    ctx.lineWidth = 5;
    for (const s of STREETS) {
      ctx.beginPath(); ctx.moveTo(toPx(s), 0); ctx.lineTo(toPx(s), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, toPx(s)); ctx.lineTo(S, toPx(s)); ctx.stroke();
    }
    // Marina pier.
    ctx.strokeStyle = '#6b543a';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(toPx(118), toPx(196)); ctx.lineTo(toPx(118), toPx(292)); ctx.stroke();

    const dot = (x, z, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toPx(x), toPx(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    // Traffic + parked.
    for (const car of G.cars) {
      if (car.kind === 'police') continue;
      if (car.driver === 'player') continue;
      dot(car.mesh.position.x, car.mesh.position.z, car.missionTarget ? '#ffd23e' : '#aebfd0', car.missionTarget ? 4.5 : 2.4);
    }
    // Police flash.
    const flash = Math.sin(G.elapsed * 7) > 0;
    for (const cop of G.police.cars) {
      dot(cop.mesh.position.x, cop.mesh.position.z, flash ? '#ff5147' : '#4d7dff', 3.6);
    }
    // Waypoint + line to it.
    const target = G.shotWaypoint !== undefined ? G.shotWaypoint
      : (G.missions ? G.missions.currentTarget() : null);
    const p = G.player;
    if (target) {
      ctx.strokeStyle = 'rgba(255, 210, 62, 0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(toPx(p.x), toPx(p.z));
      ctx.lineTo(toPx(target.x), toPx(target.z));
      ctx.stroke();
      ctx.setLineDash([]);
      dot(target.x, target.z, '#ffd23e', 5);
    }
    // Player arrow.
    const angle = p.driving && p.car ? p.car.angle : p.angle;
    ctx.save();
    ctx.translate(toPx(p.x), toPx(p.z));
    ctx.rotate(-angle + Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
