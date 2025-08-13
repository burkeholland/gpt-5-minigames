// main.js - Bioluminescent Night Garden (Phaser 3)
// Clean, commented, single-file game logic. Drops in next to index.html.

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: 0x05030a,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scene: {
    preload: preload,
    create: create,
    update: update
  }
};

const game = new Phaser.Game(config);

let moth;
let pointerTarget = { x: 0, y: 0 };
let pollenGroup;
let predators;
let score = 0;
let scoreText;
let timeText;
let startTime = 0;
let running = false;
let bgMusic;
let collectSound, hitSound;
let particles;
let streak = 0;
let highest = 0;
let style = { fontFamily: 'Arial', fontSize: '20px', color: '#bfefff' };
let overlayContainer = null;
let predatorTimer = null;

function preload() {
  // We'll generate simple graphics in runtime using graphics textures so there's no external dependency.
  // We generate audio locally with WebAudio to avoid CORS issues when loading remote assets.
}

// Simple WebAudio-based sound manager that synthesizes a soft ambient pad
// and short collect/hit effects. Audio context must be started by a user gesture.
const AudioManager = {
  ctx: null,
  ambient: { playing: false, nodes: [] },
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
  },
  startAmbient() {
    this.init();
    if (!this.ctx) return;
    if (this.ambient.playing) return;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.ctx.destination);

    // Two detuned oscillators through a slow filter for a pad
    const oscA = this.ctx.createOscillator();
    const oscB = this.ctx.createOscillator();
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 800;
    oscA.type = 'sine';
    oscB.type = 'sine';
    oscA.frequency.value = 220;
    oscB.frequency.value = 220 * 1.007; // slight detune
    oscA.connect(filt);
    oscB.connect(filt);
    filt.connect(g);

    oscA.start(); oscB.start();

    // gentle fade-in
    g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 1.2);

    // subtle LFO on filter cutoff
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 320;
    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);
    lfo.start();

    this.ambient.nodes = [g, oscA, oscB, filt, lfo, lfoGain];
    this.ambient.playing = true;
    return { isPlaying: true, stop: () => this.stopAmbient() };
  },
  stopAmbient() {
    if (!this.ctx || !this.ambient.playing) return;
    const nodes = this.ambient.nodes;
    const g = nodes[0];
    // fade out then stop
    g.gain.cancelScheduledValues(this.ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.8);
    setTimeout(() => {
      try { nodes.forEach(n => n.stop && n.stop()); } catch (e) {}
      try { nodes.forEach(n => n.disconnect && n.disconnect()); } catch (e) {}
      this.ambient.nodes = [];
      this.ambient.playing = false;
    }, 900);
  },
  playCollect() {
    this.init();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880 + Math.random() * 160;
    g.gain.value = 0.0001;
    o.connect(g); g.connect(this.ctx.destination);
    o.start();
    const now = this.ctx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    setTimeout(() => { try { o.stop(); o.disconnect(); g.disconnect(); } catch (e) {} }, 300);
  },
  playHit() {
    this.init();
    if (!this.ctx) return;
    // short noise burst via buffer
    const bufferSize = this.ctx.sampleRate * 0.2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = 0.6;
    src.connect(g); g.connect(this.ctx.destination);
    src.start();
    setTimeout(() => { try { src.stop(); src.disconnect(); g.disconnect(); } catch (e) {} }, 220);
  }
};

