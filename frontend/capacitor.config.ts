import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

// The iOS app bundles the static export in `out/` (`npm run ios:build`). It still calls the
// FastAPI service and Supabase over the network; nothing financial is computed on the phone.
const config: CapacitorConfig = {
  // Must be unique to your Apple ID when installing with free signing; change it if Xcode says it's taken.
  appId: "com.mehirkumar.penny",
  appName: "Penny",
  webDir: "out",
  plugins: {
    Keyboard: {
      // Shrink the web view above the keyboard so sheets and their Save buttons stay visible.
      resize: KeyboardResize.Native,
      // Fill the strip behind the keyboard with the page's own (light or dark) background.
      autoBackdropColor: "dom",
    },
  },
};

export default config;
