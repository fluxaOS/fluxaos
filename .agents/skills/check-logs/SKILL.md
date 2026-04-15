---
name: "check-logs"
description: "Log analysis for systemd journal and application logs."
---
# Check Logs

Ad-hoc log analysis for debugging, post-deployment checks, or quick health reads.

**Project capabilities:** webapp=false, service_name=, has_logs=false

If `false` is `false` AND `` is empty, report "NO LOGS APPLICABLE — this project has no logs or service" and **STOP**.

## Usage

```bash
/check-logs              # Default: last 15 minutes, all services
/check-logs 30           # Last 30 minutes
/check-logs webapp       # Specific service
/check-logs webapp 60    # Specific service, last 60 minutes
```

**Arguments:** `$ARGUMENTS`

## Step 1: Parse Arguments

Parse `$ARGUMENTS` to determine time range and service filter:

| Argument Pattern | Time Range | Service Filter |
|-----------------|------------|----------------|
| *(empty)* | 15 minutes | all |
| `<number>` | N minutes | all |
| `<service>` | 15 minutes | specific service |
| `<service> <number>` | N minutes | specific service |

**Detection:** If `$ARGUMENTS` contains a bare number, treat it as the time range. If it contains a non-numeric word, treat it as the service name. Both can be combined in either order.

---

## Step 2: Check Systemd Journal Logs

Query systemd journal for the specified time window.

**If a specific service was requested:**

```bash
# Check for errors/warnings in the specified service
sudo journalctl -u <service> --since "<N> minutes ago" --no-pager 2>/dev/null | grep -iE "error|critical|exception|traceback|fatal" | tail -30
```

```bash
# Check for warnings separately
sudo journalctl -u <service> --since "<N> minutes ago" --no-pager 2>/dev/null | grep -iE "warning|deprecat" | tail -20
```

**If no service was specified (all services):**

```bash
# Check common service patterns for errors
for unit in $(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | grep -iE "gunicorn|uvicorn|webapp|flask|celery|redis|postgres|nginx|caddy" | head -10); do
    echo "=== $unit ==="
    sudo journalctl -u "$unit" --since "<N> minutes ago" --no-pager 2>/dev/null | grep -iE "error|critical|exception|traceback|fatal|warning" | tail -10
done
```

**If journalctl is unavailable or returns no units:** Note this in the report and continue to Step 3 (file-based logs).

---

## Step 3: Check Application Log Files

Discover and analyze file-based application logs.

### 3a. Discover Log Directory

```bash
# Config-driven discovery via CLI
LOG_DIR=$(flu logs list 2>&1 | head -1 | sed -n 's/.*(\(.*\)).*/\1/p')
if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    LOG_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/logs"
fi
```

### 3b. Analyze Log Files

If `LOG_DIR` exists and contains log files:

```bash
# Find log files modified within the time window
find "$LOG_DIR" -name "*.log" -mmin -<N> -type f 2>/dev/null | while read -r logfile; do
    echo "=== $(basename "$logfile") ==="

    # Count total lines in the time window (approximate via recent entries)
    TOTAL=$(wc -l < "$logfile")

    # Extract errors
    ERRORS=$(grep -ciE "error|critical|exception|traceback|fatal" "$logfile" 2>/dev/null || echo 0)

    # Extract warnings
    WARNINGS=$(grep -ciE "warning|deprecat" "$logfile" 2>/dev/null || echo 0)

    echo "  Total lines: $TOTAL | Errors: $ERRORS | Warnings: $WARNINGS"

    # Show representative error samples (last N minutes worth)
    if [ "$ERRORS" -gt 0 ]; then
        echo "  --- Error samples ---"
        grep -iE "error|critical|exception|traceback|fatal" "$logfile" | tail -10
    fi

    if [ "$WARNINGS" -gt 0 ]; then
        echo "  --- Warning samples ---"
        grep -iE "warning|deprecat" "$logfile" | tail -5
    fi
done
```

**If no log directory or no log files found:** Note this in the report. This is not an error — the service may not use file-based logging.

---

## Step 4: Anomaly Detection

After collecting errors and warnings, check for anomaly patterns:

### 4a. Repeated Error Patterns

```bash
# Find repeated error messages (same error appearing 3+ times)
if [ -d "$LOG_DIR" ]; then
    for logfile in "$LOG_DIR"/*.log; do
        [ -f "$logfile" ] || continue
        grep -iE "error|exception" "$logfile" 2>/dev/null \
            | sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}[T ][0-9:.]*//g' \
            | sort | uniq -c | sort -rn | head -5 \
            | awk '$1 >= 3 {print "  REPEATED ("$1"x):", substr($0, index($0,$2))}'
    done
fi
```

### 4b. Service Restart Indicators

```bash
# Check for recent service restarts (indicates instability)
if command -v systemctl &>/dev/null; then
    for unit in $(systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | grep -iE "gunicorn|uvicorn|webapp|flask|celery" | head -5); do
        RESTARTS=$(systemctl show "$unit" --property=NRestarts 2>/dev/null | cut -d= -f2)
        if [ -n "$RESTARTS" ] && [ "$RESTARTS" -gt 0 ]; then
            echo "  SERVICE RESTART: $unit has restarted $RESTARTS time(s)"
        fi
    done
fi
```

---

## Step 5: Generate Report

Compile all findings into a structured report:

```markdown
## Log Analysis Report

**Time window:** Last N minutes
**Service filter:** [all | specific-service]
**Scan time:** [current timestamp]

---

### Summary

| Source | Errors | Warnings | Anomalies |
|--------|--------|----------|-----------|
| systemd journal | X | Y | Z |
| Application logs | X | Y | Z |
| **Total** | **X** | **Y** | **Z** |

### Verdict

[One of the following:]
- **CLEAN** — No issues found in the last N minutes.
- **WARNINGS ONLY** — N warnings found, no errors. Review if relevant.
- **ERRORS FOUND** — N errors require attention. See details below.
- **NO LOGS AVAILABLE** — No log sources found. Check service status.

---

### Errors (if any)

[Grouped by source with representative samples]

#### systemd: <service-name>
```
[error line 1]
[error line 2]
```

#### Application log: <filename>
```
[error line 1]
[error line 2]
```

### Warnings (if any)

[Grouped by source with representative samples]

### Anomalies (if any)

| Type | Detail |
|------|--------|
| Repeated error | "[message]" appeared N times |
| Service restart | <service> restarted N times |

---

### Recommended Actions

[Based on findings:]
- If errors found: "Investigate the N errors above. Start with the most recent."
- If repeated errors: "Repeated error pattern detected — likely a systematic issue, not a one-off."
- If service restarts: "Service instability detected. Check resource usage and configuration."
- If warnings only: "Review warnings for deprecation or configuration issues."
- If clean: "No action needed."
```

---

## Graceful Degradation

This command handles missing resources without failing:

| Situation | Behavior |
|-----------|----------|
| `journalctl` not available | Skip systemd checks, note in report |
| No log directory found | Skip file-based checks, note in report |
| Log directory empty | Report "no log files found" |
| Specific service not found | Report "service not found in systemd" |
| No errors or warnings | Report "CLEAN" verdict |
| Both sources unavailable | Report "NO LOGS AVAILABLE" with troubleshooting guidance |

### If No Logs Available

```
No log sources found for analysis.

Troubleshooting:
1. Check if the service is running: systemctl status <service>
2. Check if file logging is configured: flu logs list
3. Check log directory permissions
4. Verify the service name matches a running systemd unit
```
