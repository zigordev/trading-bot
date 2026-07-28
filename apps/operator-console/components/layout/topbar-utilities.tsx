"use client";

import { usePreferences } from "@/components/providers/preferences-provider";
import { Button } from "@/design-system/components/core/Button.jsx";
import { Icon } from "@/design-system/components/icons/Icon.jsx";
import { Menu, MenuItem } from "@/design-system/components/overlay/Menu.jsx";

const ICON_STYLE: React.CSSProperties = { lineHeight: 1 };

export function ThemeButton() {
  const { theme, setTheme, t } = usePreferences();

  return (
    <Button
      aria-label={t("theme.toggle")}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      size="icon"
      style={ICON_STYLE}
      title={t("theme.toggle")}
      type="button"
      variant="ghost"
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </Button>
  );
}

export function LanguageButton() {
  const { setLanguage, t } = usePreferences();

  return (
    <Menu
      trigger={
        <Button
          aria-label={t("nav.language")}
          size="icon"
          style={ICON_STYLE}
          title={t("nav.language")}
          type="button"
          variant="ghost"
        >
          <Icon name="globe" />
        </Button>
      }
    >
      {({ close }: { close: () => void }) => (
        <>
          <MenuItem onClick={() => { close(); setLanguage("en"); }}>
            🇬🇧 {t("language.english")}
          </MenuItem>
          <MenuItem onClick={() => { close(); setLanguage("es"); }}>
            🇪🇸 {t("language.spanish")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
