/**
 * useThinkingElapsed — live second counter for the active assistant run.
 *
 * Sources:
 *  - assistant-ui ThreadRuntime.unstable_on API (thread-runtime-core.d.ts)
 *  - Claude Code CLI spinner pattern (spinnerVerbs, ~/.claude/settings.json)
 */
import { useEffect, useRef, useState } from "react";
import { useThreadRuntime } from "@assistant-ui/react";

export function useThinkingElapsed(): number {
  const threadRuntime = useThreadRuntime();
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const clearTick = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const unsubStart = threadRuntime.unstable_on("runStart", () => {
      clearTick();
      setElapsed(0);
      intervalRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    });

    const unsubEnd = threadRuntime.unstable_on("runEnd", () => {
      clearTick();
    });

    return () => {
      unsubStart();
      unsubEnd();
      clearTick();
    };
  }, [threadRuntime]);

  return elapsed;
}
