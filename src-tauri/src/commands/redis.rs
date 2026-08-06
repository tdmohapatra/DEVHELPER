use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::time::Duration;

/// Execute a single Redis command via a minimal RESP client (no external crate).
/// `args` is the full command, e.g. ["GET", "mykey"]. Returns the reply as JSON.
///
/// Each call opens its own connection, so anything that depends on connection
/// state — MULTI, WATCH, SUBSCRIBE — cannot span two calls. `db` is the one piece
/// of that state worth carrying: it is applied with SELECT on this connection
/// before the command runs, so key operations address the database the caller
/// meant rather than always database 0.
#[tauri::command]
pub fn redis_exec(
    host: String,
    port: u16,
    password: Option<String>,
    db: Option<u32>,
    args: Vec<String>,
) -> Result<Value, String> {
    let addr = format!("{host}:{port}");
    let stream = TcpStream::connect(&addr).map_err(|e| format!("Connect failed: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .map_err(|e| e.to_string())?;
    let mut writer = stream.try_clone().map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream);

    if let Some(pw) = password.filter(|p| !p.is_empty()) {
        write_command(&mut writer, &["AUTH".to_string(), pw])?;
        read_reply(&mut reader)?; // consume AUTH reply (errors surface here)
    }

    // SELECT is skipped for database 0: it is already the default, and a server
    // in cluster mode rejects SELECT outright even for 0.
    if let Some(index) = db.filter(|d| *d != 0) {
        write_command(&mut writer, &["SELECT".to_string(), index.to_string()])?;
        read_reply(&mut reader)?;
    }

    write_command(&mut writer, &args)?;
    read_reply(&mut reader)
}

fn write_command(w: &mut impl Write, args: &[String]) -> Result<(), String> {
    let mut buf = format!("*{}\r\n", args.len());
    for a in args {
        buf.push_str(&format!("${}\r\n{}\r\n", a.len(), a));
    }
    w.write_all(buf.as_bytes()).map_err(|e| e.to_string())?;
    w.flush().map_err(|e| e.to_string())
}

fn read_line(r: &mut impl BufRead) -> Result<String, String> {
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

fn read_reply(r: &mut impl BufRead) -> Result<Value, String> {
    let line = read_line(r)?;
    let mut chars = line.chars();
    let prefix = chars.next().ok_or("Empty reply")?;
    let rest: String = chars.collect();

    match prefix {
        '+' => Ok(Value::String(rest)),
        '-' => Err(rest),
        ':' => Ok(Value::from(rest.parse::<i64>().unwrap_or(0))),
        '$' => {
            let len: i64 = rest.parse().map_err(|_| "Bad bulk length")?;
            if len < 0 {
                return Ok(Value::Null);
            }
            let mut buf = vec![0u8; len as usize + 2]; // include trailing CRLF
            r.read_exact(&mut buf).map_err(|e| e.to_string())?;
            buf.truncate(len as usize);
            Ok(Value::String(String::from_utf8_lossy(&buf).to_string()))
        }
        '*' => {
            let n: i64 = rest.parse().map_err(|_| "Bad array length")?;
            if n < 0 {
                return Ok(Value::Null);
            }
            let mut arr = Vec::with_capacity(n as usize);
            for _ in 0..n {
                arr.push(read_reply(r)?);
            }
            Ok(Value::Array(arr))
        }
        other => Err(format!("Unexpected RESP prefix: {other}")),
    }
}
