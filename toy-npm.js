import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import tar from 'tar';
import pLimit from 'p-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**

Fetches the metadata for a given package from the npm registry.
@async
@function fetchPackageMetadata
@param {string} packageName - The name of the package to fetch metadata for.
@returns {Promise<object>} - The package metadata object.
*/
async function fetchPackageMetadata(packageName) {
  const { data } = await axios.get(
    `https://registry.npmjs.org/${packageName}`
  );
  return data;
}

/**

Downloads the tarball for a given package version from the npm registry.
@async
@function downloadPackage
@param {string} packageName - The name of the package to download.
@param {string} version - The version of the package to download.
@returns {Promise<stream.Readable>} - A readable stream containing the package tarball data, with a resolvedVersion property attached indicating the resolved version.
@throws {Error} - If the specified version is not found for the given package.
*/
async function downloadPackage(packageName, version) {
  const metadata = await fetchPackageMetadata(packageName);

  // Resolve the version if not provided or if it's 'latest'
  const resolvedVersion = version === "latest" || !version ? metadata["dist-tags"].latest : version;

  if (!metadata.versions[resolvedVersion]) {
    throw new Error(`Version ${resolvedVersion} not found for package ${packageName}`);
  }

  const tarballUrl = metadata.versions[resolvedVersion].dist.tarball;
  const { data } = await axios.get(tarballUrl, { responseType: "stream" });

  // Attach the resolved version to the returned stream
  data.resolvedVersion = resolvedVersion;

  return data;
}

/**

Uninstalls all packages in toy-package.json
@async
@function uninstallAllPackages
@returns {Promise<void>}
*/
async function uninstallAllPackages() {
  const toyPackagePath = path.join(__dirname, "toy-package.json");

  if (!fs.existsSync(toyPackagePath)) {
    console.log("toy-package.json not found.");
    return;
  }

  const toyPackageJson = JSON.parse(fs.readFileSync(toyPackagePath, "utf8"));

  const uninstallDependenciesPromises = Object.keys(toyPackageJson.dependencies).map(async (packageName) => {
    await uninstallPackage(packageName);
  });

  const uninstallDevDependenciesPromises = Object.keys(toyPackageJson.devDependencies).map(async (packageName) => {
    await uninstallPackage(packageName, true);
  });

  await Promise.all([...uninstallDependenciesPromises, ...uninstallDevDependenciesPromises]);
}

/**

Installs packages from the toy-package.json file with a dynamic rate limit for concurrency
@async
@function installFromToyPackageJson
@returns {Promise<void>}
*/
async function installFromToyPackageJson() {
  const toyPackagePath = path.join(__dirname, "toy-package.json");

  if (!fs.existsSync(toyPackagePath)) {
    console.log("toy-package.json not found.");
    return;
  }

  const toyPackageJson = JSON.parse(fs.readFileSync(toyPackagePath, "utf8"));

  // Set a dynamic concurrency limit based on the number of packages to install
  const totalPackages = Object.keys(toyPackageJson.dependencies).length + Object.keys(toyPackageJson.devDependencies).length;
  const concurrencyLimit = Math.min(Math.ceil(totalPackages / 2), 8); // Limit between 1 and 8
  const limit = pLimit(concurrencyLimit);

  const installDependenciesPromises = Object.entries(toyPackageJson.dependencies).map(
    ([packageName, version]) => {
      return limit(async () => {
        await installPackage(packageName, version);
        console.log(`Installed ${packageName}@${version}`);
      });
    }
  );

  const installDevDependenciesPromises = Object.entries(toyPackageJson.devDependencies).map(
    ([packageName, version]) => {
      return limit(async () => {
        await installPackage(packageName, version, true);
        console.log(`Installed ${packageName}@${version} as devDependency`);
      });
    }
  );

  await Promise.all([...installDependenciesPromises, ...installDevDependenciesPromises]);
}

