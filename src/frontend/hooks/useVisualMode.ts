import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";

type VisualModeGlobal = {
  __VISUAL_MODE__?: string;
};

let visualModeSticky: boolean | null = null;

const resolveVisualModeValue = (raw?: string | null): boolean | null => {
  const normalized = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;
  return null;
};

const resolveVisualModeSearch = (search: string): boolean | null => {
  if (!search) return null;
  const params = new URLSearchParams(search);
  const raw = params.get("visual") ?? params.get("screenshot");
  return resolveVisualModeValue(raw);
};

const resolveGlobalVisualMode = (): boolean | null => {
  const globalValue = (globalThis as VisualModeGlobal).__VISUAL_MODE__;
  return resolveVisualModeValue(globalValue);
};

export function useVisualMode(): boolean {
  const routerSearch = useRouterState({
    select: (state) => state.location.search,
  });
  const search = globalThis.location?.search ?? routerSearch;
  const explicit = resolveVisualModeSearch(search);
  if (explicit !== null) {
    visualModeSticky = explicit;
  }
  const visualMode = visualModeSticky ?? resolveGlobalVisualMode() ?? false;

  useEffect(() => {
    const root = document.documentElement;
    if (visualMode) {
      root.setAttribute("data-visual-mode", "true");
    } else {
      root.removeAttribute("data-visual-mode");
    }
  }, [visualMode]);

  return visualMode;
}
