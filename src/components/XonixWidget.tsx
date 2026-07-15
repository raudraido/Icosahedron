import { useEffect, useReducer, useRef, useState } from "react";
import { useStore } from "../store";
import { api, Track } from "../lib/api";
import { FlatButton } from "./TetrisWidget";
import { Icon } from "./Icon";
import { CoverArt } from "./CoverArt";
import { PLAY_ICON_DARK } from "../lib/theme";
import { CARD_MIN } from "../screens/Albums";

// Fifth entry in the logo's 3-click game picker (see LeftPanel.tsx) — Xonix
// (aka Superxonix): claim territory by cutting trails through the unclaimed
// "fog" and reconnecting to already-claimed ground; closing a trail claims
// every enclosed region that has no monster in it, uncovering a picture
// underneath — a genuinely random track's cover art from across the whole
// library each level (not just the currently playing track), falling back
// to the current track's own art if the library fetch hasn't come back yet,
// or a generated pattern if nothing's usable at all. Once a level is won,
// the revealed picture gets the same hover play button as any other
// cover-art grid card (Albums/ForYou/etc.) — click to play, hold to queue
// instead — so clearing a level doubles as a way to discover and jump
// straight to that track. Drawn "cover"-fit
// (cropped, not stretched) so square/portrait art doesn't distort across the
// panel's tall aspect ratio. Clear WIN_PERCENT of the board to advance a
// level; a monster touching you or your in-progress trail costs a life.
//
// Unlike PongWidget/BreakoutWidget's continuous physics, movement here is
// grid-stepped (closer to TetrisWidget's tick model) since the claim/flood-
// fill logic needs discrete cells — a fixed-timestep accumulator drives
// player and monster steps off the same requestAnimationFrame loop the
// other arcade games use.

const GRID_COLS = 18;
const GRID_ROWS = 32;
const CELL = 24;
const GAME_W = GRID_COLS * CELL;
const GAME_H = GRID_ROWS * CELL;

const WIN_PERCENT = 0.75;
const LIVES_START = 3;
const LS_HIGH_SCORE = "xonix_high_score";
// How long a newly-claimed cell takes to fade from fog to fully revealed —
// see resolveClaims()/draw()'s revealingCellsRef for why claims don't just
// pop instantly.
const REVEAL_MS = 350;

const UNCLAIMED = 0, CLAIMED = 1, TRAIL = 2;

function idx(x: number, y: number) { return y * GRID_COLS + x; }

// The outer ring makeGrid() marks CLAIMED so the player has walkable ground
// to start on and trails have somewhere to reconnect to — but it's not
// something the player actually earned, so draw() keeps it visually fogged
// (same as genuinely unclaimed cells) until real interior territory gets
// claimed around it. Otherwise the picture's edges are visible from frame
// one, before any territory has actually been cleared.
function isBorderCell(x: number, y: number): boolean {
  return x === 0 || x === GRID_COLS - 1 || y === 0 || y === GRID_ROWS - 1;
}

function makeGrid(): Uint8Array {
  const grid = new Uint8Array(GRID_COLS * GRID_ROWS).fill(UNCLAIMED);
  for (let x = 0; x < GRID_COLS; x++) { grid[idx(x, 0)] = CLAIMED; grid[idx(x, GRID_ROWS - 1)] = CLAIMED; }
  for (let y = 0; y < GRID_ROWS; y++) { grid[idx(0, y)] = CLAIMED; grid[idx(GRID_COLS - 1, y)] = CLAIMED; }
  return grid;
}

interface Monster { x: number; y: number; dx: number; dy: number; prevX: number; prevY: number }

// Player/monster step cadence as a function of level — pulled out of step()
// so draw() can compute the same interval to derive its interpolation alpha.
function playerInterval(level: number) { return Math.max(0.05, 0.13 - (level - 1) * 0.008); }
function monsterInterval(level: number) { return Math.max(0.05, 0.15 - (level - 1) * 0.01); }

