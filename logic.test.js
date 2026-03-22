const { stripAndReverse, isHebrewLetter, nameVariants, getVariants, readGameData, checkSequence, getComputerOptions, getUserOptions } = require('./logic.js');

describe('מַפָּאוֹת Game Logic', () => {

    test('isHebrewLetter checks', () => {
        expect(isHebrewLetter('א')).toBe(true);
        expect(isHebrewLetter('ם')).toBe(false); // Sofit letters are not in HEBREW_LETTERS set, handled by removeSofit before check
        expect(isHebrewLetter('a')).toBe(false);
        expect(isHebrewLetter('1')).toBe(false);
    });

    test('stripAndReverse normalization', () => {
        // Reversed correctly with English and spaces stripped, sofit changed
        expect(stripAndReverse('תל אביב')).toBe('ביבאלת');
        expect(stripAndReverse('ראשון לציון')).toBe('נויצלנושאר'); // ן becomes נ
        expect(stripAndReverse('מודיעין-מכבים-רעות')).toBe('תוערמיבכמניעידומ');
        expect(stripAndReverse("מצפה לאה")).toBe("האלהפצמ");
        expect(stripAndReverse("מצפהלאה")).toBe("האלהפצמ");
        expect(stripAndReverse("םצפהלאה")).toBe("האלהפצמ");
    });

});




describe('readGameData', () => {

    test('reads real game_data.json and builds correct structure', () => {
        const raw = require('./data/game_data.json');
        const { db, canonicalToName } = readGameData(raw);

        // db is a Map with one entry per settlement
        expect(db).toBeInstanceOf(Map);
        expect(db.size).toBe(Object.keys(raw).length);

        // ── Spot-check db entry: "אלון מורה" (two outposts, no aliases) ──
        const alonMora = db.get('אלון מורה');
        expect(alonMora).toBeDefined();
        expect(alonMora.name).toBe('אלון מורה');
        expect(alonMora.aliases).toEqual([]);
        expect(alonMora.outposts).toContain('חוות סקאלי');
        expect(alonMora.outposts).toContain('שכונת הרחיבי');
        expect(alonMora.population).toBe('2170');
        expect(alonMora.establishment).toBe('1979');
        expect(typeof alonMora.x).toBe('number');
        expect(typeof alonMora.y).toBe('number');

        // ── Spot-check canonicalToName for "אלון מורה" ──
        expect(canonicalToName).toBeInstanceOf(Map);
        // key = toCanonical(name), value = [entry.name, originalVariant, tag]
        expect(canonicalToName.get('אלונמורה')).toEqual(['אלון מורה', 'אלון מורה']);
        expect(canonicalToName.get('חוותסקאלי')).toEqual(['אלון מורה', 'חוות סקאלי', 'outpost']);
        expect(canonicalToName.get('שכונתהרחיבי')).toEqual(['אלון מורה', 'שכונת הרחיבי', 'outpost']);

        // ── Spot-check: "איתמר" outpost ──
        const itamar = db.get('איתמר');
        expect(itamar).toBeDefined();
        expect(itamar.outposts).toContain('שיר חדש');
        expect(canonicalToName.get('שירחדש')).toEqual(['איתמר', 'שיר חדש', 'outpost']);
    });

    test('hardcoded data builds correct key-value structure', () => {
        const raw = {
            'אילת': {
                name: 'אילת',
                population: '56004',
                establishment: '1951',
                aliases: [],
                outposts: [],
                x: 98,
                y: 595,
            },
            'תל אביב -יפו': {
                name: 'תל אביב',
                population: '460000',
                establishment: '1909',
                aliases: ['יפו'],
                outposts: [],
                x: 90,
                y: 220,
            },
            'קרני שומרון': {
                name: 'קרני שומרון',
                population: '8000',
                establishment: '1978',
                aliases: [],
                outposts: ['מצפה צבאים'],
                x: 160,
                y: 190,
            },
        };

        const { db, canonicalToName } = readGameData(raw);

        expect(db.size).toBe(3);

        // ── db: plain settlement ──
        const eilat = db.get('אילת');
        expect(eilat.name).toBe('אילת');
        expect(eilat.aliases).toEqual([]);
        expect(eilat.outposts).toEqual([]);
        expect(eilat.population).toBe('56004');
        expect(eilat.establishment).toBe('1951');
        expect(eilat.x).toBe(98);
        expect(eilat.y).toBe(595);

        // ── db: settlement with alias ──
        const tlv = db.get('תל אביב -יפו');
        expect(tlv.name).toBe('תל אביב');
        expect(tlv.aliases).toEqual(['יפו']);
        expect(tlv.outposts).toEqual([]);

        // ── db: settlement with outpost ──
        const karni = db.get('קרני שומרון');
        expect(karni.outposts).toEqual(['מצפה צבאים']);
        expect(karni.aliases).toEqual([]);

        // ── canonicalToName: names (key = toCanonical, value = [entry.name, original]) ──
        expect(canonicalToName.get('אילת')).toEqual(['אילת', 'אילת']);
        expect(canonicalToName.get('תלאביב')).toEqual(['תל אביב -יפו', 'תל אביב']);
        expect(canonicalToName.get('קרנישומרונ')).toEqual(['קרני שומרון', 'קרני שומרון']);

        // ── canonicalToName: alias ──
        expect(canonicalToName.get('יפו')).toEqual(['תל אביב -יפו', 'יפו']);

        // ── canonicalToName: outpost ──
        expect(canonicalToName.get('מצפהצבאימ')).toEqual(['קרני שומרון', 'מצפה צבאים', 'outpost']);

        // ── canonicalToName total: 3 names + 1 alias + 1 outpost = 5 entries ──
        expect(canonicalToName.size).toBe(5);
    });

});

