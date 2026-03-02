// GeoBoor - Settlement Guessing Game

// ── Game Configuration ──────────────────────────────────────────────
const COST_REVEAL = 100; // Cost to reveal history
const COST_CLUE = 300;    // Cost to reveal next settlement name
const POINTS_BASE = 5;      // Base points per correct letter
const BONUS_FAST_TIME = 5;  // Seconds threshold for max bonus
const BONUS_FAST_PTS = 15;  // Max bonus points
const BONUS_MED_TIME = 10;  // Seconds threshold for med bonus
const BONUS_MED_PTS = 10;   // Med bonus points

// ── Globals ───────────────────────────────────────────────────────
const HEBREW_LETTERS = new Set('אבגדהוזחטיכלמנסעפצקרשת');
const SOFIT_MAP = { 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' };

function removeSofit(ch) {
    return SOFIT_MAP[ch] ?? ch;
}

function isHebrewLetter(ch) {
    return HEBREW_LETTERS.has(ch);
}

// Two consecutive yod (י\u05D9) → single yod, two vav (ו\u05D5) → single vav
const RE_DOUBLE_YOD = /\u05D9\u05D9/g;   // יי
const RE_DOUBLE_VAV = /\u05D5\u05D5/g;   // וו

/**
 * Generate the set of name-string variants by applying יי→י / וו→ו
 * BEFORE stripping spaces, so word boundaries block cross-word substitutions.
 * e.g. "תלמי יחיאל" keeps both יי (they're in separate words); "איייל" collapses to "איל".
 */
function nameVariants(name) {
    const v1 = name.replace(RE_DOUBLE_YOD, '\u05D9');
    const v2 = name.replace(RE_DOUBLE_VAV, '\u05D5');
    const v3 = v1.replace(RE_DOUBLE_VAV, '\u05D5');
    return new Set([name, v1, v2, v3]);
}

/** Strip non-Hebrew chars, reverse, and normalize sofit letters in one step. */
function stripAndReverse(name) {
    return Array.from(name.replace(/[^\u05D0-\u05EA]/g, ''))
        .reverse()
        .map(c => SOFIT_MAP[c] ?? c)
        .join('');
}

function getVariants(entry) {
    const rawNames = [entry.name, ...(entry.aliases || [])];
    const variants = new Set();
    for (const n of rawNames) {
        if (!n) continue;
        for (const v of nameVariants(n)) variants.add(stripAndReverse(v));
    }
    return [...variants];
}

// ── Game logic (ported from choose_all / find_all_former) ──────────

/**
 * Returns all possibilities for what can follow the current accumulated string.
 * Returns array of { letter, key, former } where:
 *   - letter: next letter the computer would add (to the left)
 *   - key: variant key of the chosen settlement
 *   - former: variant keys of settlements already consumed in this path
 *
 * `forbidCanon`: canonical keys of permanently forbidden settlements (set on mistake only).
 */
function chooseAll(current, keySet, forbidCanon, former) {
    former = former || [];
    if (!current) {
        return [...keySet]
            .filter(k => !forbidCanon.has(keyVariantMap[k]))
            .map(k => ({ letter: k[k.length - 1], key: k, former: [] }));
    }

    const results = [];

    // Find variant keys that END WITH current (settlement whose name starts with current read RTL)
    for (const k of keySet) {
        if (k.endsWith(current) && k !== current &&
            !former.includes(k) && !forbidCanon.has(keyVariantMap[k])) {
            results.push({ letter: k[k.length - 1 - current.length], key: k, former });
        }
    }

    // Check if current ENDS WITH a full settlement key (it was consumed)
    for (const k of keySet) {
        if (current.endsWith(k) && !former.includes(k) && !forbidCanon.has(keyVariantMap[k])) {
            const newFormer = [...former, k];
            const newCurrent = current.slice(0, current.length - k.length);
            results.push(...chooseAll(newCurrent, keySet, forbidCanon, newFormer));
        }
    }

    return results;
}

/**
 * Returns the set of variant keys that appear in ALL options (guaranteed consumed).
 */
function findAllFormer(options) {
    if (!options.length) return new Set();
    let common = new Set(options[0].former);
    for (const opt of options) {
        const s = new Set(opt.former);
        common = new Set([...common].filter(x => s.has(x)));
    }
    return common;
}

// ── State ─────────────────────────────────────────────────────────

let settlementsData = {};       // canonKey → { name, aliases, x, y, ... }
let keyVariantMap = {};         // variantKey → canonical key
let variantDisplayName = {};    // variantKey → display name (name/alias that generated it)
let allVariantKeys = new Set(); // all valid variant reversed-name strings
let easterEggData = {};         // Reversed validation string → {msg, points}
let state = {
    current: '',
    wrongLetter: null,
    // canonKeys of settlements guaranteed consumed (set on mistake, cleared on softReset)
    forbid: [],
    forbidSet: new Set(), // same as forbid but as Set for O(1) lookup
    score: 0,
    lastKeyTime: null,
    chosenCircleKey: null,
    easterEggsFound: new Set()
};

// ── DOM refs ──────────────────────────────────────────────────────

const mapImg = document.getElementById('map-img');
const svgOverlay = document.getElementById('svg-overlay');
const circleEl = document.getElementById('settlement-circle');
const currentStr = document.getElementById('current-string');
const scoreEl = document.getElementById('score');
const infoPanel = document.getElementById('info-panel');
const infoName = document.getElementById('info-name');
const infoDetails = document.getElementById('info-details');
const bonusFlash = document.getElementById('bonus-flash');

// Game Over Modal Refs
const gameOverModal = document.getElementById('game-over-modal');
const gameOverScore = document.getElementById('game-over-score');
const gameOverCompliment = document.getElementById('game-over-compliment');
const gameOverList = document.getElementById('game-over-list');

// ── Map drawing ───────────────────────────────────────────────────
// Coordinates in game_data.json are calibrated to the 234×614 PNG.
// The SVG viewBox is set to that coordinate space so we use coords directly,
// regardless of the rendered image size.
const PNG_W = 234, PNG_H = 614;

function initSvg() {
    svgOverlay.setAttribute('viewBox', `0 0 ${PNG_W} ${PNG_H}`);
    svgOverlay.setAttribute('preserveAspectRatio', 'xMidYMid meet');
}

function drawCircle(canonicalKey) {
    const entry = settlementsData[canonicalKey];
    if (!entry) return;
    circleEl.setAttribute('cx', entry.x);
    circleEl.setAttribute('cy', entry.y);
    circleEl.setAttribute('r', 10);
    circleEl.removeAttribute('style'); // clear any display:none

    // Restart CSS animation by toggling a class
    circleEl.classList.remove('active');
    void circleEl.getBoundingClientRect(); // force reflow
    circleEl.classList.add('active');

    state.chosenCircleKey = canonicalKey;
}

function showMistakeCircle(canonicalKey) {
    drawCircle(canonicalKey);
}

function hideCircle() {
    circleEl.style.display = 'none';
    circleEl.classList.remove('active');
    if (clueTimer) { clearInterval(clueTimer); clueTimer = null; }
    const btnClue = document.getElementById('btn-clue');
    if (btnClue) btnClue.textContent = `🎯 רמז (${COST_CLUE} נק')`;
}

// ── Score & bonus ─────────────────────────────────────────────────

function addScore(bonus) {
    const total = POINTS_BASE + bonus;
    state.score += total;
    scoreEl.textContent = state.score;
    showBonus(total);
}

function showBonus(pts) {
    if (pts === 0) return;

    // Create a floating element
    const floater = document.createElement('div');
    floater.className = 'floating-points';
    floater.textContent = pts > 0 ? `+${pts}` : pts;
    if (pts < 0) floater.style.color = '#e63946'; // red for penalties

    document.body.appendChild(floater);

    // Get target position (the score box)
    const scoreRect = scoreEl.getBoundingClientRect();
    const targetX = scoreRect.left + scoreRect.width / 2;
    const targetY = scoreRect.top + scoreRect.height / 2;

    // Start slightly below center
    const startX = window.innerWidth / 2;
    const startY = window.innerHeight / 2 + 50;

    // Set initial position
    floater.style.left = `${startX}px`;
    floater.style.top = `${startY}px`;

    // Force reflow
    void floater.offsetWidth;

    // Animate to target
    floater.style.transform = `translate(${targetX - startX}px, ${targetY - startY}px) scale(0.5)`;
    floater.style.opacity = '0';

    // Remove after animation finishes
    setTimeout(() => {
        floater.remove();
    }, 1000);
}

// ── Info panel ────────────────────────────────────────────────────

function showInfoPanel(canonicalKey, extraMsg) {
    const entry = settlementsData[canonicalKey];
    if (!entry) return;
    infoName.textContent = entry.name;
    infoDetails.textContent = `הוקם: ${entry.establishment} | תושבים: ${entry.population}`;
    if (extraMsg) {
        infoDetails.textContent += '\n' + extraMsg;
    }
    infoPanel.classList.add('visible');
}

function hideInfoPanel() {
    infoPanel.classList.remove('visible');
}

// ── Easter Egg ────────────────────────────────────────────────────

function triggerEasterEgg(msg, points) {
    const floater = document.createElement('div');
    floater.className = 'easter-egg-heart pumping';
    floater.textContent = msg;

    const startX = window.innerWidth / 2;
    const startY = window.innerHeight / 2;
    floater.style.left = `${startX}px`;
    floater.style.top = `${startY}px`;

    document.body.appendChild(floater);

    setTimeout(() => {
        floater.textContent = '+' + points;
        floater.classList.remove('pumping');
        floater.classList.add('moving-to-score');

        const scoreRect = scoreEl.getBoundingClientRect();
        const targetX = scoreRect.left + scoreRect.width / 2;
        const targetY = scoreRect.top + scoreRect.height / 2;

        const dx = targetX - startX;
        const dy = targetY - startY;

        floater.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.5)`;
        floater.style.opacity = '0';

        setTimeout(() => {
            state.score += points;
            scoreEl.textContent = state.score;
            scoreEl.style.transition = 'all 0.3s ease';
            scoreEl.style.color = '#4ecdc4';
            scoreEl.style.transform = 'scale(1.5)';
            setTimeout(() => {
                scoreEl.style.color = '';
                scoreEl.style.transform = '';
            }, 300);
            floater.remove();
        }, 1000);
    }, 2000);
}

// ── Game Over Modal ───────────────────────────────────────────────

function getCompliment(score) {
    if (score < 50) return "לא נורא, תמיד יש פעם הבאה!";
    if (score < 150) return "התחלה טובה! נראה שאתם מכירים את הארץ.";
    if (score < 300) return "יפה מאוד! יש לכם ידע גיאוגרפי מרשים.";
    if (score < 600) return "כל הכבוד! אתם ממש שולטים במפת ישראל.";
    if (score < 1000) return "מדהים! סייר מדופלם של ארץ ישראל.";
    return "אלוף הארץ! אין נקודה על המפה שאתם לא מכירים!";
}

function showGameOverModal(gatheredSet) {
    gameOverScore.textContent = state.score + " נקודות";
    gameOverCompliment.textContent = getCompliment(state.score);

    gameOverList.innerHTML = '';

    // Convert set of variant keys to a unique list of canonical keys
    const uniqueCanonKeys = new Set();
    for (const vKey of gatheredSet) {
        uniqueCanonKeys.add(keyVariantMap[vKey]);
    }

    if (uniqueCanonKeys.size === 0) {
        const li = document.createElement('li');
        li.textContent = "לא הספקתם לאסוף יישובים הפעם.";
        gameOverList.appendChild(li);
    } else {
        for (const canonKey of uniqueCanonKeys) {
            const entry = settlementsData[canonKey];
            if (!entry) continue;

            const li = document.createElement('li');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'ml-name';
            nameSpan.textContent = entry.name;

            const dataSpan = document.createElement('span');
            dataSpan.className = 'ml-data';
            dataSpan.textContent = `הוקם: ${entry.establishment} | תושבים: ${entry.population}`;

            li.appendChild(nameSpan);
            li.appendChild(dataSpan);
            gameOverList.appendChild(li);
        }
    }

    gameOverModal.classList.add('visible');
}

function closeGameOverModal() {
    gameOverModal.classList.remove('visible');

    // Halve the score as a penalty for failing but continuing
    const penalty = Math.ceil(state.score / 2);
    state.score -= penalty;
    scoreEl.textContent = state.score;

    if (penalty > 0) {
        showBonus(-penalty);
        // Show a temporary message about the penalty
        scoreEl.style.color = '#e63946';
        const oldText = scoreEl.textContent;
        scoreEl.textContent = "קוצץ בחצי!";
        setTimeout(() => {
            scoreEl.style.color = '';
            scoreEl.textContent = state.score;
        }, 1500);
    }

    softReset(); // Reset the current string, but let them keep playing
}

// ── Reveal Hint UI ──────────────────────────────────────────────────

const revealListEl = document.getElementById('reveal-list');

function clearForbid() {
    state.forbid = [];
    state.forbidSet = new Set();
    if (revealTimer) { clearInterval(revealTimer); revealTimer = null; }
    revealListEl.classList.remove('visible');
    const btnReveal = document.getElementById('btn-reveal');
    if (btnReveal) btnReveal.textContent = `👁 ארכיון (${COST_REVEAL} נק')`;
}

function setForbid(guaranteed) {
    state.forbid = [...guaranteed];
    state.forbidSet = new Set(guaranteed);
}

let revealTimer = null;

function revealOption() {
    if (state.score < COST_REVEAL) {
        // Flash the score to indicate not enough points
        scoreEl.style.color = '#e63946';
        setTimeout(() => { scoreEl.style.color = ''; }, 600);
        return;
    }

    // Find a valid option
    const playableOptions = chooseAll(state.current, allVariantKeys, state.forbidSet);
    const options = playableOptions.length ? playableOptions : chooseAll(state.current, allVariantKeys, new Set());

    if (!options.length) return; // shouldn't happen unless current string is invalid

    const picked = randChoice(options);
    const settlementsToShow = picked.former; // Only show the history, not the current one

    if (settlementsToShow.length === 0) {
        // If there's no history yet, don't deduct points or show an empty box
        const btnReveal = document.getElementById('btn-reveal');
        const oldText = btnReveal.textContent;
        btnReveal.textContent = "אין היסטוריה";
        setTimeout(() => { btnReveal.textContent = oldText; }, 1500);
        return;
    }

    // Deduct points
    state.score -= COST_REVEAL;
    scoreEl.textContent = state.score;
    showBonus(-COST_REVEAL);

    // Populate the list
    revealListEl.innerHTML = '';
    for (const vKey of settlementsToShow) {
        const canonKey = keyVariantMap[vKey];
        const name = variantDisplayName[vKey] || settlementsData[canonKey]?.name || canonKey;
        const li = document.createElement('li');
        li.textContent = name;
        revealListEl.appendChild(li);
    }

    // Show the list
    revealListEl.classList.add('visible');

    const btnReveal = document.getElementById('btn-reveal');
    if (revealTimer) clearInterval(revealTimer);

    let remaining = 5;

    const updateBtn = () => {
        if (btnReveal) btnReveal.textContent = `👁 ${remaining}s...`;
    };
    updateBtn();

    revealTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(revealTimer);
            revealTimer = null;
            if (btnReveal) {
                btnReveal.textContent = `👁 ארכיון (${COST_REVEAL} נק')`;
            }
        } else {
            updateBtn();
        }
    }, 1000);
}