function create() {
  const scene = this;

  // Responsive resize
  window.addEventListener('resize', () => {
    scene.scale.resize(window.innerWidth, window.innerHeight);
  });

  // Create textures for moth, pollen, predator
  createTextures(this);

  // Moth sprite
  moth = this.physics.add.image(config.width / 2, config.height / 2, 'moth');
  moth.setDepth(5);
  moth.setScale(1.2);
  moth.setDamping(true);
  moth.setDrag(0.9);
  moth.setMaxVelocity(500);

  // Particle emitter for moth glow
  particles = this.add.particles('particle');
  const emitter = particles.createEmitter({
    x: moth.x,
    y: moth.y,
    lifespan: 800,
    speed: { min: 10, max: 60 },
    scale: { start: 0.6, end: 0 },
    alpha: { start: 0.9, end: 0 },
    blendMode: 'ADD',
    frequency: 60
  });

  // Pollen group
  pollenGroup = this.physics.add.group({ allowGravity: false });

  // Predators group
  predators = this.physics.add.group({ allowGravity: false });

  // Spawn initial pollen
  for (let i = 0; i < 8; i++) spawnPollen(this);

  // Predator spawning is scheduled when a run starts so the start screen
  // isn't unfair. We'll show an overlay until the user begins the run.

  // Collisions
  this.physics.add.overlap(moth, pollenGroup, handleCollect, null, this);
  this.physics.add.overlap(moth, predators, handleHit, null, this);

  // Score display
  scoreText = this.add.text(16, 16, 'Score: 0', style).setScrollFactor(0).setDepth(10);
  timeText = this.add.text(16, 44, 'Time: 0s', style).setScrollFactor(0).setDepth(10);
  const highText = this.add.text(16, 72, 'Best: 0', style).setScrollFactor(0).setDepth(10);

  // Sounds
  // Initialize synth-based audio manager (must be started by user gesture)
  collectSound = { play: () => AudioManager.playCollect() };
  hitSound = { play: () => AudioManager.playHit() };
  // bgMusic is a lightweight wrapper so calling code can check isPlaying/play/stop
  bgMusic = {
    isPlaying: false,
    play() {
      // Prefer page-provided audio element if available
      if (window.startGameMusic && typeof window.startGameMusic === 'function') {
        window.startGameMusic();
        this.isPlaying = true;
        return;
      }
      // Fallback to synthesized ambient
      AudioManager.startAmbient();
      this.isPlaying = true;
    },
    stop() {
      if (window.stopGameMusic && typeof window.stopGameMusic === 'function') {
        window.stopGameMusic();
        this.isPlaying = false;
        return;
      }
      AudioManager.stopAmbient();
      this.isPlaying = false;
    }
  };

  // Input handling - pointer follow
  this.input.on('pointermove', function (pointer) {
    pointerTarget.x = pointer.worldX;
    pointerTarget.y = pointer.worldY;
  });
  this.input.on('pointerdown', function () {
  // Initialize audio context on user gesture and start run
  AudioManager.init();
  if (!running) startRun(scene);
  });

  // Defensive capture: prevent noisy/buggy content scripts from receiving keydown
  // when the user is not focused on an input. This can stop Uncaught TypeError
  // thrown by third-party extension content scripts that assume a form field exists.
  document.addEventListener('keydown', function (e) {
    try {
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      // stop propagation to content scripts (they run in an isolated world but listen on DOM)
      e.stopImmediatePropagation();
    } catch (err) {
      // swallow defensive errors
    }
  }, true);

  // Keyboard optional control
  this.cursors = this.input.keyboard.createCursorKeys();

  // Gentle background bloom (large glowing circles)
  for (let i = 0; i < 12; i++) {
    const x = Phaser.Math.Between(0, config.width);
    const y = Phaser.Math.Between(0, config.height);
    const g = this.add.image(x, y, 'glow').setScale(Phaser.Math.FloatBetween(0.8, 2.2)).setDepth(0).setBlendMode('ADD').setAlpha(0.07);
  }

  // Score persistence
  const saved = localStorage.getItem('moth_best');
  if (saved) highest = parseInt(saved, 10) || 0;
  highText.setText('Best: ' + highest);

  // show initial overlay
  showOverlay(this, 'Click or tap to start', 'Collect pollen and avoid predators');
}