export function XonixWidget({ onClose }: { onClose: () => void }) {
  const coverUrlFn = useStore((s) => s.coverUrl);
  const queue = useStore((s) => s.queue);
  const currentIndex = useStore((s) => s.currentIndex);
  const track = queue[currentIndex] ?? null;
  const playTrack = useStore((s) => s.playTrack);
  const addTrackToQueue = useStore((s) => s.addTrackToQueue);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgReadyRef = useRef(false);
  const pictureGenRef = useRef(0);
  const trackPoolRef = useRef<Track[]>([]);
  // Whichever track's cover art is currently the hidden picture — set by
  // loadPicture() below, read by the hover play button once the picture's
  // fully revealed (a level win).
  const pictureTrackRef = useRef<Track | null>(null);
  const [cardHovered, setCardHovered] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);
  // Click = play, press+hold 600ms = add to queue instead — same
  // hold-to-alternate-action pattern as AlbumCard's click-vs-hold-to-shuffle.
  const holdTimerRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  const gridRef = useRef<Uint8Array>(makeGrid());
  // Cell index → the performance.now() timestamp it was claimed at — draw()
  // fades a claimed cell from fog to fully revealed over REVEAL_MS instead
  // of popping it instantly, so a big claim reads as smoothly "eaten away"
  // rather than flickering in cell-by-cell in one frame. Entries are removed
  // once fully faded (or the level restarts); a cell not in here at all
  // means "already fully revealed, nothing left to animate."
  const revealingCellsRef = useRef<Map<number, number>>(new Map());
  const playerRef = useRef({ x: Math.floor(GRID_COLS / 2), y: 0 });
  // Render-only "where it was before the in-progress step" — draw() lerps
  // from here to playerRef.current using the step accumulator's progress,
  // so movement reads as continuous even though stepPlayer() itself still
  // hops a whole grid cell at a time (the claim/flood-fill logic needs
  // that discreteness). Always resynced to the current position at the
  // start of every stepPlayer() call, including no-op ones (blocked/no
  // direction), so a stalled player doesn't visually drift toward a stale
  // target.
  const playerPrevRef = useRef({ x: Math.floor(GRID_COLS / 2), y: 0 });
  const dirRef = useRef({ dx: 0, dy: 0 });
  const drawingRef = useRef(false);
  const trailCellsRef = useRef<{ x: number; y: number }[]>([]);
  const monstersRef = useRef<Monster[]>([]);
  const playerAccRef = useRef(0);
  const monsterAccRef = useRef(0);

  const scoreRef = useRef(0);
  const livesRef = useRef(LIVES_START);
  const levelRef = useRef(1);
  const claimedPctRef = useRef(0);
  const highScoreRef = useRef(0);
  const pausedRef = useRef(false);
  const gameOverRef = useRef(false);
  const wonRef = useRef(false);
  const [, forceRender] = useReducer((n) => n + 1, 0);

  // Picks a fresh picture — a random track's cover art from across the whole
  // library, not just whatever's currently playing — every time it's
  // called, so each level/stage shows a different image instead of the same
  // one for the whole session. Called once per startLevel() rather than
  // reactively off track changes: the picture for the level in progress
  // shouldn't swap out from under the player just because the underlying
  // track changed mid-play.
  function loadPicture() {
    const gen = ++pictureGenRef.current;
    imgReadyRef.current = false;
    imgRef.current = null;
    pictureTrackRef.current = null;

    const pool = trackPoolRef.current;
    const withCover = pool.filter((t) => t.cover_id);
    // Falls back to the currently-playing track only until the pool lands
    // (it's fetched once, on mount) — not a permanent fallback, unlike the
    // old artist-photo branch this replaced, which could silently keep
    // reusing the current track for a whole session if its own fetch failed.
    const picked = withCover.length
      ? withCover[Math.floor(Math.random() * withCover.length)]
      : track;
    if (!picked?.cover_id) return; // nothing usable — draw()'s generated-gradient fallback covers this
    pictureTrackRef.current = picked;
    const img = new Image();
    img.onload = () => { if (gen === pictureGenRef.current) imgReadyRef.current = true; };
    img.src = coverUrlFn(picked.cover_id, 600);
    imgRef.current = img;
  }

  function updateHighScore() {
    if (scoreRef.current > highScoreRef.current) {
      highScoreRef.current = scoreRef.current;
      localStorage.setItem(LS_HIGH_SCORE, String(highScoreRef.current));
    }
  }

  function spawnMonsters(level: number) {
    const count = Math.min(5, 2 + level - 1);
    const monsters: Monster[] = [];
    let guard = 0;
    while (monsters.length < count && guard++ < 500) {
      const x = 1 + Math.floor(Math.random() * (GRID_COLS - 2));
      const y = 1 + Math.floor(Math.random() * (GRID_ROWS - 2));
      if (gridRef.current[idx(x, y)] !== UNCLAIMED) continue;
      if (Math.hypot(x - playerRef.current.x, y - playerRef.current.y) < 4) continue;
      monsters.push({ x, y, prevX: x, prevY: y, dx: Math.random() < 0.5 ? 1 : -1, dy: Math.random() < 0.5 ? 1 : -1 });
    }
    monstersRef.current = monsters;
  }

  function recomputeClaimedPct() {
    let claimed = 0;
    for (let i = 0; i < gridRef.current.length; i++) if (gridRef.current[i] === CLAIMED) claimed++;
    claimedPctRef.current = claimed / gridRef.current.length;
  }

  function startLevel() {
    gridRef.current = makeGrid();
    revealingCellsRef.current.clear();
    playerRef.current = { x: Math.floor(GRID_COLS / 2), y: 0 };
    playerPrevRef.current = { x: Math.floor(GRID_COLS / 2), y: 0 };
    dirRef.current = { dx: 0, dy: 0 };
    drawingRef.current = false;
    trailCellsRef.current = [];
    playerAccRef.current = 0;
    monsterAccRef.current = 0;
    spawnMonsters(levelRef.current);
    recomputeClaimedPct();
    loadPicture();
  }

  // Standard Xonix fill: after a trail closes the loop back onto claimed
  // ground, every remaining unclaimed cell is grouped into its connected
  // component; any component with no monster inside becomes claimed. A
  // monster is always inside whichever component is still "the open sea",
  // so this can't ever over-claim — it only ever resolves genuinely
  // enclosed, monster-free pockets (including the trail we just closed).
  function resolveClaims() {
    const grid = gridRef.current;
    const now = performance.now();
    for (const c of trailCellsRef.current) {
      const ci = idx(c.x, c.y);
      grid[ci] = CLAIMED;
      revealingCellsRef.current.set(ci, now);
    }
    trailCellsRef.current = [];
    drawingRef.current = false;

    const visited = new Uint8Array(grid.length);
    const monsterCells = new Set(monstersRef.current.map((m) => idx(m.x, m.y)));
    let newlyClaimed = 0;

    for (let start = 0; start < grid.length; start++) {
      if (grid[start] !== UNCLAIMED || visited[start]) continue;
      const component: number[] = [start];
      visited[start] = 1;
      let hasMonster = monsterCells.has(start);
      let head = 0;
      while (head < component.length) {
        const cur = component[head++];
        const cx = cur % GRID_COLS, cy = Math.floor(cur / GRID_COLS);
        const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) continue;
          const ni = idx(nx, ny);
          if (visited[ni] || grid[ni] !== UNCLAIMED) continue;
          visited[ni] = 1;
          component.push(ni);
          if (monsterCells.has(ni)) hasMonster = true;
        }
      }
      if (!hasMonster) {
        for (const c of component) { grid[c] = CLAIMED; revealingCellsRef.current.set(c, now); }
        newlyClaimed += component.length;
      }
    }

    if (newlyClaimed > 0) scoreRef.current += newlyClaimed * 10 * levelRef.current;
    recomputeClaimedPct();
    if (claimedPctRef.current >= WIN_PERCENT) {
      wonRef.current = true;
      gameOverRef.current = true;
      // Reveal the whole picture (not just the WIN_PERCENT threshold) and
      // clear the monsters off the board for a clean "you did it" moment,
      // then wait for the player to advance — see draw()'s lighter dim for
      // this case so the full picture is actually visible while it waits.
      // Instant, not faded in like a normal claim — also drops any
      // still-fading entries from the claim just above so nothing's left
      // looking transiently foggy while the rest of the picture is already
      // fully clear.
      grid.fill(CLAIMED);
      revealingCellsRef.current.clear();
      monstersRef.current = [];
      claimedPctRef.current = 1;
      updateHighScore();
    }
    forceRender();
  }

  function loseLife() {
    const grid = gridRef.current;
    for (const c of trailCellsRef.current) grid[idx(c.x, c.y)] = UNCLAIMED;
    trailCellsRef.current = [];
    drawingRef.current = false;
    dirRef.current = { dx: 0, dy: 0 };
    playerRef.current = { x: Math.floor(GRID_COLS / 2), y: 0 };
    playerPrevRef.current = { x: Math.floor(GRID_COLS / 2), y: 0 };

    livesRef.current -= 1;
    if (livesRef.current <= 0) {
      gameOverRef.current = true;
      wonRef.current = false;
      updateHighScore();
    }
    forceRender();
  }

  function checkPlayerCollisions(): boolean {
    for (const m of monstersRef.current) {
      if (m.x === playerRef.current.x && m.y === playerRef.current.y) return true;
    }
    return false;
  }

  function stepPlayer() {
    // Always resync first — see playerPrevRef's declaration comment for why
    // a no-op step (blocked/no direction) must collapse prev to current
    // rather than leaving a stale lerp target.
    playerPrevRef.current = { ...playerRef.current };
    const dir = dirRef.current;
    if (dir.dx === 0 && dir.dy === 0) return;
    const nx = playerRef.current.x + dir.dx, ny = playerRef.current.y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) return;

    const grid = gridRef.current;
    const target = grid[idx(nx, ny)];
    if (target === TRAIL) return; // can't cross your own trail

    if (target === UNCLAIMED) {
      grid[idx(nx, ny)] = TRAIL;
      trailCellsRef.current.push({ x: nx, y: ny });
      drawingRef.current = true;
    }
    playerRef.current = { x: nx, y: ny };

    if (target === CLAIMED && drawingRef.current) {
      resolveClaims();
    }
  }

  // Returns whether this monster's bounce this tick was against a TRAIL
  // cell specifically (as opposed to already-CLAIMED ground) — a monster
  // never actually moves onto a trail cell (it deflects off it as a wall,
  // same as claimed ground), so "touching the line" has to be detected at
  // the point of deflection, not by checking where the monster ends up.
  function stepMonster(m: Monster): boolean {
    m.prevX = m.x;
    m.prevY = m.y;
    const grid = gridRef.current;
    const xCell = grid[idx(m.x + m.dx, m.y)];
    const yCell = grid[idx(m.x, m.y + m.dy)];
    const touchedTrail = xCell === TRAIL || yCell === TRAIL || grid[idx(m.x + m.dx, m.y + m.dy)] === TRAIL;
    if (xCell !== UNCLAIMED) m.dx = -m.dx;
    if (yCell !== UNCLAIMED) m.dy = -m.dy;
    if (grid[idx(m.x + m.dx, m.y + m.dy)] === UNCLAIMED) {
      m.x += m.dx;
      m.y += m.dy;
      return touchedTrail;
    }
    // Cornered: both the reflected heading and its diagonal are blocked (a
    // corner bounce landing on a cell that's boxed in on the far side too).
    // Left as-is, the next tick reflects right back to the exact same
    // blocked heading and repeats forever — the monster just sits there
    // flipping direction with zero net movement instead of visibly bouncing.
    // Try the other three diagonals and step into whichever (if any) is
    // open, adopting it as the new heading so normal bounce logic continues
    // naturally from there next tick. Diagonals only, never a cardinal
    // (dx=0 or dy=0) direction — every monster is spawned with both dx and
    // dy nonzero and the reflect logic above assumes that invariant holds
    // forever: with dy=0 say, "the cell in the dy direction" is just the
    // monster's own cell (always UNCLAIMED), so `yCell !== UNCLAIMED` can
    // never trigger again and dy is stuck at 0 permanently — that's exactly
    // what an earlier version of this fallback did by trying cardinal
    // escapes, and it visibly trapped monsters bouncing back and forth
    // along one straight row/column forever instead of diagonally.
    const escapes: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [ddx, ddy] of escapes.sort(() => Math.random() - 0.5)) {
      if (grid[idx(m.x + ddx, m.y + ddy)] === UNCLAIMED) {
        m.dx = ddx;
        m.dy = ddy;
        m.x += ddx;
        m.y += ddy;
        break;
      }
    }
    return touchedTrail;
  }

  function step(dt: number) {
    const pInterval = playerInterval(levelRef.current);
    const mInterval = monsterInterval(levelRef.current);

    playerAccRef.current += dt;
    while (playerAccRef.current >= pInterval) {
      playerAccRef.current -= pInterval;
      stepPlayer();
      if (gameOverRef.current) return;
    }

    let hitTrail = false;
    monsterAccRef.current += dt;
    while (monsterAccRef.current >= mInterval) {
      monsterAccRef.current -= mInterval;
      for (const m of monstersRef.current) if (stepMonster(m)) hitTrail = true;
    }

    if (checkPlayerCollisions() || (drawingRef.current && hitTrail)) loseLife();
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

    // The hidden picture — album/artist art if a track's loaded, else a
    // generated pattern so the game's still playable with nothing playing.
    // "Cover"-fit (crop, don't stretch): most art is square while the board
    // is tall, so naively drawImage-ing it to GAME_W×GAME_H would squash it.
    if (imgReadyRef.current && imgRef.current) {
      const img = imgRef.current;
      const imgAspect = img.width / img.height;
      const gameAspect = GAME_W / GAME_H;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (imgAspect > gameAspect) {
        sw = img.height * gameAspect;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / gameAspect;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, GAME_W, GAME_H);
    } else {
      const grad = ctx.createLinearGradient(0, 0, GAME_W, GAME_H);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, panelBg);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }

    // Fog over anything not yet claimed; the in-progress trail gets a
    // lighter, accent-tinted overlay so the path you've cut is visible.
    // Each cell is overdrawn by half a pixel on every edge and adjacent
    // same-color fog cells are merged into wide horizontal spans before
    // filling — canvas's own antialiasing otherwise leaves faint seams
    // between abutting fillRect calls once ctx.scale()'s scale factor is
    // non-integer (any panel size that isn't an exact multiple of
    // GAME_W×GAME_H), which read as a grid drawn over the covered fog.
    const grid = gridRef.current;
    const FOG_OVERDRAW = 0.5;
    // The win-state code below fills the whole grid CLAIMED specifically to
    // reveal the complete picture, border included — don't fight that.
    const revealBorder = gameOverRef.current && wonRef.current;
    const revealing = revealingCellsRef.current;
    const now = performance.now();

    // Cells mid-fade (see revealingCellsRef's declaration) are folded into
    // this same run-merging scan as their own key, grouped by exact claim
    // timestamp — cells claimed in the same resolveClaims() call share one
    // timestamp, so a whole claimed region still merges into one fillRect
    // per row like plain fog/trail/border do. Giving each cell its own
    // separate translucent fillRect instead (an earlier version of this)
    // double-painted every shared edge between same-alpha neighbors (each
    // cell's antialiasing overdraw margin overlapping the next), which reads
    // as a faint grid scored across the whole fading region — exactly what
    // merging into wide spans elsewhere on this board avoids.
    function keyOf(cx: number, cy: number, cell: number): string {
      if (cell === TRAIL) return "trail";
      if (cell === CLAIMED) {
        if (isBorderCell(cx, cy) && !revealBorder) return "border";
        const claimedAt = revealing.get(idx(cx, cy));
        return claimedAt !== undefined ? `reveal:${claimedAt}` : "";
      }
      return "fog";
    }

    for (let y = 0; y < GRID_ROWS; y++) {
      let x = 0;
      while (x < GRID_COLS) {
        const key = keyOf(x, y, grid[idx(x, y)]);
        if (!key) { x++; continue; } // already-revealed CLAIMED ground — nothing to draw, picture shows through
        let runEnd = x + 1;
        while (runEnd < GRID_COLS && keyOf(runEnd, y, grid[idx(runEnd, y)]) === key) runEnd++;

        if (key.startsWith("reveal:")) {
          const claimedAt = Number(key.slice("reveal:".length));
          const progress = (now - claimedAt) / REVEAL_MS;
          if (progress >= 1) { x = runEnd; continue; } // fully faded — cleaned up in the sweep below
          ctx.globalAlpha = Math.max(0, 1 - progress);
          ctx.fillStyle = `color-mix(in srgb, black 35%, ${panelBg})`;
        } else {
          // Both fog and border are panelBg dimmed toward black rather than
          // a flat panelBg fill — on a light theme (Cream/Sand), plain
          // panelBg is indistinguishable from the chrome around the board,
          // so the walkable areas read as nothing at all rather than
          // fogged-over. The gap between the two has to be large to
          // actually read at a glance — a few percent apart (what this
          // originally shipped with) is invisible even zoomed in.
          ctx.fillStyle = key === "trail" ? `color-mix(in srgb, ${accent} 55%, ${panelBg})`
            : key === "border" ? `color-mix(in srgb, black 8%, ${panelBg})`
            : `color-mix(in srgb, black 35%, ${panelBg})`;
        }
        ctx.fillRect(
          x * CELL - FOG_OVERDRAW, y * CELL - FOG_OVERDRAW,
          (runEnd - x) * CELL + FOG_OVERDRAW * 2, CELL + FOG_OVERDRAW * 2,
        );
        ctx.globalAlpha = 1;
        x = runEnd;
      }
    }
    // Sweep out fully-faded entries once per frame, outside the draw scan —
    // deleting mid-iteration above would be safe too (Map allows it), but
    // keeping the scan pure-read keeps keyOf()'s repeated lookups consistent
    // within a single frame.
    for (const [cellIdx, claimedAt] of revealing) {
      if ((now - claimedAt) / REVEAL_MS >= 1) revealing.delete(cellIdx);
    }

    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, GAME_W, GAME_H);

    // Render positions lerp from each actor's pre-step cell to its current
    // one using how far its step accumulator has progressed toward the
    // next tick — see playerPrevRef's declaration comment. Frozen (alpha 1,
    // i.e. snapped to the current/final cell) while paused or game-over so
    // nothing keeps drifting once the sim itself has stopped advancing.
    const frozen = pausedRef.current || gameOverRef.current;
    const monsterAlpha = frozen ? 1 : Math.min(1, monsterAccRef.current / monsterInterval(levelRef.current));
    for (const m of monstersRef.current) {
      const mx = m.prevX + (m.x - m.prevX) * monsterAlpha;
      const my = m.prevY + (m.y - m.prevY) * monsterAlpha;
      ctx.fillStyle = "#ff5050";
      ctx.beginPath();
      ctx.arc(mx * CELL + CELL / 2, my * CELL + CELL / 2, CELL * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!gameOverRef.current) {
      // Outlined halo (dark border + light fill) rather than a flat color —
      // a solid white square disappeared against light cover art/fallback
      // backgrounds, so it needs to read against either light or dark ground.
      const playerAlpha = frozen ? 1 : Math.min(1, playerAccRef.current / playerInterval(levelRef.current));
      const pxCell = playerPrevRef.current.x + (playerRef.current.x - playerPrevRef.current.x) * playerAlpha;
      const pyCell = playerPrevRef.current.y + (playerRef.current.y - playerPrevRef.current.y) * playerAlpha;
      const px = pxCell * CELL, py = pyCell * CELL;
      ctx.fillStyle = "#000000";
      ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(px + 4, py + 4, CELL - 8, CELL - 8);
    }

    if (pausedRef.current || gameOverRef.current) {
      const won = gameOverRef.current && wonRef.current;
      // Lighter dim specifically on a win — the whole point of clearing a
      // level is seeing the fully-revealed picture, so don't bury it under
      // the same heavy scrim used for pause/game-over.
      ctx.fillStyle = won ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.63)";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      // The win label/"next level" prompt is an HTML overlay instead (see
      // the JSX return below) — canvas text drawn in flat white had no
      // guaranteed contrast against whatever the revealed picture happened
      // to be (unreadable over a bright/white cover), and "press Enter to
      // continue" wasn't actually clickable. PAUSED/GAME OVER keep the
      // heavier dim above, so plain white text still reads fine there.
      if (!won) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 30px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(pausedRef.current ? "PAUSED" : "GAME OVER", GAME_W / 2, GAME_H / 2);
        if (gameOverRef.current) {
          ctx.fillStyle = "#aaaaaa";
          ctx.font = "16px sans-serif";
          ctx.fillText("Press Restart or Enter", GAME_W / 2, GAME_H / 2 + 32);
        }
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
    // A win advances to the next (faster, more monsters) level, keeping
    // score/lives; a loss starts over from level 1 — same split as the
    // other arcade games' win/loss restart behavior.
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
    // Fetched once and cached for the game's whole lifetime — loadPicture()
    // samples from this pool on every level start. startLevel() below always
    // runs before this fetch can possibly land, so the very first level
    // would otherwise be stuck showing the current-track fallback for its
    // entire duration (not just briefly) — re-running loadPicture() once the
    // pool actually arrives corrects that, swapping in a real random pick
    // for whatever level is still in progress at that point (almost always
    // still level 1, since this typically resolves in well under a level's
    // length).
    api.getRandomSongs(300).then((tracks) => {
      trackPoolRef.current = tracks;
      loadPicture();
      forceRender();
    }).catch(() => {});
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
    if (e.key === "ArrowLeft")  { e.preventDefault(); dirRef.current = { dx: -1, dy: 0 }; }
    if (e.key === "ArrowRight") { e.preventDefault(); dirRef.current = { dx: 1, dy: 0 }; }
    if (e.key === "ArrowUp")    { e.preventDefault(); dirRef.current = { dx: 0, dy: -1 }; }
    if (e.key === "ArrowDown")  { e.preventDefault(); dirRef.current = { dx: 0, dy: 1 }; }
  }

  const score = scoreRef.current, lives = livesRef.current, level = levelRef.current, best = highScoreRef.current;
  const claimedPct = Math.round(claimedPctRef.current * 100);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute inset-0 flex flex-col outline-none"
      style={{ background: "var(--left-panel-bg)", zIndex: 50 }}
    >
      {/* min-h-0 — see TetrisWidget.tsx's identical note: without it the
          canvas (a replaced element) balloons and pushes the HUD out of view. */}
      <div className="relative flex-1 min-h-0">
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        {/* The revealed picture's own mini grid-card — same look as any
            other cover-art grid card (Albums/ForYou/Playlists/Starred):
            rounded thumbnail + title/artist caption strip, with the same
            hover-play/hold-to-queue button over the thumbnail. Sized off
            the app's own CARD_MIN (Albums.tsx) so it lands in the same
            ballpark as a regular grid item rather than an arbitrary size,
            clamped to a % of the board so it still fits a narrower panel.
            Only once a level's fully won and the picture is actually the
            real, uncropped art (not mid-reveal, and not the
            generated-gradient fallback when nothing was usable) — clearing
            a level this way doubles as a way to discover and jump straight
            to whatever track it was. */}
        {gameOverRef.current && wonRef.current && pictureTrackRef.current && (
          <div
            className="flex flex-col"
            onMouseEnter={() => setCardHovered(true)}
            onMouseLeave={() => setCardHovered(false)}
            style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: `min(${CARD_MIN}px, 60%)`,
              borderRadius: 8, overflow: "hidden",
              // Two layers: a wide, even ambient halo (0 offset, big blur)
              // so the card reads as clearly floating above the busy cover
              // art behind it from every edge, plus a tighter directional
              // shadow underneath for actual depth — the single shadow this
              // shipped with was too subtle to separate the card from
              // equally-dark/busy areas of the revealed picture.
              boxShadow: "0 0 32px 6px rgba(0,0,0,0.55), 0 10px 28px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ position: "relative" }}>
              {/* Same hover treatment as AlbumCard's cover — scaled slightly
                  and dimmed a touch, clipped by the card's own
                  overflow:hidden above so the zoom never spills past the
                  rounded corners. */}
              <CoverArt
                coverId={pictureTrackRef.current.cover_id}
                size={CARD_MIN}
                className="w-full aspect-square"
                style={{
                  transform: `scale(${cardHovered ? 1.03 : 1})`,
                  filter: `brightness(${cardHovered ? 0.9 : 1})`,
                  transition: "transform 150ms, filter 150ms",
                }}
              />
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  heldRef.current = false;
                  holdTimerRef.current = window.setTimeout(() => {
                    heldRef.current = true;
                    holdTimerRef.current = null;
                    addTrackToQueue(pictureTrackRef.current!);
                  }, 600);
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  const held = holdTimerRef.current === null && heldRef.current;
                  if (holdTimerRef.current !== null) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                  if (!held) playTrack(pictureTrackRef.current!);
                }}
                onMouseEnter={() => setPlayHovered(true)}
                onMouseLeave={() => {
                  setPlayHovered(false);
                  if (holdTimerRef.current !== null) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
                }}
                title={`Play "${pictureTrackRef.current.title}" (hold to add to queue)`}
                style={{
                  position: "absolute", top: "50%", left: "50%",
                  transform: `translate(-50%, -50%) scale(${playHovered ? 1 : 0.8})`,
                  width: "min(60px, 33%)", aspectRatio: "1", borderRadius: "50%",
                  background: "var(--accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: playHovered ? 1 : cardHovered ? 0.8 : 0,
                  transition: "transform 150ms, opacity 150ms",
                  cursor: "pointer",
                }}
              >
                <Icon src="img/play.png" size={20} style={{ background: PLAY_ICON_DARK, marginLeft: 2 }} />
              </div>
            </div>
            <div className="flex flex-col grid-card-meta">
              <p className="truncate" style={{ color: "var(--text-primary)", fontSize: "var(--fs-primary)", fontWeight: "var(--fw-emphasis)" }}>
                {pictureTrackRef.current.title}
              </p>
              <p className="truncate" style={{ color: "var(--text-secondary)", fontSize: "var(--fs-secondary)" }}>
                {pictureTrackRef.current.artist}
              </p>
            </div>
          </div>
        )}
        {/* Advance button as a real HTML overlay, not canvas text — "press
            Enter to continue" wasn't actually clickable, and the button on
            its own already says everything a separate "Level Cleared!"
            label would have (the revealed picture + mini card is the actual
            celebration moment). Shown regardless of whether the mini card
            above is (a level can be won even when no usable picture was
            found for it). */}
        {gameOverRef.current && wonRef.current && (
          <button
            onClick={restart}
            style={{
              position: "absolute", bottom: "6%", left: "50%", transform: "translateX(-50%)",
              padding: "8px 20px", borderRadius: 999, border: "none",
              background: "var(--accent)", color: PLAY_ICON_DARK,
              fontWeight: 700, fontSize: 14, cursor: "pointer",
              boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
            }}
          >
            Next Level →
          </button>
        )}
      </div>
      <div className="flex flex-col shrink-0" style={{ padding: "6px 8px", gap: 3, background: "var(--left-panel-bg)" }}>
        <p className="text-center" style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          Score: {score}   Lives: {lives}   Level: {level}   Claimed: {claimedPct}%   Best: {best}
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