let clueTimer = null;

function showClue() {
    if (!state.chosenCircleKey) return;
    if (state.score < COST_CLUE) {
        scoreEl.style.color = '#e63946';
        setTimeout(() => { scoreEl.style.color = ''; }, 600);
        return;
    }

    state.score -= COST_CLUE;
    scoreEl.textContent = state.score;
    showBonus(-COST_CLUE);

    const btnClue = document.getElementById('btn-clue');
    if (clueTimer) clearInterval(clueTimer);

    const canonKey = state.chosenCircleKey;
    const name = settlementsData[canonKey]?.name || canonKey;

    let remaining = 5;

    const updateBtn = () => {
        if (btnClue) btnClue.textContent = `🎯 ${name} (${remaining}s)`;
    };
    updateBtn();

    clueTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            clearInterval(clueTimer);
            clueTimer = null;
            if (btnClue) {
                btnClue.textContent = `🎯 רמז (${COST_CLUE} נק')`;
            }
        } else {
            updateBtn();
        }
    }, 1000);
}

// ── Display ───────────────────────────────────────────────────────

function updateDisplay() {
    const display = state.current.split('').reverse().join('');
    const wrong = state.wrongLetter ? `<span class="wrong-letter">${state.wrongLetter}</span>` : '';

    currentStr.innerHTML = display + wrong;

    // Dynamically enforce a maximum of 3 lines displayed
    const computed = window.getComputedStyle(currentStr);
    const lh = parseFloat(computed.lineHeight) || 45; // 1.4 * 32px roughly 45px
    const maxH = lh * 3.5; // safe threshold between 3 and 4 lines

    if (currentStr.scrollHeight > maxH) {
        let left = 0;
        let right = display.length;
        let bestSlice = display;

        // Binary search for the smallest truncation that fits in 3 lines
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            currentStr.innerHTML = display.slice(mid) + wrong;
            if (currentStr.scrollHeight > maxH) {
                left = mid + 1; // Need to trim more
            } else {
                bestSlice = display.slice(mid);
                right = mid - 1; // Try to retain more characters
            }
        }
        currentStr.innerHTML = bestSlice + wrong;
    }
}

