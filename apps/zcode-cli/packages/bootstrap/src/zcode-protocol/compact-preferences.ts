import { zcodeWorkspaceUpdateCompactPreferencesParamsSchema } from "@zcode/shared";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

/**
 * 自动压缩阈值偏好是 App 全局设置，但每个 resident session 的 AgentRuntime 各自持有
 * 一份 config。协议层同时缓存偏好供未来 session 创建时继承，并立即热更新已有 session，
 * 避免「新建会话用新设置、旧会话还按老设置压缩」的行为分裂。
 */
export async function updateCompactPreferences(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeWorkspaceUpdateCompactPreferencesParamsSchema, rawParams);
  const thresholdPercent = params.preferences.thresholdPercent;
  context.appRuntimePreferences.compactThresholdPercent = thresholdPercent;

  let updatedSessionCount = 0;
  for (const record of context.sessions.values()) {
    record.compactThresholdPercent = thresholdPercent;
    record.app.runtime.setCompactThresholdPercent(thresholdPercent);
    updatedSessionCount += 1;
  }

  return {
    workspace: params.workspace,
    thresholdPercent,
    updatedSessionCount,
  };
}
