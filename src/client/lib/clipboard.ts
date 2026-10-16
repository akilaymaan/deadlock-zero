import { useCallback, useEffect, useRef, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

/** Copy text to the clipboard and expose an honest per-key result (no silent success). */
export function useCopy(): { state: Record<string, CopyState>; copy: (key: string, text: string) => Promise<void> } {
  const [state, setState] = useState<Record<string, CopyState>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearTimeout(timer);
    };
  }, []);

  const copy = useCallback(async (key: string, text: string) => {
    let result: CopyState = 'copied';
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch {
      result = 'failed';
    }
    setState((previous) => ({ ...previous, [key]: result }));
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);
    timers.current.set(
      key,
      setTimeout(() => setState((previous) => ({ ...previous, [key]: 'idle' })), 2_000),
    );
  }, []);

  return { state, copy };
}
