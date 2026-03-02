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

        // An ambient, evolving drone using two detuned sine oscillators

        this.bgmGain = this.audioCtx.createGain();
        // Very quiet drone
        this.bgmGain.gain.value = 0.05;
        this.bgmGain.connect(this.masterGain);

        this.bgmOsc1 = this.audioCtx.createOscillator();
        this.bgmOsc1.type = 'sine';
        this.bgmOsc1.frequency.value = 110; // A2
        this.bgmOsc1.connect(this.bgmGain);

        this.bgmOsc2 = this.audioCtx.createOscillator();
        this.bgmOsc2.type = 'sine';
        this.bgmOsc2.frequency.value = 111.5; // Slight detune for phasing/beating
        this.bgmOsc2.connect(this.bgmGain);

        // Slowly modulate the gain to make it "breathe"
        const now = this.audioCtx.currentTime;
        this.bgmGain.gain.setValueAtTime(0, now);
        this.bgmGain.gain.linearRampToValueAtTime(0.05, now + 3); // Fade in over 3s

        // Loop a breath cycle using an LFO on the gain
        this.lfo = this.audioCtx.createOscillator();
        this.lfo.type = 'sine';
        this.lfo.frequency.value = 0.05; // 20-second cycle

        this.lfoGain = this.audioCtx.createGain();
        this.lfoGain.gain.value = 0.03; // Depth of breath

        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.bgmGain.gain);

        this.bgmOsc1.start();
        this.bgmOsc2.start();
        this.lfo.start();
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
    _playNote(freq, type = 'sine', duration = 0.1, vol = 0.5, slideFreq = null) {
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
        // Quick attack, exponential decay
        gain.gain.linearRampToValueAtTime(vol, this.audioCtx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioCtx.currentTime + duration);
    }

    // Soft blip when user types a letter
    playUserSelect() {
        this._playNote(440, 'sine', 0.1, 0.1, 300); // 440 -> 300
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