// ────────────────────────────────────────────────────────────────────────────
// checkSequence tests
// ────────────────────────────────────────────────────────────────────────────
// canonicalToName keys (toCanonical = strip non-Hebrew + normalize sofit):
//   toCanonical("אילת")        = "אילת"
//   toCanonical("תל אביב")     = "תלאביב"
//   toCanonical("יפו")         = "יפו"
//   toCanonical("קרני שומרון") = "קרנישומרון"
//   toCanonical("מצפה צבאים")  = "מצפהצבאים"
//
// Values are [entry.name, originalVariant]:
//   "אילת"       → ["אילת",        "אילת"]
//   "תלאביב"     → ["תל אביב",     "תל אביב"]
//   "יפו"        → ["תל אביב",     "יפו"]      ← alias: entry.name is "תל אביב"
//   "קרנישומרון" → ["קרני שומרון", "קרני שומרון"]
//   "מצפהצבאים"  → ["קרני שומרון", "מצפה צבאים"] ← outpost: entry.name is "קרני שומרון"

describe('checkSequence', () => {

    let canonicalToName;

    beforeEach(() => {
        const raw = {
            'אילת': {
                name: 'אילת', population: '56004', establishment: '1951',
                aliases: [], outposts: [], x: 98, y: 595
            },
            'תל אביב -יפו': {
                name: 'תל אביב', population: '460000', establishment: '1909',
                aliases: ['יפו'], outposts: [], x: 90, y: 220
            },
            'קרני שומרון': {
                name: 'קרני שומרון', population: '8000', establishment: '1978',
                aliases: [], outposts: ['מצפה צבאים'], x: 160, y: 190
            },
        };
        ({ canonicalToName } = readGameData(raw));
    });

    function run(string, forbidden = []) {
        const results = [];
        checkSequence(string, canonicalToName, forbidden, [], results);
        return results;
    }

    test('"ת" is a valid partial for "תל אביב" (canonical "תלאביב" starts with "ת")', () => {
        const results = run('ת');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: [],
            forbidden: [],
            lastCanonical: 'תלאביב',
            letter: 'ל',
            lettersUntilEnd: 5,
            isBeginOfSettlement: false,
        });
    });

    test('"ב" has NO result — no canonical key starts with "ב"', () => {
        const results = run('ב');
        expect(results).toHaveLength(0);
    });

    test('full key consumed, then partial — sequence and forbidden are tracked', () => {
        // "אילת" + "ת" → consume canonical "אילת", remaining "ת" → partial "תלאביב"
        const results = run('אילתת');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: ['אילת'],
            forbidden: ['אילת'],
            lastCanonical: 'תלאביב',
            letter: 'ל',
            lettersUntilEnd: 5,
            isBeginOfSettlement: false,
        });
    });

    test('alias canonical key is consumed as a full key', () => {
        // "יפו" + "א" → consume canonical "יפו" (alias), remaining "א" → partial "אילת"
        const results = run('יפוא');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: ['יפו'],
            forbidden: ['תל אביב -יפו'],   // canon key is forbidden
            lastCanonical: 'אילת',
            letter: 'י',
            lettersUntilEnd: 3,
            isBeginOfSettlement: false,
        });
    });

    test('outpost canonical key is consumed as a full key', () => {
        // "מצפהצבאים" + "ת" → consume outpost, remaining "ת" → partial "תלאביב"
        const results = run('מצפהצבאימת');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: ['מצפהצבאימ'],
            forbidden: ['קרני שומרון'],   // canon key is forbidden
            lastCanonical: 'תלאביב',
            letter: 'ל',
            lettersUntilEnd: 5,
            isBeginOfSettlement: false,
        });
    });

    test('no-repeat: same settlement name cannot appear twice in the sequence', () => {
        // "אילת" + "אילת" = "אילתאילת" (no sofit in אילת)
        const results = run('אילתאילת');
        expect(results).toHaveLength(0);
    });

    test('empty string — all non-forbidden canonical keys are valid continuations', () => {
        const results = run('');
        expect(results).toHaveLength(5);
        const canonicalSet = new Set(results.map(r => r.lastCanonical));
        expect(canonicalSet.has('אילת')).toBe(true);
        expect(canonicalSet.has('תלאביב')).toBe(true);
        expect(canonicalSet.has('יפו')).toBe(true);
        expect(canonicalSet.has('קרנישומרונ')).toBe(true);
        expect(canonicalSet.has('מצפהצבאימ')).toBe(true);
    });

    test('pre-populated forbidden list excludes those names from results', () => {
        const results = run('', ['תל אביב -יפו']);
        // "תלאביב" → entry.name="תל אביב", canon="תל אביב -יפו" (forbidden) ✗
        // "יפו"    → entry.name="תל אביב", canon="תל אביב -יפו" (forbidden) ✗
        expect(results).toHaveLength(3);
        expect(results.every(r => r.lastCanonical !== 'תלאביב' && r.lastCanonical !== 'יפו')).toBe(true);
    });

});
// ────────────────────────────────────────────────────────────────────────────
// checkSequence — ambiguous prefix tests
// ────────────────────────────────────────────────────────────────────────────
// "תל אביב" (canonical "תלאביב") and "תל מונד" (canonical "תלמונד") share
// the prefix "תל". The function must find ALL matching options.

