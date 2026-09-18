import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  resolveNativeHelperPath,
  resolveNativeHelperWorkingDirectory,
} from "./nativeHelperPaths";

const developmentRoot = path.join(path.sep, "workspace", "ai-english-companion");
const packagedResources = path.join(
  path.sep,
  "Applications",
  "Tirva.app",
  "Contents",
  "Resources",
);

const developmentContext = {
  isPackaged: false,
  resourcesPath: packagedResources,
  developmentRoot,
};

const packagedContext = {
  isPackaged: true,
  resourcesPath: packagedResources,
  developmentRoot,
};

const filenameCases = [
  ["frontmostApp", "frontmost-app"],
  ["globalMouseMonitor", "global-mouse-monitor"],
  ["selectionProbe", "selection-probe"],
] as const;

for (const [helper, filename] of filenameCases) {
  test(`development ${filename} path uses dist-native`, () => {
    assert.equal(
      resolveNativeHelperPath(helper, developmentContext),
      path.join(developmentRoot, "dist-native", filename),
    );
  });

  test(`packaged ${filename} path uses Resources/native`, () => {
    const resolved = resolveNativeHelperPath(helper, packagedContext);
    assert.equal(resolved, path.join(packagedResources, "native", filename));
    assert.equal(path.dirname(resolved), path.join(packagedResources, "native"));
    assert.equal(path.basename(resolved), filename);
    assert.equal(resolved.includes("app.asar/dist-native"), false);
  });
}

test("all packaged helper paths stay beneath process.resourcesPath/native", () => {
  for (const [helper] of filenameCases) {
    const relative = path.relative(
      path.join(packagedResources, "native"),
      resolveNativeHelperPath(helper, packagedContext),
    );
    assert.equal(relative.startsWith(".."), false);
    assert.equal(path.isAbsolute(relative), false);
  }
});

test("packaged resolution ignores the development app.asar location", () => {
  const context = {
    ...packagedContext,
    developmentRoot: path.join(packagedResources, "app.asar"),
  };

  for (const [helper, filename] of filenameCases) {
    assert.equal(
      resolveNativeHelperPath(helper, context),
      path.join(packagedResources, "native", filename),
    );
  }
});

test("SelectionProbe working directory stays real in both runtime modes", () => {
  assert.equal(
    resolveNativeHelperWorkingDirectory(developmentContext),
    developmentRoot,
  );
  assert.equal(
    resolveNativeHelperWorkingDirectory(packagedContext),
    path.join(packagedResources, "native"),
  );
});