/**

Retrieves metadata for the specified package and version from the npm registry
@async
@function getPackageData
@param {string} packageName - The name of the package to retrieve metadata for
@param {string} [version] - The version of the package to retrieve metadata for. If not specified, the latest version will be returned
@returns {Promise<object>} - The metadata object for the specified package and version
*/
async function getPackageData(packageName, version) {
  const packageUrl = `https://registry.npmjs.org/${packageName}/${version || ""}`;
  const response = await axios.get(packageUrl);

  return response.data;
}

/**

Install a package with a given name and version.
@async
@function installPackage
@param {string} packageName - The name of the package to install.
@param {string} [version] - The version of the package to install. If not specified, the latest version will be installed.
@param {boolean} [isDevDependency=false] - Whether the package is a devDependency. Default is false.
@returns {Promise<void>}
*/
async function installPackage(packageName, version, isDevDependency = false) {
  const packagePath = path.join(__dirname, "toy_node_modules", packageName);
  fs.mkdirSync(packagePath, { recursive: true });

  const packageStream = await downloadPackage(packageName, version);
  // Update the version variable with the resolved version
  version = packageStream.resolvedVersion;

  const writeStream = fs.createWriteStream(
    path.join(packagePath, `${packageName}-${version}.tgz`)
  );

  packageStream.pipe(writeStream);

  await new Promise((resolve) => {
    writeStream.on("finish", () => {
      tar.x({
        file: path.join(packagePath, `${packageName}-${version}.tgz`),
        cwd: packagePath,
        strip: 1,
      }).then(async () => {
        // Remove the tarball after extraction
        fs.unlinkSync(path.join(packagePath, `${packageName}-${version}.tgz`));

        // Update toy-package.json
        updateToyPackageJson(packageName, version, isDevDependency);

        // Retrieve packageData for the installed version
        const packageData = await getPackageData(packageName, version);

        // Update toy-package-lock.json
        const installedPackageInfo = {
          version: packageData.version,
          resolved: packageData.dist.tarball,
          integrity: packageData.dist.shasum,
        };
        updateToyPackageLockJson(packageName, installedPackageInfo);
        resolve();
      });
    });
  });
}


/**
 * Updates the toy-package-lock.json file with version information for a package.
 *
 * @function updateToyPackageLockJson
 * @param {string} packageName - The name of the package to update.
 * @param {object} packageInfo - An object containing the package version, resolved tarball URL, and SHA-1 checksum.
 * @returns {void}
 */
function updateToyPackageLockJson(packageName, packageInfo) {
  const lockfilePath = path.join(__dirname, "toy-package-lock.json");
  let lockfileData = {};

  if (fs.existsSync(lockfilePath)) {
    lockfileData = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
  }

  lockfileData[packageName] = packageInfo;
  fs.writeFileSync(lockfilePath, JSON.stringify(lockfileData, null, 2));
}

/**

Uninstalls a package from the toy_node_modules directory, as well as from the toy-package.json and toy-package-lock.json files.
@async
@function uninstallPackage
@param {string} packageName - The name of the package to uninstall.
@returns {void}
*/
function uninstallPackage(packageName) {
  const packagePath = path.join(__dirname, "toy_node_modules", packageName);

  if (!fs.existsSync(packagePath)) {
    console.log(`Package ${packageName} not found.`);
    return;
  }

  fs.rmSync(packagePath, { recursive: true, force: true });
  
  // Remove package from toy-package.json
  removeFromToyPackageJson(packageName);
  console.log(`Uninstalled ${packageName}`);

  removePackageFromToyPackageLockJson(packageName);
}

/**
 * Remove a package from the toy-package-lock.json file
 * @function removePackageFromToyPackageLockJson
 * @param {string} packageName - The name of the package to remove
 * @returns {void}
 */
function removePackageFromToyPackageLockJson(packageName) {
  const lockfilePath = path.join(__dirname, "toy-package-lock.json");

  if (fs.existsSync(lockfilePath)) {
    const lockfileData = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));

    if (lockfileData[packageName]) {
      delete lockfileData[packageName];
      fs.writeFileSync(lockfilePath, JSON.stringify(lockfileData, null, 2));
    }
  }
}



