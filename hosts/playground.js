    import { Aioli, formatTrace } from '../aioli.js';

    const showError = error => {
      const message = formatTrace(error);
      document.getElementById('error').textContent = message;
      console.error(message);
    };
    const run = document.getElementById('run');
    run.disabled = true;
    const runtime = new Aioli({ onError: showError });
    try {
      await runtime.attach(document.getElementById('canvas'));
      run.disabled = false;
    } catch (error) { showError(error); }

    const generated = document.getElementById('javascript');
    const wgsl = document.getElementById('wgsl');
    const showProgram = program => {
      generated.value = program.javascript;
      wgsl.value = program.shaders.map(shader => shader.wgsl).join('\n\n');
    };
    const trace = document.getElementById('trace');
    const build = () => runtime.compileScene(document.getElementById('source').value, { trace: trace.checked });
    if (!run.disabled) showProgram(build());

    let runGeneration = 0;
    document.getElementById('run').onclick = async () => {
      const generation = ++runGeneration;
      generated.value = '';
      wgsl.value = '';
      document.getElementById('error').textContent = '';
      try {
        const program = build();
        showProgram(program);
        await runtime.activate(program);
      } catch (error) {
        if (generation === runGeneration) showError(error);
      }
    };
    trace.onchange = () => {
      generated.value = '';
      wgsl.value = '';
      document.getElementById('error').textContent = '';
      try { showProgram(build()); }
      catch (error) {
        document.getElementById('error').textContent = formatTrace(error);
      }
    };
