/**
 * Tailwind v4 through PostCSS.
 *
 * v4 moved the plugin here from a `tailwind.config.js`: the config that used to be JavaScript is now
 * CSS, in `@theme` and `@import` at the top of globals.css. So this file is deliberately almost
 * empty, and the interesting configuration lives where the styles are.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