// ── Game logic ────────────────────────────────────────────────────

function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function handleLetter(ch) {
    ch = removeSofit(ch);
    if (!isHebrewLetter(ch)) return;

    if (state.wrongLetter) {
        state.wrongLetter = null;
        state.current = '';
        updateDisplay();
        hideInfoPanel();
        hideCircle();
    }

    const now = Date.now();
    let bonus = 0;
    if (state.lastKeyTime !== null) {
        const elapsed = (now - state.lastKeyTime) / 1000;
        if (elapsed < BONUS_FAST_TIME) bonus = BONUS_FAST_PTS;
        else if (elapsed < BONUS_MED_TIME) bonus = BONUS_MED_PTS;
    }
    state.lastKeyTime = now;

    const userCurrent = ch + state.current;

    // Easter Egg Check (user turn)
    for (const [key, egg] of Object.entries(easterEggData)) {
        if (!state.easterEggsFound.has(key) && userCurrent.startsWith(key)) {
            state.easterEggsFound.add(key);
            triggerEasterEgg(egg.msg, egg.points);
        }
    }

    const options = chooseAll(userCurrent, allVariantKeys, state.forbidSet);

    if (!options.length) {
        // MISTAKE: find best option from the state BEFORE the wrong key
        // (mirrors: options = choose_all(current[1:], settlements, forbid))
        const prevOptions = chooseAll(state.current, allVariantKeys, state.forbidSet);

        let gatheredSet = new Set();
        if (prevOptions.length) {
            const picked = randChoice(prevOptions);
            const canonKey = keyVariantMap[picked.key];
            showMistakeCircle(canonKey);
            showInfoPanel(canonKey);

            // Set forbid to guaranteed-consumed settlements (REPLACE, not accumulate)
            const guaranteed = findAllFormer(prevOptions);
            if (guaranteed.size) setForbid(guaranteed);
            gatheredSet = guaranteed;
        }

        // Save the mistake and show it
        state.wrongLetter = ch;
        updateDisplay();

        // Show Game Over Modal after a short delay so the user can see their mistake
        setTimeout(() => {
            showGameOverModal(gatheredSet);
        }, 1200);
        return;
    }

    hideInfoPanel();

    const picked = randChoice(options);
    // Always normalize the computer's letter — no sofiot in the string!
    const compLetter = removeSofit(picked.letter);
    const canonKey = keyVariantMap[picked.key];

    state.current = compLetter + userCurrent;

    drawCircle(canonKey);
    updateDisplay();
    addScore(bonus);

    // Easter Egg Check (computer turn)
    for (const [key, egg] of Object.entries(easterEggData)) {
        if (!state.easterEggsFound.has(key) && state.current.startsWith(key)) {
            state.easterEggsFound.add(key);
            triggerEasterEgg(egg.msg, egg.points);
        }
    }
}