describe('checkSequence — ambiguous prefix', () => {

    let canonicalToName;

    beforeEach(() => {
        const raw = {
            'תל אביב': {
                name: 'תל אביב', population: '460000', establishment: '1909',
                aliases: [], outposts: [], x: 90, y: 220
            },
            'תל מונד': {
                name: 'תל מונד', population: '5000', establishment: '1953',
                aliases: [], outposts: [], x: 88, y: 225
            },
            'אשדוד': {
                name: 'אשדוד', population: '220000', establishment: '1956',
                aliases: [], outposts: [], x: 100, y: 250
            },
        };
        // canonical keys: "תלאביב", "תלמונד", "אשדוד"
        ({ canonicalToName } = readGameData(raw));
    });

    function run(string, forbidden = []) {
        const results = [];
        checkSequence(string, canonicalToName, forbidden, [], results);
        return results;
    }

    test('partial "תל" matches both "תל אביב" and "תל מונד"', () => {
        const results = run('תל');
        expect(results).toHaveLength(2);
        const canonicals = results.map(r => r.lastCanonical).sort();
        expect(canonicals).toEqual(['תלאביב', 'תלמונד'].sort());
    });

    test('consuming "תל אביב" then partial "תל" only matches "תל מונד"', () => {
        const results = run('תלאביבתל');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: ['תלאביב'],
            forbidden: ['תל אביב'],
            lastCanonical: 'תלמונד',
            letter: 'מ',
            lettersUntilEnd: 4,
            isBeginOfSettlement: false,
        });
    });

    test('full chain: "תל אביב" then "תל מונד" then partial "א" for "אשדוד"', () => {
        const results = run('תלאביבתלמונדא');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: ['תלאביב', 'תלמונד'],
            forbidden: ['תל אביב', 'תל מונד'],
            lastCanonical: 'אשדוד',
            letter: 'ש',
            lettersUntilEnd: 4,
            isBeginOfSettlement: false,
        });
    });

    test('"תל מונד" can be first: partial "תל" then only "תל אביב" remains', () => {
        const results = run('תלמונדתל');
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({
            sequence: ['תלמונד'],
            forbidden: ['תל מונד'],
            lastCanonical: 'תלאביב',
            letter: 'א',
            lettersUntilEnd: 4,
            isBeginOfSettlement: false,
        });
    });

});

