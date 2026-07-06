import { useEffect, useReducer, useRef } from "react";
import { FlatButton } from "./TetrisWidget";

// Second entry in the logo's 3-click game picker (see LeftPanel.tsx) —
// classic Pong: player (bottom, Arrow Left/Right) vs. a ball-tracking AI
// (top), first to WIN_SCORE. Oriented portrait rather than the traditional
// landscape layout — the left panel this overlay fills is narrow and tall,
// so paddles-at-top/bottom (ball travels vertically) uses the space far
// better than paddles-at-sides would. Physics run on a requestAnimationFrame
// loop (delta-time based, unlike TetrisWidget's discrete setTimeout ticks)
// since paddle movement needs to feel continuous while a key is held rather
// than per-tick-stepped.

const GAME_W = 450;
const GAME_H = 800;
const PADDLE_LEN = 80;
const PADDLE_THICK = 12;
const PADDLE_INSET = 20;
const BALL_R = 8;
const WIN_SCORE = 7;
const PLAYER_SPEED = 420;
const AI_SPEED = 300;
const BALL_SPEED_INITIAL = 320;
const BALL_SPEED_MAX = 640;
const LS_BEST_STREAK = "pong_best_streak";

type Winner = "player" | "ai" | null;

function randomServeVx(): number {
  return (Math.random() * 2 - 1) * BALL_SPEED_INITIAL * 0.4;
}