/**

Updates toy-package.json with the given package name, version, and devDependency flag
@function updateToyPackageJson
@param {string} packageName - The name of the package to add or update in toy-package.json
@param {string} version - The version of the package to add or update in toy-package.json
@param {boolean} [isDevDependency=false] - Flag indicating whether the package is a devDependency (defaults to false)
@returns {void}
*/
function updateToyPackageJson(packageName, version, isDevDependency = false) {
  const toyPackagePath = path.join(__dirname, "toy-package.json");

  let toyPackageJson = {
    name: "toy-npm",
    version: "1.0.0",
    description: "",
    main: "index.js",
    dependencies: {},
    devDependencies: {},
  };

  if (fs.existsSync(toyPackagePath)) {
    toyPackageJson = JSON.parse(fs.readFileSync(toyPackagePath, "utf8"));
  }

  if (isDevDependency) {
    toyPackageJson.devDependencies[packageName] = version;
  } else {
    toyPackageJson.dependencies[packageName] = version;
  }

  fs.writeFileSync(toyPackagePath, JSON.stringify(toyPackageJson, null, 2));
}

/**
 * Remove the specified package from toy-package.json.
 * @param {string} packageName - The name of the package to remove.
 */
function removeFromToyPackageJson(packageName) {
  const toyPackagePath = path.join(__dirname, "toy-package.json");

  if (!fs.existsSync(toyPackagePath)) {
    return;
  }

  const toyPackageJson = JSON.parse(fs.readFileSync(toyPackagePath, "utf8"));

  delete toyPackageJson.dependencies[packageName];
  delete toyPackageJson.devDependencies[packageName];

  fs.writeFileSync(toyPackagePath, JSON.stringify(toyPackageJson, null, 2));
}

/**
 * Initializes a new `toy-package.json` file with default values if it does not exist.
 * If it already exists, logs a message to the console and does nothing.
 */
function initToyPackageJson() {
  const toyPackagePath = path.join(__dirname, "toy-package.json");

  if (fs.existsSync(toyPackagePath)) {
    console.log("toy-package.json already exists.");
    return;
  }

  const defaultToyPackageJson = {
    name: "toy-project",
    version: "1.0.0",
    description: "",
    main: "index.js",
    scripts: {
      test: "echo \"Error: no test specified\" && exit 1",
    },
    keywords: [],
    author: "",
    license: "ISC",
    dependencies: {},
    devDependencies: {},
  };

  fs.writeFileSync(toyPackagePath, JSON.stringify(defaultToyPackageJson, null, 2));
  console.log("Created toy-package.json with default values.");
}

/**
Main function that parses command line arguments and performs the corresponding action
*/
async function main() {
  const [action, packageName, ...restArgs] = process.argv.slice(2);

  let version;
  let saveOption;
  let isDevDependency = false;

  if (!action) {
    await installFromToyPackageJson();
    return;
  }

  restArgs.forEach((arg) => {
    if (arg.startsWith("--save")) {
      saveOption = arg;
    } else {
      version = arg;
    }
  });

  isDevDependency = saveOption === "--save-dev";

  switch (action) {
    case "init":
      initToyPackageJson();
      break;
    case "install":
      await installPackage(packageName, version, isDevDependency);
      console.log(`Installed ${packageName}@${version || "latest"}`);
      break;
    case "uninstall":
      if (packageName) {
        const isDevDependency = restArgs.includes("--dev") || restArgs.includes("--save-dev");
        await uninstallPackage(packageName, isDevDependency);
      } else {
        await uninstallAllPackages();
      }
      break;
      default:
        console.error("Invalid action. Use 'install' or 'uninstall'.");
  }
}


main().catch((error) => {
  console.error(`Error: ${error.message}`);
});

