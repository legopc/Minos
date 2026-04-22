/**
 * VuMeter — canvas-based vertical level meter
 * 
 * Usage:
 *   import { VuMeter } from '/modules/components/vu-meter.js';
 *   const meter = new VuMeter(canvasEl, channelIndex, 'input');  // type: 'input'|'output'
 *   // meter subscribes to pb:meters events automatically
 *   // Call meter.destroy() to clean up
 */

export class VuMeter {
  constructor(canvasEl, channelIndex, type) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.channelIndex = channelIndex;
    this.type = type; // 'input' | 'output'
    
    // Frame data (updated by pb:meters events)
    this.lastFrameData = null;
    this.rmsDb = -60;
    this.peakDb = -60;
    this.peakHoldDb = -60;
    this.grDb = 0;
    this.gateOpen = true;
    
    // Smoothing state for exponential moving average
    this._smoothRms = -60;
    this._smoothPeak = -60;
    
    // Animation state
    this.lastTime = performance.now();
    this.animationId = null;
    this.isDestroyed = false;
    
    // Resize observer
    this.resizeObserver = null;
    
    // Bind event handlers
    this.handleMetersEvent = this.handleMetersEvent.bind(this);
    
    // Initialize canvas size
    this.updateCanvasSize();
    
    // Set up resize observer
    this.setupResizeObserver();
    
    // Listen for meter events
    document.addEventListener('pb:meters', this.handleMetersEvent);
    
