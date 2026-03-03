"use client";

import { useState, useEffect, useCallback } from "react";

interface UseKeyboardNavigationProps {
  itemCount: number;
  onSelect: (index: number) => void;
  onAction?: (key: string, index: number) => void;
  enabled?: boolean;
}

interface UseKeyboardNavigationReturn {
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
}

export function useKeyboardNavigation({
  itemCount,
  onSelect,
  onAction,
  enabled = true,
}: UseKeyboardNavigationProps): UseKeyboardNavigationReturn {
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      // Don't interfere with inputs, textareas, or modals
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest("[role=dialog]")
      ) {
        return;
      }

      switch (e.key) {
        case "j":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, itemCount - 1));
          break;
        case "k":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          if (selectedIndex >= 0 && selectedIndex < itemCount) {
            e.preventDefault();
            onSelect(selectedIndex);
          }
          break;
        case "Escape":
          setSelectedIndex(-1);
          break;
        case "m":
        case "x":
          if (selectedIndex >= 0 && onAction) {
            e.preventDefault();
            onAction(e.key, selectedIndex);
          }
          break;
      }
    },
    [enabled, itemCount, selectedIndex, onSelect, onAction],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Reset selection when item count changes
  useEffect(() => {
    if (selectedIndex >= itemCount) {
      setSelectedIndex(Math.max(itemCount - 1, -1));
    }
  }, [itemCount, selectedIndex]);

  return { selectedIndex, setSelectedIndex };
}
