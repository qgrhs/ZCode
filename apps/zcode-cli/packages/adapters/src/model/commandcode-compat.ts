type ProviderFetch = typeof globalThis.fetch;

/**
 * Command Code 网关（api.commandcode.ai）兼容层。
 *
 * 背景：该网关背后的上游对 OpenAI Responses 报文做严格校验，要求 input[]
 * 中每个 message 项都带显式顶层 `type: "message"`；而 AI SDK 按 OpenAI 规范
 * 省略该字段（role + content 即隐含 message），上游返回 400 MissingParameter
 * （missing `input.type`）。DeepSeek 官方对两种写法都接受，补字段无副作用。
 *
 * 触发条件按 baseURL 精确圈定在 commandcode.ai，避免影响其他 Responses 供应商。
 */
export function createCommandCodeCompatFetch(baseURL: string, baseFetch: ProviderFetch): ProviderFetch {
  const host = safeHost(baseURL);
  if (host !== "api.commandcode.ai") {
    return baseFetch;
  }
  return async (input, init) => {
    return baseFetch(input, applyCommandCodeRequestBodyCompatibility(init));
  };
}

function applyCommandCodeRequestBodyCompatibility(
  init: RequestInit | undefined,
): RequestInit | undefined {
  if (typeof init?.body !== "string") return init;

  const body = safeParseRecord(init.body);
  if (!body || !Array.isArray(body.input)) return init;

  const patchedInput = body.input.map((item) => {
    const record = asRecord(item);
    // 缺顶层 type 且带 role 的项即 message 项；已有 type（function_call、
    // reasoning、item_reference 等）或非对象项保持原样。
    if (!record || typeof record.type === "string" || typeof record.role !== "string") {
      return item;
    }
    return { type: "message", ...record };
  });

  return { ...init, body: JSON.stringify({ ...body, input: patchedInput }) };
}

function safeParseRecord(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
