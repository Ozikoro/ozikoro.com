export type LearnerSettings = {
  theme: "light" | "dark";
  textSize: "normal" | "large" | "xlarge";
  audioSpeed: 0.75 | 1 | 1.25;
  reducedMotion: boolean;
  cultureNotes: boolean;
  keyboard: "igbo" | "ndebe" | "english";
};

export const defaultSettings: LearnerSettings = {
  theme: "light", textSize: "normal", audioSpeed: 1, reducedMotion: false, cultureNotes: true, keyboard: "igbo",
};

/** Applies display settings to the page. */
export function applySettings(s: LearnerSettings) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.classList.toggle("dark", s.theme === "dark");
  html.classList.toggle("reduce-motion", s.reducedMotion);
  html.style.fontSize = s.textSize === "xlarge" ? "125%" : s.textSize === "large" ? "112.5%" : "";
}
