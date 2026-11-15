import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'slither_sound_enabled';

export function useSound() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const ctxRef = useRef<AudioContext | null>(null);
  const lastOrbSoundAtRef = useRef<number>(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // ignore storage quota errors
    }
  }, [enabled]);

  const getContext = useCallback((): AudioContext | null => {
    if (!enabled || typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, [enabled]);

  const playTone = useCallback(
    (freq: number, duration: number, type: OscillatorType = 'sine', gainVal = 0.04) => {
      const ctx = getContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration);
    },
    [getContext]
  );

  const playOrbSound = useCallback(
    (deltaScore = 1) => {
      const now = performance.now();
      if (now - lastOrbSoundAtRef.current < 55) return;
      lastOrbSoundAtRef.current = now;
      const pitch = deltaScore >= 6 ? 780 : 600 + Math.min(240, deltaScore * 20);
      playTone(pitch, 0.045, 'sine', 0.024);
    },
    [playTone]
  );

  const playBoostSound = useCallback(() => {
    playTone(150, 0.07, 'triangle', 0.032);
  }, [playTone]);

  const playKillSound = useCallback(() => {
    playTone(587.33, 0.09, 'sine', 0.048);
    setTimeout(() => playTone(880, 0.14, 'sine', 0.05), 85);
  }, [playTone]);

  const playDeathSound = useCallback(() => {
    playTone(260, 0.1, 'triangle', 0.05);
    setTimeout(() => playTone(165, 0.18, 'triangle', 0.045), 90);
  }, [playTone]);

  const playStartSound = useCallback(() => {
    playTone(440, 0.09, 'sine', 0.04);
    setTimeout(() => playTone(554.37, 0.09, 'sine', 0.04), 80);
    setTimeout(() => playTone(659.25, 0.16, 'sine', 0.05), 160);
  }, [playTone]);

  const toggleSound = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return {
    soundEnabled: enabled,
    toggleSound,
    playOrbSound,
    playBoostSound,
    playKillSound,
    playDeathSound,
    playStartSound,
  };
}

