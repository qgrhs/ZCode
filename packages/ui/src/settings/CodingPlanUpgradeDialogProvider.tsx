import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CodingPlanEntryInventory } from "@/hooks/useCodingPlanEntryPlanList.js";
import type { CodingPlanUpgradeDialogTarget } from "@/settings/CodingPlanUpgradeDialog.js";

interface CodingPlanUpgradeDialogContextValue {
  inventory: CodingPlanEntryInventory;
  openCodingPlanUpgrade: (
    target: CodingPlanUpgradeDialogTarget,
    observation?: { signal: AbortSignal; onResult: (opened: boolean) => void },
  ) => boolean;
}

const CodingPlanUpgradeDialogContext = createContext<CodingPlanUpgradeDialogContextValue | null>(
  null,
);

/**
 * 会员/升级页面已下架。
 *
 * 原因：本 fork 为开发版，购买链路依赖闭源的官网 webview 与官方 OAuth 登录
 * （后者已默认禁用，见 packages/services 的 oauth provider 配置），会员功能不可用。
 *
 * 这里保留 Provider 与 context 形状（各入口的调用点、类型和 hook 都不必大改），
 * 但 openCodingPlanUpgrade 恒为 no-op：任何入口都无法再打开购买/升级面板，
 * 对应 CodingPlanUpgradeDialog 也不再挂载；同时不再启动套餐查询
 * （useCodingPlanEntryPlanList 会请求官方 pricing/权益接口，购买已下架时纯属浪费）。
 * 需要恢复时还原本文件的上游实现即可。
 */
export function CodingPlanUpgradeDialogProvider({ children }: { children: ReactNode }) {
  const value = useMemo<CodingPlanUpgradeDialogContextValue>(
    () => ({
      // 下游 entryGate 读 status/label 决定按钮态；恒为 ready 表示“无查询、直接可用”。
      inventory: { entryPlanList: "", status: "ready", retry: () => {} },
      // 参数保持上游签名以便调用点类型不变；返回值 false 表示未打开任何面板。
      openCodingPlanUpgrade: () => false,
    }),
    [],
  );

  return (
    <CodingPlanUpgradeDialogContext.Provider value={value}>
      {children}
    </CodingPlanUpgradeDialogContext.Provider>
  );
}

export function useCodingPlanUpgradeDialog() {
  const context = useContext(CodingPlanUpgradeDialogContext);
  if (!context) {
    throw new Error(
      "useCodingPlanUpgradeDialog must be used within CodingPlanUpgradeDialogProvider",
    );
  }
  return context;
}

/**
 * 可独立挂载的 conversation pane 使用可选上下文；完整 App Root 仍会注入真实购买面板。
 */
export function useOptionalCodingPlanUpgradeDialog() {
  return useContext(CodingPlanUpgradeDialogContext);
}
