import { useEffect, useReducer, useRef } from "react";
import { FlatButton } from "./TetrisWidget";

// Fourth entry in the logo's 3-click game picker (see LeftPanel.tsx) —
// Breakout/Arkanoid: same idea as SpaceInvadersWidget's brick grid up top
// and a paddle at the bottom, but instead of firing bullets you bounce a
// ball off the paddle to smash the bricks, and it ricochets off walls/bricks
// the way PongWidget's ball ricochets off paddles. Same portrait framing and
// requestAnimationFrame delta-time loop as those two, for the same reason:
// continuous paddle/ball movement doesn't suit TetrisWidget's discrete ticks.

const GAME_W = 450;
const GAME_H = 800;

const PADDLE_W = 70;
const PADDLE_H = 14;
const PADDLE_INSET_BOTTOM = 30;
const PADDLE_SPEED = 380;

const BALL_R = 7;
const BALL_SPEED_INITIAL = 300;
const BALL_SPEED_MAX = 620;

const BRICK_COLS = 7;
const BRICK_ROWS = 6;
const BRICK_W = 50;
const BRICK_H = 20;
const BRICK_GAP = 8;
const BRICK_TOP = 70;
const BRICK_START_X = (GAME_W - (BRICK_COLS * BRICK_W + (BRICK_COLS - 1) * BRICK_GAP)) / 2;

const LIVES_START = 3;
const LS_HIGH_SCORE = "breakout_high_score";

interface Brick { col: number; row: number; alive: boolean }

function makeBricks(): Brick[] {
  const out: Brick[] = [];
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) out.push({ col, row, alive: true });
  }
  return out;
}

function brickPos(b: Brick) {
  return { x: BRICK_START_X + b.col * (BRICK_W + BRICK_GAP), y: BRICK_TOP + b.row * (BRICK_H + BRICK_GAP) };
}

