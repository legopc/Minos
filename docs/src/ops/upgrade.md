# Upgrades

## Update from Source

1. **Pull latest changes**:
   ```bash
   cd /home/legopc/dante-patchbox
   git pull origin main
   ```

2. **Rebuild**:
   ```bash
   cargo build --release --features inferno
   ```

3. **Stop the service**:
   ```bash
   sudo systemctl stop patchbox
   ```

4. **Backup current binary** (optional but recommended):
   ```bash
   sudo cp /opt/patchbox/patchbox /opt/patchbox/patchbox.backup
   ```

5. **Install new binary**:
   ```bash
   sudo cp target/release/patchbox /opt/patchbox/patchbox
   sudo chmod 755 /opt/patchbox/patchbox
   ```

6. **Check config compatibility** (review the CHANGELOG for breaking changes):
   ```bash
   # Edit /etc/patchbox/config.toml if needed
   ```

7. **Restart the service**:
   ```bash
   sudo systemctl start patchbox
   ```

8. **Verify startup**:
   ```bash
   systemctl status patchbox
   journalctl -u patchbox -n 20
   ```

## Config Migration

If the new release requires config changes, the service logs will indicate errors. Update `/etc/patchbox/config.toml` accordingly and retry.

## Rollback

If an upgrade introduces issues:

1. Restore the backup binary:
   ```bash
   sudo cp /opt/patchbox/patchbox.backup /opt/patchbox/patchbox
   ```

2. Restart:
   ```bash
   sudo systemctl restart patchbox
   ```

## Zero-Downtime Updates (Future)

Hot-reload of config and binary patches is planned but not yet implemented. Current upgrades require a brief service restart.
