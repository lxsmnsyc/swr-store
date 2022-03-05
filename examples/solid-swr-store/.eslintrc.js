module.exports = {
  "extends": [
    'lxsmnsyc/typescript/react',
  ],
  "parserOptions": {
    "project": "./tsconfig.json",
    "tsconfigRootDir": __dirname,
  },
  "rules": {
    "react-hooks/rules-of-hooks": "off",
    "react/prop-types": "off",
    "react/jsx-no-constructed-context-values": "off"
  }
};

