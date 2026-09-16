import { fileURLToPath } from "node:url";
import path from "node:path";

// Loads API keys (and anything else) from .env at the project root, without
// overriding values already set in the shell environment.
try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env"));
} catch {
  // no .env file — fine if keys are set some other way
}
