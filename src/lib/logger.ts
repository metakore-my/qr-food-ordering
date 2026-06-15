type LogData = Record<string, unknown>;

function fmt(tag: string, msg: string, data?: LogData): string {
  const base = `[${tag}] ${msg}`;
  return data ? `${base} ${JSON.stringify(data)}` : base;
}

export const log = {
  debug(tag: string, msg: string, data?: LogData) {
    if (process.env.NODE_ENV !== "production") {
      console.log(fmt(tag, msg, data));
    }
  },
  info(tag: string, msg: string, data?: LogData) {
    console.log(fmt(tag, msg, data));
  },
  warn(tag: string, msg: string, data?: LogData) {
    console.warn(fmt(tag, msg, data));
  },
  error(tag: string, msg: string, data?: LogData) {
    console.error(fmt(tag, msg, data));
  },
};