    // Start animation loop
    this.startAnimationLoop();
  }
  
  setupResizeObserver() {
    if (!window.ResizeObserver) return;
    
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.isDestroyed) {
        this.updateCanvasSize();
      }
    });
    
    this.resizeObserver.observe(this.canvas);
  }
  
  updateCanvasSize() {
    const width = this.canvas.offsetWidth;
    const height = this.canvas.offsetHeight;
    
    if (width > 0 && height > 0) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
  
  handleMetersEvent(event) {
    const frameData = event.detail;
    this.lastFrameData = frameData;
    
    // Extract data for this channel
    const isInput = this.type === 'input';
    // WebSocket sends: {rx: {rx_0: -45.0}, tx: {tx_0: -40.0}, peak: {rx_0: -40.0, tx_0: -35.0}, gr: {tx_0_lim: -3.0, ...}}
    const key = isInput ? `rx_${this.channelIndex}` : `tx_${this.channelIndex}`;
    const rmsObj = isInput ? frameData.rx : frameData.tx;
    const peakObj = frameData.peak; // peak is a flat object: {rx_0: -40.0, tx_0: -35.0, ...}
    const grObj = frameData.gr; // gr is a flat object: {tx_0_lim: -3.0, rx_0_cmp: -2.5, ...}

    // Exponential smoothing helpers
    const emaAttack  = (raw, prev, α) => α * raw + (1 - α) * prev;
    const emaRelease = (raw, prev, α) => α * raw + (1 - α) * prev;

    // Update smoothed RMS (backend sends dBFS, no conversion needed)
    if (rmsObj && rmsObj[key] !== undefined) {
      const raw = rmsObj[key]; // Already in dBFS
      const α = raw > this._smoothRms ? 0.25 : 0.04;
      this._smoothRms = emaAttack(raw, this._smoothRms, α);
      this.rmsDb = this._smoothRms;
    } else {
      this._smoothRms = emaRelease(-60, this._smoothRms, 0.04);
      this.rmsDb = this._smoothRms;
    }

    // Update smoothed peak (backend sends dBFS, no conversion needed)
    if (peakObj && peakObj[key] !== undefined) {
      const raw = peakObj[key]; // Already in dBFS
      const α = raw > this._smoothPeak ? 0.3 : 0.03;
      this._smoothPeak = emaAttack(raw, this._smoothPeak, α);
      this.peakDb = this._smoothPeak;
      if (this.peakDb > this.peakHoldDb) {
        this.peakHoldDb = this.peakDb;
      }
    }

    // Update GR (from gr object, key format: tx_0_lim or rx_0_cmp)
    if (grObj) {
      const grKey = isInput ? `rx_${this.channelIndex}_cmp` : `tx_${this.channelIndex}_lim`;
      if (grObj[grKey] !== undefined) {
        this.grDb = grObj[grKey];
      } else {
        this.grDb = 0;
      }
    } else {
      this.grDb = 0;
    }
  }
  
  linearToDb(linear) {
    if (linear <= 0) return -60;
    return 20 * Math.log10(Math.max(linear, 1e-7));
  }
  
  dbToCanvasY(db, height) {
    // Map dB (-60 to 0) to canvas Y (height to 0)
    // Bottom is -60dB (y=height), top is 0dB (y=0)
    const clampedDb = Math.max(-60, Math.min(0, db));
    return height - ((clampedDb - (-60)) / 60 * height);
  }
  
  getColorForDb(db) {
    if (db >= -3) return '#ff3b30'; // clip (red)
    if (db >= -12) return '#ff9f1c'; // warn (orange)
    return '#34c759'; // safe (green)
  }
  
  startAnimationLoop() {
    const animate = (now) => {
      if (this.isDestroyed) return;
      
      const dt = (now - this.lastTime) / 1000; // Convert to seconds
      this.lastTime = now;
      
      // Decay peak hold: 10 dB/s
      this.peakHoldDb -= 10 * dt;
      if (this.peakHoldDb < this.rmsDb) {
        this.peakHoldDb = this.rmsDb;
      }
      
      this.draw();
      this.animationId = requestAnimationFrame(animate);
    };
    
    this.animationId = requestAnimationFrame(animate);
  }
  
  draw() {
    const { width, height } = this.canvas;
    if (width === 0 || height === 0) return;
    
    // Background
    this.ctx.fillStyle = '#1a1a1f';
    this.ctx.fillRect(0, 0, width, height);
    
    const meterWidth = width - 24; // Leave space for scale on right
    const meterHeight = height - 16; // Leave space for labels
    const meterX = 2;
    const meterY = 4;
    
    // Draw RMS bar (color-coded by zones)
    this.drawRmsBar(meterX, meterY, meterWidth, meterHeight);
    
    // Draw peak hold line
    this.drawPeakLine(meterX, meterY, meterWidth, meterHeight);
    
    // Draw GR bar
    this.drawGrBar(meterX, meterY, meterWidth, meterHeight);
    
    // Draw dB scale
    this.drawScale(meterX + meterWidth + 4, meterY, 18, meterHeight);
  }
  
  drawRmsBar(x, y, width, height) {
    const rmsY = this.dbToCanvasY(this.rmsDb, height);
    const barHeight = height - (rmsY - y);
    
    if (barHeight <= 0) return;
    
    // Draw the RMS bar in segments by zone
    const zoneBreaks = [
      { dB: -60, y: y + height },
      { dB: -12, y: this.dbToCanvasY(-12, height) },
      { dB: -3, y: this.dbToCanvasY(-3, height) },
      { dB: 0, y: y }
    ];
    
    const colors = ['#34c759', '#ff9f1c', '#ff3b30'];
    
    for (let i = 0; i < 3; i++) {
      const topDb = zoneBreaks[i].dB;
      const bottomDb = zoneBreaks[i + 1].dB;
      const topY = zoneBreaks[i].y;
      const bottomY = zoneBreaks[i + 1].y;
      
      // Fill zone from its bottom up to min(rmsDb, zoneTop)
      const fillFloor = topDb;                        // bottom of this zone in dB
      const fillCeil  = Math.min(this.rmsDb, bottomDb); // clamp signal to zone ceiling
      
      if (fillFloor < fillCeil) {
        // Y coords: higher dB → lower Y (top of canvas)
        const fillTopY    = this.dbToCanvasY(fillCeil,  height);
        const fillBottomY = this.dbToCanvasY(fillFloor, height);
        const zoneHeight  = fillBottomY - fillTopY;
        
        if (zoneHeight > 0) {
          this.ctx.fillStyle = colors[i];
          this.ctx.fillRect(x, fillTopY, width, zoneHeight);
        }
      }
    }
  }
  
  drawPeakLine(x, y, width, height) {
    const peakY = this.dbToCanvasY(this.peakHoldDb, height) + y;
    
    if (peakY >= y && peakY <= y + height) {
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(x, peakY);
      this.ctx.lineTo(x + width, peakY);
      this.ctx.stroke();
    }
  }
  
  drawGrBar(x, y, width, height) {
    if (this.grDb > -0.5) return; // Only draw if GR is active
    
    const grAmount = Math.abs(this.grDb);
    const grHeight = (grAmount / 24) * height;
    const grWidth = 6;
    const grX = x + width - grWidth;
    
    this.ctx.fillStyle = '#00d4ff';
    this.ctx.fillRect(grX, y, grWidth, Math.min(grHeight, height));
  }
  
  drawScale(x, y, width, height) {
    const ticks = [0, -3, -6, -12, -18, -24, -40, -60];
    
    this.ctx.font = '9px ' + window.getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
    this.ctx.fillStyle = '#7a7a90';
    this.ctx.strokeStyle = '#7a7a90';
    this.ctx.lineWidth = 1;
    
    ticks.forEach(db => {
      const tickY = this.dbToCanvasY(db, height);
      
      if (tickY >= y && tickY <= y + height) {
        // Draw tick mark
        this.ctx.beginPath();
        this.ctx.moveTo(x, tickY);
        this.ctx.lineTo(x + 4, tickY);
        this.ctx.stroke();
        
        // Draw label
        const label = db.toString();
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label, x + 6, tickY);
      }
    });
  }
  
  destroy() {
    this.isDestroyed = true;
    
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    document.removeEventListener('pb:meters', this.handleMetersEvent);
  }
}
