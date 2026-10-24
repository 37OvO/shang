(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   *  合成女仆酱 —— 一个用桌面女仆素材库做的「合成大」小游戏
   *  物理：Matter.js    渲染：Canvas 2D
   * ------------------------------------------------------------------ */

  const { Engine, World, Bodies, Body, Events } = Matter;

  const W = 480;
  const H = 720;
  const DANGER_Y = 112;
  const MAX_LEVEL = 10;
  const STEP = 1000 / 60;

  // 11 个等级，由小到大
  const RADII = [20, 24, 29, 35, 41, 48, 56, 65, 75, 86, 98];
  const NAMES = [
    "小女仆",
    "打招呼",
    "懵圈鲸",
    "吃饱饱",
    "摸鱼觉",
    "摆烂鲸",
    "求资源",
    "干饭鲸",
    "破防鲸",
    "崩溃鲸",
    "暴走鲸",
  ];
  const SCORE = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55];
  const RINGS = [
    "#ffb3c7",
    "#9ebcff",
    "#8fb0ff",
    "#ffc17a",
    "#b9a9ff",
    "#7fd3e0",
    "#ff9fb0",
    "#ffd166",
    "#ff8f8f",
    "#a98bff",
    "#5f8bff",
  ];
  const BALL_COLORS = [
    "#ffe3ea",
    "#dbe8ff",
    "#d5e0ff",
    "#ffe9cc",
    "#e3dcff",
    "#d3f1f5",
    "#ffd9e0",
    "#fff0c2",
    "#ffd2d2",
    "#ded2ff",
    "#c7d8ff",
  ];
  const SPARK_COLORS = [
    ["#ffd0dc", "#ff9fbb", "#ffffff"],
    ["#d6e4ff", "#9ebcff", "#ffffff"],
    ["#d2ddff", "#8fb0ff", "#ffffff"],
    ["#ffe3bd", "#ffc17a", "#ffffff"],
    ["#e3dcff", "#b9a9ff", "#ffffff"],
    ["#d3f1f5", "#7fd3e0", "#ffffff"],
    ["#ffd9e0", "#ff9fb0", "#ffffff"],
    ["#fff0c2", "#ffd166", "#ffffff"],
    ["#ffd2d2", "#ff8f8f", "#ffffff"],
    ["#ded2ff", "#a98bff", "#ffffff"],
    ["#c7d8ff", "#5f8bff", "#ffe9a8"],
  ];

  const SPAWN_WEIGHTS = [30, 26, 21, 15, 8]; // 只会掉 1~5 级
  const LB_KEY = "maidMergeScores.v1";
  const NAME_KEY = "maidMergeName.v1";
  const BEST_KEY = "maidMergeBest.v1";
  const SOUND_KEY = "maidMergeSound.v1";

  /* ----------------------------- DOM ------------------------------- */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const boardWrap = document.getElementById("boardWrap");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const coinEl = document.getElementById("coinCount");
  const nextCanvas = document.getElementById("nextCanvas");
  const nextCtx = nextCanvas.getContext("2d");
  const nextNameEl = document.getElementById("nextName");
  const mergeChart = document.getElementById("mergeChart");
  const gameoverEl = document.getElementById("gameover");
  const goScoreEl = document.getElementById("goScore");
  const goBestEl = document.getElementById("goBest");
  const goNameEl = document.getElementById("goName");
  const goRevive = document.getElementById("goRevive");
  const reviveCountEl = document.getElementById("reviveCount");
  const toastEl = document.getElementById("toast");
  const lbDialog = document.getElementById("lbDialog");
  const lbList = document.getElementById("lbList");
  const nickInput = document.getElementById("nickInput");
  const soundBtn = document.getElementById("btnSound");

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;

  /* ---------------------------- 状态 ------------------------------- */
  const state = {
    mode: "playing", // playing | over
    score: 0,
    best: 0,
    coins: 0,
    coinMilestones: 0,
    nextLevel: 0,
    aimX: W / 2,
    pointerDown: false,
    dropLockUntil: 0,
    overflowSince: 0,
    lastOverflowCheck: 0,
    currentEntryId: null,
    shake: 0,
    soundOn: true,
    name: "默认用户",
  };

  let ballSeq = 0;
  const balls = new Set();
  const mergeQueue = [];
  const particles = [];
  const texts = [];
  const rings = [];

  const images = NAMES.map((_, i) => {
    const img = new Image();
    img.src = "assets/balls/" + String(i + 1).padStart(2, "0") + ".png";
    img.onload = () => {
      if (i === state.nextLevel) drawNext();
    };
    return img;
  });

  /* --------------------------- 本地存储 ---------------------------- */
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 忽略隐私模式等异常 */
    }
  }

  function loadScores() {
    const list = readJSON(LB_KEY, []);
    return Array.isArray(list) ? list.filter((x) => x && typeof x.score === "number") : [];
  }

  function saveScores(list) {
    writeJSON(LB_KEY, list);
  }

  function addScoreEntry(name, score) {
    const list = loadScores();
    const entry = {
      id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      name: name,
      score: score,
      ts: Date.now(),
    };
    list.push(entry);
    list.sort((a, b) => b.score - a.score || b.ts - a.ts);
    saveScores(list.slice(0, 60));
    return entry;
  }

  function removeScoreEntry(id) {
    saveScores(loadScores().filter((x) => x.id !== id));
  }

  /* ---------------------------- 音效 ------------------------------- */
  let audioCtx = null;

  function ensureAudio() {
    if (!state.soundOn) return null;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function tone(freq, delay, dur, type, vol, slideTo) {
    const c = ensureAudio();
    if (!c) return;
    try {
      const t = c.currentTime + delay;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    } catch (e) {
      /* 忽略音频异常 */
    }
  }

  function sfx(kind, level) {
    if (!state.soundOn) return;
    switch (kind) {
      case "drop":
        tone(300, 0, 0.09, "sine", 0.045, 150);
        break;
      case "merge": {
        const base = 330 + (level || 0) * 48;
        tone(base, 0, 0.2, "triangle", 0.055);
        tone(base * 1.25, 0.035, 0.22, "triangle", 0.045);
        tone(base * 1.5, 0.07, 0.24, "sine", 0.04);
        break;
      }
      case "big":
        [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.055, 0.3, "triangle", 0.055));
        tone(180, 0, 0.5, "sine", 0.07, 80);
        break;
      case "coin":
        tone(880, 0, 0.1, "sine", 0.05);
        tone(1175, 0.07, 0.12, "sine", 0.045);
        tone(1568, 0.14, 0.18, "sine", 0.04);
        break;
      case "over":
        [392, 330, 262].forEach((f, i) => tone(f, i * 0.16, 0.32, "triangle", 0.05));
        break;
      case "pop":
        tone(620, 0, 0.07, "sine", 0.035, 980);
        break;
      default:
        break;
    }
  }

  /* ---------------------------- 物理 ------------------------------- */
  const engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 8,
    constraintIterations: 4,
  });
  engine.gravity.y = 1.15;
  engine.enableSleeping = false;
  const world = engine.world;

  World.add(world, [
    Bodies.rectangle(W / 2, H + 20, W + 260, 40, {
      isStatic: true,
      label: "floor",
      restitution: 0.02,
      friction: 0.9,
    }),
    Bodies.rectangle(-20, H / 2, 40, H * 2, {
      isStatic: true,
      label: "wallL",
      restitution: 0.05,
      friction: 0.4,
    }),
    Bodies.rectangle(W + 20, H / 2, 40, H * 2, {
      isStatic: true,
      label: "wallR",
      restitution: 0.05,
      friction: 0.4,
    }),
  ]);

  Events.on(engine, "collisionStart", (event) => {
    const pairs = event.pairs;
    for (let i = 0; i < pairs.length; i++) {
      const a = pairs[i].bodyA;
      const b = pairs[i].bodyB;
      if (
        a.label === "ball" &&
        b.label === "ball" &&
        a.game &&
        b.game &&
        !a.game.merged &&
        !b.game.merged &&
        a.game.level === b.game.level
      ) {
        mergeQueue.push([a, b]);
      }
    }
  });

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function createBall(level, x, y, opts) {
    opts = opts || {};
    const r = RADII[level];
    x = clamp(x, r + 3, W - r - 3);
    if (y == null) y = 44;
    const body = Bodies.circle(x, y, r, {
      label: "ball",
      density: 0.0011,
      restitution: 0.12,
      friction: 0.56,
      frictionStatic: 0.8,
      frictionAir: 0.008,
      slop: 0.02,
    });
    body.game = {
      level: level,
      id: ++ballSeq,
      popStart: performance.now(),
      merged: false,
      bornAt: performance.now(),
    };
    World.add(world, body);
    balls.add(body);
    if (opts.vx || opts.vy) {
      Body.setVelocity(body, { x: opts.vx || 0, y: opts.vy || 0 });
    }
    Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);
    return body;
  }

  function processMerges() {
    while (mergeQueue.length) {
      const pair = mergeQueue.shift();
      const a = pair[0];
      const b = pair[1];
      if (!a.game || !b.game || a.game.merged || b.game.merged) continue;
      if (!balls.has(a) || !balls.has(b)) continue;
      if (a.game.level !== b.game.level) continue;

      a.game.merged = true;
      b.game.merged = true;

      const level = a.game.level;
      const x = (a.position.x + b.position.x) / 2;
      const y = (a.position.y + b.position.y) / 2;
      const vx = (a.velocity.x + b.velocity.x) * 0.35;
      const vy = (a.velocity.y + b.velocity.y) * 0.35;
      const r = RADII[level];

      World.remove(world, a);
      World.remove(world, b);
      balls.delete(a);
      balls.delete(b);

      burst(x, y, level, level >= 8 ? 1.5 : 1);

      if (level >= MAX_LEVEL) {
        state.shake = 18;
        addScore(999, x, y, "#ff8a5c", "暴走鲸爆炸！+999");
        addCoins(1);
        rings.push({ x: x, y: y, r: r * 0.5, maxR: r * 4.2, life: 0, maxLife: 620, color: "#ffd166", width: 7 });
        rings.push({ x: x, y: y, r: r * 0.4, maxR: r * 3.2, life: 0, maxLife: 480, color: "#ffffff", width: 4 });
        sfx("big");
        flashScreen();
      } else {
        const nLevel = level + 1;
        createBall(nLevel, x, y, { vx: vx, vy: vy });
        addScore(SCORE[nLevel], x, y, RINGS[nLevel], "+" + SCORE[nLevel]);
        rings.push({
          x: x,
          y: y,
          r: r * 0.9,
          maxR: RADII[nLevel] * 1.45,
          life: 0,
          maxLife: 340,
          color: RINGS[nLevel],
          width: 3,
        });
        state.shake = Math.min(12, 2 + level * 0.8);
        sfx("merge", level);
      }
    }
  }

  /* ---------------------------- 分数 ------------------------------- */
  let bumpTimer = 0;

  function addScore(points, x, y, color, label) {
    state.score += points;
    scoreEl.textContent = String(state.score);
    scoreEl.classList.add("bump");
    clearTimeout(bumpTimer);
    bumpTimer = setTimeout(() => scoreEl.classList.remove("bump"), 180);

    if (state.score > state.best) {
      state.best = state.score;
      bestEl.textContent = String(state.best);
    }

    const milestones = Math.floor(state.score / 2000);
    if (milestones > state.coinMilestones) {
      const gained = milestones - state.coinMilestones;
      state.coinMilestones = milestones;
      addCoins(gained, true);
    }

    if (x != null) {
      texts.push({
        x: x,
        y: y - 14,
        text: label || "+" + points,
        color: color || "#ff6f61",
        life: 0,
        maxLife: 850,
        size: 17,
      });
    }
  }

  function addCoins(n, quiet) {
    state.coins += n;
    coinEl.textContent = String(state.coins);
    if (!quiet) {
      sfx("coin");
      showToast("🪙 女仆币 +" + n + "！");
    } else {
      sfx("coin");
      showToast("🪙 攒到一枚女仆币！");
    }
  }

  function flashScreen() {
    const el = document.createElement("div");
    el.className = "screen-flash";
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("on"));
    setTimeout(() => {
      el.classList.remove("on");
      setTimeout(() => el.remove(), 350);
    }, 80);
  }

  /* ---------------------------- 特效 ------------------------------- */
  function burst(x, y, level, power) {
    const palette = SPARK_COLORS[level] || SPARK_COLORS[0];
    const n = Math.round((10 + level * 2.2) * power);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (60 + Math.random() * 220) * power;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        r: 1.6 + Math.random() * (2.5 + level * 0.25),
        color: palette[(Math.random() * palette.length) | 0],
        life: 0,
        maxLife: 420 + Math.random() * 420,
        gravity: 620,
      });
    }
    for (let i = 0; i < Math.round(3 + level * 0.6); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 90;
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        r: 2.5 + Math.random() * 3,
        color: "#ffffff",
        life: 0,
        maxLife: 300 + Math.random() * 200,
        gravity: 120,
      });
    }
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += (p.gravity * dt) / 1000;
      p.vx *= 0.992;
      p.x += (p.vx * dt) / 1000;
      p.y += (p.vy * dt) / 1000;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].life += dt;
      if (rings[i].life >= rings[i].maxLife) rings.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].life += dt;
      if (texts[i].life >= texts[i].maxLife) texts.splice(i, 1);
    }
  }

  /* ---------------------------- 绘制 ------------------------------- */
  const TAU = Math.PI * 2;

  function easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function drawBallTo(c, x, y, r, tilt, level, scale, alpha, shadow) {
    if (alpha == null) alpha = 1;
    if (scale == null) scale = 1;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.rotate(tilt || 0);
    c.scale(scale, scale);

    // 白色贴纸底
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    c.fillStyle = BALL_COLORS[level] || "#fff";
    if (shadow !== false) {
      c.shadowColor = "rgba(45, 60, 100, 0.2)";
      c.shadowBlur = r * 0.36;
      c.shadowOffsetY = r * 0.1;
    }
    c.fill();
    c.shadowColor = "transparent";

    // 图片裁成圆
    const img = images[level];
    c.save();
    c.beginPath();
    c.arc(0, 0, r, 0, TAU);
    c.clip();
    if (img && img.complete && img.naturalWidth) {
      c.drawImage(img, -r, -r, r * 2, r * 2);
    } else {
      c.fillStyle = BALL_COLORS[level] || "#fff";
      c.fillRect(-r, -r, r * 2, r * 2);
      c.fillStyle = "#5a7dfa";
      c.font = "700 " + Math.round(r * 0.7) + "px CuteFont, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("鲸", 0, 0);
    }
    // 糖果高光
    const g = c.createRadialGradient(-r * 0.32, -r * 0.42, r * 0.05, 0, 0, r * 1.06);
    g.addColorStop(0, "rgba(255,255,255,0.34)");
    g.addColorStop(0.4, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(45,60,110,0.1)");
    c.fillStyle = g;
    c.fillRect(-r, -r, r * 2, r * 2);
    c.restore();

    // 彩环
    c.beginPath();
    c.arc(0, 0, Math.max(1, r - 1.2), 0, TAU);
    c.lineWidth = Math.max(2, r * 0.05);
    c.strokeStyle = RINGS[level] || "#fff";
    c.stroke();

    c.restore();
  }

  function drawBoardBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#fffdf9");
    bg.addColorStop(0.55, "#fffaf2");
    bg.addColorStop(1, "#ffefdf");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 背景柔光装饰
    ctx.save();
    ctx.globalAlpha = 0.55;
    const g1 = ctx.createRadialGradient(W * 0.2, H * 0.32, 10, W * 0.2, H * 0.32, 190);
    g1.addColorStop(0, "rgba(255, 220, 210, 0.5)");
    g1.addColorStop(1, "rgba(255, 220, 210, 0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(W * 0.84, H * 0.72, 10, W * 0.84, H * 0.72, 210);
    g2.addColorStop(0, "rgba(205, 222, 255, 0.55)");
    g2.addColorStop(1, "rgba(205, 222, 255, 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // 底部地板
    const floor = ctx.createLinearGradient(0, H - 34, 0, H);
    floor.addColorStop(0, "rgba(244, 220, 200, 0)");
    floor.addColorStop(1, "rgba(240, 208, 186, 0.55)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, H - 34, W, 34);
  }

  function drawDangerLine(now) {
    const warn = !!state.overflowSince;
    ctx.save();
    ctx.setLineDash([9, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = warn
      ? "rgba(255, 95, 87, " + (0.55 + Math.sin(now / 130) * 0.2) + ")"
      : "rgba(255, 138, 118, 0.42)";
    ctx.beginPath();
    ctx.moveTo(12, DANGER_Y);
    ctx.lineTo(W - 12, DANGER_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = "11px CuteFont, sans-serif";
    ctx.fillStyle = warn ? "rgba(255, 95, 87, 0.8)" : "rgba(200, 140, 125, 0.62)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(warn ? "危险！" : "危险线", W - 14, DANGER_Y - 5);
    ctx.restore();
  }

  function drawAim(now) {
    const level = state.nextLevel;
    const r = RADII[level];
    const x = clamp(state.aimX, r + 5, W - r - 5);

    // 瞄准虚线
    ctx.save();
    ctx.setLineDash([4, 9]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(120, 140, 190, 0.28)";
    ctx.beginPath();
    ctx.moveTo(x, 86);
    ctx.lineTo(x, H - 16);
    ctx.stroke();
    ctx.restore();

    // 落点提示
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, H - 8, r * 0.75, 5, 0, 0, TAU);
    ctx.fillStyle = "rgba(110, 130, 180, 0.12)";
    ctx.fill();
    ctx.restore();

    const bob = Math.sin(now / 320) * 2.5;
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "rgba(255, 143, 130, 0.55)";
    ctx.beginPath();
    ctx.arc(x, 55 + bob, r + 5, 0, TAU);
    ctx.stroke();
    ctx.restore();

    drawBallTo(ctx, x, 55 + bob, r, 0, level, 1, 0.82, true);
  }

  function drawBalls(now) {
    balls.forEach((body) => {
      const level = body.game.level;
      const r = body.radius || body.circleRadius;
      const age = now - body.game.popStart;
      let scale = 1;
      if (age < 260) {
        scale = 0.45 + 0.55 * easeOutBack(Math.min(1, age / 260));
      }
      // 轻微倾斜，保持脸朝上
      const tilt = clamp(body.velocity.x * 0.0045, -0.18, 0.18);
      drawBallTo(ctx, body.position.x, body.position.y, r, tilt, level, scale, 1, true);
    });
  }

  function drawEffects() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.6 + a * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      const t = r.life / r.maxLife;
      const a = (1 - t) * 0.75;
      const radius = r.r + (r.maxR - r.r) * (1 - Math.pow(1 - t, 2));
      ctx.globalAlpha = Math.max(0, a);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const p = t.life / t.maxLife;
      const a = p < 0.15 ? p / 0.15 : 1 - Math.pow((p - 0.15) / 0.85, 2);
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = "700 " + t.size + "px CuteFont, 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(t.text, t.x, t.y - p * 46);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - p * 46);
    }
    ctx.globalAlpha = 1;
  }

  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawBoardBackground();

    ctx.save();
    if (state.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
      state.shake *= 0.86;
    } else {
      state.shake = 0;
    }

    drawDangerLine(now);
    if (state.mode === "playing") drawAim(now);
    drawBalls(now);
    drawEffects();

    ctx.restore();
  }

  /* ------------------------- 下一个 / 合成表 ------------------------ */
  function drawNext() {
    if (!nextCtx) return;
    nextCtx.setTransform(1, 0, 0, 1, 0, 0);
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    drawBallTo(nextCtx, 120, 120, 96, 0, state.nextLevel, 1, 1, true);
  }

  function updateNext() {
    nextNameEl.textContent = NAMES[state.nextLevel];
    drawNext();
  }

  function randomLevel() {
    let total = 0;
    for (let i = 0; i < SPAWN_WEIGHTS.length; i++) total += SPAWN_WEIGHTS[i];
    let roll = Math.random() * total;
    for (let i = 0; i < SPAWN_WEIGHTS.length; i++) {
      roll -= SPAWN_WEIGHTS[i];
      if (roll <= 0) return i;
    }
    return 0;
  }

  function buildChart() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < NAMES.length; i++) {
      const item = document.createElement("div");
      item.className = "merge-item";
      item.dataset.name = NAMES[i];
      item.style.borderColor = RINGS[i];
      const img = document.createElement("img");
      img.src = "assets/balls/" + String(i + 1).padStart(2, "0") + ".png";
      img.alt = NAMES[i];
      item.appendChild(img);
      frag.appendChild(item);
    }
    mergeChart.appendChild(frag);
  }

  /* ---------------------------- 投放 ------------------------------- */
  function setAim(x) {
    const r = RADII[state.nextLevel];
    state.aimX = clamp(x, r + 5, W - r - 5);
  }

  function dropBall() {
    if (state.mode !== "playing") return;
    const now = performance.now();
    if (now < state.dropLockUntil) return;
    ensureAudio();

    const level = state.nextLevel;
    const r = RADII[level];
    const x = clamp(state.aimX, r + 5, W - r - 5);
    createBall(level, x, 44, { vy: 1.6 });
    state.dropLockUntil = now + 240;
    sfx("drop");

    state.nextLevel = randomLevel();
    updateNext();
    state.overflowSince = 0;
  }

  /* --------------------------- 游戏结束 ----------------------------- */
  let toastTimer = 0;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  function checkOverflow(now) {
    if (state.mode !== "playing") return;
    if (now - state.lastOverflowCheck < 180) return;
    state.lastOverflowCheck = now;

    let over = false;
    for (const body of balls) {
      if (
        body.position.y - body.circleRadius < DANGER_Y - 6 &&
        body.speed < 2.2 &&
        now - body.game.bornAt > 900
      ) {
        over = true;
        break;
      }
    }

    if (over) {
      if (!state.overflowSince) state.overflowSince = now;
      boardWrap.classList.add("warning");
      if (now - state.overflowSince > 1600) endGame();
    } else {
      state.overflowSince = 0;
      boardWrap.classList.remove("warning");
    }
  }

  function endGame() {
    if (state.mode === "over") return;
    state.mode = "over";
    state.overflowSince = 0;
    boardWrap.classList.remove("warning");

    if (state.score > 0) {
      const entry = addScoreEntry(state.name, state.score);
      state.currentEntryId = entry.id;
    }

    try {
      const oldBest = Number(localStorage.getItem(BEST_KEY) || "0");
      if (state.best > oldBest) localStorage.setItem(BEST_KEY, String(state.best));
    } catch (e) {
      /* 忽略 */
    }

    goScoreEl.textContent = String(state.score);
    goBestEl.textContent = String(state.best);
    goNameEl.textContent = state.name;
    reviveCountEl.textContent = String(state.coins);
    if (state.coins > 0) goRevive.classList.remove("hidden");
    else goRevive.classList.add("hidden");

    gameoverEl.classList.add("show");
    gameoverEl.setAttribute("aria-hidden", "false");
    sfx("over");
  }

  function hideGameOver() {
    gameoverEl.classList.remove("show");
    gameoverEl.setAttribute("aria-hidden", "true");
  }

  function resetWorld() {
    balls.forEach((body) => World.remove(world, body));
    balls.clear();
    mergeQueue.length = 0;
    particles.length = 0;
    texts.length = 0;
    rings.length = 0;
    engine.gravity.y = 1.15;
  }

  function restart() {
    state.mode = "playing";
    state.score = 0;
    state.coins = 0;
    state.coinMilestones = 0;
    state.overflowSince = 0;
    state.lastOverflowCheck = 0;
    state.dropLockUntil = 0;
    state.currentEntryId = null;
    state.shake = 0;
    state.aimX = W / 2;
    state.pointerDown = false;
    resetWorld();
    hideGameOver();

    scoreEl.textContent = "0";
    coinEl.textContent = "0";
    state.nextLevel = randomLevel();
    updateNext();

    showToast("新的一局开始啦～");
  }

  function revive() {
    if (state.mode !== "over" || state.coins <= 0) return;
    state.coins -= 1;
    coinEl.textContent = String(state.coins);

    if (state.currentEntryId) {
      removeScoreEntry(state.currentEntryId);
      state.currentEntryId = null;
    }

    let removed = 0;
    for (const body of Array.from(balls)) {
      if (body.position.y - body.circleRadius < DANGER_Y + 150) {
        World.remove(world, body);
        balls.delete(body);
        removed++;
      }
    }

    state.mode = "playing";
    state.overflowSince = 0;
    state.lastOverflowCheck = 0;
    state.dropLockUntil = performance.now() + 500;
    state.aimX = W / 2;
    hideGameOver();
    sfx("pop");
    showToast("🪙 复活成功！清掉了 " + removed + " 个危险球");
  }

  /* --------------------------- 排行榜 ------------------------------- */
  function renderLeaderboard() {
    const list = loadScores();
    const recent = list
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20)
      .sort((a, b) => b.score - a.score || b.ts - a.ts);

    lbList.innerHTML = "";
    if (!recent.length) {
      const li = document.createElement("li");
      li.className = "lb-empty";
      li.textContent = "还没有人上榜，快去合成第一只暴走鲸吧！";
      lbList.appendChild(li);
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    recent.forEach((entry, index) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      if (entry.id === state.currentEntryId) li.classList.add("me");

      const rank = document.createElement("span");
      rank.className = "lb-rank";
      rank.textContent = medals[index] || String(index + 1);

      const name = document.createElement("span");
      name.className = "lb-name";
      name.textContent = entry.name || "匿名女仆";

      const score = document.createElement("span");
      score.className = "lb-score";
      score.textContent = String(entry.score);

      li.appendChild(rank);
      li.appendChild(name);
      li.appendChild(score);
      lbList.appendChild(li);
    });
  }

  function openLeaderboard() {
    try {
      if (!lbDialog.open) lbDialog.showModal();
    } catch (e) {
      lbDialog.setAttribute("open", "");
    }
    nickInput.value = state.name;
    renderLeaderboard();
  }

  function saveNickname() {
    const value = (nickInput.value || "").trim().slice(0, 12) || "默认用户";
    state.name = value;
    try {
      localStorage.setItem(NAME_KEY, value);
    } catch (e) {
      /* 忽略 */
    }
    goNameEl.textContent = value;
    if (state.currentEntryId) {
      const list = loadScores();
      const entry = list.find((x) => x.id === state.currentEntryId);
      if (entry) {
        entry.name = value;
        saveScores(list);
      }
    }
    renderLeaderboard();
    showToast("昵称已保存：" + value);
  }

  /* --------------------------- 事件绑定 ----------------------------- */
  function canvasXFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * W;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (state.mode !== "playing") return;
    e.preventDefault();
    ensureAudio();
    state.pointerDown = true;
    setAim(canvasXFromEvent(e));
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 忽略 */
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (state.mode !== "playing") return;
    if (e.pointerType === "mouse" || state.pointerDown) {
      setAim(canvasXFromEvent(e));
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state.mode !== "playing") return;
    if (!state.pointerDown) return;
    state.pointerDown = false;
    setAim(canvasXFromEvent(e));
    dropBall();
  });

  canvas.addEventListener("pointercancel", () => {
    state.pointerDown = false;
  });

  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (lbDialog.open) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      state.aimX = clamp(state.aimX - 16, RADII[state.nextLevel] + 5, W - RADII[state.nextLevel] - 5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      state.aimX = clamp(state.aimX + 16, RADII[state.nextLevel] + 5, W - RADII[state.nextLevel] - 5);
    } else if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      dropBall();
    } else if (e.key === "r" || e.key === "R") {
      restart();
    }
  });

  document.getElementById("btnRestart").addEventListener("click", restart);
  document.getElementById("goRestart").addEventListener("click", restart);
  document.getElementById("btnLeaderboard").addEventListener("click", openLeaderboard);
  document.getElementById("goLeaderboard").addEventListener("click", openLeaderboard);
  document.getElementById("goChangeName").addEventListener("click", () => {
    openLeaderboard();
    setTimeout(() => nickInput.focus(), 80);
  });
  goRevive.addEventListener("click", revive);
  document.getElementById("saveNick").addEventListener("click", saveNickname);
  nickInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveNickname();
    }
  });
  document.getElementById("btnRefreshLb").addEventListener("click", renderLeaderboard);

  lbDialog.addEventListener("click", (e) => {
    if (e.target === lbDialog) {
      try {
        lbDialog.close();
      } catch (err) {
        lbDialog.removeAttribute("open");
      }
    }
  });

  soundBtn.addEventListener("click", () => {
    state.soundOn = !state.soundOn;
    try {
      localStorage.setItem(SOUND_KEY, state.soundOn ? "on" : "off");
    } catch (e) {
      /* 忽略 */
    }
    soundBtn.textContent = state.soundOn ? "🔊 音效开" : "🔇 音效关";
    soundBtn.setAttribute("aria-pressed", String(state.soundOn));
    if (state.soundOn) {
      ensureAudio();
      sfx("pop");
    }
  });

  window.addEventListener("beforeunload", () => {
    try {
      localStorage.setItem(BEST_KEY, String(state.best));
    } catch (e) {
      /* 忽略 */
    }
  });

  /* ---------------------------- 启动 ------------------------------- */
  function init() {
    state.best = Number(readJSON(BEST_KEY, 0)) || 0;
    state.name = localStorage.getItem(NAME_KEY) || "默认用户";
    const savedSound = localStorage.getItem(SOUND_KEY);
    state.soundOn = savedSound !== "off";

    scoreEl.textContent = "0";
    bestEl.textContent = String(state.best);
    coinEl.textContent = "0";
    goNameEl.textContent = state.name;
    soundBtn.textContent = state.soundOn ? "🔊 音效开" : "🔇 音效关";
    soundBtn.setAttribute("aria-pressed", String(state.soundOn));

    buildChart();
    state.nextLevel = randomLevel();
    updateNext();
    setAim(W / 2);

    let last = performance.now();
    let acc = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(64, now - last);
      last = now;

      if (state.mode === "playing") {
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 4) {
          Engine.update(engine, STEP);
          acc -= STEP;
          steps++;
        }
        if (steps >= 4) acc = 0;
        processMerges();
        checkOverflow(now);
      }

      updateEffects(dt);
      render(now);
    }

    requestAnimationFrame(frame);
  }

  // 调试接口（不影响正常玩法）
  window.__MAID__ = {
    state: state,
    dropAt: function (x) {
      setAim(x);
      dropBall();
    },
    dropLevelAt: function (level, x) {
      createBall(level, x, 44, { vy: 1.6 });
    },
    endGame: endGame,
    restart: restart,
    balls: balls,
    addScore: addScore,
  };

  init();
})();
