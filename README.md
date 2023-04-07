# Tiny npm 
A learning project to explore how npm works


# Usage
By default it will save into dependencies section.  Use the --save-dev flag to save the package in the dev dependencies.

```js
node tiny-npm.js <install/uninstall> <package-name> [version]  [--save-dev]
```

## Init a new toy-package.json
```
node tiny-npm.js init

```

## To install the package from json

```
node tiny-npm.js
```

## Uninstall all packages

```
node tiny-npm.js uninstall
```