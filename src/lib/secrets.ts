/**
 * Passwords kept by the operating system rather than by DevHelper.
 *
 * DevHelper does not write passwords to its own storage, and that has meant
 * retyping every database password at every launch. In practice that pushes
 * people towards keeping credentials in a text file, which is worse than using
 * the facility the OS already provides.
 *
 * These wrappers talk to the platform credential store through Rust. Nothing
 * here is enabled by default: a secret is only stored when someone ticks the
 * box for that specific credential, and removing it is one call.
 *
 * Account names are namespaced by prefix so the DB vault and the AI key cannot
 * collide, and so what DevHelper owns is recognisable in the OS's own UI.
 */

import { invokeNative, isTauri, NativeUnavailableError } from "./platform";

/** Account name for a database server account, matching the session vault's key. */
export function dbAccount(credentialKey: string): string {
  return `db:${credentialKey}`;
}

/** Account name for the configured AI provider's API key. */
export function aiAccount(provider: string): string {
  return `ai:${provider}`;
}

/**
 * Is there a usable credential store?
 *
 * Cached after the first probe: the answer cannot change while the app runs,
 * and the probe writes and deletes a marker entry, which is not something to
 * repeat on every render.
 */
let availability: Promise<boolean> | null = null;

export function secretsAvailable(): Promise<boolean> {
  if (!isTauri()) return Promise.resolve(false);
  availability ??= invokeNative<boolean>("secret_available").catch(() => false);
  return availability;
}

/** Forget the cached probe. Only useful in tests. */
export function resetSecretsProbe(): void {
  availability = null;
}

/**
 * Read a stored secret. Missing is `null`, not an error.
 *
 * A failure to reach the store is also `null`: a saved password that cannot be
 * read is indistinguishable, from the caller's point of view, from one that was
 * never saved — both mean "ask the user".
 */
export async function getSecret(account: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return (await invokeNative<string | null>("secret_get", { account })) ?? null;
  } catch (e) {
    if (e instanceof NativeUnavailableError) return null;
    return null;
  }
}

/**
 * Store a secret, replacing any previous value.
 *
 * Errors propagate: someone ticked a box asking for this, and silently not
 * doing it would leave them believing a password is saved when it is not.
 */
export async function setSecret(account: string, secret: string): Promise<void> {
  if (!isTauri()) throw new Error("Saving passwords needs the desktop app.");
  await invokeNative<void>("secret_set", { account, secret });
}

/** Remove a secret. Removing one that is not there is not an error. */
export async function deleteSecret(account: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invokeNative<void>("secret_delete", { account });
  } catch {
    // Nothing useful to do: the caller wanted it gone, and either it is or the
    // store is unreachable, in which case reporting it changes nothing.
  }
}

/**
 * Which of these accounts have a stored secret.
 *
 * The OS stores cannot be enumerated by service, so presence is established by
 * asking for each one. Fine for the handful of accounts DevHelper deals with.
 */
export async function storedAccounts(accounts: string[]): Promise<string[]> {
  const results = await Promise.all(
    accounts.map(async (account) => ((await getSecret(account)) !== null ? account : null)),
  );
  return results.filter((a): a is string => a !== null);
}
