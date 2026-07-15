import { useEffect, useReducer, useRef } from "react";
import { FlatButton } from "./TetrisWidget";

// Third entry in the logo's 3-click game picker (see LeftPanel.tsx) — Space
// Invaders: a grid of aliens marches side to side (dropping and speeding up
// each time it clips an edge, same escalation as the arcade original),
// player moves left/right along the bottom and fires straight up (one shot
// in flight at a time, matching the original's single-bullet limit). Same
// portrait framing as PongWidget (narrow, tall left panel) and the same
// requestAnimationFrame delta-time loop, since alien/bullet movement needs
// to be continuous rather than tick-stepped like TetrisWidget.

const GAME_W = 450;
const GAME_H = 800;

const PLAYER_W = 40;
const PLAYER_H = 14;
const PLAYER_INSET_BOTTOM = 30;
const PLAYER_SPEED = 300;

const BULLET_W = 3;
const BULLET_H = 14;
const PLAYER_BULLET_SPEED = 520;
const ENEMY_BULLET_SPEED = 240;

const INVADER_COLS = 6;
const INVADER_ROWS = 5;
const INVADER_W = 32;
const INVADER_H = 22;
const INVADER_GAP_X = 14;
const INVADER_GAP_Y = 16;
const INVADER_TOP = 70;
const INVADER_START_X = (GAME_W - (INVADER_COLS * INVADER_W + (INVADER_COLS - 1) * INVADER_GAP_X)) / 2;
const INVADER_EDGE_MARGIN = 16;
const INVADER_DROP = 22;
const BASE_INVADER_SPEED = 34;

const LIVES_START = 3;
const LS_HIGH_SCORE = "space_invaders_high_score";

interface Invader { col: number; row: number; alive: boolean }
interface Bullet { x: number; y: number }

function makeInvaders(): Invader[] {
  const out: Invader[] = [];
  for (let row = 0; row < INVADER_ROWS; row++) {
    for (let col = 0; col < INVADER_COLS; col++) out.push({ col, row, alive: true });
  }
  return out;
}

