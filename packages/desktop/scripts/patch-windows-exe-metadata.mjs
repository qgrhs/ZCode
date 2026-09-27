// Windows 应用 exe 的元数据/图标固化。
//
// 背景：winCodeSign-2.6.0.7z 内含 macOS 符号链接（darwin/10.12/lib/*.dylib），普通 Windows
// 用户没有 SeCreateSymbolicLinkPrivilege，7za 解压返回码 2，被 electron-builder 误判为下载
// 失败并触发三轮全量重打。本 fork 在 electron-builder.config.js 里关闭了
// win.signAndEditExecutable（本地打包应急开关），代价是 electron-builder 不再调用 rcedit：
// 产物 exe 保持 Electron 原生图标与 "Electron / GitHub, Inc." 元数据。
//
// 本脚本在 afterPack 阶段用本机已解压好的 rcedit-x64.exe（winCodeSign 缓存内自带）补齐
// 图标与版本信息，把上一轮“手动跑一次 rcedit”的一次性操作固化成构建步骤。
//
// 只在 signAndEditExecutable === false 时调用：该开关为 true 时 electron-builder 自己会改
// 资源并可能在之后签名，afterPack 再改资源会把签名改坏。

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCommand } from "../../../scripts/spawn-command.mjs";

const requireFromScript = createRequire(import.meta.url);