function softReset() {
    state.current = '';
    state.wrongLetter = null;
    state.lastKeyTime = null;
    state.easterEggsFound.clear();
    clearForbid();
    updateDisplay();
    hideInfoPanel();
    hideCircle();
}

function fullReset() {
    state.current = '';
    state.wrongLetter = null;
    state.score = 0;
    state.lastKeyTime = null;
    state.easterEggsFound.clear();
    clearForbid();
    scoreEl.textContent = '0';
    bonusFlash.textContent = '';
    bonusFlash.classList.remove('flash-anim');
    updateDisplay();
    hideInfoPanel();
    hideCircle();
}

// ── Keyboard ──────────────────────────────────────────────────────

// Standard Israeli keyboard layout: English key → Hebrew letter
const EN_TO_HE = {
    'q': '/', 'w': "'", 'e': 'ק', 'r': 'ר', 't': 'א', 'y': 'ט', 'u': 'ו', 'i': 'ן', 'o': 'ם', 'p': 'פ',
    'a': 'ש', 's': 'ד', 'd': 'ג', 'f': 'כ', 'g': 'ע', 'h': 'י', 'j': 'ח', 'k': 'ל', 'l': 'ך',
    'z': 'ז', 'x': 'ס', 'c': 'ב', 'v': 'ה', 'b': 'נ', 'n': 'מ', 'm': 'צ',
    ',': 'ת', '.': 'ץ', ';': 'ף',
};

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        fullReset();
        return;
    }
    if (e.key === ' ') {
        e.preventDefault();
        softReset();
        return;
    }
    const raw = e.key.length === 1 ? e.key : '';
    if (!raw) return;
    // Map English key to Hebrew if needed
    const ch = EN_TO_HE[raw.toLowerCase()] ?? raw;
    handleLetter(ch);
});

