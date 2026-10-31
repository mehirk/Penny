"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, LogOut, Menu, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Plus, Settings, SlidersHorizontal, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Dashboard } from "@/lib/api";
import { formatMonth, greeting } from "@/lib/format";
import { getSupabaseUserEmail, signOutOfSupabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PALETTE_OPTIONS, type PaletteSetting, SURFACE_OPTIONS, type SurfaceSetting, THEME_OPTIONS, type ThemeSetting, usePreferences } from "./preferences";
import { type PeriodRange, PeriodPicker } from "./period-picker";
import { cad, NAVIGATION, type View } from "./shared";

const MONTH_VIEWS: View[] = ["today", "spending"];
export const THEME_ICONS: Record<ThemeSetting, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "N", action: "Add a transaction" },
  { keys: "[  ]", action: "Previous / next month" },
  { keys: "1 – 9", action: "Jump between sections" },
  { keys: "D", action: "Switch light / dark" },
  { keys: "?", action: "Open display settings" },
];

/** The Penny coin. Decorative: the name next to it carries the meaning. */
export function BrandMark({ className }: { className?: string }) {
  return <Image src="/penny-logo.png" alt="" width={256} height={256} priority className={cn("size-10 shrink-0 drop-shadow-sm", className)} />;
}

function useSignedInEmail() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getSupabaseUserEmail().then((value) => { if (active) setEmail(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return email;
}

function AccountSummary({ dashboard }: { dashboard: Dashboard }) {
  const router = useRouter();
  const email = useSignedInEmail();
  const [signingOut, setSigningOut] = useState(false);
  const initials = dashboard.profile.display_name.split(" ").map((part) => part[0]).join("");
  async function signOut() {
    setSigningOut(true);
    await signOutOfSupabase().catch(() => undefined);
    router.replace("/login");
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary" aria-hidden="true">{initials}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{dashboard.profile.display_name}</p>
          <p className="truncate text-xs text-ink-subtle">{email ? `Signed in as ${email}` : "Demo mode"}{dashboard.xp_total > 0 ? ` · ${dashboard.xp_total} XP` : ""}</p>
        </div>
      </div>
      {email && (
        <Button variant="ghost" size="sm" className="mt-2 w-full justify-start" onClick={() => void signOut()} disabled={signingOut}>
          <LogOut className="size-4" aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}
        </Button>
      )}
    </div>
  );
}

export function Sidebar({ active, dashboard, collapsed, onToggle, onNavigate }: { active: View; dashboard: Dashboard; collapsed: boolean; onToggle: () => void; onNavigate: (view: View) => void }) {
  return (
    <aside data-collapsed={collapsed} className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col overflow-y-auto border-r border-line bg-canvas py-5 transition-[width] duration-200 lg:flex", collapsed ? "w-20 px-3" : "w-64 px-4")}>
      <div className={cn("flex items-center gap-3 px-2", collapsed && "justify-center px-0")}>
        <BrandMark />
        {!collapsed && <div><p className="text-lg font-semibold tracking-tight text-ink">Penny</p><p className="text-xs text-ink-subtle">Make money make sense</p></div>}
      </div>
      <nav aria-label="Primary" className="mt-8">
        <ul className="space-y-1">
          {/* Settings opens from the header's gear menu (All settings), not the sidebar. */}
          {NAVIGATION.filter((item) => item.id !== "settings").map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button type="button" title={collapsed ? label : undefined} onClick={() => onNavigate(id)} aria-current={active === id ? "page" : undefined} className={cn("relative flex min-h-11 w-full items-center rounded-xl text-sm font-medium transition-colors duration-150", collapsed ? "justify-center px-0" : "gap-3 px-3", active === id ? "bg-sage text-primary before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent" : "text-ink-muted hover:bg-sage-soft hover:text-ink")}>
                <Icon className="size-5 shrink-0" aria-hidden="true" />{!collapsed && label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-auto space-y-3 pt-6">
        <button type="button" onClick={onToggle} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={cn("flex min-h-11 w-full items-center rounded-xl text-sm font-medium text-ink-muted hover:bg-sage-soft hover:text-ink", collapsed ? "justify-center" : "gap-3 px-3")}>
          {collapsed ? <PanelLeftOpen className="size-5" /> : <><PanelLeftClose className="size-5" />Collapse sidebar</>}
        </button>
        {!collapsed && <AccountSummary dashboard={dashboard} />}
      </div>
    </aside>
  );
}

export function MobileNavigation({ active, onNavigate }: { active: View; onNavigate: (view: View) => void }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = NAVIGATION.filter((item) => item.primary);
  const secondary = NAVIGATION.filter((item) => !item.primary);
  const moreActive = secondary.some((item) => item.id === active);
  const tab = (selected: boolean) => cn("flex min-h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", selected ? "text-primary" : "text-ink-subtle hover:text-ink");
  const pill = (selected: boolean) => cn("grid h-7 w-11 place-items-center rounded-full transition-colors duration-150", selected && "bg-sage");
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <ul className="mx-auto flex max-w-3xl">
        {primary.map(({ id, label, icon: Icon }) => (
          <li key={id} className="flex-1">
            <button type="button" onClick={() => onNavigate(id)} aria-current={active === id ? "page" : undefined} className={tab(active === id)}>
              <span className={pill(active === id)}><Icon className="size-5" aria-hidden="true" /></span>{label}
            </button>
          </li>
        ))}
        <li className="flex-1">
          <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" className={tab(moreActive)}>
            <span className={pill(moreActive)}><Menu className="size-5" aria-hidden="true" /></span>More
          </button>
        </li>
      </ul>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>More</DialogTitle><DialogDescription>Everything else in Penny.</DialogDescription></DialogHeader>
          <ul className="grid gap-2">
            {secondary.map(({ id, label, description, icon: Icon }) => (
              <li key={id}>
                <button type="button" onClick={() => { setMoreOpen(false); onNavigate(id); }} aria-current={active === id ? "page" : undefined} className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border p-3 text-left", active === id ? "border-accent bg-accent-soft" : "border-line hover:bg-sage-soft")}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sage text-ink-muted"><Icon className="size-5" aria-hidden="true" /></span>
                  <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-xs text-ink-subtle">{description}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

// ------------------------------------------------------------------ month switcher

// ------------------------------------------------------------------ display controls

// Heading faces per palette, mirrored from globals.css so the picker can preview them.
const PALETTE_FONTS: Record<PaletteSetting, string> = {
  original: "var(--font-sans)",
  noir: '"Didot", "Bodoni 72", "Bodoni MT", Georgia, serif',
  emerald: '"Baskerville", "Libre Baskerville", Georgia, serif',
  sapphire: '"Avenir Next", "Avenir", "Segoe UI", sans-serif',
  bordeaux: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  pearl: '"Optima", "Candara", "Segoe UI", sans-serif',
};

/** The colour styles, as swatches. "compact" for the gear menu, full cards for Display settings. */
export function PalettePicker({ compact = false }: { compact?: boolean }) {
  const { palette, setPalette, resolvedTheme } = usePreferences();
  return (
    <div role="radiogroup" aria-label="Style" className={cn("grid gap-1.5", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
      {PALETTE_OPTIONS.map((option) => {
        const [canvas, primary, accent, gold] = option.swatches[resolvedTheme];
        const selected = palette === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option.label}: ${option.description}`}
            title={option.description}
            onClick={() => setPalette(option.value)}
            className={cn("group relative overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow]", selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong")}
          >
            <span className={cn("flex items-end justify-between", compact ? "h-10 px-2 pb-1.5" : "h-20 px-3 pb-2")} style={{ background: `linear-gradient(135deg, ${canvas} 0%, ${canvas} 55%, ${primary} 55%, ${primary} 100%)` }} aria-hidden="true">
              <span className={cn("leading-none", compact ? "text-base" : "text-2xl")} style={{ fontFamily: PALETTE_FONTS[option.value], color: primary }}>Aa</span>
              <span className="flex gap-1">
                {[["accent", accent], ["gold", gold]].map(([role, color]) => <span key={role} className={cn("rounded-full ring-1 ring-black/10", compact ? "size-2.5" : "size-3.5")} style={{ background: color }} />)}
              </span>
            </span>
            <span className={cn("flex items-center gap-1 bg-surface", compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-sm")}>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{option.label}</span>
              {selected && <Check className={cn("shrink-0 text-accent-strong", compact ? "size-3" : "size-4")} aria-hidden="true" />}
            </span>
            {!compact && <span className="block bg-surface px-3 pb-2.5 text-xs text-ink-subtle">{option.description} <span className="text-ink-muted">· {option.font}</span></span>}
          </button>
        );
      })}
    </div>
  );
}

// A tiny card drawn in each surface style, using the current palette's colours.
const SURFACE_PREVIEW: Record<SurfaceSetting, React.CSSProperties> = {
  classic: { background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: 8, boxShadow: "0 4px 10px rgb(0 0 0 / 0.08)" },
  glass: { background: "color-mix(in srgb, var(--color-surface) 45%, transparent)", border: "1px solid rgb(255 255 255 / 0.5)", borderRadius: 10, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", boxShadow: "0 6px 14px rgb(0 0 0 / 0.12)" },
  soft: { background: "var(--color-canvas)", borderRadius: 12, boxShadow: "4px 4px 9px color-mix(in srgb, var(--color-ink) 14%, transparent), -4px -4px 9px rgb(255 255 255 / 0.7)" },
  clay: { background: "var(--color-surface)", borderRadius: 14, boxShadow: "0 8px 14px -6px color-mix(in srgb, var(--color-primary) 40%, transparent), inset 0 -3px 6px rgb(0 0 0 / 0.06), inset 0 3px 6px rgb(255 255 255 / 0.8)" },
  flat: { background: "var(--color-surface)", border: "1px solid var(--color-line-strong)", borderRadius: 6 },
  halo: { background: "linear-gradient(var(--color-surface), var(--color-surface)) padding-box, linear-gradient(135deg, var(--color-accent), var(--color-gold) 45%, var(--color-line) 75%) border-box", border: "1.5px solid transparent", borderRadius: 10, boxShadow: "0 6px 14px -6px color-mix(in srgb, var(--color-accent) 60%, transparent)" },
};

/** Surface styles (how cards are built), with a live mini preview of each. */
export function SurfacePicker({ compact = false }: { compact?: boolean }) {
  const { surface, setSurface } = usePreferences();
  return (
    <div role="radiogroup" aria-label="Surface" className={cn("grid gap-1.5", compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
      {SURFACE_OPTIONS.map((option) => {
        const selected = surface === option.value;
        const backdrop = option.value === "glass"
          ? "radial-gradient(circle at 20% 20%, var(--color-accent), transparent 60%), radial-gradient(circle at 85% 80%, var(--color-gold), transparent 55%), var(--color-canvas)"
          : "var(--color-canvas)";
        return (
          <button key={option.value} type="button" role="radio" aria-checked={selected} aria-label={`${option.label}: ${option.description}`} title={option.description} onClick={() => setSurface(option.value)}
            className={cn("overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow]", selected ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-line-strong")}>
            <span className={cn("grid place-items-center", compact ? "h-12" : "h-20")} style={{ background: backdrop }} aria-hidden="true">
              <span className={cn("flex flex-col justify-center gap-1 px-2", compact ? "h-7 w-14" : "h-11 w-24")} style={SURFACE_PREVIEW[option.value]}>
                <span className="h-1 w-3/4 rounded-full" style={{ background: "var(--color-ink)", opacity: 0.7 }} />
                <span className="h-1 w-1/2 rounded-full" style={{ background: "var(--color-accent)" }} />
              </span>
            </span>
            <span className={cn("flex items-center gap-1 bg-surface", compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-sm")}>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{option.label}</span>
              {selected && <Check className={cn("shrink-0 text-accent-strong", compact ? "size-3" : "size-4")} aria-hidden="true" />}
            </span>
            {!compact && <span className="block bg-surface px-3 pb-2.5 text-xs text-ink-subtle">{option.description}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The header's gear: theme, display settings, and a shortcut to all settings. */
export function SettingsMenu({ onOpenDisplay, onNavigate }: { onOpenDisplay: () => void; onNavigate: (view: View) => void }) {
  const { theme, setTheme } = usePreferences();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink hover:bg-sage-soft";
  return (
    <div ref={root} className="relative" onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); } }}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="true" aria-expanded={open} aria-controls={open ? menuId : undefined} aria-label="Settings" title="Settings" className={cn("grid size-10 place-items-center rounded-xl border border-line bg-surface text-ink-muted shadow-[var(--shadow-card)] transition-colors hover:text-ink", open && "text-ink")}>
        <Settings className={cn("size-[1.1rem] transition-transform duration-300 motion-reduce:transition-none", open && "rotate-45")} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} role="group" aria-label="Settings" className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100dvh-6rem)] w-72 animate-enter overflow-y-auto rounded-2xl border border-line bg-surface p-2 shadow-[var(--shadow-raised)]">
          <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Appearance</p>
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl bg-sage-soft p-1">
            {THEME_OPTIONS.map((option) => {
              const Icon = THEME_ICONS[option.value];
              const selected = theme === option.value;
              return (
                <button key={option.value} type="button" role="radio" aria-checked={selected} onClick={() => setTheme(option.value)} className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold transition-colors", selected ? "bg-surface text-ink shadow-sm" : "text-ink-subtle hover:text-ink")}>
                  <Icon className="size-4" aria-hidden="true" />{option.label}
                </button>
              );
            })}
          </div>
          <p className="px-2 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Style</p>
          <PalettePicker compact />
          <p className="px-2 pb-1.5 pt-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">Surface</p>
          <SurfacePicker compact />
          <div className="mt-2 border-t border-line pt-2">
            <button type="button" className={item} onClick={() => { setOpen(false); onOpenDisplay(); }}><SlidersHorizontal className="size-4 text-ink-subtle" aria-hidden="true" />Display settings</button>
            <button type="button" className={item} onClick={() => { setOpen(false); onNavigate("settings"); }}><Settings className="size-4 text-ink-subtle" aria-hidden="true" />All settings</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DisplaySettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { theme, setTheme } = usePreferences();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Display settings</DialogTitle>
          <DialogDescription>Choose how Penny looks. Your choice is saved on this device.</DialogDescription>
        </DialogHeader>
        <fieldset>
          <legend className="text-sm font-semibold text-ink">Theme</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((option) => {
              const Icon = THEME_ICONS[option.value];
              return (
                <label key={option.value} className={cn("flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent", theme === option.value ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-muted hover:bg-sage-soft")}>
                  <input type="radio" name="theme" value={option.value} checked={theme === option.value} onChange={() => setTheme(option.value)} className="sr-only" />
                  <Icon className="size-5" aria-hidden="true" />{option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink">Style</legend>
          <p className="mt-0.5 text-xs text-ink-subtle">Colours and heading type. Each style has a light and a dark version.</p>
          <div className="mt-2"><PalettePicker /></div>
        </fieldset>
        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-ink">Surface</legend>
          <p className="mt-0.5 text-xs text-ink-subtle">How cards and panels are built. Works with any style above.</p>
          <div className="mt-2"><SurfacePicker /></div>
        </fieldset>
        <div className="mt-5 hidden sm:block">
          <h3 className="text-sm font-semibold text-ink">Keyboard shortcuts</h3>
          <dl className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="flex items-center justify-between gap-3 px-3 py-2">
                <dt className="text-ink-muted">{shortcut.action}</dt>
                <dd><kbd className="rounded-md border border-line-strong bg-sage-soft px-1.5 py-0.5 font-mono text-xs text-ink">{shortcut.keys}</kbd></dd>
              </div>
            ))}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ header

export function PageHeader({ view, dashboard, monthLoading, onChangePeriod, onAddTransaction, onOpenDisplay, onNavigate }: { view: View; dashboard: Dashboard; monthLoading: boolean; onChangePeriod: (range: PeriodRange) => void; onAddTransaction: () => void; onOpenDisplay: () => void; onNavigate: (view: View) => void }) {
  const item = NAVIGATION.find((entry) => entry.id === view) ?? NAVIGATION[0];
  const firstName = dashboard.profile.display_name.split(" ")[0];
  const { period } = dashboard;
  // A period that reaches into this month is "now"; anything earlier is a look back.
  const includesNow = period.end >= dashboard.current_month;
  const pastHome = view === "today" && !includesNow;
  const title = view === "today" ? (includesNow ? `${greeting()}, ${firstName}.` : `${period.label} in review`) : item.title;
  const kept = dashboard.totals.cash_flow_cents;
  const saved = period.phrase === "this month"
    ? (kept >= 0 ? `you’re on track to save ${cad(kept)}` : `you’re ${cad(-kept)} over`)
    : (kept >= 0 ? `you kept ${cad(kept)}` : `you spent ${cad(-kept)} more than you earned`);
  const summary = `You have ${cad(dashboard.home.available_cents)} available and ${saved} ${period.phrase}.`;
  const description = pastHome ? `Looking back at ${period.label}. Balances and goals show today’s values.` : view === "today" ? summary : item.description;
  const showMonth = MONTH_VIEWS.includes(view);
  const showAdd = view === "today" || view === "spending";
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-10 lg:py-4">
        {/* Actions sit beside the title on phones, and centred against the whole header (title,
            description, and period picker) from the sm breakpoint. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
          <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
            <BrandMark className="size-9 lg:hidden" />
            <div className="min-w-0">
              <h1 id="page-title" tabIndex={-1} className="truncate text-lg font-semibold tracking-tight text-ink focus:outline-none sm:text-2xl">{title}</h1>
              <p className="hidden text-sm text-ink-subtle sm:line-clamp-2">{description}</p>
            </div>
          </div>
          <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-2 self-center sm:row-span-3">
            {showAdd && (
              <Button onClick={onAddTransaction} className="shrink-0">
                <Plus className="size-4" aria-hidden="true" /><span className="sm:hidden">Add</span><span className="hidden sm:inline">Add transaction</span>
              </Button>
            )}
            <SettingsMenu onOpenDisplay={onOpenDisplay} onNavigate={onNavigate} />
          </div>
          {showMonth ? (
            <div className="col-span-2 mt-3 flex flex-wrap items-center gap-2 sm:col-span-1">
              <PeriodPicker dashboard={dashboard} loading={monthLoading} onChange={onChangePeriod} />
              {dashboard.profile.is_fictional && <Badge tone="gold">Fictional data</Badge>}
            </div>
          ) : (
            <p className="col-span-2 mt-1 text-xs text-ink-subtle sm:hidden">{formatMonth(dashboard.current_month)}{dashboard.profile.is_fictional ? " · Fictional data" : ""}</p>
          )}
          {pastHome && <p className="col-span-2 mt-2 text-xs text-ink-subtle sm:hidden">Looking back at a past month. Balances and goals show today’s values.</p>}
        </div>
      </div>
    </header>
  );
}

/** Account summary for small screens, where the sidebar is hidden. */
export function MobileAccount({ dashboard }: { dashboard: Dashboard }) {
  return (
    <div className="space-y-3 lg:hidden">
      <AccountSummary dashboard={dashboard} />
    </div>
  );
}
