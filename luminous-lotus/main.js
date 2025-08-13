// Luminous Lotus — Phaser 3 single-file game logic
// Visual: serene bioluminescent lotus floating on a midnight pond.
// Gameplay: move the lotus (mouse/touch) to collect motes and grow. Avoid dark ripples.

const WIDTH = Math.min(window.innerWidth, 900);
const HEIGHT = Math.min(window.innerHeight, 700);

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: 0x071025,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

let lotus, motes, ripples, particles, scoreText, score = 0, started = false, speed = 0.12, size = 1;
let bgMusic, sfxCollect, sfxHurt;
let targetX = null, targetY = null;

function preload() {
  // simple generated assets using graphics — but we'll load a small audio file
  // use local backing track provided in the folder
  this.load.audio('bg', 'main track.mp3');
  // load local SFX from nearby project folders (fallback to local assets so no CDN 404s)
  this.load.audio('collect', '../aurora-bloom/Soothe.mp3');
  this.load.audio('hurt', '../moth-drift/main track with fx.mp3');
}

function create() {
  // Use the Phaser-provided `this` scene. If it's unexpectedly missing `add`, bail.
  if (!this || !this.add) return;
  const scene = this;

  // background gradient
  const g = scene.add.graphics();
  // draw a simple layered gradient by painting several semi-transparent rectangles
  const topColor = Phaser.Display.Color.ValueToColor(0x071025);
  const bottomColor = Phaser.Display.Color.ValueToColor(0x0b2a3a);
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const col = Phaser.Display.Color.Interpolate.ColorWithColor(topColor, bottomColor, steps - 1, i);
    const rgb = Phaser.Display.Color.GetColor(col.r, col.g, col.b);
    g.fillStyle(rgb, 1 - (i * 0.04));
    g.fillRect(0, (HEIGHT / steps) * i, WIDTH, Math.ceil(HEIGHT / steps));
  }

  // gentle floating particles
  // (no global particle manager needed here)
  particles = null;

  // lotus sprite produced with graphics texture
  const lotusGfx = scene.make.graphics({ x: 0, y: 0, add: false });
  drawLotus(lotusGfx, 140, 140);
  // create texture with transparent background
  lotusGfx.generateTexture('lotusTex', 140, 140);

  // physics-enabled lotus so overlaps work reliably
  lotus = scene.physics.add.sprite(WIDTH/2, HEIGHT/2, 'lotusTex').setInteractive();
  lotus.setScale(0.8);
  lotus.setDepth(2);
  lotus.body.setCircle(42);
  lotus.body.setCollideWorldBounds(true);

  // motes group
  motes = scene.physics.add.group();
  ripples = scene.physics.add.group();

  // score text
  scoreText = scene.add.text(12, 12, 'Score: 0', { font: '18px Inter, Arial', fill: '#e6f7ff' });

  // spawn loop (tuned caps)
  scene.time.addEvent({ delay: 900, callback: spawnMote, callbackScope: scene, loop: true });
  scene.time.addEvent({ delay: 1600, callback: spawnRipple, callbackScope: scene, loop: true });

  // collisions
  scene.physics.add.overlap(lotus, motes, collectMote, null, scene);
  scene.physics.add.overlap(lotus, ripples, hitRipple, null, scene);

  // input: track target coordinates and lerp in update to avoid many tweens
  scene.input.on('pointermove', p => {
    if (!started) return;
    targetX = p.x; targetY = p.y;
  });

  scene.input.once('pointerdown', () => {
    if (!started) startGame(scene);
    scene.input.on('pointermove', p => { targetX = p.x; targetY = p.y; });
  });

  // audio
  bgMusic = scene.sound.add('bg', { loop: true, volume: 0.5 });
  sfxCollect = scene.sound.add('collect', { volume: 0.9 });
  sfxHurt = scene.sound.add('hurt', { volume: 0.9 });

  // small intro pulse
  scene.tweens.add({ targets: lotus, scale: 0.9, duration: 1200, yoyo: true, loop: -1, ease: 'Sine.easeInOut' });
}

function update(time, delta) {
  // gentle rotation
  if (!lotus) return;
  lotus.rotation += 0.001 * delta;
  // smooth follow to target
  if (targetX !== null && targetY !== null) {
    // move lotus body toward target using velocity for arcade overlap accuracy
    const dx = targetX - lotus.x;
    const dy = targetY - lotus.y;
    lotus.body.setVelocity(dx * 6, dy * 6);
    // dampen when close
    if (Math.abs(dx) < 4 && Math.abs(dy) < 4) lotus.body.setVelocity(0,0);
  } else {
    lotus.body.setVelocity(0,0);
  }
}

function startGame(scene) {
  started = true;
  score = 0;
  size = 0.8;
  lotus.setScale(size);
  // resume WebAudio context if suspended due to autoplay policy, then play
  try {
    const soundSystem = scene.sound && scene.sound.context ? scene.sound : null;
    if (soundSystem && soundSystem.context && soundSystem.context.state === 'suspended') {
      soundSystem.context.resume().then(() => { bgMusic.play(); }).catch(() => { bgMusic.play(); });
    } else {
      bgMusic.play();
    }
  } catch (e) {
    // fallback
    if (bgMusic && bgMusic.play) bgMusic.play();
  }
}

