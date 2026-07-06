import { useEffect, useReducer, useRef } from "react";
import { Icon } from "./Icon";

// Ported from the old app's tetris_easter_egg.py — originally triggered by 7
// rapid clicks on the Home tab; this app triggers it from 3 clicks on the
// left panel's logo instead (see LeftPanel.tsx). Renders as an overlay
// filling the left panel, same as the old app's TetrisWidget(self._left_panel).
// Simplification: the old app kept one TetrisWidget instance alive and just
// hid/re-showed it (so a paused game survived closing the overlay); this
// version unmounts on close, so every open is a fresh game — acceptable
// since it's an easter egg, not a feature anyone expects to resume mid-play.

const COLS = 10;
const ROWS = 26;
const LS_HIGH_SCORE = "tetris_high_score";

type ShapeName = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
type Shape = number[][];

const SHAPES: Record<ShapeName, Shape> = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
};
const COLORS: Record<ShapeName, string> = {
  I: "#00f0f0", O: "#f0f000", T: "#a000f0",
  S: "#00f000", Z: "#f00000", J: "#0000f0", L: "#f0a000",
};
const SHAPE_NAMES = Object.keys(SHAPES) as ShapeName[];

function rotate(shape: Shape): Shape {
  const rows = shape.length, cols = shape[0].length;
  const out: Shape = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[c][rows - 1 - r] = shape[r][c];
  return out;
}

class Piece {
  name: ShapeName;
  shape: Shape;
  color: string;
  x: number;
  y: number;
  constructor() {
    this.name = SHAPE_NAMES[Math.floor(Math.random() * SHAPE_NAMES.length)];
    this.shape = SHAPES[this.name].map((row) => [...row]);
    this.color = COLORS[this.name];
    this.x = Math.floor(COLS / 2) - Math.floor(this.shape[0].length / 2);
    this.y = 0;
  }
  cells(dx = 0, dy = 0, shape?: Shape): [number, number][] {
    const s = shape ?? this.shape;
    const out: [number, number][] = [];
    for (let r = 0; r < s.length; r++) for (let c = 0; c < s[r].length; c++) if (s[r][c]) out.push([this.x + c + dx, this.y + r + dy]);
    return out;
  }
}

