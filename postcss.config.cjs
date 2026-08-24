/**
 * Mantine's stylesheets ship with its own mixins and breakpoint variables
 * already compiled, but anything *we* write that wants `light-dark()`, `rem()`
 * or `@mixin smaller-than` needs the preset to expand them.
 *
 * The breakpoint variables have to be declared here rather than read from the
 * theme, because PostCSS runs long before any JavaScript does. Keep them in
 * step with `theme.ts` if either moves.
 */
module.exports = {
  plugins: {
    "postcss-preset-mantine": {},
    "postcss-simple-vars": {
      variables: {
        "mantine-breakpoint-xs": "36em",
        "mantine-breakpoint-sm": "48em",
        "mantine-breakpoint-md": "62em",
        "mantine-breakpoint-lg": "75em",
        "mantine-breakpoint-xl": "88em",
      },
    },
  },
};
