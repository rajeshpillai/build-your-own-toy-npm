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
  return data;
}


async function installPackageXX(packageName, version) {
  const packagePath = path.join(__dirname, "toy_node_modules", packageName);
  console.log("Package Path: ", packagePath);

  fs.mkdirSync(packagePath, { recursive: true });

  const packageStream = await downloadPackage(packageName, version);
  const writeStream = fs.createWriteStream(
    path.join(packagePath, `${packageName}-${version}.tgz`)
  );

  packageStream.pipe(writeStream);
}

async function installPackage(packageName, version) {
  const packagePath = path.join(__dirname, "toy_node_modules", packageName);
  fs.mkdirSync(packagePath, { recursive: true });

  const packageStream = await downloadPackage(packageName, version);
  const writeStream = fs.createWriteStream(
    path.join(packagePath, `${packageName}-${version}.tgz`)
  );

  packageStream.pipe(writeStream);

  writeStream.on("finish", () => {
    tar.x({
      file: path.join(packagePath, `${packageName}-${version}.tgz`),
      cwd: packagePath,
      strip: 1,
    }).then(() => {
      // Remove the tarball after extraction
      fs.unlinkSync(path.join(packagePath, `${packageName}-${version}.tgz`));
    });
  });
}

async function uninstallPackage(packageName) {
  const packagePath = path.join(__dirname, "toy_node_modules", packageName);
  fs.rmSync(packagePath, { recursive: true, force: true });
}

async function main() {
  const [action, packageName, version] = process.argv.slice(2);

  switch (action) {
    case "install":
      await installPackage(packageName, version);
      console.log(`Installed ${packageName}@${version}`);
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

