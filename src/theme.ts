import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * The app's palette, expressed as a Mantine theme.
 *
 * The original five colours were 20BF55 green, 0B4F6C deep teal, 01BAEF cyan,
 * FBFBFF near-white and 757575 grey, with roles rather than a swatch each:
 * teal is structure by day, cyan is structure by night, green is good news.
 *
 * Mantine wants ten shades per colour rather than one, so `brand` is built as
 * a single scale running from pale cyan up to the deep teal, with both of the
 * original palette values landing on it exactly — 01BAEF at shade 4 and
 * 0B4F6C at shade 9. `primaryShade` then reproduces the old light/dark switch
 * for free: shade 9 on light, shade 4 on dark, which is the same "teal by day,
 * cyan by night" the hand-written stylesheet was doing with two blocks of
 * custom properties.
 *
 * Amber and red are Mantine's own `yellow` and `red`. The stylesheet used to
 * derive them by hand because the five-colour palette had no way to say "needs
 * watching" or "wrong" — which is precisely the sort of thing a component
 * library exists to stop you hand-rolling.
 */

const brand: MantineColorsTuple = [
  "#e3f7fd",
  "#c9edfa",
  "#94dcf5",
  "#5bcaf1",
  "#01baef", // palette cyan
  "#00a8db",
  "#0092c0",
  "#0a7ba0",
  "#0b6483",
  "#0b4f6c", // palette teal
];

/**
 * The playhead and anything that means "good".
 *
 * Green, not brand, and deliberately: the playhead has to be findable at a
 * glance against the teal and cyan the rest of the interface is built from,
 * and green is the only hue in the palette that is neither.
 */
const signal: MantineColorsTuple = [
  "#e6f9ed",
  "#c8f2d7",
  "#93e5b1",
  "#5bd88a",
  "#20bf55", // palette green
  "#17a34a",
  "#12873c",
  "#0d6b2f",
  "#095423",
  "#063d19",
];

export const theme = createTheme({
  colors: { brand, signal },
  primaryColor: "brand",
  // The one line that carries the whole day/night character of the palette.
  primaryShade: { light: 9, dark: 4 },

  // Condensed sans for anything that reads as a label on an instrument, a
  // text serif for prose, and tabular mono for numbers. Unchanged from the
  // stylesheet these components replace.
  fontFamily:
    'Charter, "Bitstream Charter", "Iowan Old Style", Georgia, serif',
  fontFamilyMonospace:
    'ui-monospace, "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace',
  headings: {
    fontFamily:
      'Bahnschrift, "DIN Alternate", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", ui-sans-serif, sans-serif',
    fontWeight: "700",
  },

  defaultRadius: "sm",
  // Phone-first: 2.75rem was the comfortable-thumb size the old stylesheet
  // set every control to, and Mantine's `md` sits a little under it.
  components: {
    Button: { defaultProps: { size: "md" } },
    ActionIcon: { defaultProps: { size: "lg" } },
  },

  other: {
    /** Widest the app ever gets. It is a phone tool held in one hand. */
    maxWidth: "34rem",
  },
});
