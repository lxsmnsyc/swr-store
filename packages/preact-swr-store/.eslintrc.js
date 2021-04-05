module.exports = {
  "extends": [
    'lxsmnsyc/typescript/preact',
  ],
  "parserOptions": {
    "project": "./tsconfig.eslint.json",
    "tsconfigRootDir": __dirname,
  },
  "rules": {
    "@typescript-eslint/no-explicit-any": "off"
  },
};