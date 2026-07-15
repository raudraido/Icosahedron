import { useEffect, useReducer, useRef } from "react";
import { useStore } from "../store";
import { api, Album, Artist } from "../lib/api";
import { FlatButton } from "./TetrisWidget";

// Fifth entry in the logo's 3-click game picker (see LeftPanel.tsx) — Xonix
// (aka Superxonix): claim territory by cutting trails through the unclaimed
// "fog" and reconnecting to already-claimed ground; closing a trail claims
// every enclosed region that has no monster in it, uncovering a picture
// underneath — a genuinely random album cover or artist photo from across
// the whole library each level (not just the currently playing track),
// falling back to the current track's own art if the library fetch hasn't
// come back yet, or a generated pattern if nothing's usable at all. Drawn
// "cover"-fit (cropped, not stretched) so square/portrait art doesn't
// distort across the panel's tall aspect ratio. Clear WIN_PERCENT of the
// board to advance a level; a monster touching you or your in-progress
// trail costs a life.
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
  const coverId = track?.cover_id ?? null;
  const artistId = track?.artist_id ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const imgReadyRef = useRef(false);
  const pictureGenRef = useRef(0);
  const albumPoolRef = useRef<Album[]>([]);
  const artistPoolRef = useRef<Artist[]>([]);

  const gridRef = useRef<Uint8Array>(makeGrid());
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

  // Picks a fresh picture — a new coin flip between album art and artist
  // photo — every time it's called, so each level/stage gets a different
  // image rather than the same one for the whole session. Called once per
  // startLevel() rather than reactively off track changes: the picture for
  // the level in progress shouldn't swap out from under the player just
  // because the underlying track changed mid-play.
  function loadPicture() {
    const gen = ++pictureGenRef.current;
    imgReadyRef.current = false;
    imgRef.current = null;

    function loadFrom(url: string) {
      if (!url || gen !== pictureGenRef.current) return;
      const img = new Image();
      img.onload = () => { if (gen === pictureGenRef.current) imgReadyRef.current = true; };
      img.src = url;
      imgRef.current = img;
    }

    // Picks a random album's cover from across the whole library, not just
    // the currently-playing track — otherwise a long listening session on
    // one track/album would show the same picture (or the same pair of
    // pictures) every level.
    function randomAlbumUrl(): string {
      const pool = albumPoolRef.current;
      const withCover = pool.filter((a) => a.cover_id);
      if (withCover.length) {
        const pick = withCover[Math.floor(Math.random() * withCover.length)];
        return coverUrlFn(pick.cover_id, 600);
      }
      return coverId ? coverUrlFn(coverId, 600) : "";
    }

    if (Math.random() < 0.5) {
      const artistPool = artistPoolRef.current;
      const targetArtistId = artistPool.length
        ? artistPool[Math.floor(Math.random() * artistPool.length)].id
        : artistId;
      if (targetArtistId) {
        api.getArtist(targetArtistId).then((detail) => {
          if (gen !== pictureGenRef.current) return;
          loadFrom(detail.image_url || randomAlbumUrl());
        }).catch(() => { if (gen === pictureGenRef.current) loadFrom(randomAlbumUrl()); });
        return;
      }
    }
    loadFrom(randomAlbumUrl());
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
    for (const c of trailCellsRef.current) grid[idx(c.x, c.y)] = CLAIMED;
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
        for (const c of component) grid[c] = CLAIMED;
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
      grid.fill(CLAIMED);
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
    for (let y = 0; y < GRID_ROWS; y++) {
      let x = 0;
      while (x < GRID_COLS) {
        const cell = grid[idx(x, y)];
        const forcedFog = cell === CLAIMED && isBorderCell(x, y) && !revealBorder;
        if (cell === CLAIMED && !forcedFog) { x++; continue; }
        const key = cell === TRAIL ? "trail" : "fog"; // forced-fog border reads as plain fog, same as unclaimed
        let runEnd = x + 1;
        while (runEnd < GRID_COLS) {
          const c2 = grid[idx(runEnd, y)];
          const forcedFog2 = c2 === CLAIMED && isBorderCell(runEnd, y) && !revealBorder;
          if (c2 === CLAIMED && !forcedFog2) break;
          if ((c2 === TRAIL ? "trail" : "fog") !== key) break;
          runEnd++;
        }
        ctx.fillStyle = key === "trail" ? `color-mix(in srgb, ${accent} 55%, ${panelBg})` : panelBg;
        ctx.fillRect(
          x * CELL - FOG_OVERDRAW, y * CELL - FOG_OVERDRAW,
          (runEnd - x) * CELL + FOG_OVERDRAW * 2, CELL + FOG_OVERDRAW * 2,
        );
        x = runEnd;
      }
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
      // Lighter dim specifically on a win — the whole point of clearing a
      // level is seeing the fully-revealed picture, so don't bury it under
      // the same heavy scrim used for pause/game-over.
      ctx.fillStyle = gameOverRef.current && wonRef.current ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.63)";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = pausedRef.current ? "PAUSED" : wonRef.current ? "LEVEL CLEARED!" : "GAME OVER";
      ctx.fillText(label, GAME_W / 2, GAME_H / 2);
      if (gameOverRef.current) {
        ctx.fillStyle = "#aaaaaa";
        ctx.font = "16px sans-serif";
        ctx.fillText(
          wonRef.current ? "Press Restart or Enter for the next level" : "Press Restart or Enter",
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
    // samples from these pools on every level start. The very first level
    // may start before these land, in which case it just falls back to the
    // current track's own art for that one level.
    api.getAllAlbums("random").then((albums) => { albumPoolRef.current = albums; }).catch(() => {});
    api.getAllArtistsSorted("random").then((artists) => { artistPoolRef.current = artists; }).catch(() => {});
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
      <canvas ref={canvasRef} className="flex-1 min-h-0" style={{ width: "100%", height: "100%" }} />
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