function makeEmptyBoard(): (string | null)[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function speedForLevel(level: number): number {
  return Math.max(80, 500 - (level - 1) * 40);
}

export function FlatButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center"
      style={{ gap: 6, padding: "3px 8px 3px 6px", borderRadius: 4, border: "none", background: "transparent", cursor: "pointer" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon src={icon} size={14} style={{ background: "var(--accent)" }} />
      <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{label}</span>
    </button>
  );
}

export function TetrisWidget({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef(makeEmptyBoard());
  const pieceRef = useRef<Piece | null>(null);
  const nextRef = useRef<Piece>(new Piece());
  const scoreRef = useRef(0);
  const linesRef = useRef(0);
  const levelRef = useRef(1);
  const highScoreRef = useRef(0);
  const pausedRef = useRef(false);
  const gameOverRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  function valid(piece: Piece, dx = 0, dy = 0, shape?: Shape): boolean {
    for (const [x, y] of piece.cells(dx, dy, shape)) {
      if (x < 0 || x >= COLS || y >= ROWS) return false;
      if (y >= 0 && boardRef.current[y][x]) return false;
    }
    return true;
  }

  function newPiece() {
    pieceRef.current = nextRef.current;
    nextRef.current = new Piece();
    if (!valid(pieceRef.current)) {
      gameOverRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
  }

  function updateHighScore() {
    if (scoreRef.current > highScoreRef.current) {
      highScoreRef.current = scoreRef.current;
      localStorage.setItem(LS_HIGH_SCORE, String(highScoreRef.current));
    }
  }

  function lock() {
    const piece = pieceRef.current!;
    for (const [x, y] of piece.cells()) if (y >= 0 && y < ROWS) boardRef.current[y][x] = piece.color;
    const full: number[] = [];
    for (let r = 0; r < ROWS; r++) if (boardRef.current[r].every(Boolean)) full.push(r);
    for (const r of full) { boardRef.current.splice(r, 1); boardRef.current.unshift(Array(COLS).fill(null)); }
    if (full.length) {
      const pts = [0, 100, 300, 500, 800][Math.min(full.length, 4)] * levelRef.current;
      scoreRef.current += pts;
      linesRef.current += full.length;
      levelRef.current = Math.floor(linesRef.current / 10) + 1;
    }
    updateHighScore();
    newPiece();
    forceRender();
  }

  function scheduleTick() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(tick, speedForLevel(levelRef.current));
  }

  function tick() {
    if (gameOverRef.current || pausedRef.current) return;
    const piece = pieceRef.current!;
    if (valid(piece, 0, 1)) piece.y += 1;
    else lock();
    draw();
    scheduleTick();
  }

  function togglePause() {
    pausedRef.current = !pausedRef.current;
    if (!pausedRef.current && !gameOverRef.current) scheduleTick();
    draw();
    forceRender();
  }

  function restart() {
    boardRef.current = makeEmptyBoard();
    scoreRef.current = 0; linesRef.current = 0; levelRef.current = 1;
    gameOverRef.current = false; pausedRef.current = false;
    nextRef.current = new Piece();
    newPiece();
    scheduleTick();
    draw();
    forceRender();
  }

  function draw() {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const W = container.clientWidth, H = container.clientHeight;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cell = Math.max(4, Math.min(Math.floor(W / COLS), Math.floor(H / ROWS)));
    const bw = COLS * cell, bh = ROWS * cell;
    const ox = Math.floor((W - bw) / 2), oy = Math.floor((H - bh) / 2);

    // Board bg/grid follow the active theme (--panel-bg/--border, matching
    // the left panel this overlay sits in) instead of a hardcoded near-black,
    // so Theme Builder edits (including live dial preview) are reflected
    // here too, not just the HUD strip around it.
    const rootStyle = getComputedStyle(document.documentElement);
    ctx.fillStyle = rootStyle.getPropertyValue("--panel-bg").trim() || "#0d0d0d";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = rootStyle.getPropertyValue("--border").trim() || "#1a1a1a";
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(ox + c * cell, oy); ctx.lineTo(ox + c * cell, oy + bh); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(ox, oy + r * cell); ctx.lineTo(ox + bw, oy + r * cell); ctx.stroke(); }

    function cellRect(cx: number, cy: number, color: string, ghost = false) {
      if (cy < 0) return;
      const x = ox + cx * cell + 1, y = oy + cy * cell + 1, w = cell - 2, h = cell - 2;
      if (ghost) {
        ctx!.globalAlpha = 0.14;
        ctx!.fillStyle = color;
        ctx!.fillRect(x, y, w, h);
        ctx!.globalAlpha = 1;
      } else {
        ctx!.fillStyle = color;
        ctx!.fillRect(x, y, w, h);
        ctx!.fillStyle = "rgba(255,255,255,0.24)";
        ctx!.fillRect(x, y, w, 3);
        ctx!.fillStyle = "rgba(0,0,0,0.31)";
        ctx!.fillRect(x, y + h - 3, w, 3);
      }
    }

    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (boardRef.current[r][c]) cellRect(c, r, boardRef.current[r][c]!);

    const piece = pieceRef.current;
    if (piece && !gameOverRef.current) {
      let dy = 0;
      while (valid(piece, 0, dy + 1)) dy++;
      if (dy > 0) for (const [gx, gy] of piece.cells(0, dy)) cellRect(gx, gy, piece.color, true);
      for (const [cx, cy] of piece.cells()) cellRect(cx, cy, piece.color);
    }

    if (pausedRef.current || gameOverRef.current) {
      ctx.fillStyle = "rgba(0,0,0,0.63)";
      ctx.fillRect(ox, oy, bw, bh);
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.max(14, cell)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pausedRef.current ? "PAUSED" : "GAME OVER", ox + bw / 2, oy + bh / 2);
      if (gameOverRef.current) {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = `${Math.max(9, Math.floor(cell / 2))}px sans-serif`;
        ctx.fillText("Press Restart or Enter", ox + bw / 2, oy + bh / 2 + cell);
      }
    }
  }

  useEffect(() => {
    highScoreRef.current = Number(localStorage.getItem(LS_HIGH_SCORE) ?? 0);
    newPiece();
    scheduleTick();
    draw();
    containerRef.current?.focus();

    const ro = new ResizeObserver(() => draw());
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
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
    const piece = pieceRef.current!;
    if (e.key === "ArrowLeft" && valid(piece, -1, 0)) piece.x -= 1;
    if (e.key === "ArrowRight" && valid(piece, 1, 0)) piece.x += 1;
    if (e.key === "ArrowDown" && valid(piece, 0, 1)) piece.y += 1;
    if (e.key === "ArrowUp") {
      const rotated = rotate(piece.shape);
      if (valid(piece, 0, 0, rotated)) piece.shape = rotated;
    }
    if (e.key === " ") {
      e.preventDefault();
      while (valid(piece, 0, 1)) piece.y += 1;
      lock();
    }
    draw();
  }

  const score = scoreRef.current, lines = linesRef.current, level = levelRef.current, best = highScoreRef.current;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute inset-0 flex flex-col outline-none"
      style={{ background: "var(--panel-bg)", zIndex: 50 }}
    >
      {/* min-h-0 is required here — a <canvas>, like an <img>, is a replaced
          element with an intrinsic size, so a flex column child defaults to
          min-height:auto and won't shrink below that, letting the canvas
          balloon to fill the whole container and push the HUD out of view
          (or under it) instead of sharing space with it. */}
      <canvas ref={canvasRef} className="flex-1 min-h-0" style={{ width: "100%", height: "100%" }} />
      <div className="flex flex-col shrink-0" style={{ padding: "6px 8px", gap: 3, background: "var(--panel-bg)" }}>
        <p className="text-center" style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          Score: {score}   Lines: {lines}   Lv {level}   Best: {best}
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
