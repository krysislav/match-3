(() => {
    "use strict";

    // ====== Настройки ======
    const W = 8;
    const H = 8;

    const TILES = [
        { id: 0, emoji: "🌰", name: "орешек" },
        { id: 1, emoji: "🍏", name: "яблочко" },
        { id: 2, emoji: "🧀", name: "сырик" },
        { id: 3, emoji: "🍓", name: "ягодка" },
        { id: 4, emoji: "🥕", name: "морковка" },
        { id: 5, emoji: "🍄", name: "грибочек" },
        { id: 6, emoji: "🥒", name: "огурчик" },
        { id: 7, emoji: "🦐", name: "кривик" },
    ];

    const difficultyLevels = [
        "очень легко",
        "легко",
        "средне",
        "сложно",
        "очень сложно",
    ];
    const speedLevels = ["медленно", "нормально", "быстро"];

    /** @typedef {"none"|"lineH"|"lineV"|"bomb"|"color"} Power */
    /** @typedef {{id:number, type:number, power:Power}} Tile */

    // ====== DOM ======
    const boardEl = document.getElementById("board");
    const resetBtn = document.getElementById("resetBtn");
    const hintBtn = document.getElementById("hintBtn");
    const statusEl = document.getElementById("status");

    const settingsBtn = document.getElementById("settingsBtn");
    const settingsPanel = document.getElementById("settingsPanel");
    const settingsCloseBtn = document.getElementById("settingsCloseBtn");

    const difficultySlider = document.getElementById("difficultySlider");
    const difficultyValue = document.getElementById("difficultyValue");
    const difficultyTypes = document.getElementById("difficultyTypes");

    const speedSlider = document.getElementById("speedSlider");
    const speedValue = document.getElementById("speedValue");

    const animalValue = document.getElementById("animalValue");
    const segBtns = Array.from(document.querySelectorAll(".seg-btn"));

    const shakeToggle = document.getElementById("shakeToggle");

    // ====== CSS метрики ======
    const readPxVar = (name, fallback = 0) => {
        const raw = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();
        if (!raw) return fallback;
        const num = parseFloat(raw.replace("px", ""));
        return Number.isFinite(num) ? num : fallback;
    };

    const readTimeVar = (name, fallback = 0) => {
        const raw = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();

        if (!raw) return fallback;

        if (raw.endsWith("ms")) {
            return parseFloat(raw);
        }

        if (raw.endsWith("s")) {
            return parseFloat(raw) * 1000;
        }

        // если вдруг просто число без единиц
        const num = parseFloat(raw);
        return Number.isFinite(num) ? num : fallback;
    };

    const CELL = () => readPxVar("--cell", 52);
    const GAP = () => readPxVar("--gap", 10);

    // padding у .board = 12px в css — зафиксируем здесь так же
    const BOARD_PAD = 12;

    // скорость из настроек будет множителем к ожиданиям в JS (CSS отдельно через --speed-mult)
    const speedMultFromSlider = (v) => {
        // 0 медленно, 1 средне, 2 быстро
        if (v === 0) return 1.55;
        if (v === 2) return 0.75;
        return 1.0;
    };

    const posToPx = (x, y) => {
        const step = CELL() + GAP();
        return {
            tx: BOARD_PAD + x * step,
            ty: BOARD_PAD + y * step,
        };
    };

    // ====== Утилиты ======
    const randInt = (max) => Math.floor(Math.random() * max);
    const setStatus = (msg) => (statusEl.textContent = msg || "");

    const inBounds = (x, y) => x >= 0 && x < W && y >= 0 && y < H;

    const shuffleArray = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = randInt(i + 1);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    };

    const cellKey = (x, y) => `${x},${y}`;
    const parseKey = (key) => {
        const [xs, ys] = key.split(",");
        return { x: Number(xs), y: Number(ys) };
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const MOVE_MS = () => readTimeVar("--move-ms", 180) * timeScale;
    const POP_MS = () => readTimeVar("--pop-ms", 160) * timeScale;

    // ====== Settings storage ======
    const SETTINGS_KEY = "zen_match3_settings_v1";

    const DEFAULT_SETTINGS = {
        difficulty: 2, // 0..4
        speed: 1, // 0..2
        animal: "🐭", // 🐭/🐹
        shake: true,
    };

    const clampInt = (v, min, max, fallback) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, Math.round(n)));
    };

    const loadSettings = () => {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return { ...DEFAULT_SETTINGS };
            const s = JSON.parse(raw);
            return {
                difficulty: clampInt(
                    s.difficulty,
                    0,
                    4,
                    DEFAULT_SETTINGS.difficulty,
                ),
                speed: clampInt(s.speed, 0, 2, DEFAULT_SETTINGS.speed),
                animal: s.animal === "🐹" ? "🐹" : "🐭",
                shake: !!s.shake,
            };
        } catch {
            return { ...DEFAULT_SETTINGS };
        }
    };

    const saveSettings = (s) => {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    };

    let settings = loadSettings();

    // ====== Derived settings ======
    let typeCount = 4 + settings.difficulty; // 4..8
    let timeScale = speedMultFromSlider(settings.speed);
    let shakeEnabled = settings.shake;

    const applySettingsToUI = () => {
        difficultySlider.value = String(settings.difficulty);
        difficultyValue.textContent = difficultyLevels[settings.difficulty];
        difficultyTypes.textContent = String(4 + settings.difficulty);

        speedSlider.value = String(settings.speed);
        speedValue.textContent = speedLevels[settings.speed];

        animalValue.textContent = settings.animal;

        for (const b of segBtns) {
            b.classList.toggle("active", b.dataset.animal === settings.animal);
        }

        shakeToggle.checked = !!settings.shake;
    };

    const applySettingsToRuntime = (regenBoardIfNeeded = true) => {
        const newTypeCount = 4 + settings.difficulty;
        const newTimeScale = speedMultFromSlider(settings.speed);
        const newShake = !!settings.shake;

        typeCount = newTypeCount;
        timeScale = newTimeScale;
        shakeEnabled = newShake;

        // CSS: скорость и “кто ест”
        document.documentElement.style.setProperty(
            "--speed-mult",
            String(newTimeScale),
        );
        document.documentElement.style.setProperty(
            "--eater",
            `"${settings.animal}"`,
        );

        if (regenBoardIfNeeded) {
            generateBoard();
            syncDom(false);
            setStatus("настройки применены");
        }
    };

    // ====== Pulse + Shake ======
    const pulseKeys = (keys) => {
        for (const k of keys) {
            const { x, y } = parseKey(k);
            const t = board[y][x];
            if (!t) continue;

            const el = tileEls.get(t.id);
            if (!el) continue;

            el.classList.remove("pulse");
            void el.offsetWidth;
            el.classList.add("pulse");
        }
    };

    const shakeBoard = () => {
        if (!shakeEnabled) return;
        boardEl.classList.remove("shake");
        void boardEl.offsetWidth;
        boardEl.classList.add("shake");
    };

    // ====== Состояние ======
    /** @type {(null|Tile)[][]} */
    let board = [];
    /** @type {{x:number,y:number}|null} */
    let selected = null;
    let isResolving = false;
    let isSettingsOpen = false;

    let nextTileId = 1;

    /** @type {Map<number, HTMLButtonElement>} */
    const tileEls = new Map();

    const getCell = (x, y) => board[y][x];
    const getType = (x, y) => (board[y][x] ? board[y][x].type : -1);
    const getPower = (x, y) => (board[y][x] ? board[y][x].power : "none");

    // ====== Tile / DOM helpers ======
    const makeTile = (type, power = "none") => ({
        id: nextTileId++,
        type,
        power,
    });

    const tileSuffix = (power) => {
        if (power === "lineH") return "↔️";
        if (power === "lineV") return "↕️";
        if (power === "bomb") return "💣";
        if (power === "color") return "🌈";
        return "";
    };

    const ensureTileEl = (tile, initialX, initialY) => {
        let el = tileEls.get(tile.id);
        if (el) return el;

        el = document.createElement("button");
        el.type = "button";
        el.className = "cell newborn";
        el.dataset.tileId = String(tile.id);

        // Устанавливаем позицию ДО добавления в DOM, чтобы браузер
        // не видел перехода от CSS-дефолта (0,0) к реальной позиции.
        // Без этого transition анимирует сдвиг из (0,0) в финальную точку,
        // что особенно заметно для тайла (0,0) — он «доплывает» на 12px.
        if (initialX !== undefined && initialY !== undefined) {
            const { tx, ty } = posToPx(initialX, initialY);
            el.style.setProperty("--tx", `${tx}px`);
            el.style.setProperty("--ty", `${ty}px`);
        }

        el.addEventListener("click", onCellClick);

        boardEl.appendChild(el);
        tileEls.set(tile.id, el);

        // newborn -> нормальная видимость на следующий кадр
        requestAnimationFrame(() => el.classList.remove("newborn"));

        return el;
    };

    const removeTileEl = (tileId) => {
        const el = tileEls.get(tileId);
        if (!el) return;
        el.remove();
        tileEls.delete(tileId);
    };

    const paintTileEl = (tile, el) => {
        const meta = TILES[tile.type];
        el.textContent = meta.emoji; // + tileSuffix(tile.power);
        el.setAttribute(
            "aria-label",
            `${meta.name}${tile.power !== "none" ? " (усилитель)" : ""}`,
        );
        el.dataset.badge = tileSuffix(tile.power);
    };

    const placeTileEl = (tile, el, x, y) => {
        el.dataset.x = String(x);
        el.dataset.y = String(y);

        const { tx, ty } = posToPx(x, y);
        el.style.setProperty("--tx", `${tx}px`);
        el.style.setProperty("--ty", `${ty}px`);

        if (selected && selected.x === x && selected.y === y)
            el.classList.add("selected");
        else el.classList.remove("selected");
    };

    // Синхронизировать DOM с board: контент + позиция.
    // Возвращает промис, который ждёт окончания “переездов”.
    const syncDom = async (waitMove = true) => {
        // 1) помечаем все tileId, которые реально есть на доске
        const alive = new Set();
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const t = board[y][x];
                if (!t) continue;
                alive.add(t.id);
                const el = ensureTileEl(t, x, y);
                paintTileEl(t, el);
                placeTileEl(t, el, x, y);
            }
        }

        // 2) удаляем “лишние” элементы (которые уже не на доске)
        for (const id of Array.from(tileEls.keys())) {
            if (!alive.has(id)) removeTileEl(id);
        }

        if (!waitMove) return;
        await sleep(MOVE_MS());
    };

    // ====== Генерация без стартовых матчей ======
    const wouldFormMatchAt = (x, y, type) => {
        const left1 = x - 1,
            left2 = x - 2;
        if (inBounds(left2, y)) {
            if (
                board[y][left1]?.type === type &&
                board[y][left2]?.type === type
            )
                return true;
        }
        const right1 = x + 1;
        if (inBounds(left1, y) && inBounds(right1, y)) {
            if (
                board[y][left1]?.type === type &&
                board[y][right1]?.type === type
            )
                return true;
        }
        const right2 = x + 2;
        if (inBounds(right2, y)) {
            if (
                board[y][right1]?.type === type &&
                board[y][right2]?.type === type
            )
                return true;
        }

        const up1 = y - 1,
            up2 = y - 2;
        if (inBounds(x, up2)) {
            if (board[up1][x]?.type === type && board[up2][x]?.type === type)
                return true;
        }
        const down1 = y + 1;
        if (inBounds(x, up1) && inBounds(x, down1)) {
            if (board[up1][x]?.type === type && board[down1][x]?.type === type)
                return true;
        }
        const down2 = y + 2;
        if (inBounds(x, down2)) {
            if (
                board[down1][x]?.type === type &&
                board[down2][x]?.type === type
            )
                return true;
        }

        return false;
    };

    const generateBoard = () => {
        // очищаем DOM
        for (const id of Array.from(tileEls.keys())) removeTileEl(id);

        board = Array.from({ length: H }, () =>
            Array.from({ length: W }, () => null),
        );

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                let tries = 0;
                let type = randInt(typeCount);
                while (wouldFormMatchAt(x, y, type) && tries < 50) {
                    type = randInt(typeCount);
                    tries++;
                }
                board[y][x] = makeTile(type, "none");
            }
        }

        selected = null;
        setStatus("готово");
    };

    // ====== Соседство / swap ======
    const isNeighbor = (a, b) => {
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        return dx + dy === 1;
    };

    const swapInBoard = (x1, y1, x2, y2) => {
        const tmp = board[y1][x1];
        board[y1][x1] = board[y2][x2];
        board[y2][x2] = tmp;
    };

    async function trySwapCells(prev, next) {
        if (!prev || !next) return;

        if (!isNeighbor(prev, next)) {
            selected = next;
            await syncDom(false);
            return;
        }

        // === SWAP + анимация движения ===
        isResolving = true;
        selected = null;

        // 1) матча нет — но color можно активировать
        const p1 = getPower(prev.x, prev.y);
        const p2 = getPower(next.x, next.y);

        if (p1 === "color" || p2 === "color") {
            let posColor, posOther;
            if (getPower(prev.x, prev.y) === "color") {
                posColor = prev;
                posOther = next;
            } else {
                posColor = next;
                posOther = prev;
            }

            const a = await activateColorBySwapAnimated(posColor, posOther);

            if (!hasMoves()) {
                const sh = reshuffle();
                await syncDom(true);
                setStatus(
                    `color: -${a.removed}${a.extraRemoved ? ` +${a.extraRemoved}` : ""} (каскады: ${a.cascades}) • перемешали (${sh.attempt})`,
                );
            } else {
                setStatus(
                    `color: -${a.removed}${a.extraRemoved ? ` +${a.extraRemoved}` : ""} (каскады: ${a.cascades})`,
                );
            }

            isResolving = false;
            return;
        }

        swapInBoard(prev.x, prev.y, next.x, next.y);
        await syncDom(true); // плавный swap

        const matches = findMatches();

        // 2) обычный матч
        if (matches.size > 0) {
            const r = await resolveBoardAnimated(next);

            if (!hasMoves()) {
                const sh = reshuffle();
                await syncDom(true);
                setStatus(
                    `съели: ${r.totalRemoved} (каскады: ${r.steps}) • перемешали (${sh.attempt})`,
                );
            } else {
                setStatus(`съели: ${r.totalRemoved} (каскады: ${r.steps})`);
            }

            isResolving = false;
            return;
        }

        // 3) матча нет и color нет — откат swap
        swapInBoard(prev.x, prev.y, next.x, next.y);
        await syncDom(true);
        setStatus("нет совпадений");
        isResolving = false;
    }

    // ====== Поиск матчей ======
    const findMatches = () => {
        const matched = new Set();

        // H
        for (let y = 0; y < H; y++) {
            let runStart = 0;
            for (let x = 1; x <= W; x++) {
                const prev = getType(x - 1, y);
                const cur = x < W ? getType(x, y) : -999;

                if (cur !== prev) {
                    const runLen = x - runStart;
                    if (runLen >= 3 && prev !== -1) {
                        for (let k = runStart; k < x; k++)
                            matched.add(cellKey(k, y));
                    }
                    runStart = x;
                }
            }
        }

        // V
        for (let x = 0; x < W; x++) {
            let runStart = 0;
            for (let y = 1; y <= H; y++) {
                const prev = getType(x, y - 1);
                const cur = y < H ? getType(x, y) : -999;

                if (cur !== prev) {
                    const runLen = y - runStart;
                    if (runLen >= 3 && prev !== -1) {
                        for (let k = runStart; k < y; k++)
                            matched.add(cellKey(x, k));
                    }
                    runStart = y;
                }
            }
        }

        return matched;
    };

    /** @returns {{cells:{x:number,y:number}[], dir:"H"|"V", length:number, type:number}[]} */
    const findMatchGroups = () => {
        const groups = [];

        // H
        for (let y = 0; y < H; y++) {
            let runStart = 0;
            for (let x = 1; x <= W; x++) {
                const prev = getType(x - 1, y);
                const cur = x < W ? getType(x, y) : -999;

                if (cur !== prev) {
                    const runLen = x - runStart;
                    if (runLen >= 3 && prev !== -1) {
                        const cells = [];
                        for (let k = runStart; k < x; k++)
                            cells.push({ x: k, y });
                        groups.push({
                            cells,
                            dir: "H",
                            length: runLen,
                            type: prev,
                        });
                    }
                    runStart = x;
                }
            }
        }

        // V
        for (let x = 0; x < W; x++) {
            let runStart = 0;
            for (let y = 1; y <= H; y++) {
                const prev = getType(x, y - 1);
                const cur = y < H ? getType(x, y) : -999;

                if (cur !== prev) {
                    const runLen = y - runStart;
                    if (runLen >= 3 && prev !== -1) {
                        const cells = [];
                        for (let k = runStart; k < y; k++)
                            cells.push({ x, y: k });
                        groups.push({
                            cells,
                            dir: "V",
                            length: runLen,
                            type: prev,
                        });
                    }
                    runStart = y;
                }
            }
        }

        return groups;
    };

    // ====== Удаление / падение / досыпка ======
    const removeMatches = (matches) => {
        for (const key of matches) {
            const { x, y } = parseKey(key);
            board[y][x] = null;
        }
    };

    const collapse = () => {
        for (let x = 0; x < W; x++) {
            const stack = [];
            for (let y = H - 1; y >= 0; y--) {
                const v = board[y][x];
                if (v !== null) stack.push(v);
            }
            for (let y = H - 1; y >= 0; y--) {
                const idx = H - 1 - y;
                board[y][x] = idx < stack.length ? stack[idx] : null;
            }
        }
    };

    const refill = () => {
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (board[y][x] === null)
                    board[y][x] = makeTile(randInt(typeCount), "none");
            }
        }
    };

    // ====== Анимации удаления ======
    const animateRemoval = async (matches) => {
        const tiles = [];
        for (const key of matches) {
            const { x, y } = parseKey(key);
            const t = board[y][x];
            if (!t) continue;
            tiles.push(t);
        }

        // 1) показываем грызунишку на всех удаляемых клетках
        for (const t of tiles) {
            const el = tileEls.get(t.id);
            if (el) el.classList.add("eaten");
        }

        // пауза, чтобы мозг успел увидеть “кто съел”
        const eatMs = Math.min(700, Math.max(220, Math.round(POP_MS() * 0.45)));
        await sleep(eatMs);

        // 2) запускаем fade/scale
        for (const t of tiles) {
            const el = tileEls.get(t.id);
            if (el) el.classList.add("removing");
        }

        await sleep(POP_MS());

        // 3) убираем DOM-элементы удалённых
        for (const t of tiles) removeTileEl(t.id);
    };

    // ====== Усилители (создание + активация) ======
    const choosePlacementForGroup = (group, preferredCell, reservedKeys) => {
        const prefKey = preferredCell
            ? cellKey(preferredCell.x, preferredCell.y)
            : null;

        if (prefKey) {
            for (const c of group.cells) {
                if (c.x === preferredCell.x && c.y === preferredCell.y) {
                    if (!reservedKeys.has(prefKey)) return { x: c.x, y: c.y };
                }
            }
        }

        const mid = group.cells[Math.floor(group.cells.length / 2)];
        const midKey = cellKey(mid.x, mid.y);
        if (!reservedKeys.has(midKey)) return { x: mid.x, y: mid.y };

        for (const c of group.cells) {
            const k = cellKey(c.x, c.y);
            if (!reservedKeys.has(k)) return { x: c.x, y: c.y };
        }
        return null;
    };

    const findIntersectionPlacements = (
        groups,
        preferredCell,
        reservedKeys,
    ) => {
        // cellKey -> {H:Set(groupIdx), V:Set(groupIdx), maxLen:number}
        const map = new Map();

        for (let gi = 0; gi < groups.length; gi++) {
            const g = groups[gi];
            for (const c of g.cells) {
                const k = cellKey(c.x, c.y);
                let entry = map.get(k);
                if (!entry) {
                    entry = { H: new Set(), V: new Set(), maxLen: 0 };
                    map.set(k, entry);
                }
                if (g.dir === "H") entry.H.add(gi);
                else entry.V.add(gi);
                entry.maxLen = Math.max(entry.maxLen, g.length);
            }
        }

        const placements = [];
        const usedGroups = new Set();

        const isIntersection = (entry) => entry.H.size > 0 && entry.V.size > 0;

        const placeAtKey = (k, entry) => {
            const { x, y } = parseKey(k);
            const baseType = getType(x, y); // какой тип был в клетке до удаления
            const power = entry.maxLen >= 5 ? "color" : "bomb";
            placements.push({ x, y, power, type: baseType });
            reservedKeys.add(k);
            for (const gi of entry.H) usedGroups.add(gi);
            for (const gi of entry.V) usedGroups.add(gi);
        };

        if (preferredCell) {
            const pk = cellKey(preferredCell.x, preferredCell.y);
            const entry = map.get(pk);
            if (entry && isIntersection(entry) && !reservedKeys.has(pk)) {
                placeAtKey(pk, entry);
            }
        }

        const keys = Array.from(map.keys());
        keys.sort((a, b) => {
            const ea = map.get(a);
            const eb = map.get(b);
            const aScore =
                ea && isIntersection(ea) ? (ea.maxLen >= 5 ? 2 : 1) : 0;
            const bScore =
                eb && isIntersection(eb) ? (eb.maxLen >= 5 ? 2 : 1) : 0;
            return bScore - aScore;
        });

        for (const k of keys) {
            const entry = map.get(k);
            if (!entry || !isIntersection(entry)) continue;
            if (reservedKeys.has(k)) continue;

            let hasFree = false;
            for (const gi of entry.H) if (!usedGroups.has(gi)) hasFree = true;
            for (const gi of entry.V) if (!usedGroups.has(gi)) hasFree = true;
            if (!hasFree) continue;

            placeAtKey(k, entry);
        }

        return { placements, usedGroups };
    };

    const expandMatchesByActivatedBoosters = (
        matches,
        colorTargets,
        protectedKeys,
    ) => {
        const queue = [];
        const processed = new Set();
        const activated = new Set();

        const isProtected = (k) => protectedKeys && protectedKeys.has(k);

        for (const key of matches) {
            if (isProtected(key)) continue;
            const { x, y } = parseKey(key);
            if (getPower(x, y) !== "none") queue.push(key);
        }

        const addKey = (k) => {
            if (isProtected(k)) return;
            if (!matches.has(k)) {
                matches.add(k);
                const { x, y } = parseKey(k);
                if (getPower(x, y) !== "none") queue.push(k);
            }
        };

        while (queue.length > 0) {
            const key = queue.pop();
            if (processed.has(key)) continue;
            processed.add(key);

            const { x, y } = parseKey(key);
            const p = getPower(x, y);
            activated.add(key);

            if (p === "lineH") {
                for (let xx = 0; xx < W; xx++) addKey(cellKey(xx, y));
            } else if (p === "lineV") {
                for (let yy = 0; yy < H; yy++) addKey(cellKey(x, yy));
            } else if (p === "bomb") {
                for (let yy = y - 1; yy <= y + 1; yy++) {
                    for (let xx = x - 1; xx <= x + 1; xx++) {
                        if (inBounds(xx, yy)) addKey(cellKey(xx, yy));
                    }
                }
            } else if (p === "color") {
                let targetType = colorTargets.get(key);
                if (targetType === undefined || targetType === null)
                    targetType = randInt(typeCount);
console.log(targetType);

                for (let yy = 0; yy < H; yy++) {
                    for (let xx = 0; xx < W; xx++) {
                        if (getType(xx, yy) === targetType)
                            addKey(cellKey(xx, yy));
                    }
                }
            }
        }

        if (activated.size > 0) pulseKeys(activated);
    };

    // ====== Resolve с анимациями ======
    const resolveBoardAnimated = async (preferredDest = null) => {
        clearHint();

        let totalRemoved = 0;
        let steps = 0;

        let preferredOnce = preferredDest;

        while (true) {
            const groups = findMatchGroups();
            if (groups.length === 0) break;

            const reserved = new Set();
            const inter = findIntersectionPlacements(
                groups,
                preferredOnce,
                reserved,
            );
            const placements = [...inter.placements];
            const blockedGroups = inter.usedGroups;

            for (let gi = 0; gi < groups.length; gi++) {
                if (blockedGroups.has(gi)) continue;

                const g = groups[gi];
                let power = null;

                if (g.length >= 5) power = "color";
                else if (g.length === 4)
                    power = g.dir === "H" ? "lineH" : "lineV";

                if (!power) continue;

                const place = choosePlacementForGroup(
                    g,
                    preferredOnce,
                    reserved,
                );
                if (!place) continue;

                reserved.add(cellKey(place.x, place.y));
                placements.push({
                    x: place.x,
                    y: place.y,
                    power,
                    type: g.type,
                });
            }

            const protectedKeys = new Set(
                placements.map((p) => cellKey(p.x, p.y)),
            );

            preferredOnce = null;

            const matches = new Set();
            for (const g of groups)
                for (const c of g.cells) matches.add(cellKey(c.x, c.y));

            // colorTargets по типу группы, где color матчился
            const colorTargets = new Map();
            for (const g of groups) {
                for (const c of g.cells) {
                    const k = cellKey(c.x, c.y);
                    if (!matches.has(k)) continue;
                    if (getPower(c.x, c.y) === "color")
                        colorTargets.set(k, g.type);
                }
            }

            // расширяем матч бустерами (которые попали в матч)
            expandMatchesByActivatedBoosters(
                matches,
                colorTargets,
                protectedKeys,
            );

            totalRemoved += matches.size;
            steps++;

            // 1) анимируем “поп”
            await animateRemoval(matches);

            // 2) удаляем в модели
            removeMatches(matches);

            // 3) спавним новые бустеры на месте рождения
            for (const p of placements) {
                // ВАЖНО: после removeMatches здесь должно быть null (или может быть не null,
                // если клетку не удалили по какой-то причине) — мы жёстко перезапишем.
                board[p.y][p.x] = makeTile(
                    p.type ?? randInt(TYPE_COUNT),
                    p.power,
                );
            }

            // 4) падение + досыпка + анимация “переезда”
            if (totalRemoved >= 16) shakeBoard();
            collapse();
            refill();
            await syncDom(true);
            await sleep(120);
        }

        return { totalRemoved, steps };
    };

    // ====== Color без match (самый мощный) ======
    const activateColorBySwapAnimated = async (posColor, posOther) => {
        const otherType = getType(posOther.x, posOther.y);
        if (otherType === -1)
            return { removed: 0, cascades: 0, extraRemoved: 0 };

        const matches = new Set();
        const otherPower = getPower(posOther.x, posOther.y);

        if (otherPower === "color") {
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) matches.add(cellKey(x, y));
        } else {
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    if (getType(x, y) === otherType) matches.add(cellKey(x, y));
                }
            }
            matches.add(cellKey(posColor.x, posColor.y)); // сам color исчезает
        }

        // ==== ВАЖНО: добавляем цепную реакцию бустеров ====

        const colorTargets = new Map();

        // если среди удаляемых есть color (второй color), пусть он чистит всё
        for (const key of matches) {
            const { x, y } = parseKey(key);
            if (getPower(x, y) === "color") {
                colorTargets.set(key, otherType);
            }
        }

        // запускаем расширение бустерами
        expandMatchesByActivatedBoosters(matches, colorTargets, new Set());

        const removed = matches.size;

        // ==== дальше всё как было ====

        await animateRemoval(matches);
        removeMatches(matches);
        collapse();
        refill();
        await syncDom(true);

        const r = await resolveBoardAnimated(null);
        return { removed, cascades: r.steps, extraRemoved: r.totalRemoved };
    };

    // ====== hasMoves / reshuffle ======
    const hasMoves = () => {
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (x + 1 < W) {
                    swapInBoard(x, y, x + 1, y);
                    const ok = findMatches().size > 0;
                    swapInBoard(x, y, x + 1, y);
                    if (ok) return true;
                }
                if (y + 1 < H) {
                    swapInBoard(x, y, x, y + 1);
                    const ok = findMatches().size > 0;
                    swapInBoard(x, y, x, y + 1);
                    if (ok) return true;
                }
            }
        }
        return false;
    };

    const findAnyMove = () => {
        for (let y = H - 1; y >= 0; y--) {
            for (let x = W - 1; x >= 0; x--) {
                if (x + 1 < W) {
                    swapInBoard(x, y, x + 1, y);
                    const ok = findMatches().size > 0;
                    swapInBoard(x, y, x + 1, y);
                    if (ok) return { from: { x, y }, to: { x: x + 1, y } };
                }
                if (y + 1 < H) {
                    swapInBoard(x, y, x, y + 1);
                    const ok = findMatches().size > 0;
                    swapInBoard(x, y, x, y + 1);
                    if (ok) return { from: { x, y }, to: { x, y: y + 1 } };
                }
            }
        }
        return null;
    };

    const reshuffle = () => {
        const bag = [];
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) bag.push(board[y][x]);

        for (let attempt = 1; attempt <= 200; attempt++) {
            shuffleArray(bag);

            let idx = 0;
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) board[y][x] = bag[idx++];
            }

            if (findMatches().size === 0 && hasMoves())
                return { ok: true, attempt };
        }

        generateBoard();
        if (!hasMoves()) generateBoard();
        return { ok: true, attempt: "fallback" };
    };

    // ====== Ввод ======
    async function onCellClick(e) {
        if (isResolving || isSettingsOpen) return;

        const el = /** @type {HTMLElement} */ (e.currentTarget);
        const x = Number(el.dataset.x);
        const y = Number(el.dataset.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        if (!selected) {
            selected = { x, y };
            await syncDom(false);
            return;
        }

        if (selected.x === x && selected.y === y) {
            selected = null;
            await syncDom(false);
            return;
        }

        const prev = selected;
        const next = { x, y };

        trySwapCells(prev, next);
    }

    // ====== Settings UI ======
    const openSettings = () => {
        if (isResolving) return;

        isSettingsOpen = true;
        boardEl.hidden = true;
        settingsPanel.hidden = false;
        settingsBtn.style.visibility = "hidden";
        resetBtn.style.visibility = "hidden";
        hintBtn.style.visibility = "hidden";

        setStatus("");
        applySettingsToUI();
    };

    const closeSettings = () => {
        let regenBoard = false;
        let oldDifficulty = settings?.difficulty;

        // сохраняем текущее UI -> settings
        settings = {
            difficulty: clampInt(
                difficultySlider.value,
                0,
                4,
                DEFAULT_SETTINGS.difficulty,
            ),
            speed: clampInt(speedSlider.value, 0, 2, DEFAULT_SETTINGS.speed),
            animal: settings.animal === "🐹" ? "🐹" : "🐭",
            shake: !!shakeToggle.checked,
        };

        if (settings.difficulty !== oldDifficulty) regenBoard = true;

        saveSettings(settings);
        applySettingsToRuntime(regenBoard);

        settingsPanel.hidden = true;
        boardEl.hidden = false;
        isSettingsOpen = false;
        settingsBtn.style.visibility = "visible";
        resetBtn.style.visibility = "visible";
        hintBtn.style.visibility = "visible";
    };

    settingsBtn.addEventListener("click", openSettings);
    settingsCloseBtn.addEventListener("click", closeSettings);

    difficultySlider.addEventListener("input", () => {
        const v = clampInt(difficultySlider.value, 0, 4, 2);
        difficultyValue.textContent = difficultyLevels[v];
        difficultyTypes.textContent = String(4 + v);
    });

    speedSlider.addEventListener("input", () => {
        const v = clampInt(speedSlider.value, 0, 2, 1);
        speedValue.textContent = speedLevels[v];
    });

    segBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const a = btn.dataset.animal === "🐹" ? "🐹" : "🐭";
            settings.animal = a;
            animalValue.textContent = a;
            for (const b of segBtns)
                b.classList.toggle("active", b.dataset.animal === a);
        });
    });

    // ====== Кнопки ======
    resetBtn.addEventListener("click", async () => {
        if (isResolving || isSettingsOpen) return;
        isResolving = true;

        const r = reshuffle();
        selected = null;
        await syncDom(true);
        setStatus(`перемешали (${r.attempt})`);

        isResolving = false;
    });

    hintBtn.addEventListener("click", async () => {
        const move = findAnyMove();
        if (move) showHint(move);
    });

    // ====== Swipe ======
    const SWIPE_THRESHOLD_PX = 14; // можно 12–20
    let swipeActive = false;
    let swipeStart = null; // {x,y, clientX, clientY, pointerId}

    function getCellFromPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        const cell = el && el.closest && el.closest(".cell");
        if (!cell) return null;
        // предполагаю, что у .cell есть data-x/data-y или что-то подобное
        const x = Number(cell.dataset.x);
        const y = Number(cell.dataset.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    function neighborByDirection(start, dx, dy) {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax < SWIPE_THRESHOLD_PX && ay < SWIPE_THRESHOLD_PX) return null;

        let nx = start.x;
        let ny = start.y;

        if (ax >= ay) {
            nx += dx > 0 ? 1 : -1;
        } else {
            ny += dy > 0 ? 1 : -1;
        }

        return { x: nx, y: ny };
    }

    boardEl.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        if (isResolving || isSettingsOpen) return;

        const start = getCellFromPoint(e.clientX, e.clientY);
        if (!start) return;

        swipeActive = true;
        swipeStart = {
            ...start,
            clientX: e.clientX,
            clientY: e.clientY,
            pointerId: e.pointerId,
        };

        boardEl.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    boardEl.addEventListener("pointermove", (e) => {
        if (e.pointerType !== "touch") return;
        if (!swipeActive || !swipeStart) return;
        if (e.pointerId !== swipeStart.pointerId) return;

        const dx = e.clientX - swipeStart.clientX;
        const dy = e.clientY - swipeStart.clientY;

        const target = neighborByDirection(
            { x: swipeStart.x, y: swipeStart.y },
            dx,
            dy,
        );
        if (!target) return;

        // ограничим границы 0..7 (или твой размер)
        if (target.x < 0 || target.x >= 8 || target.y < 0 || target.y >= 8) {
            swipeActive = false;
            return;
        }

        // Один свайп = один swap
        swipeActive = false;

        trySwapCells({ x: swipeStart.x, y: swipeStart.y }, target);

        e.preventDefault();
    });

    function endSwipe(e) {
        if (!swipeActive) return;
        swipeActive = false;
        swipeStart = null;
    }

    boardEl.addEventListener("pointerup", endSwipe);
    boardEl.addEventListener("pointercancel", endSwipe);

    // ====== Размеры поля ======
    function updateBoardScale() {
        const topbarEl = document.querySelector(".topbar");
        const footerEl = document.querySelector(".footer");
        const wrapEl = document.querySelector(".board-wrap");
        if (!topbarEl || !footerEl || !wrapEl) return;

        // 1) доступная ширина внутри wrap (минус паддинги)
        const wrapRect = wrapEl.getBoundingClientRect();
        const wrapStyle = getComputedStyle(wrapEl);
        const wrapPadX =
            parseFloat(wrapStyle.paddingLeft || "0") +
            parseFloat(wrapStyle.paddingRight || "0");
        const wrapPadY =
            parseFloat(wrapStyle.paddingTop || "0") +
            parseFloat(wrapStyle.paddingBottom || "0");

        const availW = Math.max(0, wrapRect.width - wrapPadX);

        // 2) доступная высота между низом header и верхом footer (минус паддинги wrap)
        const topbarRect = topbarEl.getBoundingClientRect();
        const footerRect = footerEl.getBoundingClientRect();

        let availH = footerRect.top - topbarRect.bottom - wrapPadY;

        // Фолбэк, если раскладка “разъехалась” и расчёт дал ерунду
        if (!Number.isFinite(availH) || availH <= 0) {
            availH =
                window.innerHeight - topbarRect.height - footerRect.height - 24;
        }

        // 3) поле квадратное и максимально большое в доступном месте
        const outerLimit = Math.floor(Math.min(availW, availH) - 2); // маленький отступ, чтобы не упираться

        // ВАЖНО: .board в CSS = 8*cell + 7*gap + 2*BOARD_PAD
        const gap = GAP();
        const boardPad = BOARD_PAD; // 12 (у тебя уже так)
        const innerForCells = outerLimit - 7 * gap - 2 * boardPad;

        const cellSize = Math.floor(innerForCells / 8);

        // защита от совсем мелких экранов
        const safeCell = Math.max(24, cellSize);

        document.documentElement.style.setProperty("--cell", `${safeCell}px`);
    }

    window.addEventListener("resize", updateBoardScale);
    window.addEventListener("orientationchange", updateBoardScale);

    updateBoardScale();

    // ====== Подсказка ======
    let hintTimer = null;

    const clearHint = () => {
        document
            .querySelectorAll(".cell.hint")
            .forEach((el) => el.classList.remove("hint"));
        if (hintTimer) {
            clearTimeout(hintTimer);
            hintTimer = null;
        }
    };

    const showHint = (move, ms = Math.floor(1000 * timeScale)) => {
        if (!move) return;
        clearHint();

        const a = document.querySelector(
            `.cell[data-x="${move.from.x}"][data-y="${move.from.y}"]`,
        );
        const b = document.querySelector(
            `.cell[data-x="${move.to.x}"][data-y="${move.to.y}"]`,
        );

        if (a) a.classList.add("hint");
        if (b) b.classList.add("hint");

        hintTimer = setTimeout(clearHint, ms);
    };

    // ====== PWA: Service Worker ======
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("./sw.js").catch(() => {
                // zen: без паники
            });
        });
    }

    // ====== Старт ======
    (async () => {
        applySettingsToRuntime(false);
        generateBoard();
        await syncDom(false);
        setStatus("готово");
    })();
})();
