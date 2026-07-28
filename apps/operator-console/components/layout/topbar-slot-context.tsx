"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Trading Bot has no per-route "portal into the header" mechanism, since
 * `AppShell` (and the sticky `Topbar` it owns) now lives once in the root
 * layout instead of being mounted per-page. Routes that need contextual
 * title/description/actions/meta/tabs (currently Execution's Paper/Live
 * sub-nav and the Promotions page) set them here; the root layout forwards
 * the current slot into `AppShell`'s `topbar` prop bag.
 *
 * Modeled after gpool's `NavCenterContext` (apps/ui/src/contexts/NavCenterContext.tsx):
 * a page calls `setTopbarSlot` in a `useEffect` and clears it (`setTopbarSlot(null)`)
 * on cleanup so the header doesn't show stale content after navigating away.
 */
export type TopbarSlot = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  tabs?: ReactNode;
  /** Mode switch for the screen — e.g. Execution's Paper/Live. */
  mode?: ReactNode;
};

interface TopbarSlotContextValue {
  slot: TopbarSlot;
  setTopbarSlot: (slot: TopbarSlot | null) => void;
}

const EMPTY_SLOT: TopbarSlot = {};

const TopbarSlotContext = createContext<TopbarSlotContextValue>({
  slot: EMPTY_SLOT,
  setTopbarSlot: () => {},
});

export function TopbarSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<TopbarSlot>(EMPTY_SLOT);

  // Stable identity across renders — pages pass this to useEffect deps, and
  // an identity that changed on every Provider render (e.g. a plain inline
  // arrow function) would refire those effects every time setSlot ran,
  // forming an infinite render loop.
  const setTopbarSlot = useCallback((next: TopbarSlot | null) => {
    setSlot(next ?? EMPTY_SLOT);
  }, []);

  return (
    <TopbarSlotContext.Provider value={{ slot, setTopbarSlot }}>
      {children}
    </TopbarSlotContext.Provider>
  );
}

export function useTopbarSlot() {
  return useContext(TopbarSlotContext);
}
