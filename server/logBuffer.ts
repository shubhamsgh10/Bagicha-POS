const LOG_BUFFER: { ts: string; source: string; message: string }[] = [];
const MAX_LOG_ENTRIES = 200;

export function pushLog(source: string, message: string) {
  LOG_BUFFER.push({ ts: new Date().toISOString(), source, message });
  if (LOG_BUFFER.length > MAX_LOG_ENTRIES) LOG_BUFFER.shift();
}

export function getLogBuffer() {
  return [...LOG_BUFFER];
}
