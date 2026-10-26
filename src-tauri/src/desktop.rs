use tauri::{image::Image, AppHandle, LogicalSize, Manager, PhysicalPosition};

use crate::models::WidgetPreferences;

pub fn apply_preferences(app: &AppHandle, preferences: &WidgetPreferences) -> Result<(), String> {
    let window = app.get_webview_window("widget").ok_or("悬浮窗不可用。")?;
    window
        .set_always_on_top(preferences.always_on_top)
        .map_err(|_| "无法调整置顶状态。")?;
    window
        .set_ignore_cursor_events(preferences.locked)
        .map_err(|_| "无法调整鼠标穿透状态。")?;
    if preferences.display_mode == "tray" && app.tray_by_id("main").is_some() {
        window.hide().map_err(|_| "无法隐藏悬浮条。")?;
    } else {
        keep_on_screen(&window)?;
        window.show().map_err(|_| "无法显示悬浮条。")?;
    }
    Ok(())
}

fn keep_on_screen(window: &tauri::WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|_| "无法读取窗口位置。")?;
    let size = window.outer_size().map_err(|_| "无法读取窗口尺寸。")?;
    let monitors = window
        .available_monitors()
        .map_err(|_| "无法读取屏幕信息。")?;
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let area = monitor.work_area();
            position.x >= area.position.x
                && position.y >= area.position.y
                && position.x < area.position.x + area.size.width as i32
                && position.y < area.position.y + area.size.height as i32
        })
        .or_else(|| monitors.first());
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let x = position.x.clamp(
            area.position.x,
            (area.position.x + area.size.width as i32 - size.width as i32).max(area.position.x),
        );
        let y = position.y.clamp(
            area.position.y,
            (area.position.y + area.size.height as i32 - size.height as i32).max(area.position.y),
        );
        if (x, y) != (position.x, position.y) {
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(|_| "无法调整窗口位置。")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn resize_widget(
    window: tauri::WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if window.label() != "widget"
        || !width.is_finite()
        || !height.is_finite()
        || !(32.0..=320.0).contains(&width)
        || !(20.0..=40.0).contains(&height)
    {
        return Err("悬浮条尺寸无效。".into());
    }
    window
        .set_size(LogicalSize::new(width.ceil(), height.ceil()))
        .map_err(|_| "无法调整悬浮条尺寸。")?;
    keep_on_screen(&window)
}

pub fn balance_digits(value: f64) -> String {
    let value = value.max(0.0);
    if value >= 999_500.0 {
        format!("{:.0}M", (value / 1_000_000.0).min(999.0))
    } else if value >= 9950.0 {
        format!("{:.0}k", value / 1000.0)
    } else if value >= 1000.0 {
        format!("{:.1}k", value / 1000.0)
    } else if value > 0.0 && value < 1.0 {
        format!("{value:.1}")
    } else {
        format!("{value:.0}")
    }
}

// At most four bitmap glyphs: Windows scales the icon to its native tray size.
pub fn tray_image(text: &str, color: [u8; 4]) -> Image<'static> {
    const DIGITS: [[u8; 5]; 10] = [
        [7, 5, 5, 5, 7],
        [2, 6, 2, 2, 7],
        [7, 1, 7, 4, 7],
        [7, 1, 7, 1, 7],
        [5, 5, 7, 1, 1],
        [7, 4, 7, 1, 7],
        [7, 4, 7, 5, 7],
        [7, 1, 1, 1, 1],
        [7, 5, 7, 5, 7],
        [7, 5, 7, 1, 7],
    ];
    let glyphs: Vec<(usize, [u8; 5])> = text
        .chars()
        .take(4)
        .map(|c| {
            if let Some(digit) = c.to_digit(10) {
                (3, DIGITS[digit as usize])
            } else {
                match c {
                    '.' => (1, [0, 0, 0, 0, 4]),
                    'k' => (3, [4, 5, 6, 5, 5]),
                    'M' => (3, [5, 7, 7, 5, 5]),
                    _ => (3, [0, 0, 7, 0, 0]),
                }
            }
        })
        .collect();
    let width = glyphs
        .iter()
        .map(|(columns, _)| columns + 1)
        .sum::<usize>()
        .saturating_sub(1);
    let scale = if width <= 10 { 3 } else { 2 };
    let mut pixels = vec![0; 32 * 32 * 4];
    for y in 1..31 {
        for x in 0..32 {
            let index = (y * 32 + x) * 4;
            pixels[index..index + 4].copy_from_slice(&[24, 28, 35, 255]);
        }
    }
    let mut left = (32 - width * scale) / 2;
    let top = (32 - 5 * scale) / 2;
    for (columns, rows) in glyphs {
        for (y, row) in rows.iter().enumerate() {
            for x in 0..columns {
                if row & (1 << (2 - x)) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let index = ((top + y * scale + dy) * 32 + left + x * scale + dx) * 4;
                        pixels[index..index + 4].copy_from_slice(&color);
                    }
                }
            }
        }
        left += (columns + 1) * scale;
    }
    Image::new_owned(pixels, 32, 32)
}
