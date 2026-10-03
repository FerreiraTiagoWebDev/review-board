import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when the module at `url` is the script node was started with. */
export function isMain(url) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/** Runs a CLI body, printing errors without a stack trace and exiting 1. */
export function run(main) {
  try {
    main();
  } catch (error) {
    console.error(`review-board: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
