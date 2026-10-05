import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetPreview } from '../asset-preview.js';

function audioContext() {
  const sources = [];
  return {
    currentTime: 10,
    sources,
    destination: {},
    resume: async () => {},
    createBufferSource() {
      const source = {
        connect() {},
        disconnect() {},
        stop() {
          this.stopped = true;
        },
        start(_, offset) {
          this.offset = offset;
        },
      };
      sources.push(source);
      return source;
    },
  };
}

test('audio transport resumes, seeks, and ignores completion from a stopped source', async () => {
  const context = audioContext(),
    preview = new AssetPreview(
      () => null,
      () => context,
    );
  preview.buffer = { duration: 4 };
  await preview.play();
  context.currentTime += 1;
  assert.equal(preview.position, 1);
  preview.pause();
  assert.equal(preview.position, 1);
  assert.equal(preview.playing, false);
  await preview.play();
  assert.equal(context.sources[1].offset, 1);
  await preview.seek(3);
  assert.equal(context.sources[2].offset, 3);
  context.sources[1].onended();
  assert.equal(preview.playing, true);
  preview.close();
  assert.equal(preview.playing, false);
  assert.equal(preview.position, 0);
});

test('stop cancels playback waiting for the browser audio context to resume', async () => {
  const context = audioContext();
  let resume;
  context.resume = () =>
    new Promise((resolve) => {
      resume = resolve;
    });
  const preview = new AssetPreview(
    () => null,
    () => context,
  );
  preview.buffer = { duration: 4 };
  const pending = preview.play();
  preview.stop();
  resume();
  await pending;
  assert.equal(context.sources.length, 0);
  assert.equal(preview.playing, false);
});

test('audio waveform preserves peaks in opposite-phase stereo channels', async () => {
  const context = audioContext();
  context.decodeAudioData = async () => ({
    duration: 1,
    numberOfChannels: 2,
    getChannelData: (channel) => new Float32Array(1024).fill(channel ? -0.75 : 0.75),
  });
  const preview = new AssetPreview(
    () => null,
    () => context,
  );
  await preview.open('sound.wav', { data: 'data:audio/wav;base64,AAAA' }, 'audio');
  assert.equal(preview.ready, true);
  assert.ok(preview.peaks.every((peak) => peak[0] === -0.75 && peak[1] === 0.75));
  preview.close();
});
