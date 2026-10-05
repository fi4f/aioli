/** Browser audio capability, shared by editor previews and exported applications. */
export class AudioOutput {
  async resume() {
    this.context ??= new AudioContext();
    await this.context.resume();
    return this.context;
  }
  async play(samples) {
    const context = await this.resume();
    const buffer = context.createBuffer(1, samples.length, 44100);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    source.onended = () => source.disconnect();
  }
}
