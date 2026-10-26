"use client";
import { useEffect, useState } from "react";

/** Chart colours validated for CVD separation & contrast against each theme's surface (see docs/DESIGN.md). */
const THEMES = {
  dark: { c1: "#8b5cf6", c2: "#b08a22", warn: "#fbbf24", danger: "#f87171", grid: "rgba(62,48,92,0.5)", axis: "#706788", surface: "#110d1a", text: "#eeeaf7", muted: "#a097b8" },
  light: { c1: "#6d28d9", c2: "#a88416", warn: "#b47300", danger: "#dc2626", grid: "rgba(226,220,238,0.9)", axis: "#8c84a0", surface: "#ffffff", text: "#1a1426", muted: "#625a78" },
};

export function useChartTheme() {
  const [mode, setMode] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () => setMode(document.documentElement.classList.contains("light") ? "light" : "dark");
    read();
    window.addEventListener("luxe-theme", read);
    return () => window.removeEventListener("luxe-theme", read);
  }, []);
  return THEMES[mode];
}
