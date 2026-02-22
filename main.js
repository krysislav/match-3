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
        // { id: 4, emoji: "🥕", name: "морковка" },
        // { id: 5, emoji: "🍄", name: "грибочек" },
        // { id: 6, emoji: "🥒", name: "огурчик" },
        // { id: 7, emoji: "🦐", name: "кривик" },
    ];
    const TYPE_COUNT = TILES.length;

    /** @typedef {"none"|"lineH"|"lineV"|"bomb"|"color"} Power */
    /** @typedef {{id:number, type:number, power:Power}} Tile */

    // ====== DOM ======
    const boardEl = document.getElementById("board");
    const resetBtn = document.getElementById("resetBtn");
    const statusEl = document.getElementById("status");

    // ====== CSS метрики ======
    const readPxVar = (name) => {
        const v = getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();
        return Number(v.replace("px", "")) || 0;
    };
    const CELL = () => readPxVar("--cell");
    const GAP = () => readPxVar("--gap");

    // padding у .board = 12px в css — зафиксируем здесь так же
    const BOARD_PAD = 12;

    const MOVE_MS = () => readPxVar("--move-ms") || 180;
    const POP_MS = () => readPxVar("--pop-ms") || 160;

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

    // ====== Состояние ======
    /** @type {(null|Tile)[][]} */
    let board = [];
    /** @type {{x:number,y:number}|null} */
    let selected = null;
    let isResolving = false;

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
        if (power === "lineH") return "—";
        if (power === "lineV") return "|";
        if (power === "bomb") return "✦";
        if (power === "color") return "◉";
        return "";
    };

    const ensureTileEl = (tile) => {
        let el = tileEls.get(tile.id);
        if (el) return el;

        el = document.createElement("button");
        el.type = "button";
        el.className = "cell newborn";
        el.dataset.tileId = String(tile.id);

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
        el.textContent = meta.emoji + tileSuffix(tile.power);
        el.setAttribute(
            "aria-label",
            `${meta.name}${tile.power !== "none" ? " (усилитель)" : ""}`,
        );
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
                const el = ensureTileEl(t);
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
                let type = randInt(TYPE_COUNT);
                while (wouldFormMatchAt(x, y, type) && tries < 50) {
                    type = randInt(TYPE_COUNT);
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
                    board[y][x] = makeTile(randInt(TYPE_COUNT), "none");
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

        // ставим класс removing
        for (const t of tiles) {
            const el = tileEls.get(t.id);
            if (el) el.classList.add("removing");
        }

        await sleep(POP_MS());

        // чистим DOM-элементы удалённых (после того как board уже обнулится)
        // (обнуление делаем снаружи)
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
            const power = entry.maxLen >= 5 ? "color" : "bomb";
            placements.push({ x, y, power });
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
                const targetType = colorTargets.get(key);
                if (targetType === undefined || targetType === null) continue;

                for (let yy = 0; yy < H; yy++) {
                    for (let xx = 0; xx < W; xx++) {
                        if (getType(xx, yy) === targetType)
                            addKey(cellKey(xx, yy));
                    }
                }
            }
        }
    };

    // ====== Resolve с анимациями ======
    const resolveBoardAnimated = async (preferredDest = null) => {
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
                placements.push({ x: place.x, y: place.y, power });
            }

            const protectedKeys = new Set(placements.map(p => cellKey(p.x, p.y)));

            preferredOnce = null;

            const matches = new Set();
            for (const g of groups)
                for (const c of g.cells) matches.add(cellKey(c.x, c.y));

            // места рождения бустеров не удаляем
            for (const p of placements) matches.delete(cellKey(p.x, p.y));

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
            expandMatchesByActivatedBoosters(matches, colorTargets, protectedKeys);

            totalRemoved += matches.size;
            steps++;

            // 1) анимируем “поп”
            await animateRemoval(matches);

            // 2) удаляем в модели
            removeMatches(matches);

            // 3) применяем рождения бустеров
            for (const p of placements) {
                const cell = getCell(p.x, p.y);
                if (cell) cell.power = p.power;
            }

            // 4) падение + досыпка + анимация “переезда”
            collapse();
            refill();
            await syncDom(true);
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

        const removed = matches.size;

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
        if (isResolving) return;

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

        if (!isNeighbor(prev, next)) {
            selected = next;
            await syncDom(false);
            return;
        }

        // === SWAP + анимация движения ===
        isResolving = true;
        selected = null;

        swapInBoard(prev.x, prev.y, next.x, next.y);
        await syncDom(true); // плавный swap

        const matches = findMatches();

        // 1) обычный матч
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

        // 2) матча нет — но color можно активировать
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

        // 3) матча нет и color нет — откат swap
        swapInBoard(prev.x, prev.y, next.x, next.y);
        await syncDom(true);
        setStatus("нет совпадений");
        isResolving = false;
    }

    // ====== Кнопки ======
    resetBtn.addEventListener("click", async () => {
        if (isResolving) return;
        isResolving = true;

        const r = reshuffle();
        selected = null;
        await syncDom(true);
        setStatus(`перемешали (${r.attempt})`);

        isResolving = false;
    });

    // ====== Старт ======
    (async () => {
        generateBoard();
        await syncDom(false);
    })();
})();
