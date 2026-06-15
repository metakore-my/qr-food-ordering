// Single source of truth for the displayed app version.
// `package.json` `version` IS the source of truth (bump it per release).
// Re-exported here so both the customer footer and the admin sidebar render the
// same string and it auto-bumps every release with no hardcoded duplicate.
//
// Client-safe: only the `version` string is pulled in, not secrets — package.json
// holds no secrets, and bundlers tree-shake the single field. The "v" prefix is
// added at the display site, not here, so callers get the bare SemVer string.
import { version } from "../../package.json";

export const APP_VERSION: string = version;
