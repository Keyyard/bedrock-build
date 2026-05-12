import pc from "picocolors";

let verbose = false;

export function setVerbose(value: boolean): void {
  verbose = value;
}

export function isVerbose(): boolean {
  return verbose;
}

const prefix = `[bedrock-build]`;

function emit(stream: NodeJS.WriteStream, line: string): void {
  stream.write(line + "\n");
}

export const logger = {
  info(message: string): void {
    emit(process.stdout, `${pc.cyan(prefix)} 📦 ${message}`);
  },
  success(message: string): void {
    emit(process.stdout, `${pc.green(prefix)} ✅ ${message}`);
  },
  warn(message: string): void {
    emit(process.stderr, `${pc.yellow(prefix)} ⚠️  ${message}`);
  },
  error(message: string): void {
    emit(process.stderr, `${pc.red(prefix)} ❌ ${message}`);
  },
  debug(message: string): void {
    if (!verbose) return;
    emit(process.stdout, `${pc.gray(`${prefix} [debug]`)} ${pc.gray(message)}`);
  },
};
