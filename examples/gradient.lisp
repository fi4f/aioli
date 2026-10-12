; Load source starts fresh bindings. Patch source preserves top-level data.
; Rendering receives the app's dimensions and clock.
(on render (context)
  ((sh ()
    (return (vec4f uv (/ ( + (sin t) 1) 2)))) context))
