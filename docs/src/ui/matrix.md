# Matrix Tab

The **Matrix** tab shows the routing grid—a 2D array where zones (TX) are rows and sources (RX) are columns. Each cell represents a **crosspoint** (source-to-zone routing).

## Grid Layout

- **Row headers** (left): Zone names and colours.
- **Column headers** (top): Source names and colours.
- **Cells**: Each crosspoint cell shows routing state and gain.

## Crosspoint Operations

- **Click a cell**: Toggle the route ON/OFF. Turns green when active.
- **Right-click or alt-click**: Adjust per-crosspoint gain in dB (0.0 = unity).
- **Lock icon** (corner): Lock the matrix to prevent accidental changes.
- **Solo mode** (corner): Solo a source or zone—routes only the solo'd source to its zone.
- **Copy mode** (corner): Copy a crosspoint route and paste it to others (useful for duplicating configurations).

## Colour Coding

- **Green cell**: Crosspoint is active (routing audio).
- **Gray/empty cell**: Crosspoint is inactive.
- **Zone colour stripe** on the left, **source colour stripe** on top for quick visual reference.

## Buses

If internal buses are configured, they appear as additional rows below the zones. Bus-to-bus and bus-to-TX routing is shown here.

## Real-Time Updates

All changes in the Matrix are reflected immediately in the audio output and optionally saved to config on exit.
