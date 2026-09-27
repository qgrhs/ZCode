import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input.js";
import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/** 与 CLI policy / AppSettings schema 对齐的阈值取值范围。 */
const MIN_THRESHOLD_PERCENT = 1;
const MAX_THRESHOLD_PERCENT = 100;

/**
 * 压缩设置页：按模型上下文窗口的百分比配置自动压缩触发时机。
 *
 * 语义：percent=100 表示跟随 CLI 默认策略（有效窗口减安全缓冲）；
 * 1-99 表示上下文用量达到完整窗口的该比例时提前触发自动压缩，
 * 适合长会话场景避免压缩请求贴着窗口上限发出。
 */
export function CompactSettingsSection({
  thresholdPercent,
  onThresholdPercentChange,
}: {
  thresholdPercent: number;
  onThresholdPercentChange: (value: number) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  // 输入框使用受控草稿：输入过程中允许临时非法值，失焦/回车才提交归一化结果。
  const [draft, setDraft] = useState(String(thresholdPercent));
  const customEnabled = thresholdPercent < MAX_THRESHOLD_PERCENT;

  useEffect(() => {
    setDraft(String(thresholdPercent));
  }, [thresholdPercent]);

  const commitThreshold = useCallback(
    (nextDraft: string) => {
      const parsed = nextDraft.trim() === "" ? Number.NaN : Number(nextDraft);
      const nextValue = Number.isFinite(parsed)
        ? Math.min(MAX_THRESHOLD_PERCENT, Math.max(MIN_THRESHOLD_PERCENT, Math.floor(parsed)))
        : thresholdPercent;
      setDraft(String(nextValue));
      if (nextValue !== thresholdPercent) {
        void onThresholdPercentChange(nextValue);
      }
    },
    [onThresholdPercentChange, thresholdPercent],
  );

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.compact.customEnabled" })}
        description={intl.formatMessage({ id: "settings.compact.customEnabledDescription" })}
        control={
          <Switch
            checked={customEnabled}
            onCheckedChange={(checked) => {
              // 打开自定义时沿用当前值；关闭时回到 100（默认策略）。
              void onThresholdPercentChange(
                checked ? Math.min(thresholdPercent, MAX_THRESHOLD_PERCENT - 1) : 100,
              );
            }}
          />
        }
      />
      {customEnabled ? (
        <SettingsRow
          label={intl.formatMessage({ id: "settings.compact.thresholdPercent" })}
          description={intl.formatMessage({ id: "settings.compact.thresholdPercentDescription" })}
          control={
            <div className="relative w-28">
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_THRESHOLD_PERCENT}
                max={MAX_THRESHOLD_PERCENT}
                step={1}
                value={draft}
                aria-label={intl.formatMessage({ id: "settings.compact.thresholdPercent" })}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onBlur={() => commitThreshold(draft)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setDraft(String(thresholdPercent));
                  }
                }}
                className="pr-8 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-ui-lg text-foreground-subtle">
                %
              </span>
            </div>
          }
        />
      ) : null}
      <SettingsRow
        label={intl.formatMessage({ id: "settings.compact.currentBehavior" })}
        description={intl.formatMessage({ id: "settings.compact.currentBehaviorDescription" })}
        control={
          <span className="text-ui-base text-foreground-subtle">
            {customEnabled
              ? intl.formatMessage(
                  { id: "settings.compact.currentBehaviorCustom" },
                  { percent: thresholdPercent },
                )
              : intl.formatMessage({ id: "settings.compact.currentBehaviorDefault" })}
          </span>
        }
      />
    </SettingsGroupCard>
  );
}
