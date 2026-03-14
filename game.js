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
// Algorithms moved to logic.js

// ── Game logic  ──────────

// chooseAll and findAllFormer moved to logic.js

// ── State ─────────────────────────────────────────────────────────

let easterEggData = {};         // Reversed validation string → {msg, points}
let db = null;
let canonicalToName = null;
let state = {
    current: '',
    wrongLetter: null,
    // canonKeys of settlements guaranteed consumed (set on mistake, cleared on softReset)
    forbid: [],
    forbidSet: new Set(), // same as forbid but as Set for O(1) lookup
    score: 0,
    lastKeyTime: null,
    chosenCircleKey: null,
    displayOffset: 0,
    easterEggsFound: new Set(),
    inactivityTimer: null,
    compOptions: [],
    allOptions: [],
    gameOverTimeout: null,
};

let bestScore = parseInt(localStorage.getItem('geoboor_best_score')) || 0;

function updateScoreDisplays() {
    scoreEl.textContent = state.score;
    if (state.score > bestScore) {
        bestScore = state.score;
        localStorage.setItem('geoboor_best_score', bestScore);
    }
    if (bestScoreEl && bestScoreEl.textContent !== bestScore.toString()) {
        bestScoreEl.textContent = bestScore;
    }
}

const audioManager = new AudioManager();

// ── DOM refs ──────────────────────────────────────────────────────

const mapImg = document.getElementById('map-img');
const svgOverlay = document.getElementById('svg-overlay');
const circleEl = document.getElementById('settlement-circle');
const currentStr = document.getElementById('current-string');
const scoreEl = document.getElementById('score');
const bestScoreEl = document.getElementById('best-score');

if (bestScoreEl) bestScoreEl.textContent = bestScore;
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
    const entry = db.get(canonicalKey);
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

function clearExtraCircles() {
    const extras = svgOverlay.querySelectorAll('.found-circle, .mistake-circle');
    extras.forEach(el => el.remove());
}

function showMistakeCircle(missedName, foundNames = []) {
    drawCircle(missedName);
    circleEl.style.display = 'none';
    clearExtraCircles();

    // Draw found settlements
    for (const name of foundNames) {
        const entry = db.get(name);
        if (entry) {
            const mc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            mc.classList.add('found-circle');
            mc.setAttribute('cx', entry.x);
            mc.setAttribute('cy', entry.y);
            mc.setAttribute('r', 10);
            svgOverlay.appendChild(mc);
        }
    }

    // Draw mistake
    const entry = db.get(missedName);
    if (entry) {
        const mc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        mc.classList.add('mistake-circle');
        mc.setAttribute('cx', entry.x);
        mc.setAttribute('cy', entry.y);
        mc.setAttribute('r', 12);
        svgOverlay.appendChild(mc);
    }

    audioManager.playGameOver();
}

function hideCircle() {
    circleEl.style.display = 'none';
    circleEl.classList.remove('active');
    clearExtraCircles();
    if (clueTimer) { clearInterval(clueTimer); clueTimer = null; }
    const btnClue = document.getElementById('btn-clue');
    if (btnClue) btnClue.textContent = `🎯 רמז (${COST_CLUE} נק')`;
}

// ── Score & bonus ─────────────────────────────────────────────────

