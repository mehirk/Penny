"use client";

import { cn } from "@/lib/utils";

/**
 * Money Town: each Learn topic is a building. Drawn in SVG with fixed colours (an illustration,
 * so it looks the same in every theme).
 */

type BuildingProps = { topic: string; className?: string };

export function Building({ topic, className }: BuildingProps) {
  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
      <ellipse cx="40" cy="76" rx="32" ry="3.5" fill="rgb(0 0 0 / 0.15)" />
      {BUILDINGS[topic] ?? BUILDINGS.budgeting}
    </svg>
  );
}

const BUILDINGS: Record<string, React.ReactNode> = {
  // A market stall with a striped awning.
  budgeting: (
    <g>
      <rect x="12" y="36" width="56" height="38" rx="3" fill="#f6e3c3" />
      <path d="M8 36 h64 l-6 -16 h-52 z" fill="#f0645a" />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${16 + i * 13} 20 l-3 16 h7 l3 -16 z`} fill="#fff" opacity="0.9" />
      ))}
      <rect x="20" y="46" width="16" height="12" rx="2" fill="#7fc8a9" />
      <rect x="44" y="46" width="16" height="28" rx="2" fill="#a35b2a" />
      <circle cx="56" cy="61" r="1.6" fill="#f5b82e" />
      <text x="40" y="31" textAnchor="middle" fontSize="8" fontWeight="700" fill="#fff">
        MARKET
      </text>
    </g>
  ),
  // A pink piggy bank.
  saving: (
    <g>
      <ellipse cx="40" cy="50" rx="30" ry="22" fill="#ff9fb6" />
      <circle cx="66" cy="48" r="8" fill="#ff8aa6" />
      <circle cx="64" cy="47" r="1.5" fill="#7a2d42" />
      <circle cx="68" cy="47" r="1.5" fill="#7a2d42" />
      <path d="M22 32 l4 -10 l8 8 z" fill="#ff8aa6" />
      <circle cx="54" cy="40" r="2.5" fill="#3b2506" />
      <rect x="32" y="28" width="14" height="4" rx="2" fill="#7a2d42" />
      <rect x="20" y="66" width="8" height="10" rx="3" fill="#ff8aa6" />
      <rect x="50" y="66" width="8" height="10" rx="3" fill="#ff8aa6" />
      <circle cx="39" cy="20" r="7" fill="#f5b82e" stroke="#c98a1c" strokeWidth="1.5" />
    </g>
  ),
  // A domed government office.
  tax: (
    <g>
      <path d="M22 34 q18 -26 36 0 z" fill="#8fb3ff" />
      <rect x="38" y="6" width="3" height="10" fill="#4a5568" />
      <path d="M41 6 h10 l-3 3 l3 3 h-10 z" fill="#f0645a" />
      <path d="M8 40 l32 -8 l32 8 z" fill="#dfe6f3" />
      <rect x="12" y="40" width="56" height="34" fill="#eef2f9" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={17 + i * 13} y="44" width="6" height="26" fill="#c6d1e6" />
      ))}
      <rect x="8" y="70" width="64" height="5" fill="#c6d1e6" />
    </g>
  ),
  // A card shop with a big card sign.
  credit: (
    <g>
      <rect x="10" y="30" width="60" height="44" rx="4" fill="#5b8def" />
      <rect x="16" y="12" width="48" height="26" rx="4" fill="#ffd34d" stroke="#c98a1c" strokeWidth="1.5" />
      <rect x="16" y="18" width="48" height="5" fill="#3b2506" opacity="0.8" />
      <rect x="22" y="28" width="12" height="5" rx="1.5" fill="#fff" />
      <rect x="18" y="44" width="18" height="14" rx="2" fill="#bcd3ff" />
      <rect x="44" y="44" width="18" height="30" rx="2" fill="#2f4f9a" />
      <circle cx="58" cy="60" r="1.6" fill="#ffd34d" />
    </g>
  ),
  // A courthouse tower with a shield.
  rules: (
    <g>
      <rect x="26" y="14" width="28" height="60" fill="#9aa7b8" />
      <path d="M22 16 l18 -12 l18 12 z" fill="#6b7a90" />
      <path
        d="M40 26 l12 4 v10 q0 10 -12 15 q-12 -5 -12 -15 v-10 z"
        fill="#19b394"
        stroke="#0e7d67"
        strokeWidth="1.5"
      />
      <path d="M35 39 l4 4 l7 -8" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="10" y="50" width="16" height="24" fill="#b8c3d1" />
      <rect x="54" y="50" width="16" height="24" fill="#b8c3d1" />
      <rect x="34" y="60" width="12" height="14" rx="6" fill="#4a5568" />
    </g>
  ),
  // A greenhouse with a growing money tree.
  investing: (
    <g>
      <path d="M10 74 v-30 l30 -26 l30 26 v30 z" fill="#c9f2e3" stroke="#7fc8a9" strokeWidth="2" />
      <path d="M40 18 v56 M10 44 h60" stroke="#7fc8a9" strokeWidth="1.5" />
      <rect x="37" y="52" width="6" height="22" fill="#8a5a10" />
      <circle cx="40" cy="44" r="13" fill="#19b394" />
      <circle cx="31" cy="50" r="8" fill="#22c38d" />
      <circle cx="49" cy="50" r="8" fill="#22c38d" />
      <circle cx="36" cy="40" r="3" fill="#f5b82e" />
      <circle cx="46" cy="46" r="3" fill="#f5b82e" />
    </g>
  ),
};

/**
 * The town skyline for the top of Learn: sky, the six buildings, and room on the left for Penny.
 * Children are drawn over the scene (the HUD).
 */
export function TownScene({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-card)] bg-[linear-gradient(180deg,#7cc4f5_0%,#b9e3ff_55%,#e6f6ff_100%)] shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <svg
        viewBox="0 0 400 120"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 size-full"
        aria-hidden="true"
      >
        <circle cx="350" cy="28" r="16" fill="#ffe27a" />
        <circle cx="350" cy="28" r="24" fill="#ffe27a" opacity="0.3" />
        <g fill="#fff" opacity="0.9">
          <ellipse cx="80" cy="24" rx="22" ry="8" />
          <ellipse cx="96" cy="20" rx="14" ry="8" />
          <ellipse cx="250" cy="34" rx="18" ry="6" />
          <ellipse cx="262" cy="30" rx="11" ry="6" />
        </g>
        <path d="M0 96 q60 -20 120 -6 t140 -4 t140 -8 v42 h-400 z" fill="#8fd18f" />
        <path d="M0 108 q80 -12 200 -2 t200 -4 v18 h-400 z" fill="#6fbf73" />
      </svg>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-1 flex items-end justify-end gap-0.5 pr-2 sm:gap-2 sm:pr-4"
        aria-hidden="true"
      >
        {["budgeting", "saving", "tax", "credit", "rules", "investing"].map((topic, index) => (
          <Building
            key={topic}
            topic={topic}
            className={cn(
              "shrink-0",
              index % 2 ? "size-12 sm:size-16" : "size-14 sm:size-20",
              index < 2 && "max-sm:hidden",
            )}
          />
        ))}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