function spawnMote() {
  const scene = (this && this.add) ? this : (game && game.scene && game.scene.scenes[0]);
  // cap motes
  if (motes.getChildren().length > 30) return;
  const x = Phaser.Math.Between(40, WIDTH - 40);
  const y = Phaser.Math.Between(40, HEIGHT - 40);
  const mote = scene.add.circle(x, y, 8, 0xa0f8ff, 0.9);
  scene.physics.add.existing(mote);
  mote.body.setCircle(8);
  mote.body.setVelocity(Phaser.Math.Between(-30,30), Phaser.Math.Between(-30,30));
  mote.body.setBounce(1,1);
  mote.body.setCollideWorldBounds(true);
  mote.glow = scene.tweens.add({ targets: mote, alpha: { from: 0.6, to: 1 }, duration: 800, yoyo: true, loop: -1 });
  motes.add(mote);
  // fade out after some time
  scene.time.addEvent({ delay: 9000, callback: ()=>{ if (mote) { if (mote.glow && mote.glow.stop) mote.glow.stop(); if (mote.destroy) mote.destroy(); } }, callbackScope: scene });
}

function spawnRipple() {
  const scene = (this && this.add) ? this : (game && game.scene && game.scene.scenes[0]);
  // cap ripples
  if (ripples.getChildren().length > 8) return;
  const x = Phaser.Math.Between(60, WIDTH - 60);
  const y = Phaser.Math.Between(60, HEIGHT - 60);
  const ripple = scene.add.circle(x, y, 10, 0x5fe6ff, 0.55).setBlendMode(Phaser.BlendModes.ADD);
  scene.physics.add.existing(ripple);
  ripple.body.setImmovable(true);
  ripples.add(ripple);
  // initialize small and grow + fade
  ripple.setScale(0.2);
  scene.tweens.add({ targets: ripple, scale: 1.6, alpha: 0, duration: 3000, ease: 'Sine.easeOut', onComplete(){ if (ripple && ripple.destroy) ripple.destroy(); } });
}

function collectMote(lotusSprite, mote) {
  score += 10;
  scoreText.setText('Score: ' + score);
  sfxCollect.play();
  // grow lotus slightly
  size = Math.min(1.6, lotusSprite.scale + 0.05);
  lotusSprite.setScale(size);
  // particle burst (manual small circles to avoid ParticleEmitterManager usage)
  const scene = game && game.scene && game.scene.scenes[0];
  if (scene) {
    const burstCount = 12;
    for (let i = 0; i < burstCount; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.Between(6, 28);
      const px = mote.x;
      const py = mote.y;
      const c = scene.add.circle(px, py, Phaser.Math.Between(2, 5), 0xaef6ff, 0.9).setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({ targets: c, x: px + Math.cos(angle) * dist, y: py + Math.sin(angle) * dist, alpha: 0, scale: 0.2, duration: 600 + Phaser.Math.Between(0,300), ease: 'Sine.easeOut', onComplete(){ if (c && c.destroy) c.destroy(); } });
    }
  }
  // stop glow tween if present
  if (mote && mote.glow && mote.glow.stop) mote.glow.stop();
  mote.destroy();
}

function hitRipple(lotusSprite, ripple) {
  sfxHurt.play();
  score = Math.max(0, score - 15);
  scoreText.setText('Score: ' + score);
  size = Math.max(0.5, lotusSprite.scale - 0.12);
  lotusSprite.setScale(size);
  // brief flash
  const scene = game.scene.scenes[0];
  scene.cameras.main.flash(250, 20, 40, 50);
  ripple.destroy();
}

function drawLotus(g, w, h) {
  // draws a stylized lotus shape into the provided graphics object
  g.clear();
  // leave background transparent for texture
  // center glow
  const cx = w/2, cy = h/2 + 10;
  for (let i=6;i>0;i--) {
    const col = Phaser.Display.Color.GetColor(30 + i*30, 150 + i*8, 170 + i*5);
    g.fillStyle(col, 0.06 * i);
    g.fillEllipse(cx, cy, w * (0.6 + i*0.025), h * (0.6 + i*0.025));
  }
  // petals (drawn as filled triangle clusters for compatibility)
  g.fillStyle(0x9ef0ff, 1);
  drawPetal(g, cx, cy, 0, w*0.35, h*0.35);
  drawPetal(g, cx, cy, Math.PI/5, w*0.34, h*0.34);
  drawPetal(g, cx, cy, -Math.PI/5, w*0.34, h*0.34);
  drawPetal(g, cx, cy, Math.PI/2.2, w*0.3, h*0.32);
  drawPetal(g, cx, cy, -Math.PI/2.2, w*0.3, h*0.32);
  // core
  g.fillStyle(0xfff7d6, 1);
  g.fillCircle(cx, cy+4, 8);
}

function drawPetal(g, cx, cy, ang, rw, rh) {
  // approximate a petal with two triangles sharing the tip for a smooth look
  const tipX = cx + Math.cos(ang) * rw;
  const tipY = cy + Math.sin(ang) * rh;
  const side1x = cx + Math.cos(ang + 0.6) * rw * 0.7;
  const side1y = cy + Math.sin(ang + 0.6) * rh * 0.7;
  const side2x = cx + Math.cos(ang - 0.6) * rw * 0.7;
  const side2y = cy + Math.sin(ang - 0.6) * rh * 0.7;
  // draw two triangles to form a petal
  g.fillTriangle(cx, cy, side1x, side1y, tipX, tipY);
  g.fillTriangle(cx, cy, side2x, side2y, tipX, tipY);
}
