(on render (context)
  ((sh ()
    (let uv (/ p (vec2 w h)))
    (return (vec4 uv 0 1))) context))
