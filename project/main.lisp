; A gradient that gently pulses with time (t, in seconds).
(let gradient (sh ()
  (vec4f uv (/ (+ (sin t) 1) 2) 1)))

(on render (context)
  (gradient context))
