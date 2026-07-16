import { useEffect, useReducer, useRef } from "react";
import { FlatButton } from "./TetrisWidget";

// Sixth entry in the logo's 3-click game picker (see LeftPanel.tsx) — Snake,
// at the Nokia 3310's own grid resolution: a 20×11 board (the same grid
// math worked out against the real 84×48 monochrome LCD screen — 20 cols ×
// 11 rows of isolated cells fits that screen almost exactly). Each snake
// segment and the food are drawn as their own isolated cell — no outline
// around it, no fill connecting it to its neighbor — textured as a 3×3
// dot-matrix of 9 small sub-pixels rather than one flat block. Real 1-bit
// matrix screens have no continuous lines or connected regions, only
// discrete physical dots, so that's true of the board's outer frame too
// (see SUBCELL_R's own comment below).
//
// Grid-stepped like TetrisWidget (a fixed-interval setTimeout tick, not
// continuous per-frame physics like Pong/Breakout) since movement here is
// inherently discrete — a segment either occupies a cell or it doesn't.

const GRID_COLS = 20;
const GRID_ROWS = 11;

// Proportions only — SUBCELL : SUBGAP : GAP : SPACING = 5 : 1 : 4 : 1,
// preserved exactly no matter what final pixel size the board renders at.
// Actual pixel sizes are computed fresh every draw() call from the
// container's real, current dimensions (see unitsFor/fitUnits below)
// rather than fixed once and then resized via CSS. CSS-resizing an
// already-rasterized bitmap at a non-integer factor is fundamentally
// unreliable for 1px features — `image-rendering: pixelated` guarantees
// nearest-neighbor sampling, but at a fractional scale it can't guarantee
// every distinct source pixel lands on its own destination pixel; some
// 1px gaps survive the rounding and some get sampled over, which is
// exactly why some cells rendered as clean 3×3 grids and others as merged
// solid bars. Computing the sizes fresh and drawing 1:1 into a
// canvas.width/height that already matches the container removes the
// resize step (and that failure mode) entirely.
const SUBCELL_R = 5, SUBGAP_R = 1, GAP_R = 4, SPACING_R = 1;
// How many dot-rows deep the border ring is — a count, not a size ratio,
// so it doesn't scale with k the way the pixel dimensions do. 2 rows
// (with a 1-dot gap between them, same convention as everywhere else)
// reads as a distinctly wider frame than the single-dot-thick border this
// replaced, while the play area stays exactly 1 dot away from wherever
// that thicker band ends.
const BORDER_DOTS = 2;

interface BoardUnits {
  subcell: number; subgap: number; gap: number; spacing: number;
  cell: number; borderThickness: number; gameW: number; gameH: number;
  playOx: number; playOy: number;
}

function unitsFor(k: number): BoardUnits {
  // Never let a dot or gap round down to 0 — that would silently merge
  // what's supposed to be a visible gap, or vanish a dot outright.
  const subcell = Math.max(1, Math.round(SUBCELL_R * k));
  const subgap = Math.max(1, Math.round(SUBGAP_R * k));
  const gap = Math.max(1, Math.round(GAP_R * k));
  const spacing = Math.max(1, Math.round(SPACING_R * k));
  const cell = 3 * subcell + 2 * subgap;
  const playW = GRID_COLS * cell + (GRID_COLS - 1) * gap;
  const playH = GRID_ROWS * cell + (GRID_ROWS - 1) * gap;
  const borderThickness = BORDER_DOTS * subcell + (BORDER_DOTS - 1) * subgap;
  return {
    subcell, subgap, gap, spacing, cell, borderThickness,
    gameW: playW + 2 * spacing + 2 * borderThickness,
    gameH: playH + 2 * spacing + 2 * borderThickness,
    playOx: borderThickness + spacing,
    playOy: borderThickness + spacing,
  };
}

// Largest k (a continuous multiplier on the 5:1:4:1 ratio) whose resulting
// whole-integer pixel sizes still fit within maxW×maxH. Binary search
// since each dimension rounds independently — size isn't a perfectly
// smooth function of k, just a broadly increasing one — 40 iterations is
// far more precision than a pixel-granularity result needs.
function fitUnits(maxW: number, maxH: number): BoardUnits {
  let lo = 0, hi = 40;
  let best = unitsFor(0);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const u = unitsFor(mid);
    if (u.gameW <= maxW && u.gameH <= maxH) { best = u; lo = mid; } else { hi = mid; }
  }
  return best;
}