function update(time, delta) {
  if (!moth) return;
  // Follow pointer gently
  const speed = 0.008 * delta;
  const dx = pointerTarget.x - moth.x;
  const dy = pointerTarget.y - moth.y;
  moth.x += dx * Math.min(1, speed * 50);
  moth.y += dy * Math.min(1, speed * 50);

  // Keyboard nudges
  if (this.cursors.left.isDown) moth.x -= 2.4;
  if (this.cursors.right.isDown) moth.x += 2.4;
  if (this.cursors.up.isDown) moth.y -= 2.4;
  if (this.cursors.down.isDown) moth.y += 2.4;

  // Keep moth on screen
  moth.x = Phaser.Math.Clamp(moth.x, 0, this.scale.width);
  moth.y = Phaser.Math.Clamp(moth.y, 0, this.scale.height);

  // Update particle emitter location
  particles.emitters.list[0].setPosition(moth.x, moth.y);

  // Rotate moth toward velocity for visual
  moth.rotation = Phaser.Math.Angle.RotateTo(moth.rotation, Math.atan2(dy, dx), 0.08);

  // Update time/score
  if (running) {
    const elapsed = Math.floor((performance.now() - startTime) / 1000);
    timeText.setText('Time: ' + elapsed + 's');
    score += 0.004 * delta; // passive score for survival
    scoreText.setText('Score: ' + Math.floor(score));
  }

  // Recycle pollen and predators when off-screen
  pollenGroup.children.each(function (p) {
    if (p.x < -40 || p.x > this.scale.width + 40 || p.y < -40 || p.y > this.scale.height + 40) {
      p.destroy();
      spawnPollen(this.scene);
    }
  }, this);

  predators.children.each(function (pr) {
    // predators drift; if they exit, destroy
    if (pr.x < -60 || pr.x > this.scale.width + 60 || pr.y < -60 || pr.y > this.scale.height + 60) {
      pr.destroy();
    } else {
  // steering toward moth with speed ramping by elapsed time
  const ang = Phaser.Math.Angle.Between(pr.x, pr.y, moth.x, moth.y);
  const elapsed = running ? Math.floor((performance.now() - startTime) / 1000) : 0;
  const difficulty = Math.min(1, elapsed / 45);
  const effectiveSpeed = (pr.baseSpeed || 0.4) * (1 + difficulty * 2.2);
  pr.x += Math.cos(ang) * effectiveSpeed * (delta / 16);
  pr.y += Math.sin(ang) * effectiveSpeed * (delta / 16);
  pr.rotation = ang + Math.PI / 2;
    }
  }, this);
}

// Helper to create runtime textures (moth, pollen, predator, particle, glow)
function createTextures(scene) {
  // Moth (soft glowing body and wings)
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  // body glow
  g.fillStyle(0xcff9ff, 1);
  g.fillEllipse(48, 44, 64, 40);
  // wings
  g.fillStyle(0xa1f0ff, 0.9);
  g.fillEllipse(32, 28, 36, 26);
  g.fillEllipse(64, 28, 36, 26);
  // darker stroke
  g.lineStyle(2, 0x6de0ff, 0.6);
  g.strokeEllipse(48, 44, 64, 40);
  g.generateTexture('moth', 96, 96);
  g.clear();

  // pollen orb
  g.fillStyle(0xfff4a3, 1);
  g.fillCircle(16, 16, 12);
  g.lineStyle(2, 0xfff4a3, 0.5);
  g.strokeCircle(16, 16, 12);
  g.generateTexture('pollen', 32, 32);
  g.clear();

  // predator (shadowy beetle-like shape)
  g.fillStyle(0x11121a, 1);
  g.fillEllipse(28, 28, 52, 36);
  g.fillStyle(0x0b0d12, 1);
  g.fillCircle(28, 15, 8);
  g.lineStyle(2, 0x000000, 0.6);
  g.strokeEllipse(28, 28, 52, 36);
  g.generateTexture('predator', 56, 56);
  g.clear();

  // particle
  g.fillStyle(0xa6fff8, 1);
  g.fillCircle(4, 4, 4);
  g.generateTexture('particle', 8, 8);
  g.clear();

  // glow background
  g.fillStyle(0x6df0ff, 1);
  g.fillCircle(64, 64, 64);
  g.generateTexture('glow', 128, 128);
  g.clear();
}

function spawnPollen(scene) {
  const x = Phaser.Math.Between(40, scene.scale.width - 40);
  const y = Phaser.Math.Between(40, scene.scale.height - 40);
  const p = pollenGroup.create(x, y, 'pollen');
  p.setScale(1.0);
  p.setAlpha(0.95);
  // small bobbing
  scene.tweens.add({ targets: p, y: p.y - 8, yoyo: true, repeat: -1, duration: Phaser.Math.Between(1400, 2400), ease: 'Sine.easeInOut' });
  return p;
}

function spawnPredator(scene) {
  const side = Phaser.Math.Between(0, 3);
  let x, y;
  if (side === 0) { x = -40; y = Phaser.Math.Between(0, scene.scale.height); }
  if (side === 1) { x = scene.scale.width + 40; y = Phaser.Math.Between(0, scene.scale.height); }
  if (side === 2) { x = Phaser.Math.Between(0, scene.scale.width); y = -40; }
  if (side === 3) { x = Phaser.Math.Between(0, scene.scale.width); y = scene.scale.height + 40; }
  const pr = predators.create(x, y, 'predator');
  pr.setScale(1.0);
  // use a modest base speed at spawn; effective speed is scaled by difficulty
  pr.baseSpeed = Phaser.Math.FloatBetween(0.3, 0.8);
  pr.setDepth(3);
  pr.setAlpha(0.95);
}

