import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { Keyboard, KeyboardStyle } from "@capacitor/keyboard";
import { LocalNotifications } from "@capacitor/local-notifications";

/** True inside the iOS app (Capacitor), false in any browser. */
export const isNativeApp = () => Capacitor.isNativePlatform();

type Haptic = "selection" | "light" | "success" | "error";

/** A short vibration in the iOS app; nothing in a browser. Never throws. */
export function haptic(kind: Haptic): void {
  if (!isNativeApp()) return;
  const done =
    kind === "selection"
      ? Haptics.selectionStart()
          .then(() => Haptics.selectionChanged())
          .then(() => Haptics.selectionEnd())
      : kind === "light"
        ? Haptics.impact({ style: ImpactStyle.Light })
        : Haptics.notification({ type: kind === "success" ? NotificationType.Success : NotificationType.Error });
  done.catch(() => undefined);
}

/** Notification ids must be 32-bit integers: the same mission and reminder always get the same
 * one, so scheduling a mission's reminders twice replaces them instead of doubling up. */
function notificationId(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}

/**
 * Puts an agent's reminders on the iPhone, at 9 a.m. on each due day (days already past are
 * skipped). Asks for permission the first time. Returns how many were scheduled; always 0 in a
 * browser, where reminders stay in the app. Never throws.
 */
export async function scheduleReminders(
  key: string,
  reminders: { title: string; detail: string; due_on: string | null }[],
): Promise<number> {
  if (!isNativeApp() || !reminders.length) return 0;
  try {
    let { display } = await LocalNotifications.checkPermissions();
    if (display === "prompt" || display === "prompt-with-rationale")
      ({ display } = await LocalNotifications.requestPermissions());
    if (display !== "granted") return 0;
    const now = Date.now();
    const notifications = reminders.flatMap((reminder, index) => {
      if (!reminder.due_on) return [];
      const [year, month, day] = reminder.due_on.split("-").map(Number);
      const at = new Date(year, month - 1, day, 9);
      if (at.getTime() <= now) return [];
      return [
        { id: notificationId(`${key}:${index}`), title: reminder.title, body: reminder.detail, schedule: { at } },
      ];
    });
    if (notifications.length) await LocalNotifications.schedule({ notifications });
    return notifications.length;
  } catch {
    return 0;
  }
}

/** Matches the keyboard to Penny's light or dark theme. */
export function setKeyboardTheme(theme: "light" | "dark"): void {
  if (isNativeApp())
    Keyboard.setStyle({ style: theme === "dark" ? KeyboardStyle.Dark : KeyboardStyle.Light }).catch(() => undefined);
}

const TEXT_ENTRY =
  "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, select, [contenteditable=true]";

/**
 * Native-app behaviour that a browser already has or doesn't need: no form accessory bar
 * (the up/down/done strip), tapping outside a field closes the keyboard, and
 * `html[data-keyboard]` lets CSS hide the tab bar while the keyboard is up.
 * Returns a cleanup function.
 */
export function setUpNativeApp(): () => void {
  if (!isNativeApp()) return () => undefined;
  const root = document.documentElement;
  root.dataset.native = "ios";
  Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined);

  const dismiss = (event: TouchEvent) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.matches(TEXT_ENTRY)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`${TEXT_ENTRY}, label`)) return;
    active.blur();
  };
  document.addEventListener("touchstart", dismiss, { passive: true });

  const shown = Keyboard.addListener("keyboardWillShow", () => {
    root.dataset.keyboard = "open";
  });
  const hidden = Keyboard.addListener("keyboardWillHide", () => {
    delete root.dataset.keyboard;
  });
  return () => {
    document.removeEventListener("touchstart", dismiss);
    void shown.then((handle) => handle.remove());
    void hidden.then((handle) => handle.remove());
  };
}