// Fixed to the authentic Nokia LCD palette rather than the app's live
// theme (unlike every other arcade widget, which reads --left-panel-bg/
// --border/--accent so Theme Builder edits show up live) — the entire
// point of this board is reproducing that one specific physical screen,
// so it stays put regardless of which theme is active. Same hex values as
// the standalone Nokia LCD mockup this game's grid math was worked out
// against.
const LCD_BG = "#9caa82";
const LCD_INK = "#2c3122";

const LS_HIGH_SCORE = "snake_high_score";
// Level (and so speed) steps up every this many food eaten — same shape as
// TetrisWidget's "every 10 lines" progression, just for food instead.
const FOODS_PER_LEVEL = 5;

interface Point { x: number; y: number }

function speedForLevel(level: number): number {
  return Math.max(70, 200 - (level - 1) * 12);
}

// Three segments, head first, trailing left from a quarter-width start —
// heading right, matching dirRef's own initial (1, 0).
function initialSnake(): Point[] {
  const y = Math.floor(GRID_ROWS / 2);
  const headX = Math.floor(GRID_COLS / 4);
  return [{ x: headX, y }, { x: headX - 1, y }, { x: headX - 2, y }];
}

function randomEmptyCell(snake: Point[]): Point {
  for (;;) {
    const x = Math.floor(Math.random() * GRID_COLS);
    const y = Math.floor(Math.random() * GRID_ROWS);
    if (!snake.some((s) => s.x === x && s.y === y)) return { x, y };
  }
}

// Evenly-spaced start positions for `count` subcell-sized dots tracing a
// `total`-px edge (first dot at 0, last dot ending exactly at `total`,
// spacing distributed rather than left as a leftover gap at one end) —
// same reasoning as the standalone Nokia LCD mockup's floor(i*total/count)
// cell-boundary formula, just for points instead of variable-width spans.
function borderDots(total: number, subcell: number, subgap: number): number[] {
  const pitch = subcell + subgap;
  const count = Math.max(2, Math.round(total / pitch));
  const positions: number[] = [];
  for (let i = 0; i < count; i++) positions.push(Math.round((i * (total - subcell)) / (count - 1)));
  return positions;
}

