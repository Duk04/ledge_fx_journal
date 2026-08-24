"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/components/theme-script";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { Button } from "@/components/ui/button";
import { useStoredState } from "@/lib/use-stored-state";

type Choice = "light" | "dark" | "system";

function isChoice(v: string): v is Choice {
  return v === "light" || v === "dark" || v === "system";
}

const ICONS: Record<Choice, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

/**
 * Three states, not two. "System" is the default and leaves the document
 * unstamped so prefers-color-scheme decides — which is what the token layer in
 * globals.css is built around. `ThemeScript` applies the stored value before
 * first paint; this control only has to keep the two in step.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useStoredState(THEME_STORAGE_KEY, "system" as const, isChoice);

  function apply(next: Choice) {
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
    setChoice(next);
    if (next === "system") {
      try {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } catch {
        /* the change still applies for this page view */
      }
    }
  }

  const Icon = ICONS[choice];

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Theme: ${choice}`}>
          <Icon />
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end" className="w-36">
        {(["light", "dark", "system"] as Choice[]).map((c) => (
          <DropdownItem key={c} onSelect={() => apply(c)} className="justify-between capitalize">
            {c}
            {choice === c ? <span className="text-brand">•</span> : null}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}
