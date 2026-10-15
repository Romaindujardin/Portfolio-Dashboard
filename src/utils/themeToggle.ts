import React from "react";

/**
 * Progressive circular reveal theme toggle (View Transitions API)
 * The trendy ripple expansion animation originating from the button click.
 */
export function toggleThemeWithTransition(
  event?: React.MouseEvent | MouseEvent,
  onThemeChanged?: (isDark: boolean) => void
) {
  const doc = document.documentElement;
  const isDark = doc.classList.contains("dark");
  const nextIsDark = !isDark;

  const applyTheme = () => {
    if (nextIsDark) {
      doc.classList.add("dark");
      localStorage.setItem("portfolio_theme", "dark");
    } else {
      doc.classList.remove("dark");
      localStorage.setItem("portfolio_theme", "light");
    }
    onThemeChanged?.(nextIsDark);
    window.dispatchEvent(
      new CustomEvent("themeChanged", { detail: { isDark: nextIsDark } })
    );
  };

  const isReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  const hasViewTransition =
    typeof (document as any).startViewTransition === "function";

  // Fallback if View Transitions API is not supported
  if (!hasViewTransition || isReducedMotion) {
    applyTheme();
    // Add smooth CSS transition class temporarily
    doc.classList.add("theme-transitioning");
    setTimeout(() => {
      doc.classList.remove("theme-transitioning");
    }, 450);
    return;
  }

  // Calculate coordinates of the click (or center of viewport as fallback)
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;

  if (event) {
    x = event.clientX;
    y = event.clientY;
  }

  // Radius to the farthest corner
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  const transition = (document as any).startViewTransition(() => {
    applyTheme();
  });

  transition.ready.then(() => {
    // Reveal the new theme in an expanding circle from the click position
    doc.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${endRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: 500,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        pseudoElement: "::view-transition-new(root)",
      }
    );
  });
}