/** 从 winCodeSign 缓存里按优先级找一个可用的 rcedit-x64.exe。 */
function findCachedRcedit(cacheRoot) {
  // 1) 缓存 facade：electron-builder 的 JS 层解压落点（目录名固定，不带版本号）。
  const facadePath = join(cacheRoot, "winCodeSign", "rcedit-x64.exe");
  if (existsSync(facadePath)) {
    return facadePath;
  }
  // 2) Go 下载器的随机目录落点（每次下载目录名随机，只能扫描）。
  let entries = [];
  try {
    entries = readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(cacheRoot, entry.name, "rcedit-x64.exe");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** 用项目自带的 7za 从 winCodeSign-2.6.0.7z 单文件抽取 rcedit，绕开 macOS 符号链接。 */
function extractRceditFromArchive(cacheRoot, log) {
  let sevenZipPath;
  try {
    // 7zip-bin 是 app-builder-lib 的依赖，打包机上必然存在。
    sevenZipPath = requireFromScript("7zip-bin").path7za;
  } catch {
    return undefined;
  }
  const archiveCandidates = [
    join(cacheRoot, "winCodeSign-2.6.0.7z"),
    ...(() => {
      try {
        return readdirSync(cacheRoot)
          .filter((name) => name.endsWith(".7z"))
          .map((name) => join(cacheRoot, name));
      } catch {
        return [];
      }
    })(),
  ];
  for (const archivePath of archiveCandidates) {
    if (!existsSync(archivePath)) continue;
    const outputDir = join(cacheRoot, "rcedit-extracted");
    mkdirSync(outputDir, { recursive: true });
    // `e` 平价抽取指定单文件、不还原目录结构，因此不会碰到 darwin/ 下的符号链接。
    runCommand(sevenZipPath, ["e", "-y", `-o${outputDir}`, archivePath, "rcedit-x64.exe"], {
      stdio: "ignore",
    });
    const extractedPath = join(outputDir, "rcedit-x64.exe");
    if (existsSync(extractedPath)) {
      log(`[windows-exe-metadata] extracted rcedit from ${archivePath}`);
      return extractedPath;
    }
  }
  return undefined;
}

/**
 * 解析 rcedit 可执行文件路径。
 * 顺序：显式环境变量覆盖 → 缓存 facade → 随机缓存目录 → 从 7z 现场抽取。
 */
export function resolveLocalRceditPath({ env = process.env, log = console.log } = {}) {
  const explicitPath = env.ZCODE_RCEDIT_PATH?.trim();
  if (explicitPath) {
    if (existsSync(explicitPath)) return explicitPath;
    throw new Error(`[windows-exe-metadata] ZCODE_RCEDIT_PATH not found: ${explicitPath}`);
  }

  const cacheRoot = join(
    env.LOCALAPPDATA || join(env.USERPROFILE ?? "", "AppData", "Local"),
    "electron-builder",
    "Cache",
    "winCodeSign",
  );
  const cached = findCachedRcedit(cacheRoot);
  if (cached) return cached;
  const extracted = extractRceditFromArchive(cacheRoot, log);
  if (extracted) return extracted;

  throw new Error(
    "[windows-exe-metadata] rcedit-x64.exe not found. Seed it once with: " +
      `7za e -y -o"${join(cacheRoot, "winCodeSign")}" "${join(cacheRoot, "winCodeSign-2.6.0.7z")}" rcedit-x64.exe ` +
      "(archive lives in %LOCALAPPDATA%\\electron-builder\\Cache after any electron-builder run), " +
      "or point ZCODE_RCEDIT_PATH at any rcedit-x64.exe.",
  );
}

/** 组装 rcedit 参数：与 electron-builder 原生 signAndEditResources 写入的字段对齐。 */
export function buildRceditArgs({
  exePath,
  iconPath,
  productName,
  companyName,
  copyright,
  fileVersion,
  productVersion,
  internalName,
}) {
  const args = [
    exePath,
    "--set-version-string",
    "FileDescription",
    productName,
    "--set-version-string",
    "ProductName",
    productName,
    "--set-version-string",
    "CompanyName",
    companyName,
    "--set-file-version",
    fileVersion,
    "--set-product-version",
    productVersion,
  ];
  if (copyright) {
    args.push("--set-version-string", "LegalCopyright", copyright);
  }
  if (internalName) {
    args.push(
      "--set-version-string",
      "InternalName",
      internalName,
      "--set-version-string",
      "OriginalFilename",
      `${internalName}.exe`,
    );
  }
  if (iconPath) {
    args.push("--set-icon", iconPath);
  }
  return args;
}

/**
 * afterPack 钩子入口：给 Windows 产物 exe 补图标与版本元数据。
 * 非 win32 或无产物时安全跳过。
 */
export function patchWindowsExeMetadata(context, { log = console.log } = {}) {
  if (context.electronPlatformName !== "win32") {
    return false;
  }
  const appInfo = context.packager?.appInfo;
  const productFilename = appInfo?.productFilename ?? "zcode-dev";
  const productName = appInfo?.productName ?? productFilename;
  const exePath = join(context.appOutDir, `${productFilename}.exe`);
  if (!existsSync(exePath)) {
    throw new Error(`[windows-exe-metadata] packaged exe not found: ${exePath}`);
  }
  const iconPath = resolve(import.meta.dirname, "..", "build", "icon.ico");
  if (!existsSync(iconPath)) {
    throw new Error(`[windows-exe-metadata] app icon not found: ${iconPath}`);
  }

  const version = appInfo?.version ?? appInfo?.buildVersion ?? "0.0.0";
  const windowsVersion =
    typeof appInfo?.getVersionInWeirdWindowsForm === "function"
      ? appInfo.getVersionInWeirdWindowsForm()
      : `${version}.0`;
  const rceditPath = resolveLocalRceditPath({ log });
  const args = buildRceditArgs({
    exePath,
    iconPath,
    productName,
    companyName: appInfo?.companyName ?? productName,
    copyright: typeof appInfo?.copyright === "string" ? appInfo.copyright : undefined,
    fileVersion: version,
    productVersion: windowsVersion,
    internalName: productFilename,
  });

  log(`[windows-exe-metadata] patching ${exePath} via ${rceditPath}`);
  runCommand(rceditPath, args, { stdio: "inherit" });
  log(
    `[windows-exe-metadata] done productName=${productName} company=${appInfo?.companyName ?? productName} version=${version}`,
  );
  return true;
}
