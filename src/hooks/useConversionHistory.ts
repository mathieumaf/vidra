import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { errorMessage } from "../lib/format";
import {
  clearConversionHistory,
  deleteHistoryEntry,
  listConversionHistory,
  revealHistoryOutput,
} from "../services/history";
import type { HistoryEntry } from "../types/media";

function mergeEntries(current: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const entries = new Map(current.map((entry) => [entry.id, entry]));
  incoming.forEach((entry) => entries.set(entry.id, entry));
  return [...entries.values()]
    .sort((left, right) => right.finishedAtMs - left.finishedAtMs)
    .slice(0, 200);
}

export function useConversionHistory() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let dispose: (() => void) | null = null;
    const subscription = listen<HistoryEntry>("history-entry-created", ({ payload }) => {
      if (active) setItems((current) => mergeEntries(current, [payload]));
    });

    void subscription
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        dispose = unlisten;
        try {
          const entries = await listConversionHistory();
          if (active) setItems((current) => mergeEntries(current, entries));
        } catch (loadError) {
          if (active) setError(errorMessage(loadError));
        } finally {
          if (active) setIsLoading(false);
        }
      })
      .catch((listenError: unknown) => {
        if (active) {
          setError(errorMessage(listenError));
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      dispose?.();
    };
  }, []);

  async function remove(id: string) {
    setError(null);
    const removed = items.find((entry) => entry.id === id);
    setItems((current) => current.filter((entry) => entry.id !== id));
    try {
      await deleteHistoryEntry(id);
    } catch (removeError) {
      if (removed) setItems((current) => mergeEntries(current, [removed]));
      setError(errorMessage(removeError));
    }
  }

  async function clear() {
    setError(null);
    const removed = items;
    setItems([]);
    try {
      await clearConversionHistory();
    } catch (clearError) {
      setItems((current) => mergeEntries(current, removed));
      setError(errorMessage(clearError));
    }
  }

  async function reveal(id: string) {
    setError(null);
    try {
      await revealHistoryOutput(id);
    } catch (revealError) {
      setError(errorMessage(revealError));
    }
  }

  return { items, isLoading, error, remove, clear, reveal };
}
