# Tiny npm (toy npm)
A learning project to explore how npm works

This is for the refactor branch. The aim is make the commands in line with npm commands for compatibility.


# Usage
By default it will save into dependencies section.  Use the --save-dev flag to save the package in the dev dependencies.

```js
node toy-npm.js <install/uninstall> <package-name> [version]  [--save-dev]
```

## Init a new toy-package.json
```
node toy-npm.js init

```

## To install the package from json

```
node toy-npm.js
```

## Uninstall all packages

```
node toy-npm.js uninstall
```