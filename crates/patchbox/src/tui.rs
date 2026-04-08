//! Terminal UI — ratatui-based live dashboard.
//!
//! Launched with `--tui` flag. Runs in a blocking thread alongside the axum
//! server so the two don't fight over the tokio runtime.
//!
//! Layout:
//!   ┌─ header ──────────────────────────────────────────────┐
//!   │ DANTE PATCHBOX  v0.1.0  ·  8×8  ·  http://0.0.0.0:9191 │
//!   ├─ meters ──────────────────────────┬─ matrix ──────────┤
//!   │ IN 1  ████████░░░░  -12 dB        │ · · · · · · · ·   │
//!   │ IN 2  ██░░░░░░░░░░  -28 dB        │ █ · · · · · · ·   │
//!   │ ...                               │ ...               │
//!   ├─ outputs ─────────────────────────┤                   │
//!   │ OUT 1 ████████████   -3 dB        │                   │
//!   │ ...                               │                   │
//!   ├─ status bar ──────────────────────┴───────────────────┤
//!   │ q quit │ r refresh │ Dante: stub                       │
//!   └───────────────────────────────────────────────────────┘

use std::io;
use std::time::{Duration, Instant};

use crossterm::{
    event::{self, Event, KeyCode, KeyModifiers},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Gauge, Paragraph},
    Frame, Terminal,
};

use crate::state::SharedState;

/// Entry point: runs the TUI in the current thread until the user quits.
/// Call from a `tokio::task::spawn_blocking` closure.
pub fn run(state: SharedState, port: u16) -> anyhow::Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let tick = Duration::from_millis(50); // ~20 Hz
    let mut last_tick = Instant::now();

    loop {
        terminal.draw(|f| ui(f, &state, port))?;

        let timeout = tick.saturating_sub(last_tick.elapsed());
        if event::poll(timeout)? {
            if let Event::Key(key) = event::read()? {
                match (key.code, key.modifiers) {
                    (KeyCode::Char('q'), _)
                    | (KeyCode::Char('c'), KeyModifiers::CONTROL) => break,
                    _ => {}
                }
            }
        }
        if last_tick.elapsed() >= tick {
            last_tick = Instant::now();
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}

// ── Rendering ─────────────────────────────────────────────────────────────

fn ui(f: &mut Frame, state: &SharedState, port: u16) {
    let area = f.area();

    // Outer layout: header / body / status
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),  // header
            Constraint::Min(4),     // body
            Constraint::Length(1),  // status bar
        ])
        .split(area);

    draw_header(f, outer[0], state, port);
    draw_body(f, outer[1], state);
    draw_statusbar(f, outer[2]);
}

fn draw_header(f: &mut Frame, area: Rect, state: &SharedState, port: u16) {
    // Best-effort read — show stale data if locked
    let (n_in, n_out) = {
        if let Ok(p) = state.params.try_read() {
            (p.matrix.inputs, p.matrix.outputs)
        } else {
            (0, 0)
        }
    };

    let text = Line::from(vec![
        Span::styled(" DANTE PATCHBOX ", Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD)),
        Span::raw(format!("  v{}  ·  {}×{}  ·  http://0.0.0.0:{}",
            env!("CARGO_PKG_VERSION"), n_in, n_out, port)),
    ]);
    f.render_widget(Paragraph::new(text), area);
}

fn draw_body(f: &mut Frame, area: Rect, state: &SharedState) {
    let cols = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(area);

    draw_meters(f, cols[0], state);
    draw_matrix(f, cols[1], state);
}

fn draw_meters(f: &mut Frame, area: Rect, state: &SharedState) {
    let (inputs, outputs, in_labels, out_labels) = {
        if let (Ok(meters), Ok(params)) = (state.meters.try_read(), state.params.try_read()) {
            (
                meters.inputs.clone(),
                meters.outputs.clone(),
                params.inputs.iter().map(|s| s.label.clone()).collect::<Vec<_>>(),
                params.outputs.iter().map(|s| s.label.clone()).collect::<Vec<_>>(),
            )
        } else {
            return;
        }
    };

    let split = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    // Input meters
    let in_block = Block::default().borders(Borders::ALL).title(" INPUTS ");
    let in_inner = in_block.inner(split[0]);
    f.render_widget(in_block, split[0]);
    render_meter_list(f, in_inner, &inputs, &in_labels, Color::Green);

    // Output meters
    let out_block = Block::default().borders(Borders::ALL).title(" OUTPUTS ");
    let out_inner = out_block.inner(split[1]);
    f.render_widget(out_block, split[1]);
    render_meter_list(f, out_inner, &outputs, &out_labels, Color::Cyan);
}

