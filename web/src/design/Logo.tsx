import { useId } from "react";

// The devdeck mark (brand/logo-mark-dark.svg). The prompt and the cursor use
// --mark-prompt / --mark-under so they follow the theme; a .mark-under rule
// (see splash.css) can animate the cursor. index.html carries the same markup
// for the boot splash, so keep the two in step.
export function Logo({ className, title = "devdeck" }: { className?: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg
      className={className}
      viewBox="-8 -8 336 336"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#054d58" />
          <stop offset=".42" stopColor="#02b3ae" />
          <stop offset="1" stopColor="#02f1c9" />
        </linearGradient>
        <linearGradient id={`${id}u`} x1="12" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#01d4d0" />
          <stop offset=".45" stopColor="#23ecca" />
          <stop offset=".8" stopColor="#68fbc9" />
          <stop offset="1" stopColor="#71fbb6" />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="12" y1="0" x2="320" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00efc7" />
          <stop offset=".45" stopColor="#01c1ac" />
          <stop offset=".72" stopColor="#048e8d" />
          <stop offset=".88" stopColor="#05545d" />
          <stop offset="1" stopColor="#0a6a70" />
        </linearGradient>
        <clipPath id={`${id}c`}>
          <path d="M12 0H195Q215 0 229 15L298 90Q320 115 320 165C320 250 260 320 185 320H12L92 244H185C250 244 280 190 270 173L175 76H92Z" />
        </clipPath>
      </defs>
      <path d="M0 8L80 84V236L0 312Z" fill={`url(#${id}s)`} />
      <path
        d="M12 0H195Q215 0 229 15L298 90Q320 115 320 165C320 250 260 320 185 320H12L92 244H185C250 244 280 190 270 173L175 76H92Z"
        fill={`url(#${id}u)`}
      />
      <g clipPath={`url(#${id}c)`}>
        <path d="M0 212L262 168L320 138H340V340H0Z" fill={`url(#${id}l)`} />
        <path d="M262 168L320 138" stroke="#ffffff" strokeOpacity=".28" strokeWidth="2" />
      </g>
      <path d="M118 128L152 160L118 192" fill="none" stroke="var(--mark-prompt)" strokeWidth="17" strokeLinecap="square" />
      <rect className="mark-under" x="166" y="186" width="54" height="16" rx="2" fill="var(--mark-under)" />
    </svg>
  );
}
