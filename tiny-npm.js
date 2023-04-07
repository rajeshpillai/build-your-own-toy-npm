const fs = require("fs");
const axios = require("axios");
const path = require("path");
const tar = require("tar");

async function fetchPackageMetadata(packageName) {
  const { data } = await axios.get(
    `https://registry.npmjs.org/${packageName}`
  );
  return data;
}

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
      }).then(() => {
        // Remove the tarball after extraction
        fs.unlinkSync(path.join(packagePath, `${packageName}-${version}.tgz`));
        // Update toy-package.json
        updateToyPackageJson(packageName, version, isDevDependency);
        resolve();
      });
    });
  });
}



async function uninstallPackage(packageName) {
  const packagePath = path.join(__dirname, "toy_node_modules", packageName);
  fs.rmSync(packagePath, { recursive: true, force: true });
}



// Update toy-package.json
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

async function main() {
  const [action, packageName, ...restArgs] = process.argv.slice(2);

  let version;
  let saveOption;
  let isDevDependency = false;

  restArgs.forEach((arg) => {
    if (arg.startsWith("--save")) {
      saveOption = arg;
    } else {
      version = arg;
    }
  });

  isDevDependency = saveOption === "--save-dev";

  switch (action) {
    case "install":
      await installPackage(packageName, version, isDevDependency);
      console.log(`Installed ${packageName}@${version || "latest"}`);
      break;
      case "uninstall":
        uninstallPackage(packageName);
        console.log(`Uninstalled ${packageName}`);
        break;
      default:
        console.error("Invalid action. Use 'install' or 'uninstall'.");
  }
}


main().catch((error) => {
  console.error(`Error: ${error.message}`);
});

