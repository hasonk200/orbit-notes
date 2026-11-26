use std::{
    fs,
    io::{ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const MAX_LOCAL_MD_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

fn is_markdown_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("md") | Some("markdown")
    )
}

fn extract_markdown_arg(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = Path::new(arg);
        if p.is_file() && is_markdown_file(p) {
            return Some(arg.clone());
        }
    }
    None
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn take_pending_files(pending: State<'_, PendingFiles>) -> Vec<String> {
    let mut guard = pending.0.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

#[tauri::command]
fn read_local_markdown(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !is_markdown_file(p) {
        return Err("Only .md and .markdown files can be opened directly.".into());
    }
    let meta = fs::metadata(p).map_err(|e| format!("Could not inspect file: {e}"))?;
    if !meta.is_file() {
        return Err("Target path is not a file.".into());
    }
    if meta.len() > MAX_LOCAL_MD_BYTES {
        return Err("Markdown file exceeds the 5 MB direct editor limit.".into());
    }
    fs::read_to_string(p).map_err(|e| format!("Could not read Markdown file: {e}"))
}

#[tauri::command]
fn write_local_markdown(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !is_markdown_file(p) {
        return Err("Only .md and .markdown files can be saved directly.".into());
    }
    fs::write(p, content.as_bytes()).map_err(|e| format!("Could not save Markdown file: {e}"))
}

#[tauri::command]
fn open_local_path(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if parsed.scheme() != "file" {
        return Err("Only file:// links can be opened locally.".into());
    }
    let path = parsed
        .to_file_path()
        .map_err(|_| "Could not convert file:// URL into a local path.".to_string())?;
    app.opener()
        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string()),
        _ => Err("Unsupported external URL scheme.".into()),
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<(String, String), String> {
    stream
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;

    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 2048];
    let mut header_end = None;
    let mut content_length = 0usize;

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() + n > 32 * 1024 {
                    return Err("Request too large.".into());
                }
                buf.extend_from_slice(&chunk[..n]);
                if header_end.is_none() {
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        header_end = Some(pos);
                        let headers = String::from_utf8_lossy(&buf[..pos]);
                        for line in headers.lines() {
                            if let Some((k, v)) = line.split_once(':') {
                                if k.trim().eq_ignore_ascii_case("content-length") {
                                    content_length = v.trim().parse::<usize>().unwrap_or(0);
                                }
                            }
                        }
                    }
                }
                if let Some(end) = header_end {
                    let body_start = end + 4;
                    if buf.len() >= body_start + content_length {
                        break;
                    }
                }
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock || e.kind() == ErrorKind::TimedOut => break,
            Err(e) => return Err(e.to_string()),
        }
    }

    let end = header_end.ok_or_else(|| "Malformed HTTP request.".to_string())?;
    let head = String::from_utf8_lossy(&buf[..end]).into_owned();
    let request_line = head.lines().next().unwrap_or("").to_string();
    let body_start = end + 4;
    let body_end = (body_start + content_length).min(buf.len());
    let body = String::from_utf8_lossy(&buf[body_start..body_end]).into_owned();
    Ok((request_line, body))
}

fn send_http_response(stream: &mut TcpStream, status: &str, body_html: &str) {
    let bytes = body_html.as_bytes();
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        bytes.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(bytes);
    let _ = stream.flush();
}

#[tauri::command]
async fn desktop_google_sign_in(app: tauri::AppHandle, web_app_url: String) -> Result<String, String> {
    if !web_app_url.starts_with("https://") {
        return Err("Desktop sign-in bridge URL must use HTTPS.".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        let mut nonce = [0u8; 16];
        getrandom::getrandom(&mut nonce).map_err(|e| format!("Failed to generate state: {e}"))?;
        let expected_state: String = nonce.iter().map(|b| format!("{b:02x}")).collect();

        let auth_url = format!(
            "{}/desktop-auth?port={}&state={}",
            web_app_url.trim_end_matches('/'),
            port,
            expected_state
        );
        app.opener()
            .open_url(auth_url, None::<&str>)
            .map_err(|e| e.to_string())?;

        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(180);

        while Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let Ok((req_line, body)) = read_http_request(&mut stream) else {
                        continue;
                    };
                    if !req_line.starts_with("POST /callback") {
                        let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
                        let _ = stream.flush();
                        continue;
                    }

                    let mut got_state: Option<String> = None;
                    let mut got_token: Option<String> = None;
                    for (k, v) in url::form_urlencoded::parse(body.as_bytes()) {
                        match k.as_ref() {
                            "state" => got_state = Some(v.into_owned()),
                            "access_token" => got_token = Some(v.into_owned()),
                            _ => {}
                        }
                    }

                    if got_state.as_deref() == Some(expected_state.as_str()) {
                        if let Some(token) = got_token.filter(|t| !t.is_empty()) {
                            let ok_html = r#"<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>Orbit</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f7f6f3;color:#1f1e1c;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #e8e6e1;border-radius:14px;padding:28px 32px;text-align:center;max-width:380px;box-shadow:0 8px 24px rgba(20,18,14,.08)}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#55534e;margin:0}</style></head><body><main><h1>已登入 Orbit 桌面版</h1><p>可以關閉呢個分頁並返回 Orbit 視窗。</p><script>setTimeout(function(){window.close()},1200)</script></main></body></html>"#;
                            send_http_response(&mut stream, "200 OK", ok_html);
                            show_main(&app);
                            return Ok(token);
                        }
                    }

                    let err_html = "<!doctype html><html><body><p>Invalid sign-in callback.</p></body></html>";
                    send_http_response(&mut stream, "400 Bad Request", err_html);
                    return Err("Invalid sign-in callback.".into());
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(40));
                }
                Err(e) => return Err(e.to_string()),
            }
        }

        Err("Sign-in timed out. Please try again.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingFiles::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            if let Some(path) = extract_markdown_arg(&args) {
                if let Some(pending) = app.try_state::<PendingFiles>() {
                    pending.0.lock().unwrap_or_else(|e| e.into_inner()).push(path.clone());
                }
                let _ = app.emit("orbit://open-file", path);
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_main(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            open_local_path,
            open_external_url,
            show_main_window,
            desktop_google_sign_in,
            take_pending_files,
            read_local_markdown,
            write_local_markdown
        ])
        .setup(|app| {
            let cli_args: Vec<String> = std::env::args().collect();
            if let Some(path) = extract_markdown_arg(&cli_args) {
                if let Some(pending) = app.try_state::<PendingFiles>() {
                    pending.0.lock().unwrap_or_else(|e| e.into_inner()).push(path);
                }
            }

            let show_item = MenuItem::with_id(app, "show", "Show Orbit", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Orbit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Orbit")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;

            let _ = app.global_shortcut().register("CmdOrCtrl+Shift+O");

            // Failsafe: ensure the main window is shown even if frontend boot stalls.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(1500));
                show_main(&handle);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Orbit desktop app");
}