// ────────────────────────────────────────────────────────────────────────────
// readGameData — double-letter (יי / וו) canonical variant tests
// ────────────────────────────────────────────────────────────────────────────

describe('readGameData — double-letter canonical variants', () => {

    let canonicalToName;

    beforeEach(() => {
        const raw = {
            'נחלייה': {
                name: 'נחלייה', population: '5000', establishment: '1950',
                aliases: [], outposts: [], x: 50, y: 50
            },
            'חוות נוף': {
                name: 'חוות נוף', population: '3000', establishment: '1990',
                aliases: [], outposts: [], x: 60, y: 60
            },
            'כרמל': {
                name: 'כרמל', population: '40000', establishment: '1920',
                aliases: ['כרמליי'], outposts: [], x: 70, y: 70
            },
            'עמק': {
                name: 'עמק', population: '10000', establishment: '1960',
                aliases: ['מי-יד'], outposts: [], x: 80, y: 80
            },
        };
        ({ canonicalToName } = readGameData(raw));
    });

    test('double יי in name adds single-י variant', () => {
        expect(canonicalToName.get('נחלייה')).toEqual(['נחלייה', 'נחלייה']);
        expect(canonicalToName.get('נחליה')).toEqual(['נחלייה', 'נחלייה', 'short']);
    });

    test('double וו in name adds single-ו variant', () => {
        expect(canonicalToName.get('חוותנופ')).toEqual(['חוות נוף', 'חוות נוף']);
        expect(canonicalToName.get('חותנופ')).toEqual(['חוות נוף', 'חוות נוף', 'short']);
    });

    test('double יי in alias adds single-י variant', () => {
        expect(canonicalToName.get('כרמליי')).toEqual(['כרמל', 'כרמליי']);
        expect(canonicalToName.get('כרמלי')).toEqual(['כרמל', 'כרמליי', 'short']);
    });

    test('hyphenated "מי-יד" does NOT produce a variant (original lacks adjacent יי)', () => {
        expect(canonicalToName.has('מיד')).toBe(false);
        expect(canonicalToName.get('מייד')).toEqual(['עמק', 'מי-יד']);
    });

    test('total size = 4 names + 2 aliases + 3 variants', () => {
        // 6 original entries + 3 variants (נחליה, חותנוף, כרמלי) = 9
        expect(canonicalToName.size).toBe(9);
    });

});

