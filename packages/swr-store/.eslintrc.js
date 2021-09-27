module.exports = {
  "extends": [
    'lxsmnsyc/typescript',
  ],
  "parserOptions": {
    "project": "./tsconfig.eslint.json",
    "tsconfigRootDir": __dirname,
  },
  "rules": {
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "no-restricted-syntax": "off",
    "prefer-object-spread": "off"
  }
};