function handleCollect(mothObj, pollenObj) {
  // particle burst
  const burst = particles.createEmitter({ x: pollenObj.x, y: pollenObj.y, speed: { min: 80, max: 180 }, scale: { start: 0.9, end: 0 }, lifespan: 600, blendMode: 'ADD', quantity: 12 });
  this.time.delayedCall(420, () => burst.stop());

  pollenObj.destroy();
  spawnPollen(this);

  // scoring
  streak += 1;
  const bonus = Math.floor(Math.sqrt(streak) * 6);
  score += 10 + bonus;
  collectSound.play();
}

function handleHit(mothObj, predatorObj) {
  if (!running) return;
  running = false;
  hitSound.play();
  // flash and shake
  this.cameras.main.flash(500, 220, 100, 100);
  this.cameras.main.shake(600, 0.02);

  // stop bg music
  if (bgMusic.isPlaying) bgMusic.stop();

  // update best
  const finalScore = Math.floor(score);
  if (finalScore > highest) {
    highest = finalScore;
    localStorage.setItem('moth_best', highest);
  }
  // cancel predator scheduling
  if (predatorTimer) {
    try { predatorTimer.remove(false); } catch (e) {}
    predatorTimer = null;
  }
  // stop predator movement
  predators.children.each(function (pr) { pr.baseSpeed = 0; });

  // show an overlay for game over
  showOverlay(this, 'Game Over', 'Score: ' + finalScore + '\nClick or tap to play again');
  this.input.once('pointerdown', () => {
    hideOverlay(this);
    resetGame(this);
  });
}

function startRun(scene) {
  running = true;
  score = 0;
  startTime = performance.now();
  streak = 0;
  // populate pollen
  pollenGroup.clear(true, true);
  for (let i = 0; i < 10; i++) spawnPollen(scene);
  // clear predators
  predators.clear(true, true);
  if (predatorTimer) { try { predatorTimer.remove(false); } catch (e) {} }
  scheduleNextPredator(scene);
  // ensure music starts when run starts
  if (!bgMusic.isPlaying) bgMusic.play();
  hideOverlay(scene);
}

function resetGame(scene) {
  // move moth to center
  moth.x = scene.scale.width / 2;
  moth.y = scene.scale.height / 2;
  pointerTarget.x = moth.x; pointerTarget.y = moth.y;
  running = true;
  score = 0;
  streak = 0;
  startTime = performance.now();
  // clear and respawn
  pollenGroup.clear(true, true);
  predators.clear(true, true);
  for (let i = 0; i < 10; i++) spawnPollen(scene);
  if (predatorTimer) { try { predatorTimer.remove(false); } catch (e) {} }
  scheduleNextPredator(scene);
  if (!bgMusic.isPlaying) bgMusic.play();
  hideOverlay(scene);
}

function scheduleNextPredator(scene) {
  const elapsed = running ? Math.max(0, (performance.now() - startTime) / 1000) : 0;
  const difficulty = Math.min(1, elapsed / 45);
  const delay = 2200 - difficulty * (2200 - 700);
  predatorTimer = scene.time.delayedCall(Math.floor(delay), () => {
    if (running) spawnPredator(scene);
    if (running) scheduleNextPredator(scene);
  });
}

function showOverlay(scene, title, subtitle) {
  if (overlayContainer) { try { overlayContainer.destroy(); } catch (e) {} }
  const w = scene.scale.width;
  const h = scene.scale.height;
  const container = scene.add.container(0, 0).setDepth(50);
  const panel = scene.add.rectangle(w / 2, h / 2, Math.min(680, w - 40), 220, 0x070612, 0.95);
  const t = scene.add.text(w / 2, h / 2 - 30, title, { fontSize: '30px', color: '#fffbdf', fontFamily: 'Inter' }).setOrigin(0.5);
  const s = scene.add.text(w / 2, h / 2 + 18, subtitle, { fontSize: '16px', color: '#bfefff', align: 'center', wordWrap: { width: Math.min(620, w - 80) } }).setOrigin(0.5);
  container.add([panel, t, s]);
  overlayContainer = container;
}

function hideOverlay(scene) {
  if (!overlayContainer) return;
  try { overlayContainer.destroy(); } catch (e) {}
  overlayContainer = null;
}

// Expose minimal API for debugging in console
window._mothGame = { game, resetGame };
