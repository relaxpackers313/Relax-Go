/* eslint-env node */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: watch the workspace and resolve from both node_modules trees.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules'), path.resolve(workspaceRoot, 'node_modules')];

// Never watch build outputs: Gradle/CMake churn crashes the file watcher mid-build.
config.resolver.blockList = [/\.gradle/, /android[\/]build/, /\.cxx/, /[\/]uploads[\/]/];
config.watcher = { ...config.watcher, ignore: [/\.gradle/, /android[\/]build/, /\.cxx/] };

/**
 * React must be a SINGLETON. pnpm's hoisted layout nests a second react copy (the Next.js
 * admin panel's 19.2.x) inside some hoisted packages — e.g. @tanstack/react-query — which
 * puts two Reacts in the bundle and crashes with "Invalid hook call ... useEffect of null".
 * Pin the singleton packages to the workspace-root copy no matter which package imports them.
 */
const SINGLETONS = new Set(['react', 'scheduler', 'react-native']);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const base = moduleName.startsWith('@') ? moduleName.split('/').slice(0, 2).join('/') : moduleName.split('/')[0];
  if (SINGLETONS.has(base) && base !== 'react-native') {
    return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [workspaceRoot] }) };
  }
  if (base === 'react-native' && moduleName === 'react-native') {
    // Only the bare specifier: subpaths need Metro's own platform-aware resolution.
    return context.resolveRequest({ ...context, originModulePath: path.join(workspaceRoot, 'package.json') }, moduleName, platform);
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
