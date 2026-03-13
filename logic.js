// GeoBoor Logic

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

/** Strip non-Hebrew chars and normalize sofit letters, preserving reading order. */
function toCanonical(name) {
    return Array.from(name.replace(/[^\u05D0-\u05EA]/g, ''))
        .map(c => SOFIT_MAP[c] ?? c)
        .join('');
}

function getVariants(entry) {
    const rawNames = [entry.name, ...(entry.aliases || [])];
    const baseKeys = new Set();
    const variantKeys = new Set();

    for (const n of rawNames) {
        if (!n) continue;

        // The first variant returned by nameVariants is ALWAYS the original string
        const variantsArr = Array.from(nameVariants(n));

        // The original string is a base key
        baseKeys.add(stripAndReverse(variantsArr[0]));

        // Any subsequent strings from nameVariants are modified variants
        for (let i = 1; i < variantsArr.length; i++) {
            variantKeys.add(stripAndReverse(variantsArr[i]));
        }
    }
    return {
        baseKeys: [...baseKeys],
        variantKeys: [...variantKeys]
    };
}

/**
 * Returns all possibilities for what can follow the current accumulated string.
 * Returns array of { letter, key, former } where:
 *   - letter: next letter the computer would add (to the left)
 *   - key: variant key of the chosen settlement
 *   - former: variant keys of settlements already consumed in this path
 *
 * `forbidCanon`: canonical keys of permanently forbidden settlements (set on mistake only).
 */
