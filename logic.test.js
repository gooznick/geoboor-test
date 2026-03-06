const { chooseAll, stripAndReverse, isHebrewLetter, nameVariants, getVariants, buildDictionaries, checkEasterEggs } = require('./logic.js');

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
        expect(stripAndReverse("םץףה לאה")).toBe("האלהפצמ");

    });

    // Shared mock dataset and structures for game state
    let rawData;
    let keyVariantMap;
    let allVariantKeys;
    let baseVariantKeys;
    let outpostKeys;
    let forbidCanon;

    beforeEach(() => {
        rawData = {
            "תל אביב -יפו": {
                "name": "תל אביב",
                "aliases": ["יפו"]
            },
            "אילת": {
                "name": "אילת",
                "aliases": []
            },
            "רביבים": {
                "name": "רביבים",
                "aliases": []
            },
            "גוויאדה": { // Settlement with double vav
                "name": "גוויאדה",
                "aliases": []
            },
            "קרני שומרון": {
                "name": "קרני שומרון",
                "aliases": [],
                "outposts": ["מצפה צבאים"]
            }
        };

        // Simulate game init() using the shared logic function
        const dicts = buildDictionaries(rawData);
        keyVariantMap = dicts.keyVariantMap;
        allVariantKeys = dicts.allVariantKeys;
        baseVariantKeys = dicts.baseVariantKeys;
        outpostKeys = dicts.outpostKeys;
        forbidCanon = new Set();
    });

    test('chooseAll handles empty string with full dataset', () => {
        // Test chooseAll with an empty string, passing baseVariantKeys
        const options = chooseAll('', allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys);

        // We have 4 canon settlements, and 1 alias. So 5 base names.
        // "גוויאדה" yields variants: "גוויאדה" and "גויאדה".
        // Base names reversed (with sofit replacement):
        // תל אביב -> ביבאלת
        // יפו -> ופי
        // אילת -> תליא
        // רביבים -> מיביבר
        // גוויאדה -> הדאיווג
        // גויאדה -> הדאיוג
        // Total variants = 6.
        // Options contain 5 items now because variants are excluded from the empty string proposal.

        expect(options.length).toBe(6);
        expect(options.length).toBeGreaterThan(Object.keys(rawData).length); // More options than raw dictionary keys 

        // 2. Check examples of names and aliases
        const optionKeys = options.map(o => o.key);
        expect(optionKeys).toContain(stripAndReverse("תל אביב"));
        expect(optionKeys).toContain(stripAndReverse("אילת"));
        expect(optionKeys).toContain(stripAndReverse("יפו")); // Alias is included

        // 3. Check that וו replacements are not in the list the computer chooses
        // The new architecture uses baseKeySet to only propose exact original aliases and names!
        expect(optionKeys).toContain(stripAndReverse("גוויאדה"));
        expect(optionKeys).not.toContain(stripAndReverse("גויאדה")); // Variant correctly excluded
    });

    test('chooseAll handles full overlapping matches (e.g. רביבים)', () => {
        // When the user has fully typed "רביבים", the reversed string is "מיביבר".
        // The game should recognize "רביבים" is fully consumed, mark it in `former`, 
        // and propose the next valid components matching the leftover string (which is empty string).

        const current = stripAndReverse("רביבים"); // 'מיביבר'
        const options = chooseAll(current, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys);

        // Options should now propose all OTHER settlements (since the leftover is empty, 
        // it can transition into any base settlement that isn't רביבים).

        // Explicitly check the exact options returned
        expect(options).toHaveLength(5);

        expect(options).toEqual(expect.arrayContaining([
            { letter: 'ת', key: stripAndReverse("תל אביב"), former: [current] },
            { letter: 'א', key: stripAndReverse("אילת"), former: [current] },
            { letter: 'י', key: stripAndReverse("יפו"), former: [current] },
            { letter: 'ג', key: stripAndReverse("גוויאדה"), former: [current] },
            { letter: 'ק', key: stripAndReverse("קרני שומרון"), former: [current] },
        ]));
    });

    test('chooseAll correctly identifies legal and illegal strings', () => {
        // Helper function to check if a Hebrew string (read left-to-right by user) is legal
        // If chooseAll returns options > 0, the string is a valid prefix/path.
        const isLegal = (hebrewString) => {
            const reversed = stripAndReverse(hebrewString);
            const options = chooseAll(reversed, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys);
            return options.length > 0;
        };

        // LEGAL strings:
        expect(isLegal("רביב")).toBe(true);
        expect(isLegal("רביבי")).toBe(true);
        expect(isLegal("רביבים")).toBe(true);
        expect(isLegal("רביביםת")).toBe(true); // תל אביב overlapping starting with ת
        expect(isLegal("רביביםיפ")).toBe(true); // יפו overlapping
        expect(isLegal("יפותלאביב")).toBe(true); // יפו overlapping into תל אביב
        expect(isLegal("גוויאדהתל")).toBe(true); // גוויאדה into תל אביב
        expect(isLegal("גויאדה")).toBe(true); // The variant itself is legal to type
        expect(isLegal("גויאדהיפ")).toBe(true); // Variant overlapping into יפו

        // ILLEGAL strings:
        expect(isLegal("רביביםרבי")).toBe(false); // Can't reuse רביבים
        // expect(isLegal("גוויאדהגו")).toBe(false); // TODO: Can't reuse גוויאדה (assuming גויאדה maps to same canon)
        expect(isLegal("ע")).toBe(false); // No settlement starts with ע
        expect(isLegal("יפע")).toBe(false); // יפו ends, no settlement starts with ע
        expect(isLegal("יפוע")).toBe(false);
        expect(isLegal("תלאביביפוס")).toBe(false); // Overlapping chain valid until ס which breaks it
    });

    test('chooseAll prefers base variations when user input matches both base and variant of same settlement', () => {
        // User typed "ג", the computer should propose "גוויאדה" (base) but NOT "גויאדה" (single vav variant).
        const current = stripAndReverse("ג");
        const options = chooseAll(current, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys);

        const optionKeys = options.map(o => o.key);
        expect(optionKeys).toHaveLength(1);
        expect(optionKeys).toContain(stripAndReverse("גוויאדה"));
        expect(optionKeys).not.toContain(stripAndReverse("גויאדה"));

        // User typed "גוי" which ONLY matches the single-vav variant "גויאדה".
        // The computer MUST propose the variant because the base "גוויאדה" no longer matches.
        const currentVariant = stripAndReverse("גוי");
        const optionsVariant = chooseAll(currentVariant, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys);

        const optionKeysVariant = optionsVariant.map(o => o.key);
        expect(optionKeysVariant).toHaveLength(1);
        expect(optionKeysVariant).toContain(stripAndReverse("גויאדה"));
        expect(optionKeysVariant).not.toContain(stripAndReverse("גוויאדה"));
    });

    test('checkEasterEggs correctly finds and awards points for easter eggs, handling variants properly', () => {
        const foundEggsSet = new Set();

        // Define a small easter egg DB using reversed keys (just like game.js parsed output)
        const easterEggData = {
            [stripAndReverse("רביבים")]: { msg: "Found Revivim!", points: 100 },
            [stripAndReverse("גוויאדה")]: { msg: "Found Gviada!", points: 50 },
            [stripAndReverse("אילת")]: { msg: "Eilat bonus!", points: 10 }
        };

        // 1. Exact string match ("רביבים" -> RTL "מיביבר")
        const current1 = stripAndReverse("רביבים");
        const found1 = checkEasterEggs(current1, easterEggData, keyVariantMap, foundEggsSet);

        expect(found1).toHaveLength(1);
        expect(found1[0].points).toBe(100);
        expect(found1[0].msg).toBe("Found Revivim!");
        expect(foundEggsSet.has(stripAndReverse("רביבים"))).toBe(true);

        // 2. Typing the EXACT SAME string again shouldn't trigger, because it's recorded in foundEggsSet
        const found2 = checkEasterEggs(current1, easterEggData, keyVariantMap, foundEggsSet);
        expect(found2).toHaveLength(0);

        // 3. Prefixing the same matched string to mimic game progress should NOT re-trigger
        const current2 = stripAndReverse("עיררביבים"); // 'מיביברריע'
        const found3 = checkEasterEggs(current2, easterEggData, keyVariantMap, foundEggsSet);
        expect(found3).toHaveLength(0);

        // 4. Variant matching flexibility! 
        // Our easter egg was explicitly registered for the base variant "גוויאדה" (double-vav).
        // Let's type out the single-vav generic variant "גויאדה"
        const current3 = stripAndReverse("גויאדה"); // RTL 'הדאיוג'
        const found4 = checkEasterEggs(current3, easterEggData, keyVariantMap, foundEggsSet);

        expect(found4).toHaveLength(1); // STILL triggers the egg successfully because their canonical settlements map to the same id!
        expect(found4[0].points).toBe(50);
        expect(foundEggsSet.has(stripAndReverse("גוויאדה"))).toBe(true);
    });

    test('Outposts are ignored by computer default suggestions but accepted if the user overlaps into them', () => {
        // "מצפה צבאים" -> reversed is "םיאבצ הפצמ" -> "מיאבצהפצמ"

        // 1. Ensure the computer won't suggest the outpost on an empty string
        const emptyOptions = chooseAll('', allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys, outpostKeys);
        const emptyOptionKeys = emptyOptions.map(o => o.key);
        expect(emptyOptionKeys).not.toContain(stripAndReverse("מצפה צבאים"));

        // 2. Ensure if the user types part of it (e.g. "מ" which is "מ" in reversed string)
        // Since "מ" could be the start of "מצפה צבאים", we want to ensure the game recognizes it as a valid path.
        // User string building RTL: if user types 'מ' it becomes 'מ'.
        const userTypesM = stripAndReverse("מ"); // just "מ"
        const optionsM = chooseAll(userTypesM, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys, outpostKeys);

        // Explicit check: letter, key, and former for outposts acting as a first match
        expect(optionsM).toEqual(
            expect.arrayContaining([
                {
                    letter: 'צ',
                    key: stripAndReverse("מצפה צבאים"),
                    former: []
                }
            ])
        );

        // However, if we filter outposts like game.js does for the computer's choice:
        const compOptionsFilteredM = optionsM.filter(opt => !outpostKeys.has(opt.key));
        expect(compOptionsFilteredM.some(o => o.key === stripAndReverse("מצפה צבאים"))).toBe(false);

        // 3. User types an outpost AFTER a regular settlement:
        // Regular settlement is "תל אביב". User types "מ". Combined is "תל אביבמ".
        const userTypesOverlap = stripAndReverse("תל אביבמ");
        const optionsOverlap = chooseAll(userTypesOverlap, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys, outpostKeys);

        // Explicit check: letter, key, and former showing previous settlement in chain
        expect(optionsOverlap).toEqual(
            expect.arrayContaining([
                {
                    letter: 'צ',
                    key: stripAndReverse("מצפה צבאים"),
                    former: [stripAndReverse("תל אביב")]
                }
            ])
        );

        // 4. User is FORCED into the outpost (e.g. they typed "מצפה צב")
        // User string "מצפה צב" -> "בצהפצמ"
        const userForced = stripAndReverse("מצפה צב");
        const optionsForced = chooseAll(userForced, allVariantKeys, forbidCanon, keyVariantMap, [], baseVariantKeys, outpostKeys);

        expect(optionsForced).toEqual(
            expect.arrayContaining([
                {
                    letter: 'א',
                    key: stripAndReverse("מצפה צבאים"),
                    former: []
                }
            ])
        );

        // The game loop in game.js filters outposts ONLY if non-outposts exist.
        // At "מצפה צב", the only matching base/variant in our test DB is "מצפה צבאים".
        expect(optionsForced.length).toBeGreaterThan(0);

        // We simulate the game.js extraction logic
        const nonOutpostForced = optionsForced.filter(opt => !outpostKeys.has(opt.key));
        expect(nonOutpostForced).toHaveLength(0); // No regular settlements match "מצפה צב"

        const finalCompOptions = nonOutpostForced.length > 0 ? nonOutpostForced : optionsForced;
        expect(finalCompOptions).toHaveLength(1);
        expect(finalCompOptions[0].key).toBe(stripAndReverse("מצפה צבאים"));
    });

    test('Outposts chain terminal state allows final character gracefully', () => {
        // Reproducing bug: "מעוזאסתרמעלהשלמהמצפהלא" + "ה" was rejected because no further continuation
        // exists for "מצפה לאה", and there are no other settlements in the entire universe.
        const mockBugData = {
            "כוכב השחר": {
                "name": "כוכב השחר",
                "aliases": [],
                "outposts": [
                    "מעוז אסתר",
                    "מעלה שלמה",
                    "אעירה שחר",
                    "מצפה לאה"
                ]
            },
        };
        const dicts = buildDictionaries(mockBugData);

        // Scenario 1: User typed "מעוזאסתרמעלהשלמהמצפהלא" (missing the final 'ה' of the 3rd outpost)
        const typedPartial = "מעוזאסתרמעלהשלמהמצפהלא";
        const reversedPartial = stripAndReverse(typedPartial);
        const optionsPartial = chooseAll(reversedPartial, dicts.allVariantKeys, new Set(), dicts.keyVariantMap, [], dicts.baseVariantKeys, dicts.outpostKeys);

        // Exact expectation: The computer should propose 'ה' to finish "מצפה לאה"
        expect(optionsPartial).toEqual([
            {
                letter: 'ה',
                key: stripAndReverse("מצפה לאה"),
                former: [stripAndReverse("מעוז אסתר"), stripAndReverse("מעלה שלמה")]
            }
        ]);

        // With ה: "מעוזאסתרמעלהשלמהמצפהלאה"
        // It forms a completed exact match, but doesn't overlap into any untouched remaining settlement.
        // It SHOULD return an object indicating the path is valid but terminal (letter: undefined/null).
        const typedFull = "מעוזאסתרמעלהשלמהמצפהלאה";
        const reversedFull = stripAndReverse(typedFull);
        const optionsFull = chooseAll(reversedFull, dicts.allVariantKeys, new Set(), dicts.keyVariantMap, [], dicts.baseVariantKeys, dicts.outpostKeys);

        expect(optionsFull).toEqual([
            {
                letter: 'כ',
                key: stripAndReverse("כוכב השחר"),
                former: [stripAndReverse("מעוז אסתר"), stripAndReverse("מעלה שלמה"), stripAndReverse("מצפה לאה")]
            }
        ]);

        // The critical bug check: The sequence should NOT return an empty array (which indicates invalid typing)
        expect(optionsFull.length).toBeGreaterThan(0);


        const typedFull1 = "מצפהלאה";
        const reversedFull1 = stripAndReverse(typedFull1);
        const optionsFull1 = chooseAll(reversedFull1, dicts.allVariantKeys, new Set(), dicts.keyVariantMap, [], dicts.baseVariantKeys, dicts.outpostKeys);

        expect(optionsFull1).toEqual([
            {
                letter: 'כ',
                key: stripAndReverse("כוכב השחר"),
                former: [stripAndReverse("מצפה לאה")]
            }
        ]);

        // The critical bug check: The sequence should NOT return an empty array (which indicates invalid typing)
        expect(optionsFull1.length).toBeGreaterThan(0);
    });

    test('Bug Reproduction: Omitting outpostKeys causes chooseAll to incorrectly forbid parent settlement', () => {
        const mockData = {
            "כוכב השחר": {
                "name": "כוכב השחר",
                "aliases": [],
                "outposts": ["מעוז אסתר",
                    "מעלה שלמה",
                    "אעירה שחר",
                    "מצפה לאה"]
            }
        };
        const dicts = buildDictionaries(mockData);
        const userCurrent = stripAndReverse("מצפהלאה");

        // 1. Without passing outpostKeys (simulates the bug in game.js)
        // Since chooseAll does NOT use globals, falling back to the default `new Set()` 
        // means it treats the outpost like a normal settlement. And since a normal settlement 
        // can't be played twice, it forbids its canonical parent!
        const optionsMissingArg = chooseAll(userCurrent, dicts.allVariantKeys, new Set(), dicts.keyVariantMap, [], dicts.baseVariantKeys);
        expect(optionsMissingArg.length).toBe(0); // Fails exactly like the user's game.js log

        // 2. Passing outpostKeys correctly evaluates it as an outpost and suggests the parent
        const optionsWithArg = chooseAll(userCurrent, dicts.allVariantKeys, new Set(), dicts.keyVariantMap, [], dicts.baseVariantKeys, dicts.outpostKeys);
        expect(optionsWithArg.length).toBeGreaterThan(0);
        expect(optionsWithArg[0].key).toBe(stripAndReverse("כוכב השחר"));
    });

});


