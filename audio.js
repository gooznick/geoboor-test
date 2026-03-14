class AudioManager {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioCtx.createGain();
        this.masterGain.connect(this.audioCtx.destination);

        // Default to unmuted, moderate volume
        this.masterGain.gain.value = 0.5;
        this.isMuted = false;

        // BGM state
        this.bgmOsc = null;
        this.bgmGain = null;
        this.isPlayingBgm = false;
    }

    // --- Core Utility ---

    // Browsers require a user gesture to start playing audio.
    // This should be called on the first user interaction.
    resume() {
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    }

    toggleMute() {
        this.resume();
        this.isMuted = !this.isMuted;
        // Smooth fade to prevent popping
        this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.5, this.audioCtx.currentTime, 0.05);

        // Toggle button UI if available
        const btn = document.getElementById('btn-audio');
        if (btn) {
            btn.textContent = this.isMuted ? '🔇' : '🔊';
            btn.classList.toggle('muted', this.isMuted);
        }
    }

    // --- Background Music ---

    playBgMusic() {
        this.resume();
        if (this.isPlayingBgm) return;
        this.isPlayingBgm = true;

        // The user requested to remove the background drone ("pumping sound")
        // Keeping this function mostly empty so state variables stay consistent.
    }

    stopBgMusic() {
        if (!this.isPlayingBgm) return;
        this.isPlayingBgm = false;

        const now = this.audioCtx.currentTime;
        if (this.bgmGain) {
            // Fade out
            this.bgmGain.gain.setTargetAtTime(0, now, 0.5);
        }

        setTimeout(() => {
            if (this.bgmOsc1) this.bgmOsc1.stop();
            if (this.bgmOsc2) this.bgmOsc2.stop();
            if (this.lfo) this.lfo.stop();

            if (this.bgmOsc1) this.bgmOsc1.disconnect();
            if (this.bgmOsc2) this.bgmOsc2.disconnect();
            if (this.bgmGain) this.bgmGain.disconnect();
            if (this.lfo) this.lfo.disconnect();
            if (this.lfoGain) this.lfoGain.disconnect();
        }, 1000);
    }

    // --- Sound Effects ---

    // Helper to play a quick synthesized note
    _playNote(freq, type = 'sine', duration = 0.1, vol = 0.5, slideFreq = null, attack = 0.02) {
        if (!this.audioCtx) return;
        if (this.isMuted) return;
        this.resume();

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
        if (slideFreq) {
            osc.frequency.exponentialRampToValueAtTime(slideFreq, this.audioCtx.currentTime + duration);
        }

        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        // Configurable attack, exponential decay
        gain.gain.linearRampToValueAtTime(vol, this.audioCtx.currentTime + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioCtx.currentTime + duration);
    }

    // Sharp click when user types a valid letter
    playUserSelect() {
        this._playNote(1200, 'square', 0.04, 0.08, 600, 0.005); // Higher pitch click
        // Start BGM on first keypress if not already playing
        if (!this.isPlayingBgm) {
            this.playBgMusic();
        }
    }

    // Distinct blip when computer plays its turn
    playComputerSelect() {
        this._playNote(300, 'square', 0.15, 0.05, 150); // Lower, rougher
    }

    // Happy ascending chord when finishing a settlement and scoring
    playPoints() {
        // C Major Arpeggio: C5, E5, G5, C6
        const delay = 0.08;
        setTimeout(() => this._playNote(523.25, 'triangle', 0.3, 0.2), 0);
        setTimeout(() => this._playNote(659.25, 'triangle', 0.3, 0.2), delay * 1000);
        setTimeout(() => this._playNote(783.99, 'triangle', 0.3, 0.2), delay * 2000);
        setTimeout(() => this._playNote(1046.50, 'triangle', 0.5, 0.3), delay * 3000);
    }

    // Fast, sparkly shimmer for easter egg
    playEasterEgg() {
        const notes = [1046.50, 1318.51, 1567.98, 2093.00, 2637.02, 3135.96]; // C6, E6, G6, C7, E7, G7
        notes.forEach((freq, idx) => {
            setTimeout(() => {
                this._playNote(freq, 'sine', 0.2, 0.1);
            }, idx * 40);
        });
    }

    // Gentle whoosh or bell for a clue
    playClue() {
        this._playNote(880, 'sine', 0.4, 0.1); // A5
        setTimeout(() => this._playNote(1318.51, 'sine', 0.6, 0.15), 100); // E6
    }

    // Playful double blip for the inactivity teaser
    playTeaserBlip() {
        this._playNote(659.25, 'sine', 0.1, 0.15); // E5
        setTimeout(() => this._playNote(783.99, 'sine', 0.15, 0.15), 120); // G5
    }

    // Sad descending minor sequence for game over
    playGameOver() {
        this.stopBgMusic();
        const delay = 0.3;
        // Descending D minor: A4, F4, D4, A3
        setTimeout(() => this._playNote(440.00, 'square', 0.5, 0.1), 0);
        setTimeout(() => this._playNote(349.23, 'square', 0.5, 0.1), delay * 1000);
        setTimeout(() => this._playNote(293.66, 'square', 0.5, 0.1), delay * 2000);
        // Long final note
        setTimeout(() => this._playNote(220.00, 'square', 1.5, 0.2, 100), delay * 3000);
    }
}