export function BreakoutWidget({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const paddleXRef = useRef(GAME_W / 2);
  const ballRef = useRef({ x: GAME_W / 2, y: 0, vx: 0, vy: 0 });
  const ballStuckRef = useRef(true);
  const bricksRef = useRef<Brick[]>(makeBricks());

  const scoreRef = useRef(0);
  const livesRef = useRef(LIVES_START);
  const levelRef = useRef(1);
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

  function paddleTop() { return GAME_H - PADDLE_INSET_BOTTOM - PADDLE_H; }

  function stickBallToPaddle() {
    ballStuckRef.current = true;
    ballRef.current = { x: paddleXRef.current, y: paddleTop() - BALL_R, vx: 0, vy: 0 };
  }

  function launchBall() {
    if (!ballStuckRef.current) return;
    ballStuckRef.current = false;
    const speed = BALL_SPEED_INITIAL * (1 + (levelRef.current - 1) * 0.12);
    const angle = (Math.random() * 2 - 1) * 0.35 - Math.PI / 2; // mostly-upward, slight random tilt
    ballRef.current.vx = speed * Math.cos(angle);
    ballRef.current.vy = speed * Math.sin(angle);
  }

  function startLevel() {
    bricksRef.current = makeBricks();
    paddleXRef.current = GAME_W / 2;
    stickBallToPaddle();
  }

  function loseLife() {
    livesRef.current -= 1;
    if (livesRef.current <= 0) {
      gameOverRef.current = true;
      wonRef.current = false;
      updateHighScore();
    } else {
      stickBallToPaddle();
    }
    forceRender();
  }

  function step(dt: number) {
    if (keysRef.current.has("ArrowLeft")) paddleXRef.current -= PADDLE_SPEED * dt;
    if (keysRef.current.has("ArrowRight")) paddleXRef.current += PADDLE_SPEED * dt;
    paddleXRef.current = Math.max(PADDLE_W / 2, Math.min(GAME_W - PADDLE_W / 2, paddleXRef.current));

    const ball = ballRef.current;
    if (ballStuckRef.current) {
      ball.x = paddleXRef.current;
      ball.y = paddleTop() - BALL_R;
      return;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - BALL_R <= 0 && ball.vx < 0) { ball.x = BALL_R; ball.vx = -ball.vx; }
    if (ball.x + BALL_R >= GAME_W && ball.vx > 0) { ball.x = GAME_W - BALL_R; ball.vx = -ball.vx; }
    if (ball.y - BALL_R <= 0 && ball.vy < 0) { ball.y = BALL_R; ball.vy = -ball.vy; }

    // Paddle bounce — angled by hit offset, same as PongWidget's paddle response.
    const pTop = paddleTop();
    if (ball.vy > 0 && ball.y + BALL_R >= pTop && ball.y + BALL_R <= pTop + PADDLE_H
      && ball.x >= paddleXRef.current - PADDLE_W / 2 && ball.x <= paddleXRef.current + PADDLE_W / 2) {
      ball.y = pTop - BALL_R;
      const hitOffset = (ball.x - paddleXRef.current) / (PADDLE_W / 2);
      const speed = Math.min(BALL_SPEED_MAX, Math.hypot(ball.vx, ball.vy));
      ball.vy = -Math.abs(speed * Math.cos(hitOffset * 0.6));
      ball.vx = speed * Math.sin(hitOffset * 0.6);
    }

    // Ball lost past the paddle.
    if (ball.y - BALL_R > GAME_H) { loseLife(); return; }

    // Brick collision — reflect whichever axis has the smaller overlap
    // (simple, standard AABB-vs-circle approximation, good enough for the
    // arcade feel without full swept collision).
    for (const brick of bricksRef.current) {
      if (!brick.alive) continue;
      const p = brickPos(brick);
      const closestX = Math.max(p.x, Math.min(ball.x, p.x + BRICK_W));
      const closestY = Math.max(p.y, Math.min(ball.y, p.y + BRICK_H));
      const dx = ball.x - closestX, dy = ball.y - closestY;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;

      brick.alive = false;
      scoreRef.current += 10 * levelRef.current;
      const speed = Math.min(BALL_SPEED_MAX, Math.hypot(ball.vx, ball.vy) * 1.05);
      const overlapX = Math.min(ball.x + BALL_R, p.x + BRICK_W) - Math.max(ball.x - BALL_R, p.x);
      const overlapY = Math.min(ball.y + BALL_R, p.y + BRICK_H) - Math.max(ball.y - BALL_R, p.y);
      if (overlapX < overlapY) ball.vx = -ball.vx; else ball.vy = -ball.vy;
      const norm = speed / Math.max(1, Math.hypot(ball.vx, ball.vy));
      ball.vx *= norm; ball.vy *= norm;
      forceRender();
      break;
    }

    if (bricksRef.current.every((b) => !b.alive)) {
      wonRef.current = true;
      gameOverRef.current = true;
      updateHighScore();
      forceRender();
    }
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
    const panelBg = rootStyle.getPropertyValue("--panel-bg").trim() || "#0d0d0d";
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

    for (const brick of bricksRef.current) {
      if (!brick.alive) continue;
      const p = brickPos(brick);
      ctx.globalAlpha = 0.5 + 0.1 * (BRICK_ROWS - brick.row);
      ctx.fillStyle = accent;
      ctx.fillRect(p.x, p.y, BRICK_W, BRICK_H);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = accent;
    ctx.fillRect(paddleXRef.current - PADDLE_W / 2, paddleTop(), PADDLE_W, PADDLE_H);

    if (!gameOverRef.current) {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ballRef.current.x, ballRef.current.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    if (pausedRef.current || gameOverRef.current || ballStuckRef.current) {
      if (pausedRef.current || gameOverRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.63)";
        ctx.fillRect(0, 0, GAME_W, GAME_H);
      }
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (pausedRef.current) {
        ctx.fillText("PAUSED", GAME_W / 2, GAME_H / 2);
      } else if (gameOverRef.current) {
        ctx.fillText(wonRef.current ? "LEVEL CLEARED!" : "GAME OVER", GAME_W / 2, GAME_H / 2);
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px sans-serif";
        ctx.fillText(
          wonRef.current ? "Press Restart or Enter for the next level" : "Press Restart or Enter",
          GAME_W / 2, GAME_H / 2 + 32,
        );
      } else {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px sans-serif";
        ctx.fillText("Press Space to launch", GAME_W / 2, paddleTop() - 40);
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

  function restart() {
    // A win advances to the next (faster) level, keeping score/lives; a loss
    // starts over from level 1 — same split as SpaceInvadersWidget's waves.
    if (gameOverRef.current && wonRef.current) {
      levelRef.current += 1;
    } else {
      scoreRef.current = 0;
      livesRef.current = LIVES_START;
      levelRef.current = 1;
    }
    gameOverRef.current = false;
    pausedRef.current = false;
    wonRef.current = false;
    startLevel();
    forceRender();
  }

  useEffect(() => {
    highScoreRef.current = Number(localStorage.getItem(LS_HIGH_SCORE) ?? 0);
    startLevel();
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
    if (e.key === " ") { e.preventDefault(); launchBall(); }
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    keysRef.current.delete(e.key);
  }

  const score = scoreRef.current, lives = livesRef.current, level = levelRef.current, best = highScoreRef.current;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className="absolute inset-0 flex flex-col outline-none"
      style={{ background: "var(--panel-bg)", zIndex: 50 }}
    >
      {/* min-h-0 — see TetrisWidget.tsx's identical note: without it the
          canvas (a replaced element) balloons and pushes the HUD out of view. */}
      <canvas ref={canvasRef} className="flex-1 min-h-0" style={{ width: "100%", height: "100%" }} />
      <div className="flex flex-col shrink-0" style={{ padding: "6px 8px", gap: 3, background: "var(--panel-bg)" }}>
        <p className="text-center" style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          Score: {score}   Lives: {lives}   Level: {level}   Best: {best}
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
