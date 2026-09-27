// 官方插件暂存：把 apps/zcode-cli/packages 下的插件目录按 bootstrap 的 rootCandidates
// 期望拷进 bundled-agents/<平台>/glm/packages/*-plugin，让 Electron Node 跑 zcode.cjs 时
// 能用同一套 filesystem seed 逻辑发现内置插件。
//
// 背景：仓库只随源码分发 browser-use 与 node-repl-host 两个插件；其余官方插件（documents、
// pdf、presentations 等）受许可证约束，禁止随仓库再分发，只以本地副本形式放在
// apps/zcode-cli/packages/ 并在 .git/info/exclude 中排除。CI 干净检出没有这些副本，
// 因此扫描必须"存在即 stage、缺失即跳过"，绝不能在缺目录时让构建失败。
//
// dev 链与打包链必须共用这一份扫描实现，否则又会回到"打包缺插件、dev 看不出"的漂移老路。

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveAgentBundlePaths } from "./stage-agent-bundle.mjs";

/**
 * 插件目录内允许进入安装包的顶层条目。
 * 与 bootstrap 的 includedTopLevelPaths（seed 白名单）保持同一套键名：
 * seed 端只复制它认识的目录，stage 端多拷无意义，漏拷则会让 seed 出的插件缺文件。
 */
export const OFFICIAL_PLUGIN_TOP_LEVEL_PATHS = [
  ".mcp.json",
  ".zcode-plugin",
  "README.md",
  // Electron 生产资源复制有独立白名单，遗漏 agents 会让首启 filesystem seed 永久缺少子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  "scripts",
  "skills",
  "templates",
];

/** stage 时排除的非运行时文件（node_modules 由运行时依赖闭包另行处理）。 */
const EXCLUDED_ASSET_NAMES = new Set([".DS_Store", ".venv", "__pycache__", "node_modules"]);

function shouldCopyAsset(sourcePath) {
  // 必须用 basename：cpSync 的 filter 收到的是平台路径（Windows 下是反斜杠），
  // 手写 lastIndexOf("/") 在 Windows 上会拿不到目录/文件名，node_modules 就被漏放进来。
  const name = basename(sourcePath);
  return !EXCLUDED_ASSET_NAMES.has(name) && !name.endsWith(".pyc");
}

/**
 * 把一个插件目录按白名单拷进目标目录。只拷贝存在的顶层条目，缺失的静默跳过
 * （各插件目录结构不同：纯内容插件没有 dist，模拟器插件没有 agents）。
 */
export function stagePluginDirectory({ sourceRoot, targetRoot }) {
  mkdirSync(targetRoot, { recursive: true });
  for (const entryName of OFFICIAL_PLUGIN_TOP_LEVEL_PATHS) {
    const sourcePath = resolve(sourceRoot, entryName);
    if (!existsSync(sourcePath)) continue;
    cpSync(sourcePath, resolve(targetRoot, entryName), {
      recursive: true,
      filter: shouldCopyAsset,
    });
  }
  // 清单是插件能被 bootstrap 识别的唯一凭证，任何 stage 结果缺它都算坏包。
  const manifestPath = resolve(targetRoot, ".zcode-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`[stage:official-plugins] staged plugin missing manifest: ${manifestPath}`);
  }
}

/**
 * 扫描本地官方插件副本并逐个 stage。
 *
 * 判定依据是 `.zcode-plugin/plugin.json` 存在，而不是目录名（node-repl-host 不以
 * `-plugin` 结尾但同样是带 manifest 的 seed 单元，按名字过滤会漏掉它）。
 *
 * 跳过规则：
 * - `skipDirNames`：已在调用方显式处理（含 runtime 构建与 seed 校验）的插件，避免重复拷贝；
 * - 没有 manifest 的目录（如只有 LICENSE 的占位包、bundled-skills 技能包），不算插件。
 *
 * @returns {string[]} 实际 stage 的插件目录名，供日志与测试断言。
 */
export function stageLocalOfficialPlugins({
  repoRoot,
  platformKey,
  skipDirNames = [],
  log = console.log,
}) {
  const { glmDir } = resolveAgentBundlePaths({ repoRoot, platformKey });
  const packagesRoot = resolve(repoRoot, "apps/zcode-cli/packages");
  const skip = new Set(skipDirNames);
  const staged = [];

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || skip.has(entry.name)) {
      continue;
    }
    const sourceRoot = resolve(packagesRoot, entry.name);
    if (!existsSync(resolve(sourceRoot, ".zcode-plugin", "plugin.json"))) {
      continue;
    }
    stagePluginDirectory({
      sourceRoot,
      targetRoot: resolve(glmDir, "packages", entry.name),
    });
    staged.push(entry.name);
  }

  if (staged.length > 0) {
    log(`[stage:official-plugins] staged ${staged.length} local plugin(s): ${staged.join(", ")}`);
  } else {
    // CI 干净检出的正常路径；提示一句避免排查时误以为 stage 逻辑没跑。
    log("[stage:official-plugins] no local plugin copies found (clean checkout)");
  }
  return staged;
}