export function SnakeWidget({ onClose }: { onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The canvas's own immediate parent — draw() measures *this*, not the
  // outer container (which also includes the HUD strip below), so the
  // board is sized to the space actually available above the HUD rather
  // than the whole widget's height.
  const viewportRef = useRef<HTMLDivElement>(null);

  const snakeRef = useRef<Point[]>(initialSnake());
  // Last-applied heading — reversal checks always compare a new keypress
  // against this, never against nextDirRef below. Comparing against the
  // pending direction instead would let two rapid keypresses (e.g. Up then
  // Left while still heading Right) sneak a 180° reversal past the check
  // one tick before it'd actually apply.
  const dirRef = useRef({ dx: 1, dy: 0 });
  // Queued heading — applied at the start of the next tick() only, so a
  // direction change always lines up with an actual grid step rather than
  // potentially firing twice before the snake visibly moves once.
  const nextDirRef = useRef({ dx: 1, dy: 0 });
  const foodRef = useRef<Point>(randomEmptyCell(initialSnake()));

  const scoreRef = useRef(0);
  const foodEatenRef = useRef(0);
  const levelRef = useRef(1);
  const highScoreRef = useRef(0);
  const pausedRef = useRef(false);
  const gameOverRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  function updateHighScore() {
    if (scoreRef.current > highScoreRef.current) {
      highScoreRef.current = scoreRef.current;
      localStorage.setItem(LS_HIGH_SCORE, String(highScoreRef.current));
    }
  }

  function scheduleTick() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(tick, speedForLevel(levelRef.current));
  }

  function endGame() {
    gameOverRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    updateHighScore();
    draw();
    forceRender();
  }

  function tick() {
    if (gameOverRef.current || pausedRef.current) return;
    dirRef.current = nextDirRef.current;
    const dir = dirRef.current;
    const snake = snakeRef.current;
    const head = snake[0];
    const nx = head.x + dir.dx, ny = head.y + dir.dy;

    if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) { endGame(); return; }

    const willGrow = nx === foodRef.current.x && ny === foodRef.current.y;
    // The current tail cell is vacated this same tick (unless growing), so
    // it isn't actually an obstacle to moving into.
    const body = willGrow ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === nx && s.y === ny)) { endGame(); return; }

    snake.unshift({ x: nx, y: ny });
    if (willGrow) {
      scoreRef.current += 10 * levelRef.current;
      foodEatenRef.current += 1;
      levelRef.current = Math.floor(foodEatenRef.current / FOODS_PER_LEVEL) + 1;
      foodRef.current = randomEmptyCell(snake);
      forceRender(); // score/level/length HUD changed
    } else {
      snake.pop();
    }

    draw();
    scheduleTick();
  }

  function togglePause() {
    if (gameOverRef.current) return;
    pausedRef.current = !pausedRef.current;
    if (!pausedRef.current) scheduleTick();
    draw();
    forceRender();
  }

  function restart() {
    snakeRef.current = initialSnake();
    dirRef.current = { dx: 1, dy: 0 };
    nextDirRef.current = { dx: 1, dy: 0 };
    foodRef.current = randomEmptyCell(snakeRef.current);
    scoreRef.current = 0;
    foodEatenRef.current = 0;
    levelRef.current = 1;
    gameOverRef.current = false;
    pausedRef.current = false;
    scheduleTick();
    draw();
    forceRender();
  }

  // canvas.width/height (the drawing buffer) are set here to exactly match
  // viewportRef's real, current CSS box size — not a fixed logical
  // resolution, and never resized afterward via CSS. That equality is what
  // actually fixes the merged-dot bug: as long as the buffer and the CSS
  // box are the same size, the browser has no scaling to do at all (1
  // buffer pixel = 1 CSS pixel), so there's no resize step left for
  // fractional-scale rounding to corrupt.
  function draw() {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !viewport || !ctx) return;

    const W = viewport.clientWidth, H = viewport.clientHeight;
    canvas.width = W;
    canvas.height = H;
    // Outside the centered board (if the viewport's aspect ratio doesn't
    // exactly match the board's), stay transparent so the panel's own
    // --left-panel-bg shows through rather than an LCD-green wash over
    // the whole panel.
    ctx.clearRect(0, 0, W, H);

    const u = fitUnits(W, H);
    const ox = Math.floor((W - u.gameW) / 2), oy = Math.floor((H - u.gameH) / 2);
    ctx.save();
    ctx.translate(ox, oy);

    ctx.fillStyle = LCD_BG;
    ctx.fillRect(0, 0, u.gameW, u.gameH);

    // Board frame — the reserved band is BORDER_DOTS dot-rows deep (same
    // borderThickness the play area's offset is measured from, see
    // playOx/playOy), but only the outermost row of that band is actually
    // painted; any inner rows stay unpainted background. That keeps the
    // wider gap to the play area while the visible line itself stays a
    // single dot thick, traced right at the board's true edge — not a
    // smooth vector stroke, a real 1-bit LCD has no continuous lines, only
    // individual physical pixels.
    ctx.fillStyle = LCD_INK;
    const bottomY = u.gameH - u.subcell, rightX = u.gameW - u.subcell;
    for (const x of borderDots(u.gameW, u.subcell, u.subgap)) {
      ctx.fillRect(x, 0, u.subcell, u.subcell);          // top
      ctx.fillRect(x, bottomY, u.subcell, u.subcell);    // bottom
    }
    for (const y of borderDots(u.gameH, u.subcell, u.subgap)) {
      ctx.fillRect(0, y, u.subcell, u.subcell);          // left
      ctx.fillRect(rightX, y, u.subcell, u.subcell);     // right
    }

    // Draws one game cell as a 3×3 dot-matrix — 9 individual sub-pixel
    // blocks, no outline around the cell itself and no fill connecting one
    // block to the next. A real 1-bit matrix screen has no concept of "a
    // border around a pixel" or "two adjacent pixels joined" — just
    // discrete dots, each fully surrounded by background on every side
    // (subgap within a cell, gap between cells). cx/cy are grid
    // coordinates; playOx/playOy offset them past the board's own border
    // ring and its 1-dot gap.
    function cellRect(cx: number, cy: number, color: string) {
      const baseX = u.playOx + cx * (u.cell + u.gap), baseY = u.playOy + cy * (u.cell + u.gap);
      ctx!.fillStyle = color;
      for (let sr = 0; sr < 3; sr++) {
        for (let sc = 0; sc < 3; sc++) {
          ctx!.fillRect(baseX + sc * (u.subcell + u.subgap), baseY + sr * (u.subcell + u.subgap), u.subcell, u.subcell);
        }
      }
    }

    // Prey (food) — a hollow diamond, not the full 3×3: the 4 corner
    // sub-dots and the center dot are left undrawn, only the 4 edge-middle
    // ones (N/S/E/W) are filled. Same fixed LCD_INK as the snake's own
    // body, not a distinct accent color — the shape alone is what marks it
    // as "the special one," not a color the 1-bit palette doesn't have.
    function preyRect(cx: number, cy: number) {
      const baseX = u.playOx + cx * (u.cell + u.gap), baseY = u.playOy + cy * (u.cell + u.gap);
      ctx!.fillStyle = LCD_INK;
      const edgeMiddles: [number, number][] = [[1, 0], [0, 1], [2, 1], [1, 2]];
      for (const [sc, sr] of edgeMiddles) {
        ctx!.fillRect(baseX + sc * (u.subcell + u.subgap), baseY + sr * (u.subcell + u.subgap), u.subcell, u.subcell);
      }
    }

    // Food — its own isolated dot-matrix cell, same as a snake segment,
    // just drawn as the hollow-diamond shape above so it still reads as
    // "the special one" against the snake's own solid-block ink.
    const food = foodRef.current;
    preyRect(food.x, food.y);

    const snake = snakeRef.current;
    for (let i = 0; i < snake.length; i++) cellRect(snake[i].x, snake[i].y, LCD_INK);

    if (pausedRef.current || gameOverRef.current) {
      ctx.fillStyle = "rgba(0,0,0,0.63)";
      ctx.fillRect(0, 0, u.gameW, u.gameH);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pausedRef.current ? "PAUSED" : "GAME OVER", u.gameW / 2, u.gameH / 2);
      if (gameOverRef.current) {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "13px sans-serif";
        ctx.fillText("Press Restart or Enter", u.gameW / 2, u.gameH / 2 + 24);
      }
    }
    ctx.restore();
  }

  useEffect(() => {
    highScoreRef.current = Number(localStorage.getItem(LS_HIGH_SCORE) ?? 0);
    scheduleTick();
    draw();
    containerRef.current?.focus();

    const ro = new ResizeObserver(draw);
    if (viewportRef.current) ro.observe(viewportRef.current);

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

    const cur = dirRef.current;
    function setDir(dx: number, dy: number) {
      if (dx === -cur.dx && dy === -cur.dy) return; // no direct reversal into your own neck
      nextDirRef.current = { dx, dy };
    }
    if (e.key === "ArrowLeft")  { e.preventDefault(); setDir(-1, 0); }
    if (e.key === "ArrowRight") { e.preventDefault(); setDir(1, 0); }
    if (e.key === "ArrowUp")    { e.preventDefault(); setDir(0, -1); }
    if (e.key === "ArrowDown")  { e.preventDefault(); setDir(0, 1); }
  }

  const score = scoreRef.current, level = levelRef.current, best = highScoreRef.current;
  const length = snakeRef.current.length;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute inset-0 flex flex-col outline-none"
      style={{ background: "var(--left-panel-bg)", zIndex: 50 }}
    >
      {/* min-h-0 — see TetrisWidget.tsx's identical note: without it a
          replaced element (canvas, like an <img>) balloons and pushes the
          HUD out of view. No width/height attributes here — draw() sets
          canvas.width/height itself, from viewportRef's own measured size,
          every time it runs. style width/height: 100% then makes the
          canvas's CSS box exactly that same size, so there's never a gap
          between the drawing buffer's resolution and its displayed size
          for the browser to scale across (see draw()'s own comment). */}
      <div ref={viewportRef} className="flex-1 min-h-0 flex items-center justify-center">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height: "100%", imageRendering: "pixelated" }}
        />
      </div>
      <div className="flex flex-col shrink-0" style={{ padding: "6px 8px", gap: 3, background: "var(--left-panel-bg)" }}>
        <p className="text-center" style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          Score: {score}   Length: {length}   Level: {level}   Best: {best}
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
