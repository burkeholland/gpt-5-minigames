// Aurora Bloom - main.js
// Phaser 3 game: collect glowing blooms, avoid dark shards. Simple, polished, and easy to run locally.

const WIDTH = 800;
const HEIGHT = 600;

class MainScene extends Phaser.Scene {
  constructor() {
    super('MainScene');
    this.player = null;
    this.blooms = null;
    this.shards = null;
    this.score = 0;
    this.scoreText = null;
    this.gameOver = false;
    this.spawnTimer = 0;
    this.spawnInterval = 1000; // ms
    this.speedFactor = 1;
    this.targetX = null; // for touch
    this.audioContext = null;
  this.ambientNodes = null;
  this.bgmAudio = null;
  }

  preload() {
  // We'll generate textures at runtime. Avoid preloading remote audio (can be blocked with 403/CORS).
  // Background music will be handled via an HTMLAudioElement on first user interaction.
  }

  create() {
  // AudioContext for synthesized SFX will be created/resumed on first user gesture.
  this.audioContext = null;
  // We'll synthesize a gentle ambient pad with WebAudio to avoid external network requests.
  this.ambientNodes = null;

    // Create glow seed texture
    this.createSeedTexture();
    this.createBloomTexture();
    this.createShardTexture();

    // Player
    this.player = this.physics.add.sprite(WIDTH / 2, HEIGHT - 80, 'seed');
    this.player.setCollideWorldBounds(true);
    this.player.body.setCircle(18);
    this.player.setDepth(2);

    // Groups
    this.blooms = this.physics.add.group();
    this.shards = this.physics.add.group();

    // Collisions
    this.physics.add.overlap(this.player, this.blooms, this.collectBloom, null, this);
    this.physics.add.overlap(this.player, this.shards, this.hitShard, null, this);

    // Score text
    this.scoreText = this.add.text(16, 16, 'Score: 0', { fontFamily: 'Arial', fontSize: '22px', color: '#e6fffb' });

    // Instructions
    this.instr = this.add.text(WIDTH / 2, 40, 'Use ← → or A / D (or drag/tap) to move. Collect blooms, avoid shards.', { fontFamily: 'Arial', fontSize: '16px', color: '#bfeaf4' }).setOrigin(0.5);

    // Lightweight aurora effect implemented with periodic bloom sprites + tweens (ParticleEmitterManager removed in newer Phaser)
    this.time.addEvent({
      delay: 200,
      callback: () => this.spawnAuroraParticle(),
      loop: true
    });

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Pointer controls (touch/mouse)
    this.input.on('pointerdown', (pointer) => {
      this.targetX = pointer.x;
      // Start bgm on first user interaction (use HTMLAudioElement, safer for cross-origin files)
      // Ensure AudioContext available for SFX (must be created/resumed after user gesture)
      try {
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
          if (this.audioContext.state === 'suspended') this.audioContext.resume().catch(()=>{});
        } else if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(()=>{});
        }
      } catch (e) {
        this.audioContext = null;
      }

      // Start a procedural ambient pad using the (now resumed) AudioContext
      if (this.audioContext && !this.ambientNodes) {
        try {
          const ctx = this.audioContext;
          const master = ctx.createGain();
          // Increase base ambient volume to be more audible but still subtle
          master.gain.value = 0.0025;
          master.connect(ctx.destination);

          // Create three slow detuned oscillators for a richer pad
          const o1 = ctx.createOscillator();
          const o2 = ctx.createOscillator();
          const o3 = ctx.createOscillator();
          const g1 = ctx.createGain();
          const g2 = ctx.createGain();
          const g3 = ctx.createGain();

          o1.type = 'sine';
          o2.type = 'sine';
          o3.type = 'sine';
          o1.frequency.value = 110;
          o2.frequency.value = 112.5; // slight detune
          o3.frequency.value = 220; // higher harmonic
          g1.gain.value = 0.7;
          g2.gain.value = 0.6;
          g3.gain.value = 0.45;

          // Gentle LFO to modulate gain
          const lfo = ctx.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = 0.06;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = 0.18;

          // Subtle lowpass filter for warmth
          const filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 1200;

          // Stereo panner for movement
          const panner = ctx.createStereoPanner();
          panner.pan.value = 0.0;

          o1.connect(g1); g1.connect(filter);
          o2.connect(g2); g2.connect(filter);
          o3.connect(g3); g3.connect(filter);
          filter.connect(panner); panner.connect(master);

          lfo.connect(lfoGain);
          lfoGain.connect(g1.gain); lfoGain.connect(g2.gain); lfoGain.connect(g3.gain);

          o1.start(); o2.start(); o3.start(); lfo.start();

          this.ambientNodes = { master, o1, o2, o3, g1, g2, g3, lfo, lfoGain, filter, panner };
          // start ambient sequenced notes
          this.startAmbientMusic();
        } catch (e) {
          this.ambientNodes = null;
        }
      }

      // Start background music using the bundled MP3 file (looped). Create on first gesture.
      try {
        if (!this.bgmAudio) {
          const bgm = new Audio('Soothe.mp3');
          bgm.loop = true;
          bgm.volume = 0.24;
          // play() returns a promise in modern browsers
          const p = bgm.play();
          if (p && p.catch) p.catch(()=>{});
          this.bgmAudio = bgm;
        } else if (this.bgmAudio.paused) {
          const p2 = this.bgmAudio.play();
          if (p2 && p2.catch) p2.catch(()=>{});
        }
      } catch (e) {
        console.warn('BGM playback failed', e);
      }
    });
    this.input.on('pointermove', (pointer) => {
      if (pointer.isDown) this.targetX = pointer.x;
    });
    this.input.on('pointerup', () => {
      this.targetX = null;
    });

    // Start spawn timer
    this.spawnTimer = this.time.now + this.spawnInterval;

  // Night glow overlay (subtle). Phaser graphics doesn't expose createLinearGradient; use translucent rectangle.
  const graphics = this.add.graphics();
  graphics.fillStyle(0x08122a, 0.06).fillRect(0, 0, WIDTH, HEIGHT);

    // Game over UI (hidden)
    this.gameOverText = this.add.text(WIDTH / 2, HEIGHT / 2 - 30, 'Game Over', { fontFamily: 'Arial', fontSize: '48px', color: '#fff' }).setOrigin(0.5).setVisible(false);
    this.finalScoreText = this.add.text(WIDTH / 2, HEIGHT / 2 + 20, '', { fontFamily: 'Arial', fontSize: '20px', color: '#fff' }).setOrigin(0.5).setVisible(false);
    this.restartHint = this.add.text(WIDTH / 2, HEIGHT / 2 + 70, 'Press Space to restart', { fontFamily: 'Arial', fontSize: '14px', color: '#bfeaf4' }).setOrigin(0.5).setVisible(false);

    // Smooth camera follow (optional subtle shake on hit)

    // Resize handling
    this.scale.on('resize', this.resize, this);
  }

  update(time, delta) {
    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.keySpace)) {
        this.scene.restart();
      }
      return;
    }

    // Player movement
    const accel = 0.0025 * delta * 60; // frame rate independent
    const maxSpeed = 400;

    if (this.cursors.left.isDown || this.keyA.isDown) {
      this.player.body.velocity.x = Phaser.Math.Clamp(this.player.body.velocity.x - 20 * accel * 1000, -maxSpeed, maxSpeed);
    } else if (this.cursors.right.isDown || this.keyD.isDown) {
      this.player.body.velocity.x = Phaser.Math.Clamp(this.player.body.velocity.x + 20 * accel * 1000, -maxSpeed, maxSpeed);
    } else if (this.targetX !== null) {
      // Move towards targetX smoothly
      const dir = this.targetX - this.player.x;
      this.player.body.velocity.x = Phaser.Math.Clamp(dir * 3, -maxSpeed, maxSpeed);
    } else {
      // Apply drag
      this.player.body.velocity.x *= 0.92;
      if (Math.abs(this.player.body.velocity.x) < 2) this.player.body.velocity.x = 0;
    }

    // Keep within bounds
    if (this.player.x < 24) this.player.x = 24;
    if (this.player.x > WIDTH - 24) this.player.x = WIDTH - 24;

    // Spawning
    if (time > this.spawnTimer) {
      this.spawnWave();
      this.spawnTimer = time + this.spawnInterval;
      // Gradually speed up
      if (this.spawnInterval > 400) this.spawnInterval *= 0.98;
      this.speedFactor += 0.02;
    }

    // Remove off-screen
    this.blooms.children.iterate((b) => {
      if (b && b.y > HEIGHT + 50) b.destroy();
    });
    this.shards.children.iterate((s) => {
      if (s && s.y > HEIGHT + 50) s.destroy();
    });
  }

  spawnWave() {
    // Spawn 1-3 blooms and 0-2 shards
    const bloomCount = Phaser.Math.Between(1, 3);
    for (let i = 0; i < bloomCount; i++) {
      const x = Phaser.Math.Between(30, WIDTH - 30);
      const b = this.blooms.create(x, -20, 'bloom');
      b.setVelocity(0, Phaser.Math.Between(40, 100) * this.speedFactor);
      b.setScale(Phaser.Math.FloatBetween(0.6, 1.2));
      b.body.setCircle(12);
      b.setDepth(1);
      b.setBounce(0.1);
    }

    const shardCount = Phaser.Math.Between(0, 2);
    for (let i = 0; i < shardCount; i++) {
      const x = Phaser.Math.Between(30, WIDTH - 30);
      const s = this.shards.create(x, -40, 'shard');
      s.setVelocity(Phaser.Math.Between(-40, 40), Phaser.Math.Between(140, 260) * this.speedFactor);
      s.setScale(Phaser.Math.FloatBetween(0.8, 1.4));
      s.body.setCircle(10);
      s.setDepth(1);
      s.setBounce(0.1);
      s.setAngularVelocity(Phaser.Math.Between(-200, 200));
    }
  }

  // Aurora particle (small bloom sprite that fades and floats)
  spawnAuroraParticle() {
    const x = Phaser.Math.Between(0, WIDTH);
    const y = Phaser.Math.Between(0, 80);
    const s = this.add.image(x, y, 'bloom');
    s.setScale(Phaser.Math.FloatBetween(0.4, 0.9));
    s.setBlendMode(Phaser.BlendModes.ADD);
    s.alpha = 0.6;
    this.tweens.add({
      targets: s,
      y: y - Phaser.Math.Between(10, 30),
      alpha: 0,
      duration: Phaser.Math.Between(1200, 2400),
      onComplete: () => s.destroy()
    });
  }

  // Ambient music sequencer -------------------------------------------------
  startAmbientMusic() {
    if (!this.ambientNodes || !this.audioContext) return;
    const ctx = this.audioContext;

    // Ensure any existing sequencer is cleared
    if (this._ambientInterval) {
      this._ambientInterval.remove();
      this._ambientInterval = null;
    }

    // Create a subtle delay/feedback chain for ambience if supported
    try {
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.28;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.32;
      // route delay feedback
      delay.connect(feedback);
      feedback.connect(delay);
      // connect delay into the ambient master
      if (this.ambientNodes.master) {
        // connect master -> delay -> master (so delay is heard alongside dry)
        this.ambientNodes.master.connect(delay);
        delay.connect(this.ambientNodes.master);
      }
      this.ambientNodes.delay = delay;
      this.ambientNodes.delayFeedback = feedback;
    } catch (e) {
      // ignore if not supported
    }

    // schedule periodic ambient notes
    this._ambientInterval = this.time.addEvent({
      delay: 1200,
      callback: () => this.playAmbientNote(),
      loop: true
    });
    // play initial note
    this.playAmbientNote();
  }

  playAmbientNote() {
    if (!this.audioContext || !this.ambientNodes) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const base = 110;
    const intervals = [0, 3, 5, 7, 10];
    const step = intervals[Phaser.Math.Between(0, intervals.length - 1)];
    const freq = base * Math.pow(2, step / 12);

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    // connect into ambient master (which already connects to destination)
    o.connect(g);
    if (this.ambientNodes.delay) {
      g.connect(this.ambientNodes.delay);
    }
    g.connect(this.ambientNodes.master);
    o.start(now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.0016, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    o.stop(now + 1.25);
  }

  stopAmbientMusic() {
    // Stop scheduled notes
    if (this._ambientInterval) {
      this._ambientInterval.remove();
      this._ambientInterval = null;
    }
    // Stop and disconnect ambient oscillators and LFO
    if (this.ambientNodes) {
      try {
        const n = this.ambientNodes;
        if (n.o1 && n.o1.stop) n.o1.stop();
        if (n.o2 && n.o2.stop) n.o2.stop();
        if (n.o3 && n.o3.stop) n.o3.stop();
        if (n.lfo && n.lfo.stop) n.lfo.stop();
      } catch (e) {
        // ignore
      }
      try { if (this.ambientNodes.delay) this.ambientNodes.delay.disconnect(); } catch (e) {}
      try { if (this.ambientNodes.delayFeedback) this.ambientNodes.delayFeedback.disconnect(); } catch (e) {}
      try { if (this.ambientNodes.filter) this.ambientNodes.filter.disconnect(); } catch (e) {}
      try { if (this.ambientNodes.panner) this.ambientNodes.panner.disconnect(); } catch (e) {}
      try { if (this.ambientNodes.master) this.ambientNodes.master.disconnect(); } catch (e) {}
    }
    this.ambientNodes = null;
  }

  // Small pop (used on collect)
  smallPop(x, y) {
    for (let i = 0; i < 8; i++) {
      const p = this.add.image(x, y, 'bloom');
      p.setScale(0.08);
      p.setBlendMode(Phaser.BlendModes.ADD);
      const dx = Phaser.Math.Between(-40, 40);
      const dy = Phaser.Math.Between(-40, 40);
      this.tweens.add({ targets: p, x: x + dx, y: y + dy, alpha: 0, scale: 0, duration: 350, onComplete: () => p.destroy() });
    }
  }

  // Burst for hit
  burstAt(x, y) {
    for (let i = 0; i < 16; i++) {
      const p = this.add.image(x, y, 'shard');
      p.setScale(0.5);
      const dx = Phaser.Math.Between(-220, 220);
      const dy = Phaser.Math.Between(-220, 220);
      this.tweens.add({ targets: p, x: x + dx, y: y + dy, alpha: 0, duration: 700, onComplete: () => p.destroy() });
    }
  }

  collectBloom(player, bloom) {
    bloom.destroy();
    this.score += 10;
    this.scoreText.setText('Score: ' + this.score);
    this.playCollectSound();

    // Tiny pop particle
  this.smallPop(bloom.x, bloom.y);
  }

  hitShard() {
    if (this.gameOver) return;
    this.playHitSound();
    this.gameOver = true;
    // stop ambient nodes if running
    try {
      if (this.ambientNodes) {
        const n = this.ambientNodes;
        if (n.o1) n.o1.stop();
        if (n.o2) n.o2.stop();
        if (n.lfo) n.lfo.stop();
        // disconnect
        try { n.o1.disconnect(); } catch(e){}
        try { n.o2.disconnect(); } catch(e){}
        try { n.lfo.disconnect(); } catch(e){}
  try { n.master.disconnect(); } catch(e){}
  this.stopAmbientMusic();
  this.ambientNodes = null;
      }
    } catch (e) {
      // ignore
    }
    // Pause background music at game end
    try {
      if (this.bgmAudio && !this.bgmAudio.paused) {
        this.bgmAudio.pause();
        try { this.bgmAudio.currentTime = 0; } catch (e) {}
      }
    } catch (e) {
      // ignore
    }
    // Show UI
    this.gameOverText.setVisible(true);
    this.finalScoreText.setText('Final Score: ' + this.score).setVisible(true);
    this.restartHint.setVisible(true);

    // Dim and particle effect
    this.cameras.main.flash(300, 40, 10, 10);
    this.burstAt(this.player.x, this.player.y);
    this.player.destroy();
  }

  playCollectSound() {
  if (!this.audioContext) return;
  const ctx = this.audioContext;
  // quick FM-y tone + tiny noise click
  const carrier = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const env = ctx.createGain();
  carrier.type = 'triangle';
  mod.type = 'sine';
  carrier.frequency.value = 600 + Math.random() * 200;
  mod.frequency.value = 120 + Math.random() * 80;
  modGain.gain.value = 60;
  env.gain.value = 0.0001;
  carrier.connect(env);
  env.connect(ctx.destination);
  mod.connect(modGain);
  modGain.connect(carrier.frequency);
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0.0001, now);
  env.gain.exponentialRampToValueAtTime(0.0025, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
  carrier.start(now);
  mod.start(now);
  carrier.stop(now + 0.2);
  mod.stop(now + 0.2);
  // small noise click
  this.playNoise(0.06, 0.04);
  }

  playHitSound() {
    if (!this.audioContext) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    o1.type = 'sawtooth';
    o2.type = 'sine';
    o1.frequency.value = 200;
    o2.frequency.value = 120;
    g.gain.value = 0.0001;
    o1.connect(g); o2.connect(g); g.connect(ctx.destination);
    // quick attack
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.006, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    o1.start(now); o2.start(now);
    o1.stop(now + 0.65); o2.stop(now + 0.65);
    // add heavier noise
    this.playNoise(0.45, 0.18);
  }

  // Play a short noise burst using a bufferSource
  playNoise(volume = 0.08, duration = 0.08) {
    if (!this.audioContext) return;
    const ctx = this.audioContext;
    // generate noise buffer once and cache on scene
    if (!this._noiseBuffer) {
      const bufferSize = ctx.sampleRate * 1.0; // 1s buffer
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
      this._noiseBuffer = buffer;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.stop(now + duration + 0.02);
  }

  createSeedTexture() {
    const rt = this.make.graphics({ x: 0, y: 0, add: false });
    const w = 64;
    const h = 64;
    // outer glow
    rt.fillStyle(0xffffff, 1);
    rt.fillCircle(w / 2, h / 2, 10);
    rt.fillStyle(0x66ffd9, 0.6);
    rt.fillCircle(w / 2, h / 2, 16);
    rt.fillStyle(0x29a6ff, 0.25);
    rt.fillCircle(w / 2, h / 2, 26);
    rt.generateTexture('seed', w, h);
    rt.destroy();
  }

  createBloomTexture() {
    const rt = this.make.graphics({ x: 0, y: 0, add: false });
    const w = 48;
    const h = 48;
    // petal-like glow
    rt.fillStyle(0xffffff, 1);
    rt.fillCircle(w / 2, h / 2, 6);
    rt.fillStyle(0xffc6f5, 0.9);
    rt.fillCircle(w / 2, h / 2, 10);
    rt.fillStyle(0x8ad9ff, 0.4);
    rt.fillCircle(w / 2, h / 2, 20);
    // small sparkle
    rt.fillStyle(0xffffff, 0.6);
    rt.fillRect(w/2 + 6, h/2 - 2, 2, 8);
    rt.generateTexture('bloom', w, h);
    rt.destroy();
  }

  createShardTexture() {
    const rt = this.make.graphics({ x: 0, y: 0, add: false });
    const w = 36;
    const h = 36;
    rt.fillStyle(0x111422, 1);
    rt.beginPath();
    rt.moveTo(w/2, 4);
    rt.lineTo(4, h-6);
    rt.lineTo(w-6, h-10);
    rt.closePath();
    rt.fillPath();
    // highlight
    rt.lineStyle(2, 0x3b4b5c, 0.65);
    rt.strokeTriangle(w/2, 4, 4, h-6, w-6, h-10);
    rt.generateTexture('shard', w, h);
    rt.destroy();
  }

  resize(gameSize, baseSize, displaySize, resolution) {
    // optional responsive scaling
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: '#041022',
  physics: {
    default: 'arcade',
    arcade: { debug: false }
  },
  scene: [MainScene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }
};

window.addEventListener('load', () => {
  const game = new Phaser.Game(config);
});