export function SpaceInvadersWidget({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const playerXRef = useRef(GAME_W / 2);
  const invadersRef = useRef<Invader[]>(makeInvaders());
  const groupXRef = useRef(0);
  const groupYRef = useRef(0);
  const groupDirRef = useRef(1);
  const speedMultRef = useRef(1);
  const playerBulletRef = useRef<Bullet | null>(null);
  const enemyBulletsRef = useRef<Bullet[]>([]);
  const enemyFireCooldownRef = useRef(1.2);

  const scoreRef = useRef(0);
  const livesRef = useRef(LIVES_START);
  const waveRef = useRef(1);
  const highScoreRef = useRef(0);
  const pausedRef = useRef(false);
  const gameOverRef = useRef(false);
  const wonRef = useRef(false);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  function updateHighScore() {
    if (scoreRef.current > highScoreRef.current) {
      highScoreRef.current = scoreRef.current;
      localStorage.setItem(LS_HIGH_SCORE, String(highScoreRef.current));
    }
  }

  function invaderPos(inv: Invader) {
    return {
      x: INVADER_START_X + inv.col * (INVADER_W + INVADER_GAP_X) + groupXRef.current,
      y: INVADER_TOP + inv.row * (INVADER_H + INVADER_GAP_Y) + groupYRef.current,
    };
  }

  function startWave(wave: number) {
    invadersRef.current = makeInvaders();
    groupXRef.current = 0;
    groupYRef.current = 0;
    groupDirRef.current = 1;
    speedMultRef.current = 1 + (wave - 1) * 0.25;
    playerBulletRef.current = null;
    enemyBulletsRef.current = [];
    enemyFireCooldownRef.current = 1.2;
  }

  function loseLife() {
    livesRef.current -= 1;
    if (livesRef.current <= 0) {
      gameOverRef.current = true;
      wonRef.current = false;
      updateHighScore();
    }
    forceRender();
  }

  function step(dt: number) {
    if (keysRef.current.has("ArrowLeft")) playerXRef.current -= PLAYER_SPEED * dt;
    if (keysRef.current.has("ArrowRight")) playerXRef.current += PLAYER_SPEED * dt;
    playerXRef.current = Math.max(PLAYER_W / 2, Math.min(GAME_W - PLAYER_W / 2, playerXRef.current));

    // Alien grid: marches as one block, reverses + drops on hitting an edge —
    // fewer aliens left / higher waves both raise speedMult, same as the
    // arcade original speeding up as the formation thins out.
    const alive = invadersRef.current.filter((i) => i.alive);
    if (alive.length === 0) {
      wonRef.current = true;
      gameOverRef.current = true;
      updateHighScore();
      forceRender();
      return;
    }
    const killedFrac = 1 - alive.length / invadersRef.current.length;
    const speed = BASE_INVADER_SPEED * speedMultRef.current * (1 + killedFrac * 2.5);
    groupXRef.current += groupDirRef.current * speed * dt;

    const xs = alive.map((i) => invaderPos(i).x);
    const minX = Math.min(...xs), maxX = Math.max(...xs) + INVADER_W;
    if ((groupDirRef.current > 0 && maxX >= GAME_W - INVADER_EDGE_MARGIN)
      || (groupDirRef.current < 0 && minX <= INVADER_EDGE_MARGIN)) {
      groupDirRef.current *= -1;
      groupYRef.current += INVADER_DROP;
      speedMultRef.current += 0.06;
    }

    // Invasion — an alien reaching the player's row ends the game outright.
    const playerY = GAME_H - PLAYER_INSET_BOTTOM - PLAYER_H;
    for (const inv of alive) {
      if (invaderPos(inv).y + INVADER_H >= playerY) {
        gameOverRef.current = true;
        wonRef.current = false;
        updateHighScore();
        forceRender();
        return;
      }
    }

    // Player bullet.
    const pb = playerBulletRef.current;
    if (pb) {
      pb.y -= PLAYER_BULLET_SPEED * dt;
      if (pb.y < -BULLET_H) playerBulletRef.current = null;
      else {
        for (const inv of invadersRef.current) {
          if (!inv.alive) continue;
          const p = invaderPos(inv);
          if (pb.x >= p.x && pb.x <= p.x + INVADER_W && pb.y >= p.y && pb.y <= p.y + INVADER_H) {
            inv.alive = false;
            playerBulletRef.current = null;
            scoreRef.current += 10 * waveRef.current;
            forceRender();
            break;
          }
        }
      }
    }

    // Enemy fire — a random alive invader in the bottom of its column takes a shot.
    enemyFireCooldownRef.current -= dt;
    if (enemyFireCooldownRef.current <= 0) {
      enemyFireCooldownRef.current = Math.max(0.35, 1.3 - waveRef.current * 0.08 - killedFrac);
      const byCol = new Map<number, Invader>();
      for (const inv of alive) {
        const existing = byCol.get(inv.col);
        if (!existing || inv.row > existing.row) byCol.set(inv.col, inv);
      }
      const shooters = [...byCol.values()];
      if (shooters.length) {
        const shooter = shooters[Math.floor(Math.random() * shooters.length)];
        const p = invaderPos(shooter);
        enemyBulletsRef.current.push({ x: p.x + INVADER_W / 2, y: p.y + INVADER_H });
      }
    }

    const playerLeft = playerXRef.current - PLAYER_W / 2, playerRight = playerXRef.current + PLAYER_W / 2;
    enemyBulletsRef.current = enemyBulletsRef.current.filter((b) => {
      b.y += ENEMY_BULLET_SPEED * dt;
      if (b.y > GAME_H) return false;
      if (b.y + BULLET_H >= playerY && b.x >= playerLeft && b.x <= playerRight) {
        loseLife();
        return false;
      }
      return true;
    });
  }

  function draw() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const W = container.clientWidth, H = container.clientHeight;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scale = Math.max(0.1, Math.min(W / GAME_W, H / GAME_H));
    const gw = GAME_W * scale, gh = GAME_H * scale;
    const ox = Math.floor((W - gw) / 2), oy = Math.floor((H - gh) / 2);

    const rootStyle = getComputedStyle(document.documentElement);
    const panelBg = rootStyle.getPropertyValue("--left-panel-bg").trim() || "#0d0d0d";
    const border = rootStyle.getPropertyValue("--border").trim() || "#1a1a1a";
    const accent = rootStyle.getPropertyValue("--accent").trim() || "#ffffff";

    ctx.fillStyle = panelBg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, GAME_W, GAME_H);

    for (const inv of invadersRef.current) {
      if (!inv.alive) continue;
      const p = invaderPos(inv);
      ctx.globalAlpha = 0.55 + 0.15 * (INVADER_ROWS - inv.row);
      ctx.fillStyle = accent;
      ctx.fillRect(p.x, p.y, INVADER_W, INVADER_H);
    }
    ctx.globalAlpha = 1;

    if (!gameOverRef.current) {
      ctx.fillStyle = accent;
      const py = GAME_H - PLAYER_INSET_BOTTOM - PLAYER_H;
      ctx.fillRect(playerXRef.current - PLAYER_W / 2, py, PLAYER_W, PLAYER_H);
    }

    ctx.fillStyle = "#ffffff";
    if (playerBulletRef.current) {
      const b = playerBulletRef.current;
      ctx.fillRect(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H);
    }
    ctx.fillStyle = "#ff5050";
    for (const b of enemyBulletsRef.current) ctx.fillRect(b.x - BULLET_W / 2, b.y, BULLET_W, BULLET_H);

    if (pausedRef.current || gameOverRef.current) {
      ctx.fillStyle = "rgba(0,0,0,0.63)";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = pausedRef.current ? "PAUSED" : wonRef.current ? "WAVE CLEARED!" : "GAME OVER";
      ctx.fillText(label, GAME_W / 2, GAME_H / 2);
      if (gameOverRef.current) {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px sans-serif";
        ctx.fillText(
          wonRef.current ? "Press Restart or Enter for the next wave" : "Press Restart or Enter",
          GAME_W / 2, GAME_H / 2 + 32,
        );
      }
    }
    ctx.restore();
  }

  function loop(t: number) {
    const last = lastTimeRef.current ?? t;
    const dt = Math.min(0.05, (t - last) / 1000);
    lastTimeRef.current = t;
    if (!pausedRef.current && !gameOverRef.current) step(dt);
    draw();
    rafRef.current = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (gameOverRef.current) return;
    pausedRef.current = !pausedRef.current;
    forceRender();
  }

  function fire() {
    if (gameOverRef.current || pausedRef.current || playerBulletRef.current) return;
    playerBulletRef.current = { x: playerXRef.current, y: GAME_H - PLAYER_INSET_BOTTOM - PLAYER_H - BULLET_H };
  }

  function restart() {
    // A win advances to the next wave (harder, faster); a loss starts over
    // from wave 1 — matches the classic "clear it, level up" / "die, restart" split.
    if (gameOverRef.current && wonRef.current) {
      waveRef.current += 1;
    } else {
      scoreRef.current = 0;
      livesRef.current = LIVES_START;
      waveRef.current = 1;
    }
    playerXRef.current = GAME_W / 2;
    gameOverRef.current = false;
    pausedRef.current = false;
    wonRef.current = false;
    startWave(waveRef.current);
    forceRender();
  }

  useEffect(() => {
    highScoreRef.current = Number(localStorage.getItem(LS_HIGH_SCORE) ?? 0);
    startWave(waveRef.current);
    containerRef.current?.focus();
    lastTimeRef.current = null;
    rafRef.current = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => draw());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (gameOverRef.current) {
      if (e.key === "Enter" || e.key === " ") restart();
      return;
    }
    if (e.key === "p" || e.key === "P") { togglePause(); return; }
    if (pausedRef.current) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      keysRef.current.add(e.key);
    }
    if (e.key === " ") { e.preventDefault(); fire(); }
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    keysRef.current.delete(e.key);
  }

  const score = scoreRef.current, lives = livesRef.current, wave = waveRef.current, best = highScoreRef.current;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className="absolute inset-0 flex flex-col outline-none"
      style={{ background: "var(--left-panel-bg)", zIndex: 50 }}
    >
      {/* min-h-0 — see TetrisWidget.tsx's identical note: without it the
          canvas (a replaced element) balloons and pushes the HUD out of view. */}
      <canvas ref={canvasRef} className="flex-1 min-h-0" style={{ width: "100%", height: "100%" }} />
      <div className="flex flex-col shrink-0" style={{ padding: "6px 8px", gap: 3, background: "var(--left-panel-bg)" }}>
        <p className="text-center" style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          Score: {score}   Lives: {lives}   Wave: {wave}   Best: {best}
        </p>
        <div className="flex items-center justify-center" style={{ gap: 16 }}>
          <FlatButton icon={pausedRef.current ? "img/sub_play.png" : "img/sub_pause.png"} label={pausedRef.current ? "Resume" : "Pause"} onClick={togglePause} />
          <FlatButton icon="img/sub_refresh.png" label="Restart" onClick={restart} />
          <FlatButton icon="img/sub_close.png" label="Close" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