fn render_meter_list(f: &mut Frame, area: Rect, levels: &[f32], labels: &[String], color: Color) {
    if area.height == 0 || area.width < 10 { return; }

    let n = levels.len().min(area.height as usize);
    let constraints: Vec<Constraint> = (0..n).map(|_| Constraint::Length(1)).collect();
    if constraints.is_empty() { return; }

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(area);

    for (i, (&db, lbl)) in levels.iter().zip(labels.iter()).enumerate().take(n) {
        if i >= rows.len() { break; }
        let row = rows[i];
        if row.width < 10 { continue; }

        // Label (fixed 6 chars)
        let label_w: u16 = 7;
        let bar_w = row.width.saturating_sub(label_w + 8);
        if bar_w == 0 { continue; }

        let lbl_area = Rect { x: row.x, y: row.y, width: label_w.min(row.width), height: 1 };
        let bar_area = Rect { x: row.x + label_w, y: row.y, width: bar_w, height: 1 };
        let val_area = Rect { x: row.x + label_w + bar_w, y: row.y, width: row.width.saturating_sub(label_w + bar_w), height: 1 };

        // Label
        let short_lbl = lbl.chars().take(6).collect::<String>();
        f.render_widget(
            Paragraph::new(format!("{:<6} ", short_lbl)).style(Style::default().fg(Color::Gray)),
            lbl_area,
        );

        // Gauge (db -60..0 → 0..100%)
        let pct = ((db + 60.0) / 60.0 * 100.0).clamp(0.0, 100.0) as u16;
        let bar_color = if pct > 95 { Color::Red } else if pct > 75 { Color::Yellow } else { color };
        let gauge = Gauge::default()
            .gauge_style(Style::default().fg(bar_color).bg(Color::DarkGray))
            .percent(pct)
            .label("");
        f.render_widget(gauge, bar_area);

        // dB value
        let db_str = if db <= -59.0 { "  -∞".to_owned() } else { format!("{:>4.0}", db) };
        f.render_widget(
            Paragraph::new(format!(" {}", db_str)).style(Style::default().fg(Color::DarkGray)),
            val_area,
        );
    }
}

fn draw_matrix(f: &mut Frame, area: Rect, state: &SharedState) {
    let block = Block::default().borders(Borders::ALL).title(" MATRIX ");
    let inner = block.inner(area);
    f.render_widget(block, area);

    let params = match state.params.try_read() {
        Ok(p) => p,
        Err(_) => return,
    };

    let n_in  = params.matrix.inputs;
    let n_out = params.matrix.outputs;

    if inner.width < 4 || inner.height < 2 { return; }

    // Header row: output short labels
    let max_out = ((inner.width as usize).saturating_sub(8)) / 2;
    let show_out = n_out.min(max_out);

    let mut header_spans = vec![Span::raw(format!("{:<7} ", "IN\\OUT"))];
    for o in 0..show_out {
        let lbl = &params.outputs[o].label;
        let short: String = lbl.chars().take(2).collect();
        header_spans.push(Span::styled(
            format!("{:>2} ", short),
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ));
    }
    f.render_widget(
        Paragraph::new(Line::from(header_spans))
            .style(Style::default().add_modifier(Modifier::UNDERLINED)),
        Rect { x: inner.x, y: inner.y, width: inner.width, height: 1 },
    );

    // Matrix rows
    let max_rows = (inner.height as usize).saturating_sub(1);
    let show_in = n_in.min(max_rows);

    for i in 0..show_in {
        let row_y = inner.y + 1 + i as u16;
        if row_y >= inner.y + inner.height { break; }

        let inp = &params.inputs[i];
        let mut row_spans = vec![
            Span::styled(
                format!("{:<6} ", inp.label.chars().take(6).collect::<String>()),
                if inp.mute {
                    Style::default().fg(Color::Red)
                } else {
                    Style::default().fg(Color::White)
                },
            )
        ];

        for o in 0..show_out {
            let gain = params.matrix.gains[i][o];
            let (ch, style) = if gain > 0.0 {
                let color = if gain >= 1.0 { Color::Green } else { Color::Yellow };
                ("██", Style::default().fg(color))
            } else {
                ("··", Style::default().fg(Color::DarkGray))
            };
            row_spans.push(Span::styled(format!("{} ", ch), style));
        }

        f.render_widget(
            Paragraph::new(Line::from(row_spans)),
            Rect { x: inner.x, y: row_y, width: inner.width, height: 1 },
        );
    }
}

fn draw_statusbar(f: &mut Frame, area: Rect) {
    let text = Line::from(vec![
        Span::styled(" q ", Style::default().fg(Color::Black).bg(Color::DarkGray)),
        Span::raw(" quit  "),
        Span::styled(" Ctrl+C ", Style::default().fg(Color::Black).bg(Color::DarkGray)),
        Span::raw(" quit  │  Dante: stub (compile --features inferno for real audio)"),
    ]);
    f.render_widget(Paragraph::new(text).style(Style::default().fg(Color::Gray)), area);
}