function chooseAll(current, keySet, forbidCanon, keyVariantMap, former, baseKeySet = null, outpostKeys = new Set()) {

    former = former || [];
    if (!current) {
        // Collect canonical keys that are forbidden OR have already been used in this path
        const excludeCanon = new Set(forbidCanon);
        for (const f of former) {
            if (!outpostKeys.has(f)) {
                excludeCanon.add(keyVariantMap[f]);
            }
        }

        const baseOptions = [];

        // If empty string, we want to look at ALL possible valid starts.
        // If a baseKeySet is provided, we ONLY use the base keys for proposals.
        // Otherwise fallback to keySet for backward compatibility.
        const searchSet = baseKeySet || keySet;

        for (const k of searchSet) {
            const canon = keyVariantMap[k];
            if (!excludeCanon.has(canon) && !former.includes(k)) {
                baseOptions.push({ letter: k[k.length - 1], key: k, former: former });
            }
        }
        return baseOptions;
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
            results.push(...chooseAll(newCurrent, keySet, forbidCanon, keyVariantMap, newFormer, baseKeySet, outpostKeys));
        }
    }

    if (baseKeySet && results.length > 0) {
        // Filter out variant keys if there's a base key that also represents the same canonical settlement
        // for the same partial path.
        const groupsWithBase = new Set();
        for (const r of results) {
            if (baseKeySet.has(r.key)) {
                // Generate a group ID using canonical key + former array 
                const groupId = keyVariantMap[r.key] + '|' + (r.former || []).join(',');
                groupsWithBase.add(groupId);
            }
        }
        return results.filter(r => {
            if (baseKeySet.has(r.key)) return true;
            const groupId = keyVariantMap[r.key] + '|' + (r.former || []).join(',');
            return !groupsWithBase.has(groupId);
        });
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

/**
 * Parses raw JSON settlement data to build the dictionaries for the game.
 * Returns an object containing: { keyVariantMap, variantDisplayName, allVariantKeys, baseVariantKeys }
 * Returns an object containing: { keyVariantMap, variantDisplayName, allVariantKeys, baseVariantKeys, outpostKeys }
 */
function buildDictionaries(raw) {
    const keyVariantMap = {};         // variantKey → canonical key
    const variantDisplayName = {};    // variantKey → display name
    const allVariantKeys = new Set(); // all valid variant reversed-name strings
    const baseVariantKeys = new Set(); // strictly the unmodified names and aliases keys
    const outpostKeys = new Set(); // reversed keys corresponding strictly to outposts

    for (const [canonKey, entry] of Object.entries(raw)) {
        // Collect normal names and aliases
        const rawNames = [entry.name, ...(entry.aliases || [])].filter(Boolean);
        for (const n of rawNames) {
            const variantsArr = Array.from(nameVariants(n));

            // The first variant is always the base
            const baseKey = stripAndReverse(variantsArr[0]);
            allVariantKeys.add(baseKey);
            baseVariantKeys.add(baseKey);
            keyVariantMap[baseKey] = canonKey;
            if (!variantDisplayName[baseKey]) variantDisplayName[baseKey] = n;

            // Rest are variations (double-vav adjustments etc)
            for (let i = 1; i < variantsArr.length; i++) {
                const variantKey = stripAndReverse(variantsArr[i]);
                allVariantKeys.add(variantKey);
                keyVariantMap[variantKey] = canonKey;
                if (!variantDisplayName[variantKey]) variantDisplayName[variantKey] = n;
            }
        }

        // Collect outposts
        const rawOutposts = (entry['outposts'] || []).filter(Boolean);
        for (const op of rawOutposts) {
            const variantsArr = Array.from(nameVariants(op));

            const baseKey = stripAndReverse(variantsArr[0]);
            allVariantKeys.add(baseKey);
            // Outposts are NOT added to baseVariantKeys so the computer won't naturally propose them on empty strings
            // But we do track them in outpostKeys
            outpostKeys.add(baseKey);
            keyVariantMap[baseKey] = canonKey;
            if (!variantDisplayName[baseKey]) variantDisplayName[baseKey] = op;

            for (let i = 1; i < variantsArr.length; i++) {
                const variantKey = stripAndReverse(variantsArr[i]);
                allVariantKeys.add(variantKey);
                outpostKeys.add(variantKey);
                keyVariantMap[variantKey] = canonKey;
                if (!variantDisplayName[variantKey]) variantDisplayName[variantKey] = op;
            }
        }

        // canonical key always maps to itself
        keyVariantMap[canonKey] = canonKey;
        if (!variantDisplayName[canonKey]) variantDisplayName[canonKey] = entry.name;
    }

    return { keyVariantMap, variantDisplayName, allVariantKeys, baseVariantKeys, outpostKeys };
}

/**
 * Reads raw game_data JSON into two structures.
 *
 * @param {Object} raw - The parsed game_data.json object.
 * @returns {{
 *   db: Map<string, {
 *     name: string,
 *     aliases: string[],
 *     outposts: string[],
 *     population: number|string,
 *     establishment: string,
 *     x: number,
 *     y: number
 *   }>,
 *   canonicalToName: Map<string, string>
 * }}
 *
 * `db`             — keyed by the canonical JSON key (e.g. "אלון מורה").
 * `canonicalToName` — keyed by toCanonical() of every name, alias, and outpost;
 *                    value is a tuple [settlementName, originalVariant] where
 *                    settlementName is always entry.name and originalVariant is
 *                    the raw name/alias/outpost before canonicalization.
 *
 * @example
 * // raw key: "אלון מורה"  (outpost "חוות סקאלי")
 * //   canonicalToName entries:
 * //     "אלוןמורה"    → ["אלון מורה",   "אלון מורה"]
 * //     "חוותסקאלי"  → ["אלון מורה",   "חוות סקאלי"]
 *
 * // raw key: "תל אביב -יפו"  (alias "יפו")
 * //   canonicalToName entries:
 * //     "תלאביב" → ["תל אביב", "תל אביב"]
 * //     "יפו"     → ["תל אביב", "יפו"]
 */
function readGameData(raw) {
    const db = new Map();
    const canonicalToName = new Map();

    for (const [canonKey, entry] of Object.entries(raw)) {
        const aliases = (entry.aliases || []).filter(Boolean);
        const outposts = (entry.outposts || []).filter(Boolean);

        db.set(canonKey, {
            name: entry.name,
            aliases,
            outposts,
            population: entry.population,
            establishment: entry.establishment,
            x: entry.x,
            y: entry.y,
        });

        canonicalToName.set(toCanonical(entry.name), [canonKey, entry.name]);
        for (const a of aliases) canonicalToName.set(toCanonical(a), [canonKey, a]);
        for (const o of outposts) canonicalToName.set(toCanonical(o), [canonKey, o, 'outpost']);
    }

    // Second pass: for each entry whose original variant contains adjacent יי or וו,
    // add a simplified canonical key with the doubled letter collapsed to one.
    // The check is on `originalVariant` so that a hyphen between two yods/vavs
    // (e.g. "מי-יד") does NOT produce a variant (canonical strips the hyphen, but
    // the original string "מי-יד" never contains the literal "יי" substring).
    for (const [canonicalKey, [entryName, originalVariant]] of [...canonicalToName]) {
        for (const [doubled, single] of [['יי', 'י'], ['וו', 'ו']]) {
            if (originalVariant.includes(doubled)) {
                const variantKey = canonicalKey.replace(new RegExp(doubled, 'g'), single);
                if (!canonicalToName.has(variantKey)) {
                    canonicalToName.set(variantKey, [entryName, originalVariant, 'short']);
                }
            }
        }
    }

    return { db, canonicalToName };
}

/**
 * Recursively consumes fully-matched canonical keys from the start of `string`,
 * then reports every possible partial continuation.
 *
 * Algorithm:
 *  1. For each entry in `canonicalToName`, if its key is a prefix of `string`
 *     AND its display name is not in `forbidden`, consume it:
 *     strip it from `string`, append to `sequence` / `forbidden`, recurse.
 *  2. If no full key matches, look for partial matches:
 *     any canonical key that starts with the remaining string.
 *     Each hit is pushed to `results`.
 *
 * @param {string}   string          - Current game string.
 * @param {Map}      canonicalToName - Map<canonicalKey, [displayName, canonicalKey]>.
 * @param {string[]} forbidden       - Display names already used in this path.
 * @param {string[]} sequence        - Canonical keys consumed so far in this path.
 * @param {Array}    results         - Output array; each partial match is pushed here.
 *
 * Result object shape:
 * {
 *   sequence:      string[],  // canonical keys of fully consumed settlements
 *   forbidden:     string[],  // display names corresponding to sequence
 *   lastCanonical: string,    // the canonical key that starts with `string`
 *   lastName:      string,    // display name stored in canonicalToName for lastCanonical
 * }
 *
 * @example
 * // canonicalToName contains:
 * //   "אילת"    → ["אילת",    "אילת"]
 * //   "תל אביב" → ["תל אביב", "תל אביב"]
 * //
 * // checkSequence("אילתת", canonicalToName, [], [], results)
 * //  → "אילתת".startsWith("אילת") → consumes "אילת", remaining = "ת"
 * //  → "תל אביב".startsWith("ת") → result pushed:
 * //     { sequence:["אילת"], forbidden:["אילת"],
 * //       lastCanonical:"תל אביב", lastName:"תל אביב" }
 */
function checkSequence(string, canonicalToName, forbidden, sequence, results) {
    let consumed = false;

    for (const [canonicalKey, [displayName]] of canonicalToName) {
        if (string.startsWith(canonicalKey) && !forbidden.includes(displayName)) {
            consumed = true;
            checkSequence(
                string.slice(canonicalKey.length),
                canonicalToName,
                [...forbidden, displayName],
                [...sequence, canonicalKey],
                results
            );
        }
    }

    if (!consumed) {
        // Report every canonical key that has `string` as a prefix
        for (const [canonicalKey, [displayName, originalVariant]] of canonicalToName) {
            if (canonicalKey.startsWith(string) && !forbidden.includes(displayName)) {
                results.push({
                    sequence: [...sequence],
                    forbidden: [...forbidden],
                    lastCanonical: canonicalKey,
                    letter: canonicalKey[string.length],
                    lettersUntilEnd: canonicalKey.length - string.length,
                    isBeginOfSettlement: string.length === 0
                });
            }
        }
    }
}

/**
 * Checks if the current string triggers any new easter eggs.
 * Mutates `foundEggsSet` by adding nely found keys.
 * Returns an array of triggered egg owbjects: [{ msg, points }, ...]
 */
function checkEasterEggs(displayName, easterEggData, foundEggsSet) {
    const newlyFound = [];
    for (const [key, egg] of Object.entries(easterEggData)) {
        if (!foundEggsSet.has(key)) {
            // Find the canonical key for this easter egg
            const canonKey = keyVariantMap[key];
            if (canonKey) {
                // Find all variants for this canonical key
                const variants = Object.keys(keyVariantMap).filter(k => keyVariantMap[k] === canonKey);
                // Check if current string starts with any of these variants
                if (variants.some(v => currentStr.startsWith(v))) {
                    foundEggsSet.add(key);
                    newlyFound.push(egg);
                }
            }
        }
    }
    return newlyFound;
}

// Export for Node.js environments (like Jest)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        HEBREW_LETTERS,
        SOFIT_MAP,
        removeSofit,
        isHebrewLetter,
        nameVariants,
        stripAndReverse,
        toCanonical,
        getVariants,
        buildDictionaries,
        readGameData,
        checkSequence,
        chooseAll,
        findAllFormer,
        checkEasterEggs
    };
}
