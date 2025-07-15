/* eslint-disable no-undef */
module.exports = {
  "*.{js,jsx,ts,tsx}": (filenames) => [
    `npx eslint --fix ${filenames.join(" ")}`,
    `npx prettier --write ${filenames.join(" ")}`,
  ],
  "*.{json,md,yml,yaml}": (filenames) =>
    `npx prettier --write ${filenames.join(" ")}`,
};
