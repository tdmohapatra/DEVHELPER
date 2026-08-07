//! Passwords that outlive the session, held by the operating system.
//!
//! DevHelper's own rule is that it never writes a password to its own storage,
//! and that stays true here: nothing in this file persists anything DevHelper
//! can read back on its own. What it does is hand the secret to the platform's
//! credential store — Windows Credential Manager, the macOS keychain, the
//! Secret Service on Linux — which encrypts it against the logged-in user and
//! is the same place every other well-behaved application keeps one.
//!
//! The trade is explicit and opt-in per credential. Without it, every database
//! password is retyped at every launch, which in practice pushes people towards
//! keeping passwords in a text file instead — a worse outcome than using the
//! facility the OS provides for exactly this.

use keyring::Entry;

/// Namespace every DevHelper secret lands under in the OS store, so they are
/// identifiable and removable by the user outside the app.
const SERVICE: &str = "DevHelper";

/// Reject an account name that could not address a real entry.
///
/// An empty account silently collides with every other empty account, which
/// would let one saved password overwrite another.
fn entry_for(account: &str) -> Result<Entry, String> {
    let trimmed = account.trim();
    if trimmed.is_empty() {
        return Err("A credential needs an account name.".into());
    }
    Entry::new(SERVICE, trimmed).map_err(|e| format!("Could not address the credential store: {e}"))
}

/// Store (or replace) a secret under `account`.
#[tauri::command]
pub fn secret_set(account: String, secret: String) -> Result<(), String> {
    entry_for(&account)?
        .set_password(&secret)
        .map_err(|e| format!("Could not save to the credential store: {e}"))
}

/// Read a secret back. `None` means no entry, which is not an error.
#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
    match entry_for(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read from the credential store: {e}")),
    }
}

/// Remove a secret. Deleting one that is not there succeeds — the caller asked
/// for it to be gone, and it is.
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
    match entry_for(&account)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove from the credential store: {e}")),
    }
}

/// Is a usable credential store present?
///
/// Probed by writing and removing a marker rather than by inspecting the
/// platform: a headless Linux session can have the Secret Service missing at
/// runtime even though the build supports it, and the only honest answer comes
/// from trying.
#[tauri::command]
pub fn secret_available() -> bool {
    let probe = match Entry::new(SERVICE, "__devhelper_probe__") {
        Ok(e) => e,
        Err(_) => return false,
    };
    if probe.set_password("probe").is_err() {
        return false;
    }
    let ok = probe.get_password().is_ok();
    let _ = probe.delete_credential();
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_account_is_refused_rather_than_colliding() {
        assert!(entry_for("   ").is_err());
        assert!(secret_set("".into(), "x".into()).is_err());
    }

    #[test]
    fn reading_a_secret_that_was_never_stored_is_not_an_error() {
        // A fresh, deliberately unusual account name: nothing has stored one.
        let account = "devhelper-test-never-stored-9f3a".to_string();
        match secret_get(account) {
            Ok(v) => assert!(v.is_none()),
            // A machine with no credential store at all reports an error here,
            // which is a legitimate environment rather than a failing test.
            Err(_) => {}
        }
    }

    #[test]
    fn deleting_something_absent_succeeds() {
        let account = "devhelper-test-absent-4b1c".to_string();
        if secret_available() {
            assert!(secret_delete(account).is_ok());
        }
    }

    #[test]
    fn a_stored_secret_round_trips_and_can_be_removed() {
        if !secret_available() {
            return; // no credential store in this environment
        }
        let account = "devhelper-test-roundtrip-77de".to_string();
        secret_set(account.clone(), "hunter2".into()).expect("set");
        assert_eq!(secret_get(account.clone()).expect("get"), Some("hunter2".into()));
        secret_set(account.clone(), "hunter3".into()).expect("replace");
        assert_eq!(secret_get(account.clone()).expect("get"), Some("hunter3".into()));
        secret_delete(account.clone()).expect("delete");
        assert_eq!(secret_get(account).expect("get"), None);
    }
}
