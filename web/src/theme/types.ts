/** The colours a person can change. Each stands for a few tokens in design/tokens.css; the rest are worked out from them. */
export const ROLES = [
  { id: "background", label: "Background", hint: "The page, and the sidebar." },
  { id: "cards", label: "Menus and panels", hint: "What floats above the page: menus, toasts, sheets." },
  { id: "controls", label: "Buttons and fields", hint: "Secondary buttons, inputs, the active menu item." },
  { id: "text", label: "Text", hint: "Titles and content. Softer text is worked out from it." },
  { id: "primary", label: "Primary button", hint: "The one blue action, links and the focus ring." },
  { id: "selected", label: "Selected", hint: "The selected tab and the active marker." },
  { id: "success", label: "Success", hint: "Running, passed, healthy." },
  { id: "warning", label: "Warning", hint: "Idle, slow, pending." },
  { id: "error", label: "Error", hint: "Crashed, failed, blocked." },
  { id: "neutral", label: "Neutral", hint: "Stopped, skipped." },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

/** The tokens a role does not set directly. They are worked out from the roles, and the Advanced list lets a person set any of them. */
export const ADVANCED = [
  { token: "--ink-2", label: "Soft text" },
  { token: "--ink-3", label: "Muted text" },
  { token: "--fill-hover", label: "Button hover" },
  { token: "--fill-press", label: "Button pressed" },
  { token: "--inset", label: "Inset background" },
  { token: "--primary-hover", label: "Primary button hover" },
  { token: "--on-primary", label: "Text on the primary button" },
  { token: "--link", label: "Links" },
  { token: "--focus", label: "Focus ring" },
  { token: "--serious", label: "Restarting (orange)" },
  { token: "--strip-ok", label: "Timeline: healthy" },
  { token: "--strip-idle", label: "Timeline: idle" },
  { token: "--strip-off", label: "Timeline: stopped" },
  { token: "--strip-bad", label: "Timeline: failing" },
  { token: "--sidebar", label: "Sidebar background" },
  { token: "--sidebar-foreground", label: "Sidebar text" },
  { token: "--sidebar-primary", label: "Sidebar active marker" },
  { token: "--sidebar-primary-foreground", label: "Sidebar active marker text" },
  { token: "--sidebar-accent", label: "Sidebar active item" },
  { token: "--sidebar-accent-foreground", label: "Sidebar active item text" },
  { token: "--sidebar-ring", label: "Sidebar focus ring" },
] as const;

export type AdvancedToken = (typeof ADVANCED)[number]["token"];

/** Anything a person can set a colour for: a role, or one of the Advanced tokens. */
export type ColorKey = RoleId | AdvancedToken;

/** The colours a theme changes, by role or by Advanced token. */
export type Colors = Partial<Record<ColorKey, string>>;

/** The themes that ship with devdeck, and the base every custom theme starts from. */
export type BaseId = "paper" | "paper-dark";

/** A theme as it is saved: only the colours the person changed; the rest come from the base. */
export type ThemeData = {
  schema: 1;
  id: string;
  name: string;
  base: BaseId;
  colors: Colors;
};

/** Every token a theme sets: a CSS variable name (`--bg`) to its value, plus `color-scheme`. */
export type TokenMap = Record<string, string>;