describe('checkSequence — full game data', () => {
    let canonicalToName;

    beforeEach(() => {
        const raw = require('./data/game_data.json');
        ({ canonicalToName } = readGameData(raw));
    });

    function run(string, forbidden = []) {
        const results = [];
        checkSequence(string, canonicalToName, forbidden, [], results);
        return results;
    }

    test('variant name "עין זיון" (shortened וו) is legal and evaluates correctly as partial string', () => {
        const results = run('עינזיו');

        // There may be other settlements in the real data that start with this.
        // We mainly want to ensure "עינזיונ" and "עינזיוונ" are present.
        const shortVariant = results.find(r => r.lastCanonical === 'עינזיונ');
        expect(shortVariant).toBeDefined();
        expect(shortVariant).toMatchObject({
            lastCanonical: 'עינזיונ',
            letter: 'נ',
            lettersUntilEnd: 1,
        });

        const fullVariant = results.find(r => r.lastCanonical === 'עינזיוונ');
        expect(fullVariant).toBeDefined();
        expect(fullVariant).toMatchObject({
            lastCanonical: 'עינזיוונ',
            letter: 'ו',
            lettersUntilEnd: 2,
        });
    });

    test('variant name "עין זיון" with continuing letters consumes the variant key', () => {
        // "עינזיונ" + "א" (testing overlap into anything starting with א in real data, such as אילת)
        const results = run('עינזיונא');

        // Ensure that there is at least one result where the sequence includes 'עינזיונ' 
        // and it tries to find a continuation starting with 'א' (e.g. אילת)
        const overlapsWithA = results.filter(r => r.sequence.includes('עינזיונ'));
        expect(overlapsWithA.length).toBeGreaterThan(0);

        const testCase = overlapsWithA.find(r => r.lastCanonical === 'אילת');
        expect(testCase).toBeDefined();
        expect(testCase).toMatchObject({
            sequence: ['עינזיונ'],
            forbidden: ['עין זיוון'],
            lastCanonical: 'אילת',
            letter: 'י',
        });
    });
});

// ────────────────────────────────────────────────────────────────────────────
// getComputerOptions and getUserOptions tests
// ────────────────────────────────────────────────────────────────────────────

describe('getComputerOptions and getUserOptions', () => {
    let canonicalToName;

    beforeEach(() => {
        const raw = {
            'תל אביב': {
                name: 'תל אביב', population: '100', establishment: '1900',
                aliases: [], outposts: ['תל אבנימ'], x: 1, y: 1
            }
        };
        ({ canonicalToName } = readGameData(raw));
    });

    test('getComputerOptions filters out metadata options when base options exist', () => {
        // "תל" matches both "תלאביב" and "תלאבנימ"
        const compOptions = getComputerOptions('תל', canonicalToName);
        expect(compOptions).toHaveLength(1);
        expect(compOptions[0].lastCanonical).toBe('תלאביב');
    });

    test('getComputerOptions falls back to metadata option if no base option exists', () => {
        // "תלאבנ" only matches "תלאבנימ" (outpost)
        const compOptions = getComputerOptions('תלאבנ', canonicalToName);
        expect(compOptions).toHaveLength(1);
        expect(compOptions[0].lastCanonical).toBe('תלאבנימ');
    });

    test('getUserOptions returns allOptions with meta and compOptions without meta', () => {
        const { allOptions, compOptions } = getUserOptions('תל', canonicalToName);
        expect(allOptions).toHaveLength(2);
        const allCanons = allOptions.map(o => o.lastCanonical).sort();
        expect(allCanons).toEqual(['תלאביב', 'תלאבנימ'].sort());

        expect(compOptions).toHaveLength(1);
        expect(compOptions[0].lastCanonical).toBe('תלאביב');
    });

    test('Sequence "אלוןייטב" is always valid for computer and user after each letter', () => {
        const { removeSofit } = require('./logic.js');
        const raw = require('./data/game_data.json');
        const { canonicalToName } = readGameData(raw);

        const rawSeq = 'אלוןייטב';
        let currentString = '';

        for (let i = 0; i < rawSeq.length; i++) {
            currentString += removeSofit(rawSeq[i]);
            const compOpts = getComputerOptions(currentString, canonicalToName);
            const { allOptions } = getUserOptions(currentString, canonicalToName);

            // Expect that both computer and user have valid options
            expect(compOpts.length).toBeGreaterThan(0);
            expect(allOptions.length).toBeGreaterThan(0);
        }
    });

    test('Sequence "חצורהגלילית" is always valid for computer and user after each letter', () => {
        const { removeSofit } = require('./logic.js');
        const raw = require('./data/game_data.json');
        const { canonicalToName } = readGameData(raw);

        const rawSeq = 'חצורהגלילית';
        let currentString = '';

        for (let i = 0; i < rawSeq.length; i++) {
            currentString += removeSofit(rawSeq[i]);
            const compOpts = getComputerOptions(currentString, canonicalToName);
            const { allOptions } = getUserOptions(currentString, canonicalToName);

            // Expect that both computer and user have valid options
            expect(compOpts.length).toBeGreaterThan(0);
            expect(allOptions.length).toBeGreaterThan(0);
        }
    });
});
