/** Browser decoding and playback only. Lisp paints the image window, waveform,
 * transport and pan/zoom controls; decoded images are sampled through WebGPU.
 */
export class AssetPreview {
  constructor(getGPU, getAudioContext) {
    this.getGPU = getGPU;
    this.getAudioContext = getAudioContext;
    this.revision = 0;
    this.playRevision = 0;
    this.path = '';
    this.ready = false;
    this.status = '';
    this.width = this.height = 0;
    this.offset = 0;
  }

  async open(path, resource, kind) {
    if (
      this.path === path &&
      this.data === resource?.data &&
      this.sourceMissing === !!resource?.sourceMissing
    )
      return;
    this.close();
    const revision = this.revision;
    this.path = path;
    this.data = resource?.data;
    this.sourceMissing = !!resource?.sourceMissing;
    this.kind = kind;
    this.status = 'Loading asset...';
    if (this.sourceMissing) {
      this.status = `Missing asset source: ${resource.source}`;
      return;
    }
    try {
      const blob = await (await fetch(resource.data)).blob();
      if (revision !== this.revision) return;
      if (kind === 'image') {
        const bitmap = await createImageBitmap(blob);
        try {
          if (revision !== this.revision) return;
          this.getGPU().uploadAssetImage(bitmap);
          this.width = bitmap.width;
          this.height = bitmap.height;
        } finally {
          bitmap.close();
        }
      } else {
        const context = this.getAudioContext();
        const buffer = await context.decodeAudioData(await blob.arrayBuffer());
        if (revision !== this.revision) return;
        this.buffer = buffer;
        // Preserve peaks across channels, including stereo with opposite phase.
        this.peaks = Array.from({ length: 512 }, () => [0, 0]);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) {
            const peak = this.peaks[Math.min(511, Math.floor((i / samples.length) * 512))];
            peak[0] = Math.min(peak[0], samples[i]);
            peak[1] = Math.max(peak[1], samples[i]);
          }
        }
      }
      if (revision !== this.revision) return;
      this.ready = true;
      this.status = '';
    } catch (error) {
      if (revision === this.revision) this.status = `Cannot preview: ${error.message}`;
    }
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }
  get playing() {
    return Boolean(this.source);
  }
  get position() {
    return this.source
      ? Math.min(this.duration, this.offset + this.getAudioContext().currentTime - this.started)
      : this.offset;
  }

  async play() {
    if (!this.buffer || this.source) return;
    const revision = this.revision,
      playRevision = ++this.playRevision,
      context = this.getAudioContext();
    await context.resume();
    if (revision !== this.revision || playRevision !== this.playRevision || this.source) return;
    if (this.offset >= this.duration) this.offset = 0;
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(context.destination);
    this.source = source;
    this.started = context.currentTime;
    source.onended = () => {
      source.disconnect();
      if (this.source === source) {
        this.source = null;
        this.offset = this.duration;
      }
    };
    source.start(0, this.offset);
  }

  pause() {
    this.playRevision++;
    this.offset = this.position;
    const source = this.source;
    this.source = null;
    if (source) {
      source.stop();
      source.disconnect();
    }
  }
  stop() {
    this.pause();
    this.offset = 0;
  }
  seek(seconds) {
    const playing = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration, seconds));
    if (playing) return this.play();
  }
  close() {
    this.stop();
    this.revision++;
    this.path = '';
    this.data = null;
    this.buffer = null;
    this.peaks = null;
    this.width = this.height = 0;
    this.ready = false;
    this.status = '';
  }
}