// ── Init ──────────────────────────────────────────────────────────

async function init() {
    const [gameResp, eggsResp] = await Promise.all([
        fetch('data/game_data.json'),
        fetch('data/easter_eggs.json').catch(() => null) // Ignore missing file just in case
    ]);
    const raw = await gameResp.json();
    const eggsRaw = eggsResp ? await eggsResp.json() : {};

    settlementsData = raw;

    // Build keyVariantMap, variantDisplayName, allVariantKeys
    for (const [canonKey, entry] of Object.entries(raw)) {
        const rawNames = [entry.name, ...(entry.aliases || [])].filter(Boolean);
        for (const n of rawNames) {
            // Apply יי→י / וו→ו BEFORE stripping spaces (word boundaries protect cross-word joins)
            for (const variantName of nameVariants(n)) {
                const key = stripAndReverse(variantName);
                allVariantKeys.add(key);
                keyVariantMap[key] = canonKey;
                if (!variantDisplayName[key]) variantDisplayName[key] = n;
            }
        }
        // canonical key always maps to itself
        keyVariantMap[canonKey] = canonKey;
        if (!variantDisplayName[canonKey]) variantDisplayName[canonKey] = entry.name;
    }

    // Initialize easter eggs
    for (const [name, data] of Object.entries(eggsRaw)) {
        const key = stripAndReverse(name);
        easterEggData[key] = data; // store object with msg and points
    }

    // Init Hint buttons with constants
    const btnReveal = document.getElementById('btn-reveal');
    if (btnReveal) btnReveal.textContent = `👁 ארכיון (${COST_REVEAL} נק')`;

    const btnClue = document.getElementById('btn-clue');
    if (btnClue) btnClue.textContent = `🎯 רמז (${COST_CLUE} נק')`;

    initSvg();
    initKeyboard();
    updateDisplay();
}

function initKeyboard() {
    const kbRows = [
        ['ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ'],
        ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
        ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ']
    ];

    const vk = document.getElementById('virtual-keyboard');
    if (!vk) return;

    for (const row of kbRows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'kb-row';
        for (const letter of row) {
            const keyEl = document.createElement('button');
            keyEl.className = 'kb-key';
            keyEl.textContent = letter;
            // Prevent button from capturing focus so we don't interfere with physical keyboard events
            keyEl.onmousedown = (e) => e.preventDefault();
            keyEl.onclick = () => handleLetter(letter);
            rowEl.appendChild(keyEl);
        }
        vk.appendChild(rowEl);
    }
}

window.addEventListener('load', init);

// Resize: redraw circle when window size changes
window.addEventListener('resize', () => {
    if (state.chosenCircleKey) drawCircle(state.chosenCircleKey);
});