function addScore(bonus) {
    const total = POINTS_BASE + bonus;
    state.score += total;
    updateScoreDisplays();
    showBonus(total);
    audioManager.playPoints();
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

function showInfoPanel(originalVariant, extraMsg = '', displayName = '', customTitle = null) {


    const titleEl = document.getElementById('info-panel-title');
    if (titleEl) {
        if (customTitle !== null) {
            titleEl.textContent = customTitle;
        } else {
            titleEl.textContent = state.score >= 500 ? "אתה (לא) בור!" : "אתה בור!";
        }
    }

    if (originalVariant !== displayName) {
        infoName.textContent = `${originalVariant} (${displayName})`;
    } else {
        infoName.textContent = displayName;
    }

    const entry = db.get(displayName);
    if (entry) {
        infoDetails.innerHTML = `הוקם: ${entry.establishment} | תושבים: ${entry.population}`;
    }



    if (extraMsg) {
        infoDetails.innerHTML += `<br>${extraMsg}`;
    }
    infoPanel.classList.add('visible');
}

function hideInfoPanel() {
    infoPanel.classList.remove('visible');
}

// ── Easter Egg ────────────────────────────────────────────────────

function triggerEasterEgg(msg, points) {
    audioManager.playEasterEgg();
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
            updateScoreDisplays();
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
    if (score < 500) return "כל הכבוד! אתם מתחילים ממש לשלוט במפת ישראל.";
    if (score < 750) return "מרשים מאוד! סייר מדופלם של ארץ ישראל.";
    if (score < 1000) return "מדהים! יש לכם זיכרון פנומנלי ליישובים.";
    if (score < 1250) return "וואו! המפה קטנה עליכם.";
    if (score < 1500) return "אדיר! האם הייתם נווטים בפלמ\"ח?";
    if (score < 1800) return "בלתי ייאמן! אתם מכירים כל שביל וכביש גישה במדינה.";
    if (score < 2100) return "איזה ידע! אי אפשר להתקיל אתכם בכלל.";
    if (score < 2500) return "המוח שלכם עובד כמו GPS על טורבו! כבוד עצום.";
    if (score < 2900) return "רב-אמן ארצישראלי! שלטון מוחלט במפה.";
    if (score < 3200) return "הראיתם למחשב מי כאן הבוס! פשוט מבריק.";
    return "אגדה חיה! אין נקודה על המפה שאתם לא מכירים בעל פה! שלמות.";
}

function showGameOverModal(foundNames, missedName = null, skipAudio = false) {
    if (!skipAudio) {
        audioManager.playGameOver();
    }
    gameOverScore.textContent = state.score + " נקודות";
    gameOverCompliment.textContent = getCompliment(state.score);

    const modalTitle = gameOverModal.querySelector('.modal-title');
    if (modalTitle) {
        modalTitle.textContent = state.score >= 500 ? "אתה (לא) בור ועם הארץ בידיעת הארץ!" : "אתה בור ועם הארץ בידיעת הארץ!";
    }

    gameOverList.innerHTML = '';

    const uniqueNames = new Set(foundNames || []);

    const missedContainer = document.getElementById('game-over-missed-container');
    const missedNameEl = document.getElementById('game-over-missed-name');
    const missedDataEl = document.getElementById('game-over-missed-data');

    if (missedName) {
        const entry = db.get(missedName);
        if (entry && missedContainer) {
            missedNameEl.textContent = entry.name;
            missedDataEl.textContent = `הוקם: ${entry.establishment} | תושבים: ${entry.population}`;
            missedContainer.style.display = 'block';
        }
    } else if (missedContainer) {
        missedContainer.style.display = 'none';
    }

    if (uniqueNames.size === 0 && !missedName) {
        const li = document.createElement('li');
        li.textContent = "לא הספקתם לאסוף יישובים הפעם.";
        gameOverList.appendChild(li);
    } else {
        for (const displayName of uniqueNames) {
            const entry = db.get(displayName);
            if (!entry) continue;

            const li = document.createElement('li');

            const nameSpan = document.createElement('span');
            nameSpan.className = 'ml-name';
            nameSpan.textContent = `${entry.name}`;

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
    updateScoreDisplays();

    if (penalty > 0) {
        showBonus(-penalty);
        // Show a temporary message about the penalty
        scoreEl.style.color = '#e63946';
        const oldText = scoreEl.textContent;
        scoreEl.textContent = "קוצץ בחצי!";
        setTimeout(() => {
            scoreEl.style.color = '';
            updateScoreDisplays();
        }, 1500);
    }

    softReset(); // Reset the current string, but let them keep playing
}

function showHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) {
        modal.classList.add('visible');
    }
}

function closeHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

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


let clueTimer = null;

function showClue() {
    if (state.score < COST_CLUE) {
        scoreEl.style.color = '#e63946';
        setTimeout(() => { scoreEl.style.color = ''; }, 600);
        return;
    }


    state.score -= COST_CLUE;
    updateScoreDisplays();
    showBonus(-COST_CLUE);
    audioManager.playClue();

    const btnClue = document.getElementById('btn-clue');
    if (clueTimer) clearInterval(clueTimer);


    const [displayName, originalVariant, metadata] = canonicalToName.get(state.compNext.lastCanonical);


    let remaining = 5;

    const updateBtn = () => {
        if (btnClue) btnClue.textContent = `🎯 ${originalVariant} (${remaining}s)`;
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

    if (state.displayOffset === undefined) state.displayOffset = 0;

    currentStr.innerHTML = display.slice(state.displayOffset) + wrong;

    // Dynamically enforce a maximum of 3 lines displayed
    const computed = window.getComputedStyle(currentStr);
    const lh = parseFloat(computed.lineHeight) || 45; // 1.4 * 32px roughly 45px
    const maxH = lh * 3.5; // safe threshold between 3 and 4 lines

    if (currentStr.scrollHeight > maxH) {
        let left = state.displayOffset;
        let right = display.length;
        let bestK = right;
        const targetH = lh * 2.5; // 2 lines threshold

        // Binary search for the smallest truncation that fits in 2 lines
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            currentStr.innerHTML = display.slice(mid) + wrong;
            if (currentStr.scrollHeight <= targetH) {
                bestK = mid;
                right = mid - 1; // Try to retain more characters (smaller k)
            } else {
                left = mid + 1; // Need to trim more characters
            }
        }

        // We set displayOffset to bestK - 1 to make it 2 full lines + newest characters on 3rd line
        state.displayOffset = Math.max(0, bestK - 1);
        currentStr.innerHTML = display.slice(state.displayOffset) + wrong;
    }
}

// ── Game logic ────────────────────────────────────────────────────

function randChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function handleLetter(ch) {
    ch = removeSofit(ch);
    if (!isHebrewLetter(ch)) return;
    console.log("handleLetter", ch, state.current);

    audioManager.playUserSelect();
    hideInactivityTeaser();
    resetInactivityTimer();

    if (state.wrongLetter) {
        state.wrongLetter = null;
        state.current = '';
        state.displayOffset = 0;
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

    // check if user char is in the options (state.allOptions) or it's first move
    isLegal = state.allOptions.some(option => option.letter === ch) || !state.current.length;


    const userCurrent = ch + state.current;


    if (!isLegal) {
        const [displayName, originalVariant, metadata] = canonicalToName.get(state.compNext.lastCanonical);
        const foundNames = state.allOptions.length > 0 ? state.allOptions[0].forbidden : [];

        showMistakeCircle(displayName, foundNames);
        showInfoPanel(originalVariant, '', displayName);

        // Save the mistake and show it
        state.wrongLetter = ch;
        updateDisplay();

        //Show Game Over Modal after a short pump delay
        if (state.gameOverTimeout) clearTimeout(state.gameOverTimeout);
        state.gameOverTimeout = setTimeout(() => {
            showGameOverModal(foundNames, displayName, true);
        }, 4000);
        return;
    }

    hideInfoPanel();



    // Computer finds the next one (for him to choose)
    const forwardString1 = userCurrent.split('').reverse().join('');
    const checkResults1 = [];
    checkSequence(forwardString1, canonicalToName, [], [], checkResults1);
    const nonMetadataOptions1 = checkResults1.filter(r => {
        const metadata = canonicalToName.get(r.lastCanonical)[2];
        return metadata !== "short" && metadata !== "outpost";
    });
    const compOptions1 = nonMetadataOptions1.length > 0 ? nonMetadataOptions1 : checkResults1;
    if (compOptions1.length === 0) {
        const [displayName, originalVariant, metadata] = canonicalToName.get(state.compNext.lastCanonical);
        const foundNames = state.allOptions.length > 0 ? state.allOptions[0].forbidden : [];
        showGameOverModal(foundNames, displayName);
        return;
    }
    choice = randChoice(compOptions1);

    // If we were forced to use a metadata option, show a teaser
    if (nonMetadataOptions1.length === 0) {
        const metadata = canonicalToName.get(choice.lastCanonical)[2];
        if (metadata === 'short' || metadata === 'outpost') {
            showMetadataTeaser(metadata);
        }
    }

    const compLetter = choice.letter;

    audioManager.playComputerSelect();

    state.current = compLetter + userCurrent;

    // Check if it's an easter egg. 

    // take the last fobidden in option (it's the last valid settlement)
    const lastValid = choice.forbidden[choice.forbidden.length - 1];

    // check if displayName is in the easter egg list (easterEggData) and it's last letter
    if (lastValid in easterEggData && choice.isBeginOfSettlement) {
        triggerEasterEgg(easterEggData[lastValid].msg, easterEggData[lastValid].points);
    }



    // Computer finds the next one (for the user to choose)
    const forwardString = state.current.split('').reverse().join('');
    const checkResults = [];
    checkSequence(forwardString, canonicalToName, [], [], checkResults);
    const nonMetadataOptions = checkResults.filter(r => {
        const metadata = canonicalToName.get(r.lastCanonical)[2];
        return metadata !== "short" && metadata !== "outpost";
    });


    const compOptions = nonMetadataOptions.length > 0 ? nonMetadataOptions : checkResults;
    state.compOptions = compOptions;
    state.compNext = randChoice(compOptions);
    state.allOptions = checkResults;
    const [displayName, originalVariant, metadata] = canonicalToName.get(state.compNext.lastCanonical);

    drawCircle(displayName);
    updateDisplay();
    addScore(bonus);

    // make a set of all the last valid settlements if isBeginOfSettlement is true
    const lastValidSettlements = new Set();
    for (const option of state.compOptions) {
        if (option.isBeginOfSettlement) {
            const lastValid = option.forbidden[option.forbidden.length - 1];

            lastValidSettlements.add(lastValid);
        }
    }
    // Check if it's an easter egg. 
    for (const settlement of lastValidSettlements) {
        // check if displayName is in the easter egg list (easterEggData) and it's last letter
        if (settlement in easterEggData) {
            triggerEasterEgg(easterEggData[settlement].msg, easterEggData[settlement].points);
        }
    }

}

function softReset() {
    if (state.gameOverTimeout) {
        clearTimeout(state.gameOverTimeout);
        state.gameOverTimeout = null;
    }
    state.current = '';
    state.wrongLetter = null;
    state.lastKeyTime = null;
    state.displayOffset = 0;
    state.easterEggsFound.clear();
    clearForbid();
    updateDisplay();
    hideInfoPanel();
    hideCircle();
    hideInactivityTeaser();
    resetInactivityTimer();
}

function fullReset() {
    if (state.gameOverTimeout) {
        clearTimeout(state.gameOverTimeout);
        state.gameOverTimeout = null;
    }
    state.current = '';
    state.wrongLetter = null;
    state.score = 0;
    state.lastKeyTime = null;
    state.displayOffset = 0;
    state.easterEggsFound.clear();
    clearForbid();
    updateScoreDisplays();
    bonusFlash.textContent = '';
    bonusFlash.classList.remove('flash-anim');
    updateDisplay();
    hideInfoPanel();
    hideCircle();
    hideInactivityTeaser();
    resetInactivityTimer();
}

// ── Inactivity Teaser ─────────────────────────────────────────────

function resetInactivityTimer() {
    if (state.inactivityTimer) {
        clearTimeout(state.inactivityTimer);
    }
    state.inactivityTimer = setTimeout(showInactivityTeaser, 7000);
}

function showInactivityTeaser() {
    if (state.wrongLetter || gameOverModal.classList.contains('visible')) return;

    const checkResults = [];
    // userCurrent is built right-to-left, so reverse it for checkSequence which reads left-to-right
    const forwardString = state.current.split('').reverse().join('');
    checkSequence(forwardString, canonicalToName, [], [], checkResults);


    const nonMetadataOptions = checkResults.filter(r => {
        const metadata = canonicalToName.get(r.lastCanonical)[2];
        return metadata !== "short" && metadata !== "outpost";
    });
    const compOptions = nonMetadataOptions.length > 0 ? nonMetadataOptions : checkResults;
    if (!compOptions.length) return;

    const uniqueLetters = new Set(compOptions.map(opt => opt.letter)).size;
    const uniqueSettlements = new Set(compOptions.map(opt => canonicalToName.get(opt.lastCanonical)[0])).size;

    // Don't show the teaser if it's the start of the game or if there are too many options
    if (uniqueSettlements > 40) return;

    let phrases = [];
    const useLetters = Math.random() > 0.5;

    if (useLetters) {
        if (uniqueLetters === 1) {
            phrases = [
                `יש רק אות אחת שממשיכה מפה. יודעים איזו? 🎯`,
                `הגענו למבוי (כמעט) סתום. רק אות אחת עובדת! 🤫`,
                `אין לכם הרבה ברירות, רק אות אחת תתאים כאן. 🥸`,
                ` רק אות אחת חוקית... מצאתם? 🤔`,
                `אפשרות אחת בודדה וזהו. תמצאו אותה? ⏳`
            ];
        } else if (uniqueLetters <= 5) {
            phrases = [
                `רק ${uniqueLetters} אותיות אפשריות. אתם בכיוון הנכון! 🧐`,
                `נשארו ${uniqueLetters} אפשרויות לאות הבאה... קלי קלות. 💪`,
                `זה נהיה צפוף... נותרו ${uniqueLetters} אופציות. 🥵`,
                `יש רק ${uniqueLetters} אותיות שממשיכות את הרצף. קדימה! 🔥`,
                `כל צעד סוגר אפשרויות. ${uniqueLetters} אותיות לפניכם. �`
            ];
        } else {
            phrases = [
                `ראיתי איזה ${uniqueLetters} אותיות מתאימות... נו? 😏`,
                `יש לי רעיון ל-${uniqueLetters} אותיות. מה איתך? 😜`,
                `אין תירוצים, יש לפחות ${uniqueLetters} אותיות פנויות על הלוח! 😎`,
                `קחו את הזמן... רק ${uniqueLetters} אותיות שונות יעבדו עכשיו. 🙃`,
                `מספיק זמן לבהות! יש ${uniqueLetters} אותיות נכונות, תבחרו אחת. 😌`
            ];
        }
    } else {
        if (uniqueSettlements === 1) {
            phrases = [
                `יישוב אחד אחרון נשאר! 🥵`,
                `מצאתי אותו אצלי... ואתם? 🤔`,
                `זהו, ננעלנו על יישוב בודד. רק לסיים אותו! 🎯`,
                `יישוב אחד ויחיד מתאים למה שכתבתם. 🤓`,
                `אין לאן לחמוק, רק יישוב אחד מתאים עכשיו. ⏳`
            ];
        } else if (uniqueSettlements <= 5) {
            phrases = [
                `רק ${uniqueSettlements} יישובים באים בחשבון. קטן עליכם! 💪`,
                `הצטמצמנו ל-${uniqueSettlements} יישובים. מתחמם! 🔥`,
                `עוד קצת! ${uniqueSettlements} יישובים נותרו. 🧐`,
                `יש פה ${uniqueSettlements} יישובים במאגר שעונים על זה... אל תתייאשו. 🤫`,
                `המעגל נסגר: ${uniqueSettlements} יישובים בלבד. קדימה! 🥸`
            ];
        } else {
            phrases = [
                `מזהה לפחות ${uniqueSettlements} יישובים שטובים פה. מה הבעיה? 😎`,
                `יש לי ${uniqueSettlements} יישובים בראש... מחכה ללחיצה. 🥸`,
                `עם ${uniqueSettlements} כאלו באופק, אין טעם לחשוב כל כך הרבה! 😜`,
                `אני יכול למנות לפחות ${uniqueSettlements} תשובות. ואתם? 😏`,
                `עדיין המון אפשרויות: ${uniqueSettlements} יישובים לשחק איתם. בואו נתקדם. 🙃`
            ];
        }
    }

    const randomMsg = phrases[Math.floor(Math.random() * phrases.length)];

    let teaserEl = document.getElementById('inactivity-teaser');
    if (!teaserEl) {
        teaserEl = document.createElement('div');
        teaserEl.id = 'inactivity-teaser';
        teaserEl.className = 'inactivity-teaser';
        document.getElementById('map-container').appendChild(teaserEl);
    }

    const msgBody = randomMsg.slice(0, -2);
    const emoji = randomMsg.slice(-2).trim();

    teaserEl.innerHTML = `${msgBody}<span class="teaser-emoji">${emoji}</span>`;

    // Force reflow
    void teaserEl.offsetWidth;
    // Removed blink class as requested
    teaserEl.classList.add('visible');
    audioManager.playTeaserBlip();

    // Remove the teaser after a shorter time (2.0s)
    if (state.teaserTimeout) clearTimeout(state.teaserTimeout);
    state.teaserTimeout = setTimeout(hideInactivityTeaser, 2000);
}

function hideInactivityTeaser() {
    const teaserEl = document.getElementById('inactivity-teaser');
    if (teaserEl) {
        teaserEl.classList.remove('visible');
    }
}

function showMetadataTeaser(type) {
    let phrases = [];
    if (type === 'short') {
        phrases = [
            "זורם איתך על כתיב חסר 🤷",
            "מחליק לך על הכתיב 🤫",
            "שיהיה כתיב חסר הפעם 😅",
            "לא נתקטנן על כתיב חסר 📝",
            "כתיב חסר התקבל בברכה ✅",
            "פסדר, נזרום עם כתיב חסר 🦦",
            "נראה שאין ברירה אלא כתיב חסר 🧐"
        ];
    } else if (type === 'outpost') {
        phrases = [
            "זורם איתך על ישוב לא רשמי ⛺",
            "יאללה, גם מאחז תופס 🚜",
            "מאושר פה אחד: ישוב לא רשמי 📜",
            "מכיר גם את המאחזים הכי נידחים חחח 🐐",
            "קיבלתי את הישוב הלא רשמי 🤝",
            "זרמתי הפעם על חוות בודדים 🐑",
            "מאחז זה לא תירוץ, זורם 😎"
        ];
    } else {
        return;
    }

    const randomMsg = phrases[Math.floor(Math.random() * phrases.length)];

    let teaserEl = document.getElementById('inactivity-teaser');
    if (!teaserEl) {
        teaserEl = document.createElement('div');
        teaserEl.id = 'inactivity-teaser';
        teaserEl.className = 'inactivity-teaser';
        document.getElementById('map-container').appendChild(teaserEl);
    }

    const msgBody = randomMsg.slice(0, -2);
    const emoji = randomMsg.slice(-2).trim();

    teaserEl.innerHTML = `${msgBody}<span class="teaser-emoji">${emoji}</span>`;

    // Force reflow
    void teaserEl.offsetWidth;
    teaserEl.classList.add('visible');
    audioManager.playTeaserBlip();

    if (state.teaserTimeout) clearTimeout(state.teaserTimeout);
    state.teaserTimeout = setTimeout(() => {
        teaserEl.classList.remove('visible');
    }, 2000);
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

    const gameData = readGameData(raw);
    db = gameData.db;
    canonicalToName = gameData.canonicalToName;

    // Build keyVariantMap, variantDisplayName, allVariantKeys, baseVariantKeys
    // (Deprecated, removed from here)

    // Initialize easter eggs
    for (const [name, data] of Object.entries(eggsRaw)) {
        easterEggData[name] = data; // store object with msg and points
    }

    // Init Hint buttons with constants
    const btnReveal = document.getElementById('btn-reveal');
    if (btnReveal) btnReveal.textContent = `👁 ארכיון (${COST_REVEAL} נק')`;

    const btnClue = document.getElementById('btn-clue');
    if (btnClue) btnClue.textContent = `🎯 רמז (${COST_CLUE} נק')`;

    initSvg();
    initKeyboard();
    updateDisplay();
    resetInactivityTimer();
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
