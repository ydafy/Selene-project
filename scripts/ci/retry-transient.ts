// Runs a command and retries it when it fails with a server error, such as
// `unexpected deploy status 500: ...` from `supabase functions deploy` (CLI
// 3.1.0). Only a line with `status 5xx` counts as a server error: any other
// failure, including a 4xx, exits at once with the command's code. At most 3
// attempts, 30 s and then 60 s apart; the command must be safe to rerun. Its
// stdout and stderr stream to ours as they arrive. deploy-staging.yml runs the
// function deploy through it. Imports nothing, so a rollback can run main's
// copy from outside the checkout.

const USAGE = 'Usage: bun scripts/ci/retry-transient.ts -- <command> [args...]';
// The Supabase CLI prints the HTTP status of a failed Management API call
// this way. Narrow on purpose: a bare "500" elsewhere in the output is not one.
const SERVER_ERROR = /\bstatus 5\d\d\b/;
const DELAYS_MS = [30_000, 60_000];

export type RunResult = { exitCode: number; output: string };

export type RetryOptions = {
  spawn?: (command: string[]) => Promise<RunResult>;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
};

async function pipe(
  stream: ReadableStream<Uint8Array>,
  write: (chunk: Uint8Array) => void,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) {
    write(chunk);
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}

async function spawnStreaming(command: string[]): Promise<RunResult> {
  const child = Bun.spawn(command, {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    pipe(child.stdout, (chunk) => process.stdout.write(chunk)),
    pipe(child.stderr, (chunk) => process.stderr.write(chunk)),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

function serverErrorLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .find((line) => SERVER_ERROR.test(line))
    ?.trim();
}

// Returns the exit code to exit with.
export async function retryTransient(
  command: string[],
  {
    spawn = spawnStreaming,
    sleep = (ms) => Bun.sleep(ms),
    log = (line) => console.error(line),
  }: RetryOptions = {},
): Promise<number> {
  const attempts = DELAYS_MS.length + 1;
  for (let attempt = 1; ; attempt++) {
    const { exitCode, output } = await spawn(command);
    if (exitCode === 0) return 0;
    const matched = serverErrorLine(output);
    if (matched === undefined) return exitCode;
    const prefix = `retry-transient: attempt ${attempt} of ${attempts} failed with a server error (${matched})`;
    if (attempt === attempts) {
      log(`${prefix}; giving up.`);
      return exitCode;
    }
    const delay = DELAYS_MS[attempt - 1];
    log(`${prefix}; retrying in ${delay / 1000} s.`);
    await sleep(delay);
  }
}

if (import.meta.main) {
  // Bun drops the first `--` before the script sees its arguments.
  const args = process.argv.slice(2);
  const command = args[0] === '--' ? args.slice(1) : args;
  if (command.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(await retryTransient(command));
}
