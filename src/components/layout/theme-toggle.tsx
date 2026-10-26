"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(next);
    document.cookie = `luxe_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
    window.dispatchEvent(new Event("luxe-theme"));
  };
  return (
    <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-xl border border-line/60 text-muted transition hover:border-gold/50 hover:text-gold" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