export function PongWidget({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const keysRef = useRef<Set<string>>(new Set());

  const playerXRef = useRef(GAME_W / 2);
  const aiXRef = useRef(GAME_W / 2);
  const ballRef = useRef({ x: GAME_W / 2, y: GAME_H / 2, vx: randomServeVx(), vy: BALL_SPEED_INITIAL });
  const playerScoreRef = useRef(0);
  const aiScoreRef = useRef(0);
  const streakRef = useRef(0);
  const bestStreakRef = useRef(0);
  const pausedRef = useRef(false);
  const gameOverRef = useRef(false);
  const winnerRef = useRef<Winner>(null);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  function updateBestStreak() {
    if (streakRef.current > bestStreakRef.current) {
      bestStreakRef.current = streakRef.current;
      localStorage.setItem(LS_BEST_STREAK, String(bestStreakRef.current));
    }
  }

  function serve() {
    ballRef.current = {
      x: GAME_W / 2, y: GAME_H / 2,
      vx: randomServeVx(),
      vy: Math.random() < 0.5 ? BALL_SPEED_INITIAL : -BALL_SPEED_INITIAL,
    };
  }

  function scorePoint(who: "player" | "ai") {
    if (who === "player") {
      playerScoreRef.current += 1;
      streakRef.current += 1;
    } else {
      aiScoreRef.current += 1;
      streakRef.current = 0;
    }
    if (playerScoreRef.current >= WIN_SCORE || aiScoreRef.current >= WIN_SCORE) {
      winnerRef.current = playerScoreRef.current > aiScoreRef.current ? "player" : "ai";
      gameOverRef.current = true;
      updateBestStreak();
    } else {
      serve();
    }
    forceRender();
  }

  function step(dt: number) {
    if (keysRef.current.has("ArrowLeft")) playerXRef.current -= PLAYER_SPEED * dt;
    if (keysRef.current.has("ArrowRight")) playerXRef.current += PLAYER_SPEED * dt;
    playerXRef.current = Math.max(PADDLE_LEN / 2, Math.min(GAME_W - PADDLE_LEN / 2, playerXRef.current));

    const ball = ballRef.current;
    const aiDiff = ball.x - aiXRef.current;
    const aiStep = Math.max(-AI_SPEED * dt, Math.min(AI_SPEED * dt, aiDiff));
    aiXRef.current = Math.max(PADDLE_LEN / 2, Math.min(GAME_W - PADDLE_LEN / 2, aiXRef.current + aiStep));

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x - BALL_R <= 0 && ball.vx < 0) { ball.x = BALL_R; ball.vx = -ball.vx; }
    if (ball.x + BALL_R >= GAME_W && ball.vx > 0) { ball.x = GAME_W - BALL_R; ball.vx = -ball.vx; }

    // Bottom (player) paddle collision.
    const playerTop = GAME_H - PADDLE_INSET - PADDLE_THICK, playerBottom = GAME_H - PADDLE_INSET;
    if (ball.vy > 0 && ball.y + BALL_R >= playerTop && ball.y + BALL_R <= playerBottom
      && ball.x >= playerXRef.current - PADDLE_LEN / 2 && ball.x <= playerXRef.current + PADDLE_LEN / 2) {
      ball.y = playerTop - BALL_R;
      const hitOffset = (ball.x - playerXRef.current) / (PADDLE_LEN / 2);
      const speed = Math.min(BALL_SPEED_MAX, Math.hypot(ball.vx, ball.vy) * 1.08);
      ball.vy = -Math.abs(speed * Math.cos(hitOffset * 0.6));
      ball.vx = speed * Math.sin(hitOffset * 0.6);
    }

    // Top (AI) paddle collision.
    const aiTop = PADDLE_INSET, aiBottom = PADDLE_INSET + PADDLE_THICK;
    if (ball.vy < 0 && ball.y - BALL_R <= aiBottom && ball.y - BALL_R >= aiTop
      && ball.x >= aiXRef.current - PADDLE_LEN / 2 && ball.x <= aiXRef.current + PADDLE_LEN / 2) {
      ball.y = aiBottom + BALL_R;
      const hitOffset = (ball.x - aiXRef.current) / (PADDLE_LEN / 2);
      const speed = Math.min(BALL_SPEED_MAX, Math.hypot(ball.vx, ball.vy) * 1.08);
      ball.vy = Math.abs(speed * Math.cos(hitOffset * 0.6));
      ball.vx = speed * Math.sin(hitOffset * 0.6);
    }

    if (ball.y < -BALL_R) scorePoint("player");
    else if (ball.y > GAME_H + BALL_R) scorePoint("ai");
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

    // Center net (dashed, horizontal).
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(0, GAME_H / 2);
    ctx.lineTo(GAME_W, GAME_H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = accent;
    ctx.fillRect(aiXRef.current - PADDLE_LEN / 2, PADDLE_INSET, PADDLE_LEN, PADDLE_THICK);
    ctx.fillRect(playerXRef.current - PADDLE_LEN / 2, GAME_H - PADDLE_INSET - PADDLE_THICK, PADDLE_LEN, PADDLE_THICK);

    if (!gameOverRef.current) {
      ctx.beginPath();
      ctx.arc(ballRef.current.x, ballRef.current.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.5;
    ctx.fillText(String(aiScoreRef.current), GAME_W / 2, GAME_H / 2 - 60);
    ctx.fillText(String(playerScoreRef.current), GAME_W / 2, GAME_H / 2 + 60);
    ctx.globalAlpha = 1;

    if (pausedRef.current || gameOverRef.current) {
      ctx.fillStyle = "rgba(0,0,0,0.63)";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = pausedRef.current ? "PAUSED" : winnerRef.current === "player" ? "YOU WIN!" : "AI WINS!";
      ctx.fillText(label, GAME_W / 2, GAME_H / 2);
      if (gameOverRef.current) {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px sans-serif";
        ctx.fillText("Press Restart or Enter", GAME_W / 2, GAME_H / 2 + 32);
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
    pausedRef.current = !pausedRef.current;
    forceRender();
  }

  function restart() {
    playerXRef.current = GAME_W / 2;
    aiXRef.current = GAME_W / 2;
    playerScoreRef.current = 0;
    aiScoreRef.current = 0;
    streakRef.current = 0;
    gameOverRef.current = false;
    pausedRef.current = false;
    winnerRef.current = null;
    serve();
    forceRender();
  }

  useEffect(() => {
    bestStreakRef.current = Number(localStorage.getItem(LS_BEST_STREAK) ?? 0);
    serve();
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
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      keysRef.current.add(e.key);
    }
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    keysRef.current.delete(e.key);
  }

  const playerScore = playerScoreRef.current, aiScore = aiScoreRef.current, best = bestStreakRef.current;

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
          You: {playerScore}   AI: {aiScore}   Best Streak: {best}
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
