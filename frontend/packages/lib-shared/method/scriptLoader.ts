interface ScriptOptions {
  identifier: string;
}

export function loadScript(_scriptContent: string, _options: ScriptOptions): Promise<void> {
  return Promise.reject(new Error('远程脚本执行已关闭'));
}
